"""Phase 24 — Daily Standup Generator."""
from __future__ import annotations

import json
from datetime import datetime

import psycopg2.extras
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.providers.ai_provider import ai_provider
from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _fmt(r: dict) -> dict:
    out = {}
    for k, v in r.items():
        if v is None:
            out[k] = None
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif hasattr(v, "hex"):
            out[k] = str(v)
        else:
            out[k] = v
    return out


def _collect_context() -> dict:
    """Pull standup context from the DB: completed tasks, focus sessions, upcoming dues, interview."""
    ctx: dict = {
        "tasks_done": [],
        "focus_sessions": [],
        "upcoming_due": [],
        "interview_today": None,
    }

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Yesterday's completed tasks
                cur.execute(
                    """
                    SELECT title FROM tasks
                    WHERE status = 'done'
                      AND updated_at >= NOW() - INTERVAL '1 day'
                    ORDER BY updated_at DESC
                    LIMIT 10
                    """
                )
                ctx["tasks_done"] = [r["title"] for r in cur.fetchall()]

                # Today's focus sessions
                cur.execute(
                    """
                    SELECT task_title, actual_minutes FROM focus_sessions
                    WHERE DATE(started_at) = CURRENT_DATE
                    ORDER BY started_at ASC
                    """
                )
                ctx["focus_sessions"] = [
                    {"task": r["task_title"], "minutes": r["actual_minutes"]}
                    for r in cur.fetchall()
                ]

                # Upcoming due tasks (next 2 days, not done)
                cur.execute(
                    """
                    SELECT title, due_at FROM tasks
                    WHERE due_at BETWEEN NOW() AND NOW() + INTERVAL '2 days'
                      AND status != 'done'
                    ORDER BY due_at ASC
                    LIMIT 5
                    """
                )
                ctx["upcoming_due"] = [
                    {"title": r["title"], "due": r["due_at"].isoformat() if r["due_at"] else None}
                    for r in cur.fetchall()
                ]

                # Any interview notification from the past 7 days
                cur.execute(
                    """
                    SELECT title FROM notifications
                    WHERE type = 'email'
                      AND created_at >= NOW() - INTERVAL '7 days'
                      AND title ILIKE '%interview%'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
                if row:
                    ctx["interview_today"] = row["title"]

    except Exception as exc:
        log.warning("standup: context collection failed", error=str(exc))

    return ctx


# ── Routes ──────────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_standup():
    """Collect context from the DB and generate a daily standup update via AI."""
    ctx = _collect_context()

    focus_minutes = sum(s["minutes"] or 0 for s in ctx["focus_sessions"])

    prompt = (
        "Generate a concise daily standup update for a job seeker/developer. "
        "Be specific about what was actually done.\n"
        f"Context: {json.dumps(ctx)}\n"
        "Format with exactly these three sections:\n"
        "✅ Yesterday: [what was completed]\n"
        "🎯 Today: [what you'll work on]\n"
        "⚠️ Blockers: [any blockers, or \"None\"]\n"
        "Keep it under 150 words total."
    )

    standup_text = (
        "✅ Yesterday: No completed tasks recorded.\n"
        "🎯 Today: Continue working on current tasks.\n"
        "⚠️ Blockers: None"
    )

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            max_tokens=300,
            temperature=0.4,
        )
        standup_text = result.content.strip()
    except Exception as exc:
        log.warning("standup: AI generation failed, using fallback", error=str(exc))

    generated_at = datetime.utcnow().isoformat() + "Z"

    # Save to standup_history
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO standup_history (content, generated_at) VALUES (%s, NOW())",
                    (standup_text,),
                )
            conn.commit()
    except Exception as exc:
        log.warning("standup: failed to save history", error=str(exc))

    return {
        "standup": standup_text,
        "generated_at": generated_at,
        "context_summary": {
            "tasks_done": len(ctx["tasks_done"]),
            "focus_minutes": focus_minutes,
            "upcoming_due": len(ctx["upcoming_due"]),
        },
    }


@router.get("/history")
def standup_history(limit: int = 7):
    """Return the last N standup entries."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM standup_history ORDER BY generated_at DESC LIMIT %s",
                    (limit,),
                )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"history": [_fmt(r) for r in rows]}
