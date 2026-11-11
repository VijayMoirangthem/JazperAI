"""Phase 9E — Telegram API routes"""
from __future__ import annotations
from fastapi import APIRouter, HTTPException
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


class ConfigBody(BaseModel):
    bot_token: str
    chat_id: str = ""   # optional: leave empty, message the bot, then approve yourself in the app
    enabled: bool = True


class ApproveBody(BaseModel):
    chat_id: str


class SendBody(BaseModel):
    text: str
    parse_mode: str = "Markdown"


@router.get("/status")
def telegram_status():
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT bot_token, chat_id, enabled, updated_at FROM telegram_config WHERE id = 1")
        row = cur.fetchone()
        if not row:
            return {"configured": False, "enabled": False}
        token, chat_id, enabled, updated_at = row
        return {
            "configured": bool(token and chat_id),
            "enabled": bool(enabled),
            "has_token": bool(token),
            "has_chat_id": bool(chat_id),
            "updated_at": updated_at.isoformat() if updated_at else None,
            "approved_chat_id": chat_id or "",
            "bot": __import__("core.services.telegram_bot", fromlist=["bot"]).bot.status(),
        }
    finally:
        cur.close(); conn.close()


@router.post("/configure")
def configure_telegram(body: ConfigBody):
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            UPDATE telegram_config
            SET bot_token = %s, chat_id = %s, enabled = %s, updated_at = NOW()
            WHERE id = 1
        """, (body.bot_token, body.chat_id, body.enabled))
        conn.commit()
        log.info("telegram: config updated", enabled=body.enabled)
    finally:
        cur.close(); conn.close()
    from core.services.telegram_bot import bot
    bot.start()  # picks up the new token/chat id on its next poll; no restart needed
    return {"ok": True}


@router.get("/pending")
def pending():
    """People who messaged the bot but are not approved yet (waiting for your click)."""
    from core.services.telegram_bot import bot
    return bot.status()


@router.post("/approve")
def approve(body: ApproveBody):
    """Approve one chat: the ONLY chat Jazper will answer. Only callable from this PC (the app), never from Telegram itself."""
    from core.services.telegram_bot import bot
    if body.chat_id not in bot.pending:
        raise HTTPException(404, "that chat has not messaged the bot (or the request expired)")
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("UPDATE telegram_config SET chat_id = %s, enabled = TRUE, updated_at = NOW() WHERE id = 1", (body.chat_id,))
        conn.commit()
    finally:
        cur.close(); conn.close()
    who = bot.pending.pop(body.chat_id)
    log.info("telegram: chat approved", name=who.get("name"))
    return {"ok": True, "approved": who}


@router.post("/send")
async def send_telegram(body: SendBody):
    from core.services.telegram_service import send_message
    result = await send_message(body.text, body.parse_mode)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "Send failed"))
    return result


@router.post("/test")
async def test_telegram():
    from core.services.telegram_service import send_message
    result = await send_message(
        "🤖 *Sir Jazper OS* — Telegram is connected and working!",
        parse_mode="Markdown",
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "Test failed"))
    return {"ok": True, "message": "Test message sent"}


@router.delete("/configure")
def clear_telegram():
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE telegram_config SET bot_token='', chat_id='', enabled=FALSE, updated_at=NOW() WHERE id=1"
        )
        conn.commit()
        return {"ok": True}
    finally:
        cur.close(); conn.close()
