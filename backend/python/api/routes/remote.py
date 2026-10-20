"""Remote access for the phone app (Plan V3 W8).

Local-only management (blocked remotely by core/remote_guard.py), under /api/remote:  start pairing, list devices, revoke.
Remote surface, under /remote/v1 (the ONLY paths a tunnel can reach):  pair/complete, auth/refresh, me, bots, chat/stream, approvals, notifications, status.

Auth: pairing creates a device with a random secret (stored hashed). The app exchanges id+secret for a 15-minute HS256 access token
(key in the OS vault, REMOTE_JWT_KEY) and refreshes the same way. Revoking a device stops it at the next refresh and immediately at the next call.
Tier-3 approvals from a phone additionally require the device secret in `confirm` (the app releases it only after a biometric prompt).
Every pairing, revocation and approval is written to the hash-chained audit log. Per-device rate limit: 240 requests/minute.
"""
import hashlib
import hmac
import secrets
import time
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from core import audit, hitl, vault
from memory.db import aio
from memory.redis import layer

local_router = APIRouter()
router = APIRouter()
ACCESS_TTL = 15 * 60
PAIR_TTL = 300
RATE_PER_MIN = 240
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no look-alike characters


def _key() -> str:
    k = vault.get("REMOTE_JWT_KEY")
    if not k:
        k = secrets.token_urlsafe(48)
        vault.set("REMOTE_JWT_KEY", k)
    return k


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _token(device_id: str) -> str:
    now = int(time.time())
    return jwt.encode({"sub": device_id, "typ": "access", "iat": now, "exp": now + ACCESS_TTL}, _key(), algorithm="HS256")


