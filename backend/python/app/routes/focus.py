"""Phase 21 — Focus Sessions: Pomodoro / deep work tracking + stats."""
from __future__ import annotations

from datetime import date, timedelta, datetime, timezone
from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2.extras

from app.services.memory_service import _pg
from app.services.telegram_service import send_message as send_telegram

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    task_title: str = ""
    task_id: Optional[str] = None
    duration_minutes: int = 25
    type: str = "pomodoro"


class PatchSessionRequest(BaseModel):
    status: str  # "completed" | "cancelled" | "interrupted"
    actual_minutes: int = 0


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/sessions")
def create_session(body: CreateSessionRequest):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO focus_sessions
                        (task_title, task_id, duration_minutes, type, status)
                    VALUES (%s, %s, %s, %s, 'active')
                    RETURNING *
                    """,
                    (
                        body.task_title,
                        body.task_id or None,
                        body.duration_minutes,
                        body.type,
                    ),
                )
                row = dict(cur.fetchone())
            conn.commit()
        return _fmt_session(row)
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.patch("/sessions/{session_id}")
async def patch_session(session_id: str, body: PatchSessionRequest):
    valid_statuses = {"completed", "cancelled", "interrupted"}
    if body.status not in valid_statuses:
        raise HTTPException(400, f"status must be one of {valid_statuses}")

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    UPDATE focus_sessions
                    SET status = %s,
                        actual_minutes = %s,
                        ended_at = NOW()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (body.status, body.actual_minutes, session_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Session not found")
                row = dict(row)
            conn.commit()

        if body.status == "completed":
            task_title = row.get("task_title") or "Deep work"
            actual = body.actual_minutes
            try:
                await send_telegram(
                    f"Focus session complete! {actual}min on: {task_title}"
                )
            except Exception as tg_exc:
                log.warning("focus: telegram notify failed (non-fatal)", error=str(tg_exc))

        return _fmt_session(row)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/sessions")
def list_sessions(limit: int = 50, status: str = "all"):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if status == "all":
                    cur.execute(
                        "SELECT * FROM focus_sessions ORDER BY started_at DESC LIMIT %s",
                        (limit,),
                    )
                else:
                    cur.execute(
                        "SELECT * FROM focus_sessions WHERE status = %s ORDER BY started_at DESC LIMIT %s",
                        (status, limit),
                    )
                rows = [dict(r) for r in cur.fetchall()]
        return [_fmt_session(r) for r in rows]
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/stats")
def get_stats():
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                # Week aggregates
                cur.execute(
                    """
                    SELECT
                        COALESCE(SUM(actual_minutes), 0) AS week_total_minutes,
                        COUNT(*)                          AS week_sessions,
                        COUNT(*) FILTER (WHERE status = 'completed') AS week_completed
                    FROM focus_sessions
                    WHERE started_at >= NOW() - INTERVAL '7 days'
                    """
                )
                week_row = cur.fetchone()
                week_total_minutes = int(week_row[0])
                week_sessions = int(week_row[1])
                week_completed = int(week_row[2])

                # Today's minutes
                cur.execute(
                    """
                    SELECT COALESCE(SUM(actual_minutes), 0)
                    FROM focus_sessions
                    WHERE started_at >= CURRENT_DATE
                      AND status = 'completed'
                    """
                )
                today_minutes = int(cur.fetchone()[0])

                # Streak: fetch all distinct completed dates in last 90 days
                cur.execute(
                    """
                    SELECT DISTINCT DATE(started_at AT TIME ZONE 'UTC') AS d
                    FROM focus_sessions
                    WHERE status = 'completed'
                      AND started_at >= NOW() - INTERVAL '90 days'
                    ORDER BY d DESC
                    """
                )
                completed_dates = set(r[0] for r in cur.fetchall())
                today_d = date.today()
                current_streak = _calc_streak(completed_dates, today_d)
                longest_streak = _calc_longest_streak(completed_dates)

                # Most productive hour (last 30 days, completed only)
                cur.execute(
                    """
                    SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE 'UTC') AS hr,
                           COUNT(*) AS cnt
                    FROM focus_sessions
                    WHERE status = 'completed'
                      AND started_at >= NOW() - INTERVAL '30 days'
                    GROUP BY hr
                    ORDER BY cnt DESC
                    LIMIT 1
                    """
                )
                mph_row = cur.fetchone()
                most_productive_hour = f"{int(mph_row[0]):02d}:00" if mph_row else "09:00"

                # By-type for completed sessions this week
                cur.execute(
                    """
                    SELECT type, COUNT(*) AS cnt
                    FROM focus_sessions
                    WHERE started_at >= NOW() - INTERVAL '7 days'
                      AND status = 'completed'
                    GROUP BY type
                    """
                )
                by_type = {r[0]: int(r[1]) for r in cur.fetchall()}

        return {
            "week_total_minutes": week_total_minutes,
            "week_sessions": week_sessions,
            "week_completed": week_completed,
            "today_minutes": today_minutes,
            "longest_streak_days": longest_streak,
            "current_streak_days": current_streak,
            "most_productive_hour": most_productive_hour,
            "by_type": by_type,
        }
    except Exception as exc:
        raise HTTPException(500, str(exc))


# ── Helpers ────────────────────────────────────────────────────────────────────

def _fmt_session(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "task_id": str(row["task_id"]) if row.get("task_id") else None,
        "task_title": row.get("task_title") or "",
        "duration_minutes": row.get("duration_minutes"),
        "actual_minutes": row.get("actual_minutes") or 0,
        "type": row.get("type"),
        "status": row.get("status"),
        "started_at": row["started_at"].isoformat() if row.get("started_at") else None,
        "ended_at": row["ended_at"].isoformat() if row.get("ended_at") else None,
    }


def _calc_streak(completed_dates: set, today: date) -> int:
    """Count consecutive days from today backwards."""
    streak = 0
    check = today
    while check in completed_dates:
        streak += 1
        check -= timedelta(days=1)
    # If today has no session yet, start from yesterday
    if streak == 0:
        check = today - timedelta(days=1)
        while check in completed_dates:
            streak += 1
            check -= timedelta(days=1)
    return streak


def _calc_longest_streak(completed_dates: set) -> int:
    """Find the longest consecutive-day streak in the set."""
    if not completed_dates:
        return 0
    sorted_dates = sorted(completed_dates)
    longest = 1
    current = 1
    for i in range(1, len(sorted_dates)):
        if sorted_dates[i] - sorted_dates[i - 1] == timedelta(days=1):
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest
