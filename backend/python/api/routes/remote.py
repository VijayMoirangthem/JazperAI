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


_PAIR_MEM: dict[str, float] = {}  # used only while Redis is unavailable (for example Docker is not running)


async def _pair_put(code: str) -> None:
    try:
        await layer.client().set(f"tenant:platform:pair:{code}", "1", ex=PAIR_TTL)
        return
    except Exception:
        pass
    now = time.time()
    for k in [k for k, exp in _PAIR_MEM.items() if exp < now]:
        _PAIR_MEM.pop(k, None)
    _PAIR_MEM[code] = now + PAIR_TTL


async def _pair_take(code: str) -> bool:
    try:
        c = layer.client()
        key = f"tenant:platform:pair:{code}"
        if await c.get(key):
            await c.delete(key)
            return True
    except Exception:
        pass
    return _PAIR_MEM.pop(code, 0) > time.time()


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
    await _pair_put(code)
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
    if not await _pair_take(body.code.upper()):  # single use
        raise HTTPException(400, "invalid or expired code")
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
                                                                     "enabled": b["enabled"], "score": b["score"], "grade": b["grade"], "look": orgchart.SETTINGS.get(b["slug"], {}).get("look")} for b in g["bots"] if b["enabled"]]} for g in groups if g["id"] != "legacy"]}


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
    import asyncio
    # unread_count() is a plain (blocking) function returning {"count": n}: run it off the event loop. It was awaited directly, which
    # raised TypeError (HTTP 500) on every call, so the phone's unread badge never worked.
    res = await asyncio.to_thread(n.unread_count)
    return {"unread": res.get("count", 0) if isinstance(res, dict) else res}


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


# ── V2: one-tap sign-in (development scaffolding until real accounts exist) ──────────────────────────────
import ipaddress
import re

from core.remote_guard import is_remote


class DevSigninIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    platform: str = Field(default="", max_length=20)
    push_token: str | None = None


def _private_client(request: Request) -> bool:
    host = request.client.host if request.client else ""
    if host in ("localhost", "testclient"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private


async def _rate(key: str, limit: int, window: int) -> None:
    try:
        c = layer.client()
        k = f"tenant:platform:rate:{key}:{int(time.time() // window)}"
        n = await c.incr(k)
        if n == 1:
            await c.expire(k, window + 30)
        if n > limit:
            raise HTTPException(429, "too many requests")
    except HTTPException:
        raise
    except Exception:
        pass  # Redis down: do not lock the founder out


@router.post("/auth/dev-signin")
async def dev_signin(body: DevSigninIn, request: Request):
    """Same response as /pair/complete. Off by default; loopback/LAN only; never through the tunnel."""
    if vault.get("REMOTE_DEV_SIGNIN") != "1":
        raise HTTPException(403, "one-tap sign-in is turned off on the computer")
    if is_remote(request.scope) or not _private_client(request):
        raise HTTPException(403, "one-tap sign-in works only on the local network")
    await _rate("devsignin", 5, 3600)
    dsecret = secrets.token_urlsafe(32)
    rows = await aio.fetch("INSERT INTO shared.devices(name, platform, secret_hash, push_token) VALUES($1,$2,$3,$4) RETURNING id::text AS id", body.name, body.platform, _hash(dsecret), body.push_token)
    await audit.write("create_origins", "remote-dev-signin", {"device": rows[0]["id"], "name": body.name})
    return {"device_id": rows[0]["id"], "device_secret": dsecret, "access_token": _token(rows[0]["id"]), "expires_in": ACCESS_TTL}


@local_router.post("/dev-signin/enable")
async def dev_signin_enable():
    vault.set("REMOTE_DEV_SIGNIN", "1")
    await audit.write("create_origins", "remote-dev-signin-enabled", {})
    return {"enabled": True}


@local_router.post("/dev-signin/disable")
async def dev_signin_disable():
    vault.set("REMOTE_DEV_SIGNIN", "0")
    await audit.write("create_origins", "remote-dev-signin-disabled", {})
    return {"enabled": False}


# ── V2: create a bot and its look from the phone ─────────────────────────────────────────────────────────
LOOK_BODIES = {"circle", "blob", "squircle", "capsule", "triangle", "hexagon", "cloud", "drop", "star", "cursor", "shield", "diamond"}
LOOK_COLORS = {"white", "brown", "red", "orange", "amber", "green", "teal", "blue", "purple", "pink", "grey", "black"}
PHONE_CREW = "mobile"
CORE_BOTS = {"jasper"}


class LookIn(BaseModel):
    body: str
    color: str


def _check_look(look: LookIn) -> dict:
    if look.body not in LOOK_BODIES or look.color not in LOOK_COLORS:
        raise HTTPException(422, "unknown shape or colour")
    return {"body": look.body, "color": look.color}


async def _save_look(slug: str, look: dict) -> None:
    import json as _json
    from agents import orgchart
    cur = dict(orgchart.SETTINGS.get(slug, {}))
    cur["look"] = look
    orgchart.SETTINGS[slug] = cur
    await aio.execute("INSERT INTO shared.bot_org(slug) VALUES($1) ON CONFLICT DO NOTHING", slug)
    await aio.execute("UPDATE shared.bot_org SET settings=$2::jsonb, updated_at=now() WHERE slug=$1", slug, _json.dumps(cur))


def _clean(text: str, limit: int) -> str:
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text or "").strip()[:limit]


