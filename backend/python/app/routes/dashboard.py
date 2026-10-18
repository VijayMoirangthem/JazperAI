"""Dashboard stats — aggregates from all services."""
import time
from fastapi import APIRouter
import structlog

from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()
_start_time = time.time()

# ── AI brief cache (5-min TTL) ────────────────────────────────────────────────
_brief_cache: dict = {"ts": 0.0, "brief": ""}
_BRIEF_TTL = 300  # seconds


async def _generate_brief() -> str:
    """Collect key stats and produce a short daily brief via AI."""
    from app.providers.ai_provider import ai_provider

    context_parts: list[str] = []

    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        COUNT(*) FILTER (WHERE status != 'done') AS pending,
                        COUNT(*) FILTER (WHERE due_at::date = CURRENT_DATE AND status != 'done') AS due_today,
                        COUNT(*) FILTER (WHERE due_at < NOW() AND status != 'done') AS overdue
                    FROM tasks
                """)
                r = cur.fetchone()
                if r:
                    context_parts.append(
                        f"Tasks: {r[0]} pending, {r[1]} due today, {r[2]} overdue."
                    )

                cur.execute(
                    "SELECT COUNT(*) FROM job_applications WHERE status IN ('applied','viewed')"
                )
                r = cur.fetchone()
                if r and r[0]:
                    context_parts.append(f"Job applications: {r[0]} active.")

                cur.execute("SELECT COUNT(*) FROM notifications WHERE read = FALSE")
                r = cur.fetchone()
                if r and r[0]:
                    context_parts.append(f"Unread notifications: {r[0]}.")

                # Unread emails from Hermes
                cur.execute("""
                    SELECT title, body FROM notifications
                    WHERE type IN ('info','success','warning') AND read = FALSE
                      AND (body ILIKE '%recruiter%' OR body ILIKE '%interview%'
                           OR body ILIKE '%offer%' OR body ILIKE '%from:%')
                    ORDER BY created_at DESC LIMIT 3
                """)
                email_notifs = cur.fetchall()
                if email_notifs:
                    summaries = "; ".join(r[0] for r in email_notifs)
                    context_parts.append(f"Recent email alerts: {summaries}.")

                # Automation rules fired in last 24h
                cur.execute("""
                    SELECT COUNT(*) FROM automation_history
                    WHERE fired_at > NOW() - INTERVAL '24 hours'
                """)
                r = cur.fetchone()
                if r and r[0]:
                    context_parts.append(f"Automation rules fired: {r[0]} in the last 24h.")
    except Exception:
        pass

    if not context_parts:
        return "Good morning! Everything looks quiet — no pending tasks or notifications."

    context = " ".join(context_parts)
    prompt = (
        f"You are Jazper. Write a crisp 2-3 sentence OS brief for VJ based on: {context} "
        "Mention any email alerts or automation activity if present. Be friendly and specific. No markdown."
    )
    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.3,
            max_tokens=120,
        )
        return result.content.strip()
    except Exception:
        # Deterministic fallback
        return f"Here's your OS status: {context}"


@router.get("/brief")
async def dashboard_brief():
    now = time.time()
    if now - _brief_cache["ts"] < _BRIEF_TTL and _brief_cache["brief"]:
        return {"brief": _brief_cache["brief"], "cached": True}
    brief = await _generate_brief()
    _brief_cache["ts"] = now
    _brief_cache["brief"] = brief
    return {"brief": brief, "cached": False}


@router.get("/stats")
def dashboard_stats():
    stats = {
        "uptime_seconds": int(time.time() - _start_time),
        "tasks": {"pending": 0, "done": 0, "due_today": 0, "overdue": 0},
        "memory": {"core": 0, "extracted": 0, "auto": 0},
        "chat": {"sessions": 0, "messages_today": 0},
        "services": {},
    }
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                # Tasks
                cur.execute("""
                    SELECT
                        COUNT(*) FILTER (WHERE status != 'done') AS pending,
                        COUNT(*) FILTER (WHERE status = 'done') AS done,
                        COUNT(*) FILTER (WHERE due_at::date = CURRENT_DATE AND status != 'done') AS due_today,
                        COUNT(*) FILTER (WHERE due_at < NOW() AND status != 'done') AS overdue
                    FROM tasks
                """)
                r = cur.fetchone()
                stats["tasks"] = {"pending": r[0], "done": r[1], "due_today": r[2], "overdue": r[3]}

                # Memory
                cur.execute("SELECT COUNT(*) FROM core_memories")
                stats["memory"]["core"] = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM extracted_memories")
                stats["memory"]["extracted"] = cur.fetchone()[0]

                # Chat
                cur.execute("SELECT COUNT(*) FROM chat_sessions WHERE expires_at IS NULL OR expires_at > NOW()")
                stats["chat"]["sessions"] = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM chat_messages WHERE created_at::date = CURRENT_DATE")
                stats["chat"]["messages_today"] = cur.fetchone()[0]

                # Notifications unread
                cur.execute("SELECT COUNT(*) FROM notifications WHERE read = FALSE")
                stats["unread_notifications"] = cur.fetchone()[0]

        stats["services"]["database"] = "online"
    except Exception as e:
        stats["services"]["database"] = "offline"

    # LM Studio ping
    try:
        import urllib.request
        urllib.request.urlopen("http://localhost:1234/v1/models", timeout=1)
        stats["services"]["lm_studio"] = "online"
    except Exception:
        stats["services"]["lm_studio"] = "offline"

    return stats
