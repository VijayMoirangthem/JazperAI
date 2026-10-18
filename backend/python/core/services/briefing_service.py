"""
Phase 10A — Morning/Evening Briefing Service

Collects real-time data (calendar, email, jobs), formats it via LLM in
Jazper's voice, and delivers via Telegram. Runs on schedule from scheduler.py
and can be triggered manually via the briefings API.
"""
from __future__ import annotations
from core.config import settings as _settings
_LIGHT_MODEL = _settings.LIGHT_MODEL
import asyncio
import json
from datetime import datetime, timezone

import structlog

from memory.db.legacy_pg import _pg

log = structlog.get_logger()

_BRIEFING_MODEL = _LIGHT_MODEL


# ── Config ────────────────────────────────────────────────────────────────────

def get_briefing_config() -> dict:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT morning_enabled, morning_hour, morning_minute,
                           evening_enabled, evening_hour, evening_minute,
                           include_calendar, include_email, include_jobs,
                           last_morning_sent_at, last_evening_sent_at
                    FROM briefing_config WHERE id = 1
                """)
                row = cur.fetchone()
        if not row:
            return _default_config()
        return {
            "morning_enabled":       row[0],
            "morning_hour":          row[1],
            "morning_minute":        row[2],
            "evening_enabled":       row[3],
            "evening_hour":          row[4],
            "evening_minute":        row[5],
            "include_calendar":      row[6],
            "include_email":         row[7],
            "include_jobs":          row[8],
            "last_morning_sent_at":  row[9].isoformat() if row[9] else None,
            "last_evening_sent_at":  row[10].isoformat() if row[10] else None,
        }
    except Exception as e:
        log.warning("briefing_config read failed", error=str(e))
        return _default_config()


def _default_config() -> dict:
    return {
        "morning_enabled": False, "morning_hour": 2, "morning_minute": 0,
        "evening_enabled": False, "evening_hour": 15, "evening_minute": 30,
        "include_calendar": True, "include_email": True, "include_jobs": True,
        "last_morning_sent_at": None, "last_evening_sent_at": None,
    }


def save_briefing_config(updates: dict) -> None:
    allowed = {
        "morning_enabled", "morning_hour", "morning_minute",
        "evening_enabled", "evening_hour", "evening_minute",
        "include_calendar", "include_email", "include_jobs",
    }
    clean = {k: v for k, v in updates.items() if k in allowed}
    if not clean:
        return
    clauses = ", ".join(f"{k} = %s" for k in clean)
    values  = list(clean.values())
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE briefing_config SET {clauses}, updated_at = NOW() WHERE id = 1",
                values,
            )
        conn.commit()


# ── Data collection ────────────────────────────────────────────────────────────

def _collect_calendar_sync() -> dict:
    try:
        from core.services.calendar_service import get_today, format_events_for_context
        events = get_today()
        if not events:
            return {"text": "No events scheduled today.", "count": 0}
        return {
            "text":   format_events_for_context(events, label="Today"),
            "count":  len(events),
            "events": [
                {
                    "title":  e.get("summary", "Untitled"),
                    "start":  e.get("start", {}).get("dateTime", e.get("start", {}).get("date", "")),
                    "end":    e.get("end",   {}).get("dateTime", e.get("end",   {}).get("date", "")),
                }
                for e in events[:5]
            ],
        }
    except Exception as e:
        return {"text": None, "count": 0, "error": str(e)}


def _collect_tomorrow_calendar_sync() -> dict:
    try:
        from core.services.calendar_service import get_today, format_events_for_context
        from datetime import timedelta
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        from core.services.calendar_service import get_events
        events = get_events(
            start=tomorrow + "T00:00:00Z",
            end=tomorrow + "T23:59:59Z",
            max_results=8,
        )
        if not events:
            return {"text": "Nothing scheduled for tomorrow.", "count": 0}
        return {
            "text":  format_events_for_context(events, label="Tomorrow"),
            "count": len(events),
        }
    except Exception as e:
        return {"text": None, "count": 0, "error": str(e)}


def _collect_email_sync() -> dict:
    try:
        from core.services.gmail_service import list_emails, get_category_counts
        res    = list_emails(max_results=5, label="INBOX", force_refresh=True)
        emails = res.get("emails", [])
        counts = get_category_counts()
        unread = counts.get("inbox", 0)
        # Build preview list
        previews = []
        for e in emails[:4]:
            previews.append({
                "from":    e.get("from", "?"),
                "subject": e.get("subject", "(no subject)"),
                "snippet": e.get("snippet", "")[:120],
                "unread":  e.get("unread", False),
            })
        return {"unread": unread, "previews": previews}
    except Exception as e:
        return {"unread": None, "previews": [], "error": str(e)}


def _collect_jobs_sync() -> dict:
    try:
        from agents.roster.atlas_agent import _get_application_stats
        stats = _get_application_stats()
        if "error" in stats:
            return {"total": 0, "by_status": {}, "error": stats["error"]}
        # Flag applications that haven't had a response in >5 days
        stale_count = 0
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT COUNT(*) FROM job_applications
                        WHERE status IN ('applied','pending')
                        AND applied_at < NOW() - INTERVAL '5 days'
                    """)
                    stale_count = cur.fetchone()[0]
        except Exception:
            pass
        return {
            "total":      stats.get("total", 0),
            "by_status":  stats.get("by_status", {}),
            "recent":     stats.get("recent", []),
            "stale":      stale_count,
        }
    except Exception as e:
        return {"total": 0, "by_status": {}, "stale": 0, "error": str(e)}


