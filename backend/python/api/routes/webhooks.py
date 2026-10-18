"""Phase 9B — Webhook / Event Triggers
Inbound webhooks fire agent chain-loop commands automatically.
"""
from __future__ import annotations
import hashlib, hmac, json, asyncio
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel
import psycopg2
import structlog
from core.config import settings as s

router = APIRouter()
log = structlog.get_logger()


def _conn():
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


class CreateWebhookBody(BaseModel):
    name: str
    secret: str = ""
    event_name: str = "generic"
    agent_codename: str = "jazper"
    chain_template: str
    active: bool = True


@router.get("")
def list_webhooks():
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, name, event_name, agent_codename, chain_template,
                   active, last_triggered, trigger_count, created_at
            FROM webhook_registry ORDER BY created_at DESC
        """)
        rows = cur.fetchall()
        return [
            {"id": str(r[0]), "name": r[1], "event_name": r[2], "agent_codename": r[3],
             "chain_template": r[4], "active": r[5],
             "last_triggered": r[6].isoformat() if r[6] else None,
             "trigger_count": r[7], "created_at": r[8].isoformat()}
            for r in rows
        ]
    finally:
        cur.close(); conn.close()


@router.post("", status_code=201)
def create_webhook(body: CreateWebhookBody):
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO webhook_registry (name, secret, event_name, agent_codename, chain_template, active)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """, (body.name, body.secret, body.event_name, body.agent_codename, body.chain_template, body.active))
        webhook_id = str(cur.fetchone()[0])
        conn.commit()
        log.info("webhook: created", id=webhook_id, name=body.name)
        return {"ok": True, "id": webhook_id}
    finally:
        cur.close(); conn.close()


@router.patch("/{webhook_id}/toggle")
def toggle_webhook(webhook_id: str):
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE webhook_registry SET active = NOT active WHERE id = %s RETURNING active",
            (webhook_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Webhook not found")
        conn.commit()
        return {"ok": True, "active": row[0]}
    finally:
        cur.close(); conn.close()


@router.delete("/{webhook_id}")
def delete_webhook(webhook_id: str):
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM webhook_registry WHERE id = %s RETURNING id", (webhook_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Webhook not found")
        conn.commit()
        return {"ok": True}
    finally:
        cur.close(); conn.close()


async def _fire_chain(agent_codename: str, chain_message: str, webhook_id: str):
    """Background: run the chain loop for this webhook trigger."""
    from concurrent.futures import ThreadPoolExecutor
    from api.routes.chain_loop import run_chain_loop
    from api.routes.agents import _get_agent_row

    try:
        _executor = ThreadPoolExecutor(max_workers=1)
        loop = asyncio.get_event_loop()

        full_result = []
        async for raw in run_chain_loop(
            message=chain_message,
            session_id=f"webhook-{webhook_id}",
            history=[],
            executor=_executor,
            loop=loop,
            resolved_email=None,
            user_profile=None,
            core_memories=None,
            model=None,
        ):
            if isinstance(raw, str) and "[CHAIN_DONE]" in raw:
                full_result.append(raw)

        log.info("webhook: chain completed", webhook_id=webhook_id, agent=agent_codename)
    except Exception as exc:
        log.error("webhook: chain failed", webhook_id=webhook_id, error=str(exc))


@router.post("/{webhook_id}/inbound")
async def inbound_webhook(webhook_id: str, request: Request, background_tasks: BackgroundTasks):
    """
    Receive an inbound webhook payload, verify the secret (HMAC-SHA256 or plain),
    expand the chain template with payload variables, and fire the chain loop.
    """
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT name, secret, agent_codename, chain_template, active
            FROM webhook_registry WHERE id = %s
        """, (webhook_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Webhook not found")

        name, secret, agent_codename, chain_template, active = row
        if not active:
            raise HTTPException(403, "Webhook is disabled")

        body_bytes = await request.body()
        # Secret verification (optional — skip if secret is empty)
        if secret:
            sig_header = request.headers.get("X-Hub-Signature-256", "")
            expected = "sha256=" + hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig_header, expected):
                raise HTTPException(401, "Invalid signature")

        # Parse payload for template substitution
        try:
            payload = json.loads(body_bytes) if body_bytes else {}
        except Exception:
            payload = {}

        # Simple {key} template substitution from payload
        chain_message = chain_template
        for k, v in _flatten(payload).items():
            chain_message = chain_message.replace(f"{{{k}}}", str(v))

        # Update trigger stats
        cur.execute("""
            UPDATE webhook_registry
            SET last_triggered = NOW(), trigger_count = trigger_count + 1
            WHERE id = %s
        """, (webhook_id,))
        conn.commit()

        background_tasks.add_task(_fire_chain, agent_codename, chain_message, webhook_id)
        log.info("webhook: triggered", id=webhook_id, name=name, agent=agent_codename)
        return {"ok": True, "triggered": True, "message": chain_message[:200]}
    finally:
        cur.close(); conn.close()


@router.post("/{webhook_id}/test")
async def test_webhook(webhook_id: str, background_tasks: BackgroundTasks):
    """Fire the webhook immediately with an empty payload — for testing."""
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute(
            "SELECT agent_codename, chain_template, active FROM webhook_registry WHERE id = %s",
            (webhook_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Webhook not found")
        agent_codename, chain_template, active = row
        if not active:
            raise HTTPException(403, "Webhook is disabled")
        cur.execute(
            "UPDATE webhook_registry SET last_triggered = NOW(), trigger_count = trigger_count + 1 WHERE id = %s",
            (webhook_id,)
        )
        conn.commit()
        background_tasks.add_task(_fire_chain, agent_codename, chain_template, webhook_id)
        return {"ok": True, "fired": True}
    finally:
        cur.close(); conn.close()


def _flatten(d: dict, prefix: str = "") -> dict[str, str]:
    """Flatten nested dict to dotted keys for template substitution."""
    out: dict[str, str] = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(_flatten(v, key))
        elif isinstance(v, (list, tuple)):
            out[key] = ", ".join(str(i) for i in v)
        else:
            out[key] = str(v)
    return out
