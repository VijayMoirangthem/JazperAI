"""
Phase 10B — Instant alert service.

Called by HermesMonitorWorker and GmailReplyMonitorWorker when important
emails are detected. Checks per-category config and sends via Telegram.
"""
from __future__ import annotations
import structlog

from memory.db.legacy_pg import _pg

log = structlog.get_logger()

# Maps email category names (from both workers) → alert_config column
_CATEGORY_MAP: dict[str, str] = {
    # From HermesMonitorWorker categories
    "recruiter_outreach":  "recruiter_email",
    "interview_invite":    "interview_invite",
    "offer_letter":        "offer_letter",
    "rejection":           "job_rejection",
    "action_required":     "action_required",
    # From GmailReplyMonitorWorker new_status values
    "interview":           "interview_invite",
    "rejected":            "job_rejection",
    "response":            "recruiter_email",
}

# Emoji per category for the Telegram message
_CATEGORY_EMOJI: dict[str, str] = {
    "recruiter_email":   "📨",
    "interview_invite":  "🎯",
    "offer_letter":      "🎉",
    "job_rejection":     "📋",
    "action_required":   "⚡",
    "important_email":   "📬",
}


def get_alert_config() -> dict:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT recruiter_email, interview_invite, job_rejection,
                           offer_letter, action_required, important_email
                    FROM alert_config WHERE id = 1
                """)
                row = cur.fetchone()
        if not row:
            return _default_config()
        return {
            "recruiter_email":  row[0],
            "interview_invite": row[1],
            "job_rejection":    row[2],
            "offer_letter":     row[3],
            "action_required":  row[4],
            "important_email":  row[5],
        }
    except Exception as e:
        log.warning("alert_config read failed", error=str(e))
        return _default_config()


def _default_config() -> dict:
    return {
        "recruiter_email": True, "interview_invite": True,
        "job_rejection": True,   "offer_letter": True,
        "action_required": False, "important_email": False,
    }


def save_alert_config(updates: dict) -> None:
    allowed = {
        "recruiter_email", "interview_invite", "job_rejection",
        "offer_letter", "action_required", "important_email",
    }
    clean = {k: v for k, v in updates.items() if k in allowed}
    if not clean:
        return
    clauses = ", ".join(f"{k} = %s" for k in clean)
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE alert_config SET {clauses}, updated_at = NOW() WHERE id = 1",
                list(clean.values()),
            )
        conn.commit()


async def try_send_alert(category: str, title: str, body: str) -> None:
    """
    Check if alerts are enabled for this category, then send via Telegram.
    Never raises — called from workers so failures must be silent.
    """
    try:
        cfg_key = _CATEGORY_MAP.get(category)
        if not cfg_key:
            return

        cfg = get_alert_config()
        if not cfg.get(cfg_key, False):
            return

        emoji = _CATEGORY_EMOJI.get(cfg_key, "🔔")
        message = f"{emoji} *{title}*\n\n{body}"

        from core.services.telegram_service import send_message
        await send_message(message)
        log.info("Alert sent via Telegram", category=category, cfg_key=cfg_key)
    except Exception as e:
        log.warning("Alert send failed", category=category, error=str(e))


def try_send_alert_sync(category: str, title: str, body: str) -> None:
    """
    Sync wrapper. Safe to call from anywhere — uses asyncio.create_task if a
    loop is running, otherwise opens a new loop.
    """
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(try_send_alert(category, title, body))
    except RuntimeError:
        # No running loop — run directly (rare, e.g. during startup)
        try:
            asyncio.run(try_send_alert(category, title, body))
        except Exception:
            pass
    except Exception as e:
        log.warning("try_send_alert_sync failed", error=str(e))