async def _collect_data(briefing_type: str, config: dict) -> dict:
    loop = asyncio.get_event_loop()
    data: dict = {"type": briefing_type, "collected_at": datetime.now(timezone.utc).isoformat()}

    tasks = []
    if config.get("include_calendar"):
        if briefing_type == "morning":
            tasks.append(("calendar", loop.run_in_executor(None, _collect_calendar_sync)))
        else:
            tasks.append(("calendar", loop.run_in_executor(None, _collect_tomorrow_calendar_sync)))

    if config.get("include_email"):
        tasks.append(("email", loop.run_in_executor(None, _collect_email_sync)))

    if config.get("include_jobs"):
        tasks.append(("jobs", loop.run_in_executor(None, _collect_jobs_sync)))

    for key, coro in tasks:
        try:
            data[key] = await coro
        except Exception as e:
            data[key] = {"error": str(e)}

    return data


# ── Formatting ─────────────────────────────────────────────────────────────────

async def _format_briefing(briefing_type: str, data: dict) -> str:
    from core.providers.ai_provider import ai_provider

    now_utc = datetime.now(timezone.utc)
    day_str  = now_utc.strftime("%A, %d %B %Y")
    time_str = now_utc.strftime("%H:%M UTC")

    icon   = "☀️" if briefing_type == "morning" else "🌙"
    label  = "Morning briefing" if briefing_type == "morning" else "Evening wrap-up"

    # Build raw data block for the LLM
    parts: list[str] = []

    cal = data.get("calendar", {})
    if cal.get("text") and not cal.get("error"):
        parts.append(f"CALENDAR ({cal.get('count', 0)} events):\n{cal['text']}")
    elif cal.get("error"):
        parts.append("CALENDAR: Not available (Google Calendar not connected)")

    email = data.get("email", {})
    if email.get("unread") is not None and not email.get("error"):
        preview_lines = [
            f"  • {e['from'][:40]} — {e['subject'][:60]}" + (" [UNREAD]" if e.get("unread") else "")
            for e in email.get("previews", [])
        ]
        parts.append(f"EMAIL: {email['unread']} unread\nTop emails:\n" + "\n".join(preview_lines))
    elif email.get("error"):
        parts.append("EMAIL: Not available (Gmail not connected)")

    jobs = data.get("jobs", {})
    if not jobs.get("error"):
        by_status = jobs.get("by_status", {})
        status_str = ", ".join(f"{v} {k}" for k, v in by_status.items()) if by_status else "no data"
        stale = jobs.get("stale", 0)
        parts.append(
            f"JOB PIPELINE: {jobs.get('total', 0)} total applications — {status_str}"
            + (f"\n  • {stale} applications awaiting response >5 days" if stale else "")
        )
    elif jobs.get("error"):
        parts.append("JOB PIPELINE: Not available")

    raw_data = "\n\n".join(parts) if parts else "No data available."

    system = (
        "You are Jazper, VJ's AI Chief of Staff. Write a concise briefing message for Telegram. "
        "Use Telegram markdown: *bold*, _italic_. "
        "Start with the icon, label, and date on one line. "
        "Use section headers with emoji. Be specific about actual data — numbers, names, times. "
        "End with a 1-sentence observation or motivating note based on the day ahead. "
        "No fluff, no sycophancy. Max 350 characters per section. Total max 600 characters."
    )

    user_prompt = (
        f"Write the {briefing_type} briefing for VJ.\n"
        f"Date: {day_str} | Time sent: {time_str}\n\n"
        f"DATA:\n{raw_data}"
    )

    try:
        result = await ai_provider.chat(
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user_prompt},
            ],
            model=_BRIEFING_MODEL,
            temperature=0.5,
            max_tokens=600,
            enable_thinking=False,
        )
        return result.content.strip()
    except Exception as e:
        log.warning("Briefing LLM format failed, using fallback", error=str(e))
        return _fallback_format(briefing_type, day_str, data)


