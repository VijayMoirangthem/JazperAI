"""Phase 9E — Telegram API routes"""
from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2
import structlog
from app.core.config import settings as s

router = APIRouter()
log = structlog.get_logger()


def _conn():
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


class ConfigBody(BaseModel):
    bot_token: str
    chat_id: str
    enabled: bool = True


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
        return {"ok": True}
    finally:
        cur.close(); conn.close()


@router.post("/send")
async def send_telegram(body: SendBody):
    from app.services.telegram_service import send_message
    result = await send_message(body.text, body.parse_mode)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "Send failed"))
    return result


@router.post("/test")
async def test_telegram():
    from app.services.telegram_service import send_message
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
