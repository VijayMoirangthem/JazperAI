"""Suggested prompts — rule-based, context-aware."""
from __future__ import annotations
import structlog
from fastapi import APIRouter
from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()

# Base suggestions always available
_BASE = [
    "What should I focus on today?",
    "Any important emails I should know about?",
    "Show me my job application pipeline",
    "What's on my calendar this week?",
    "Summarize my recent tasks",
]


def _get_context() -> dict:
    ctx = {
        "overdue_tasks": 0,
        "due_today": 0,
        "pending_applications": 0,
        "unread_notifications": 0,
        "has_resume": False,
        "email_alerts": [],
    }
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        COUNT(*) FILTER (WHERE due_at < NOW() AND status != 'done') AS overdue,
                        COUNT(*) FILTER (WHERE due_at::date = CURRENT_DATE AND status != 'done') AS due_today
                    FROM tasks
                """)
                r = cur.fetchone()
                if r:
                    ctx["overdue_tasks"] = r[0] or 0
                    ctx["due_today"] = r[1] or 0

                cur.execute("SELECT COUNT(*) FROM job_applications WHERE status IN ('applied','viewed')")
                r = cur.fetchone()
                ctx["pending_applications"] = r[0] if r else 0

                cur.execute("SELECT COUNT(*) FROM notifications WHERE read = FALSE")
                r = cur.fetchone()
                ctx["unread_notifications"] = r[0] if r else 0

                cur.execute("SELECT resume_text FROM user_profile WHERE id = 1")
                r = cur.fetchone()
                ctx["has_resume"] = bool(r and r[0] and r[0].strip())

                # Recent email alerts from Hermes — suggest follow-up tasks
                cur.execute("""
                    SELECT title FROM notifications
                    WHERE read = FALSE
                      AND created_at > NOW() - INTERVAL '48 hours'
                      AND title ILIKE ANY(ARRAY['%interview%','%recruiter%','%offer%'])
                    ORDER BY created_at DESC LIMIT 2
                """)
                ctx["email_alerts"] = [row[0] for row in cur.fetchall()]
    except Exception as e:
        log.warning("suggestions context fetch failed", error=str(e))
    return ctx


def _build_suggestions(ctx: dict) -> list[str]:
    suggestions: list[str] = []

    if ctx["overdue_tasks"] > 0:
        suggestions.append(f"I have {ctx['overdue_tasks']} overdue task(s) — help me prioritize")

    if ctx["due_today"] > 0:
        suggestions.append(f"Walk me through my {ctx['due_today']} task(s) due today")

    if ctx["unread_notifications"] > 0:
        suggestions.append(f"Summarize my {ctx['unread_notifications']} unread notifications")

    if ctx["pending_applications"] > 0:
        suggestions.append(f"What's the status of my {ctx['pending_applications']} active job applications?")
        suggestions.append("Draft a follow-up email for my oldest application")

    if not ctx["has_resume"]:
        suggestions.append("Help me set up my resume in the Resume Manager")

    for notif_title in ctx.get("email_alerts", []):
        if "interview" in notif_title.lower():
            suggestions.append("Prepare for interview — research the company and practice answers")
        elif "offer" in notif_title.lower():
            suggestions.append("Review your job offer details and prepare questions")
        else:
            suggestions.append("Follow up with the recruiter who reached out")

    # Fill remaining slots from base list (avoid duplicates)
    for base in _BASE:
        if len(suggestions) >= 6:
            break
        if base not in suggestions:
            suggestions.append(base)

    return suggestions[:6]


@router.get("")
def get_suggestions():
    ctx = _get_context()
    return {"suggestions": _build_suggestions(ctx), "context": ctx}
