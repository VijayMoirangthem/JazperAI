"""Phase 22 — Weekly Digest Generator."""
from __future__ import annotations

from datetime import date, timedelta, datetime, timezone

import json
import structlog
import psycopg2.extras
from fastapi import APIRouter, HTTPException

from memory.db.legacy_pg import _pg
from core.providers.ai_provider import ai_provider
from core.services.telegram_service import send_message as send_telegram

router = APIRouter()
log = structlog.get_logger()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_digest():
    try:
        now = datetime.now(timezone.utc)
        seven_days_ago = now - timedelta(days=7)
        week_start = (now - timedelta(days=7)).date()

        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Tasks
                cur.execute("SELECT COUNT(*) AS total FROM tasks")
                task_total = (cur.fetchone() or {}).get("total", 0)
                cur.execute("SELECT COUNT(*) AS done FROM tasks WHERE status = 'done'")
                task_done = (cur.fetchone() or {}).get("done", 0)

                # Focus sessions
                cur.execute(
                    """
                    SELECT
                        COALESCE(SUM(duration_minutes), 0) AS week_total_minutes,
                        COUNT(*) FILTER (WHERE status = 'completed') AS week_completed
                    FROM focus_sessions
                    WHERE started_at >= %s
                    """,
                    (seven_days_ago,),
                )
                focus_row = dict(cur.fetchone() or {})
                focus_minutes = focus_row.get("week_total_minutes") or 0
                focus_completed = focus_row.get("week_completed") or 0

                # Habits
                cur.execute(
                    """
                    SELECT COUNT(*) AS completions
                    FROM habit_completions
                    WHERE completed_date >= %s
                    """,
                    (week_start,),
                )
                habit_completions = (cur.fetchone() or {}).get("completions", 0)
                cur.execute("SELECT COUNT(*) AS habit_count FROM habits")
                habit_count = (cur.fetchone() or {}).get("habit_count", 0)

                # Job applications
                cur.execute(
                    "SELECT COUNT(*) AS new_apps FROM job_applications WHERE applied_at >= %s",
                    (seven_days_ago,),
                )
                new_apps = (cur.fetchone() or {}).get("new_apps", 0)

                # Notifications / emails
                cur.execute(
                    "SELECT COUNT(*) AS notif_count FROM notifications WHERE created_at >= %s",
                    (seven_days_ago,),
                )
                notif_count = (cur.fetchone() or {}).get("notif_count", 0)

                # Goals and progress
                cur.execute("SELECT COUNT(*) AS active_goals FROM goals WHERE status = 'active'")
                active_goals = (cur.fetchone() or {}).get("active_goals", 0)
                cur.execute(
                    """
                    SELECT AVG(
                        CASE WHEN kr.target_value > 0
                             THEN LEAST((kr.current_value / kr.target_value) * 100, 100)
                             ELSE 0 END
                    ) AS avg_progress
                    FROM key_results kr
                    JOIN goals g ON g.id = kr.goal_id
                    WHERE g.status = 'active'
                    """
                )
                avg_progress = (cur.fetchone() or {}).get("avg_progress") or 0

        context = (
            f"Tasks: {task_done}/{task_total} completed. "
            f"Focus: {focus_minutes} minutes logged, {focus_completed} sessions completed this week. "
            f"Habits: {habit_completions} completions across {habit_count} habits. "
            f"Job applications: {new_apps} new applications this week. "
            f"Notifications: {notif_count} received this week. "
            f"Goals: {active_goals} active, average progress {round(float(avg_progress), 1)}%."
        )

        prompt = (
            "Generate a concise weekly digest for a job seeker. Be encouraging and specific. "
            "Include highlights, wins, and 2-3 action items for next week. "
            f"Data: {context}. Format with sections: 🏆 Wins, 📊 By the Numbers, 🎯 Next Week."
        )

        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            temperature=0.4,
            max_tokens=600,
        )
        digest_content = result.content.strip()

        # Save to DB
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO weekly_digests (content, week_start)
                    VALUES (%s, %s)
                    RETURNING id, generated_at
                    """,
                    (digest_content, week_start),
                )
                saved = dict(cur.fetchone())
            conn.commit()

        # Send to Telegram (first 500 chars)
        preview = digest_content[:500] + ("..." if len(digest_content) > 500 else "")
        telegram_msg = preview + "\n\n_See full digest in Sir Jazper._"
        try:
            await send_telegram(telegram_msg)
        except Exception as tg_err:
            log.warning("Telegram send failed (non-fatal)", error=str(tg_err))

        return {
            "digest": digest_content,
            "week_start": week_start.isoformat(),
            "generated_at": saved["generated_at"].isoformat() if saved.get("generated_at") else None,
        }

    except HTTPException:
        raise
    except Exception as e:
        log.warning("generate_digest failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("")
def list_digests():
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM weekly_digests ORDER BY generated_at DESC LIMIT 10"
                )
                rows = [dict(r) for r in cur.fetchall()]
        return [
            {
                "id": str(r["id"]),
                "content": r["content"],
                "week_start": r["week_start"].isoformat() if r.get("week_start") else None,
                "generated_at": r["generated_at"].isoformat() if r.get("generated_at") else None,
            }
            for r in rows
        ]
    except Exception as e:
        log.warning("list_digests failed", error=str(e))
        raise HTTPException(500, str(e))