async def device(request: Request, authorization: str = Header(default="")) -> dict:
    """Dependency for every authenticated remote route: valid access token, device not revoked, within the rate limit."""
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing token")
    try:
        claims = jwt.decode(authorization[7:], _key(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid or expired token")
    if claims.get("typ") != "access":
        raise HTTPException(401, "wrong token type")
    rows = await aio.fetch("SELECT id::text AS id, name, revoked FROM shared.devices WHERE id=$1::uuid", claims["sub"])
    if not rows or rows[0]["revoked"]:
        raise HTTPException(401, "device revoked")
    try:
        c = layer.client()
        n = await c.incr(f"tenant:platform:rate:{claims['sub']}:{int(time.time() // 60)}")
        if n == 1:
            await c.expire(f"tenant:platform:rate:{claims['sub']}:{int(time.time() // 60)}", 90)
        if n > RATE_PER_MIN:
            raise HTTPException(429, "rate limit")
    except HTTPException:
        raise
    except Exception:
        pass  # Redis down: do not lock the founder out
    await aio.execute("UPDATE shared.devices SET last_seen=now(), last_ip=$2 WHERE id=$1::uuid", claims["sub"], request.headers.get("cf-connecting-ip") or (request.client.host if request.client else ""))
    return dict(rows[0])


# ── local management ────────────────────────────────────────────────────────────────────────────────
@local_router.post("/pair/start")
async def pair_start():
    code = "".join(secrets.choice(ALPHABET) for _ in range(8))
    await layer.client().set(f"tenant:platform:pair:{code}", "1", ex=PAIR_TTL)
    url = vault.get("REMOTE_PUBLIC_URL") or ""
    await audit.write("create_origins", "remote-pair-start", {"expires_s": PAIR_TTL})
    return {"code": code, "expires_s": PAIR_TTL, "url": url, "qr_payload": f"jasper://pair?u={url}&c={code}"}


@local_router.get("/devices")
async def devices():
    rows = await aio.fetch("SELECT id::text AS id, name, platform, revoked, created_at, last_seen, last_ip FROM shared.devices ORDER BY created_at DESC")
    return {"devices": [dict(r) for r in rows]}


@local_router.delete("/devices/{device_id}")
async def revoke(device_id: UUID):
    await aio.execute("UPDATE shared.devices SET revoked=true WHERE id=$1", device_id)
    await audit.write("create_origins", "remote-device-revoked", {"device": str(device_id)})
    return {"revoked": str(device_id)}


@local_router.put("/public-url")
async def set_public_url(body: dict):
    u = str(body.get("url", "")).strip().rstrip("/")
    if not u.startswith("https://"):
        raise HTTPException(422, "use the https URL of your tunnel")
    vault.set("REMOTE_PUBLIC_URL", u)
    return {"url": u}


# ── remote surface ──────────────────────────────────────────────────────────────────────────────────
class PairIn(BaseModel):
    code: str = Field(min_length=8, max_length=8)
    name: str = Field(min_length=1, max_length=60)
    platform: str = Field(default="", max_length=20)
    push_token: str | None = None


class RefreshIn(BaseModel):
    device_id: UUID
    device_secret: str


@router.post("/pair/complete")
async def pair_complete(body: PairIn):
    c = layer.client()
    key = f"tenant:platform:pair:{body.code.upper()}"
    if not await c.get(key):
        raise HTTPException(400, "invalid or expired code")
    await c.delete(key)  # single use
    dsecret = secrets.token_urlsafe(32)
    rows = await aio.fetch("INSERT INTO shared.devices(name, platform, secret_hash, push_token) VALUES($1,$2,$3,$4) RETURNING id::text AS id", body.name, body.platform, _hash(dsecret), body.push_token)
    await audit.write("create_origins", "remote-device-paired", {"device": rows[0]["id"], "name": body.name, "platform": body.platform})
    return {"device_id": rows[0]["id"], "device_secret": dsecret, "access_token": _token(rows[0]["id"]), "expires_in": ACCESS_TTL}


@router.post("/auth/refresh")
async def refresh(body: RefreshIn):
    rows = await aio.fetch("SELECT secret_hash, revoked FROM shared.devices WHERE id=$1", body.device_id)
    if not rows or rows[0]["revoked"] or not hmac.compare_digest(rows[0]["secret_hash"], _hash(body.device_secret)):
        raise HTTPException(401, "invalid device credentials")
    return {"access_token": _token(str(body.device_id)), "expires_in": ACCESS_TTL}


@router.get("/me")
async def me(d: dict = Depends(device)):
    return {"device_id": d["id"], "name": d["name"]}


@router.get("/bots")
async def bots(d: dict = Depends(device)):
    from agents import orgchart
    groups = (await orgchart.tree())["groups"]
    return {"groups": [{"id": g["id"], "label": g["label"], "bots": [{"slug": b["slug"], "display_name": b["display_name"], "position": b["position"], "department": b["department"],
                                                                     "enabled": b["enabled"], "score": b["score"], "grade": b["grade"]} for b in g["bots"] if b["enabled"]]} for g in groups if g["id"] != "legacy"]}


@router.post("/chat/stream")
async def chat_stream(body: dict, d: dict = Depends(device)):
    """Same NDJSON event stream as the desktop chat (speaker/delta/tool/ui/done/error)."""
    from api.routes.chat2 import ChatIn, stream
    return await stream(ChatIn(**{k: v for k, v in body.items() if k in ("text", "slug", "history", "attachments", "tier")}))


@router.get("/approvals")
async def approvals(d: dict = Depends(device)):
    rows = await aio.fetch("SELECT request_id::text AS request_id, tier, action, summary, requester, created_at FROM shared.hitl_requests WHERE status='pending' ORDER BY created_at DESC LIMIT 50")
    return {"requests": [dict(r) for r in rows]}


class RespondIn(BaseModel):
    approve: bool
    confirm: str | None = None  # device secret, released by the app after a biometric prompt (required for Tier 3)


@router.post("/approvals/{request_id}/respond")
async def respond(request_id: UUID, body: RespondIn, d: dict = Depends(device)):
    rows = await aio.fetch("SELECT tier FROM shared.hitl_requests WHERE request_id=$1 AND status='pending'", request_id)
    if not rows:
        raise HTTPException(404, "no such pending request")
    if body.approve and rows[0]["tier"] >= 3:
        h = await aio.fetch("SELECT secret_hash FROM shared.devices WHERE id=$1::uuid", d["id"])
        if not body.confirm or not hmac.compare_digest(h[0]["secret_hash"], _hash(body.confirm)):
            raise HTTPException(403, "Tier 3 needs the biometric confirmation from this device")
    ok = await hitl.respond(request_id, body.approve, "founder")
    await audit.write("create_origins", "remote-approval", {"device": d["id"], "request": str(request_id), "approve": body.approve, "tier": rows[0]["tier"]})
    return {"resolved": ok}


@router.get("/notifications")
async def notifications(d: dict = Depends(device)):
    from api.routes import notifications as n
    return {"unread": (await n.unread_count()) if hasattr(n, "unread_count") else None}


@router.get("/status")
async def status(d: dict = Depends(device)):
    from core import metrics
    s = await metrics.slo_status_async()
    return {"slos": s["slos"], "pending_approvals": (await aio.fetch("SELECT count(*) AS n FROM shared.hitl_requests WHERE status='pending'"))[0]["n"]}


# ── more remote endpoints used by the phone app ─────────────────────────────────────────────────────────
@router.get("/comms/threads")
async def comms_threads(d: dict = Depends(device)):
    from agents import comms
    return {"threads": await comms.threads()}


@router.get("/comms/thread")
async def comms_thread(id: str, since_id: int = 0, d: dict = Depends(device)):
    from agents import comms
    return {"messages": await comms.messages(id, since_id)}


@router.get("/bots/{slug}/card")
async def bot_card(slug: str, d: dict = Depends(device)):
    from agents import orgchart
    c = await orgchart.card(slug)
    if not c:
        raise HTTPException(404, "unknown bot")
    return {k: v for k, v in c.items() if k not in ("prompt",)}  # the system prompt stays on the desktop


@router.post("/voice/transcribe")
async def voice_transcribe(request: Request, d: dict = Depends(device)):
    """Multipart field `audio` (wav/webm/m4a). Same engine as the desktop voice note."""
    from fastapi import UploadFile
    from api.routes.voice import transcribe
    form = await request.form()
    audio = form.get("audio")
    if not isinstance(audio, UploadFile) and not hasattr(audio, "read"):
        raise HTTPException(422, "multipart field 'audio' is required")
    return await transcribe(audio)


@router.get("/voice/speak")
async def voice_speak(text: str, voice: str = "en-US-AriaNeural", d: dict = Depends(device)):
    from api.routes.voice2 import speak
    return await speak(text, voice)


class PushIn(BaseModel):
    token: str = Field(min_length=10, max_length=300)


@router.post("/push/register")
async def push_register(body: PushIn, d: dict = Depends(device)):
    await aio.execute("UPDATE shared.devices SET push_token=$2 WHERE id=$1::uuid", d["id"], body.token)
    return {"ok": True}