def _fallback_format(briefing_type: str, day_str: str, data: dict) -> str:
    """Deterministic fallback when LLM is unavailable."""
    icon  = "☀️" if briefing_type == "morning" else "🌙"
    label = "Good morning" if briefing_type == "morning" else "Good evening"
    lines = [f"{icon} *{label}, VJ — {day_str}*\n"]

    cal = data.get("calendar", {})
    if cal.get("count", 0) > 0:
        lines.append(f"📅 *{cal['count']} event(s) today*")

    email = data.get("email", {})
    if email.get("unread"):
        lines.append(f"📬 *{email['unread']} unread emails*")

    jobs = data.get("jobs", {})
    if jobs.get("total"):
        lines.append(f"💼 *{jobs['total']} active applications*")

    lines.append("\n_Jazper_")
    return "\n".join(lines)


# ── Record keeping ─────────────────────────────────────────────────────────────

def _record_sent(briefing_type: str, message: str, delivery_ok: bool = True) -> None:
    col = f"last_{briefing_type}_sent_at"
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE briefing_config SET {col} = NOW() WHERE id = 1"
                )
                cur.execute(
                    "INSERT INTO briefing_history (type, message, char_count, delivery_ok) "
                    "VALUES (%s, %s, %s, %s)",
                    (briefing_type, message, len(message), delivery_ok),
                )
            conn.commit()
    except Exception as e:
        log.warning("Failed to record briefing", error=str(e))


# ── Main entry point ───────────────────────────────────────────────────────────

async def generate_and_send_briefing(briefing_type: str = "morning") -> dict:
    """Full pipeline: collect → format → send → log."""
    config = get_briefing_config()

    # Collect data even if telegram isn't set up (so send-now shows a preview)
    data    = await _collect_data(briefing_type, config)
    message = await _format_briefing(briefing_type, data)

    # Attempt Telegram delivery
    delivery_ok = False
    delivery_error: str | None = None
    try:
        from core.services.telegram_service import send_message
        result = await send_message(message)
        delivery_ok = "ok" in str(result).lower() or result.get("ok", False)
    except Exception as e:
        delivery_error = str(e)
        log.warning("Telegram delivery failed for briefing", error=str(e))

    _record_sent(briefing_type, message, delivery_ok)

    return {
        "status":        "sent" if delivery_ok else "delivery_failed",
        "message":       message,
        "chars":         len(message),
        "delivery_ok":   delivery_ok,
        "delivery_error": delivery_error,
    }


def get_briefing_history(limit: int = 10) -> list[dict]:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, type, message, sent_at, char_count, delivery_ok "
                    "FROM briefing_history ORDER BY sent_at DESC LIMIT %s",
                    (limit,),
                )
                rows = cur.fetchall()
        return [
            {
                "id":          r[0],
                "type":        r[1],
                "message":     r[2],
                "sent_at":     r[3].isoformat() if r[3] else None,
                "char_count":  r[4],
                "delivery_ok": r[5],
            }
            for r in rows
        ]
    except Exception as e:
        log.warning("briefing_history read failed", error=str(e))
        return []
