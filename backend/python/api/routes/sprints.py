"""Phase 23 — Sprint Planner."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

import psycopg2.extras
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ────────────────────────────────────────────────────────────

class SprintCreate(BaseModel):
    title: str
    goal: str = ""
    start_date: date
    end_date: date


class SprintUpdate(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    goal: Optional[str] = None


class SprintTaskCreate(BaseModel):
    title: str
    task_id: Optional[str] = None


class SprintTaskUpdate(BaseModel):
    status: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _fmt(r: dict) -> dict:
    """Normalise a DB row — UUIDs to str, dates to ISO."""
    out = {}
    for k, v in r.items():
        if v is None:
            out[k] = None
        elif isinstance(v, (datetime, date)):
            out[k] = v.isoformat()
        else:
            out[k] = str(v) if hasattr(v, "hex") else v   # UUID objects have .hex
    return out


# ── Sprint CRUD ────────────────────────────────────────────────────────────────

@router.get("")
def list_sprints(status: str = "active"):
    """List sprints with task counts (total and done)."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if status == "all":
                    cur.execute(
                        """
                        SELECT s.*,
                               COUNT(st.id)                                         AS total_tasks,
                               COUNT(st.id) FILTER (WHERE st.status = 'done')       AS done_tasks
                        FROM sprints s
                        LEFT JOIN sprint_tasks st ON st.sprint_id = s.id
                        GROUP BY s.id
                        ORDER BY s.created_at DESC
                        """
                    )
                else:
                    cur.execute(
                        """
                        SELECT s.*,
                               COUNT(st.id)                                         AS total_tasks,
                               COUNT(st.id) FILTER (WHERE st.status = 'done')       AS done_tasks
                        FROM sprints s
                        LEFT JOIN sprint_tasks st ON st.sprint_id = s.id
                        WHERE s.status = %s
                        GROUP BY s.id
                        ORDER BY s.created_at DESC
                        """,
                        (status,),
                    )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))

    return {"sprints": [_fmt(r) for r in rows]}


@router.post("")
def create_sprint(body: SprintCreate):
    """Create a new sprint."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO sprints (title, goal, start_date, end_date)
                    VALUES (%s, %s, %s, %s)
                    RETURNING *
                    """,
                    (body.title, body.goal, body.start_date, body.end_date),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))
    return _fmt(row)


@router.patch("/{sprint_id}")
def update_sprint(sprint_id: str, body: SprintUpdate):
    """Update sprint status, title, or goal."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    set_parts = [f"{k} = %s" for k in updates]
    values = list(updates.values()) + [sprint_id]

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"UPDATE sprints SET {', '.join(set_parts)} WHERE id = %s::uuid RETURNING *",
                    values,
                )
                row = cur.fetchone()
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if not row:
        raise HTTPException(404, "Sprint not found")
    return _fmt(dict(row))


@router.delete("/{sprint_id}")
def delete_sprint(sprint_id: str):
    """Delete a sprint and all its tasks (cascade)."""
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM sprints WHERE id = %s::uuid", (sprint_id,))
                deleted = cur.rowcount
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if deleted == 0:
        raise HTTPException(404, "Sprint not found")
    return {"ok": True, "deleted_id": sprint_id}


# ── Sprint Tasks ───────────────────────────────────────────────────────────────

@router.get("/{sprint_id}/tasks")
def list_sprint_tasks(sprint_id: str):
    """List all tasks in a sprint."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM sprint_tasks WHERE sprint_id = %s::uuid ORDER BY added_at ASC",
                    (sprint_id,),
                )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"tasks": [_fmt(r) for r in rows]}


@router.post("/{sprint_id}/tasks")
def add_sprint_task(sprint_id: str, body: SprintTaskCreate):
    """Add a task to a sprint."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if body.task_id:
                    cur.execute(
                        """
                        INSERT INTO sprint_tasks (sprint_id, task_id, title)
                        VALUES (%s::uuid, %s::uuid, %s)
                        RETURNING *
                        """,
                        (sprint_id, body.task_id, body.title),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO sprint_tasks (sprint_id, title)
                        VALUES (%s::uuid, %s)
                        RETURNING *
                        """,
                        (sprint_id, body.title),
                    )
                row = dict(cur.fetchone())
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))
    return _fmt(row)


@router.patch("/{sprint_id}/tasks/{sprint_task_id}")
def update_sprint_task(sprint_id: str, sprint_task_id: str, body: SprintTaskUpdate):
    """Update the status of a sprint task."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    UPDATE sprint_tasks SET status = %s
                    WHERE id = %s::uuid AND sprint_id = %s::uuid
                    RETURNING *
                    """,
                    (body.status, sprint_task_id, sprint_id),
                )
                row = cur.fetchone()
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if not row:
        raise HTTPException(404, "Sprint task not found")
    return _fmt(dict(row))


@router.delete("/{sprint_id}/tasks/{sprint_task_id}")
def delete_sprint_task(sprint_id: str, sprint_task_id: str):
    """Remove a task from a sprint."""
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM sprint_tasks WHERE id = %s::uuid AND sprint_id = %s::uuid",
                    (sprint_task_id, sprint_id),
                )
                deleted = cur.rowcount
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if deleted == 0:
        raise HTTPException(404, "Sprint task not found")
    return {"ok": True, "deleted_id": sprint_task_id}


# ── Velocity ───────────────────────────────────────────────────────────────────

@router.get("/{sprint_id}/velocity")
def sprint_velocity(sprint_id: str):
    """Return completion stats and a linear velocity projection for a sprint."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM sprints WHERE id = %s::uuid", (sprint_id,)
                )
                sprint = cur.fetchone()
                if not sprint:
                    raise HTTPException(404, "Sprint not found")
                sprint = dict(sprint)

                cur.execute(
                    """
                    SELECT COUNT(*)                                          AS total_tasks,
                           COUNT(*) FILTER (WHERE status = 'done')           AS done_tasks
                    FROM sprint_tasks
                    WHERE sprint_id = %s::uuid
                    """,
                    (sprint_id,),
                )
                counts = dict(cur.fetchone())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

    today = date.today()
    start = sprint["start_date"]
    end = sprint["end_date"]
    # Normalise to date if stored as datetime
    if isinstance(start, datetime):
        start = start.date()
    if isinstance(end, datetime):
        end = end.date()

    total_days = max((end - start).days, 1)
    days_elapsed = max((today - start).days, 0)
    days_remaining = max((end - today).days, 0)

    total_tasks = int(counts["total_tasks"] or 0)
    done_tasks = int(counts["done_tasks"] or 0)
    completion_rate = round(done_tasks / total_tasks, 4) if total_tasks > 0 else 0.0

    # Linear projection: tasks/day * total_days
    if days_elapsed > 0 and total_tasks > 0:
        daily_rate = done_tasks / days_elapsed
        projected_done = min(daily_rate * total_days, total_tasks)
        projected_completion_rate = round(projected_done / total_tasks, 4)
    else:
        projected_completion_rate = 0.0

    return {
        "sprint_id": sprint_id,
        "title": sprint["title"],
        "total_tasks": total_tasks,
        "done_tasks": done_tasks,
        "completion_rate": completion_rate,
        "days_elapsed": days_elapsed,
        "days_remaining": days_remaining,
        "projected_completion_rate": projected_completion_rate,
    }
