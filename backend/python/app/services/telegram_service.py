"""Phase 9E — Telegram notification service
Uses the Telegram Bot API directly (no third-party library needed).
Reads bot_token + chat_id from the telegram_config DB table.
"""
from __future__ import annotations
import asyncio
import httpx
import psycopg2
import structlog
from app.core.config import settings as s

log = structlog.get_logger()

_TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


def _get_config() -> tuple[str, str, bool]:
    """Return (bot_token, chat_id, enabled) from DB."""
    try:
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("SELECT bot_token, chat_id, enabled FROM telegram_config WHERE id = 1")
        row = cur.fetchone()
        cur.close(); conn.close()
        if row:
            return row[0] or "", row[1] or "", bool(row[2])
    except Exception as exc:
        log.warning("telegram: config read failed", error=str(exc))
    return "", "", False


async def send_message(text: str, parse_mode: str = "Markdown") -> dict:
    """
    Send a message via the Telegram Bot API.
    Returns {"ok": True} or {"ok": False, "error": "..."}.
    """
    bot_token, chat_id, enabled = _get_config()

    if not enabled:
        return {"ok": False, "error": "Telegram not enabled"}
    if not bot_token or not chat_id:
        return {"ok": False, "error": "Telegram not configured (missing token or chat_id)"}

    url = _TELEGRAM_API.format(token=bot_token)
    payload = {"chat_id": chat_id, "text": text[:4096], "parse_mode": parse_mode}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()
            if resp.status_code == 200 and data.get("ok"):
                log.info("telegram: message sent", chars=len(text))
                return {"ok": True}
            log.warning("telegram: send failed", status=resp.status_code, body=data)
            return {"ok": False, "error": data.get("description", "Unknown error")}
    except Exception as exc:
        log.error("telegram: http error", error=str(exc))
        return {"ok": False, "error": str(exc)}


def send_message_sync(text: str) -> dict:
    """Sync wrapper for use in non-async contexts."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                fut = pool.submit(asyncio.run, send_message(text))
                return fut.result(timeout=15)
        return loop.run_until_complete(send_message(text))
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