class BotCreateIn(BaseModel):
    display_name: str = Field(min_length=2, max_length=40)
    role_title: str = Field(default="", max_length=60)
    instructions: str = Field(default="", max_length=500)
    look: LookIn | None = None


class BotPatchIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=40)
    role_title: str | None = Field(default=None, max_length=60)


@router.post("/bots")
async def create_bot(body: BotCreateIn, d: dict = Depends(device)):
    """Safe defaults are decided here, never by the phone: no tools, standard model tier, crew 'mobile'."""
    from agents.registry import BotDef, registry
    await _rate(f"botcreate:{d['id']}", 10, 3600)
    await registry.reload()
    name = _clean(body.display_name, 40)
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "bot"
    slug, n = base, 2
    while registry.get(slug) or slug in CORE_BOTS or len(slug) < 2:
        slug, n = f"{base}-{n}", n + 1
    role = _clean(body.role_title, 60) or "Assistant"
    prompt = f"You are {name}, a helpful assistant. Role: {role}.\n" + (f"What you should do: {_clean(body.instructions, 500)}\n" if body.instructions else "") + "Be clear, kind and brief."
    bot = await registry.upsert(BotDef(slug=slug, display_name=name, role_title=role, crew=PHONE_CREW, prompt=prompt, tools=[], reports_to="jasper"))
    look = _check_look(body.look) if body.look else None
    if look:
        await _save_look(slug, look)
    await audit.write("create_origins", "remote-bot-created", {"device": d["id"], "slug": slug})
    return {"slug": slug, "display_name": bot.display_name, "position": role, "department": "", "enabled": True, "score": None, "grade": "", "look": look}


@router.put("/bots/{slug}/look")
async def put_look(slug: str, body: LookIn, d: dict = Depends(device)):
    look = _check_look(body)
    await _save_look(slug, look)
    return {"slug": slug, "look": look}


@router.patch("/bots/{slug}")
async def patch_bot(slug: str, body: BotPatchIn, d: dict = Depends(device)):
    from agents.registry import registry
    await registry.reload()
    bot = registry.get(slug)
    if bot is None or slug in CORE_BOTS:
        raise HTTPException(403, "this bot can only be changed on the computer")
    if body.display_name:
        bot.display_name = _clean(body.display_name, 40)
    if body.role_title is not None:
        bot.role_title = _clean(body.role_title, 60)
    await registry.upsert(bot)
    await audit.write("create_origins", "remote-bot-renamed", {"device": d["id"], "slug": slug})
    return {"slug": slug, "display_name": bot.display_name, "role_title": bot.role_title}


@router.delete("/bots/{slug}")
async def archive_bot(slug: str, d: dict = Depends(device)):
    from agents.registry import registry
    await registry.reload()
    bot = registry.get(slug)
    if bot is None or slug in CORE_BOTS or bot.crew != PHONE_CREW:
        raise HTTPException(403, "only bots made on the phone can be archived here")
    await registry.disable(slug)
    await audit.write("create_origins", "remote-bot-archived", {"device": d["id"], "slug": slug})
    return {"slug": slug, "enabled": False}


# ── V2: read-only plugin catalogue (never secrets) ──────────────────────────────────────────────────────
FEATURED_IDS = ("gmail", "google-calendar", "google-drive", "slack", "notion", "github")


def _logo_key(cid: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", cid.lower())[:40]


@router.get("/connectors")
async def connectors_catalogue(d: dict = Depends(device)):
    from agents import connector
    items = []
    for st in await connector.overview():
        cid = str(st.get("id", ""))
        connected = bool(st.get("connected"))
        needs = bool(st.get("missing")) and not connected
        items.append({"id": cid, "name": str(st.get("name") or cid.replace("-", " ").title())[:60],
                      "description": _clean(str(st.get("why") or st.get("description") or ""), 140),
                      "category": str(st.get("category") or "general")[:30], "logo_key": _logo_key(cid), "connected": connected,
                      "status": "added" if connected else "needs_attention" if needs else "available",
                      "tier_summary": "read_write" if connected else "read"})
    featured = [i for i in items if i["connected"] or i["id"] in FEATURED_IDS][:8]
    team = [i for i in items if i not in featured][:8]
    return {"featured": featured, "team": team, "all": items}


@router.post("/connectors/{cid}/request")
async def connector_request(cid: str, d: dict = Depends(device)):
    from agents import connector
    if cid not in connector.catalogue():
        raise HTTPException(404, "unknown plugin")
    await _rate(f"connreq:{d['id']}", 20, 3600)
    await audit.write("create_origins", "remote-connector-request", {"device": d["id"], "connector": cid})
    return {"requested": True}
