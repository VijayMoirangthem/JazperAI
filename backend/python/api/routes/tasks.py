"""Task management — DB-backed CRUD with priority, due date, notes."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal
import structlog
import psycopg2.extras

from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


class TaskCreate(BaseModel):
    title: str
    notes: str = ""
    priority: Literal["low", "medium", "high"] = "medium"
    due_at: str | None = None   # ISO8601 string or None


class TaskUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    priority: Literal["low", "medium", "high"] | None = None
    status: Literal["pending", "in_progress", "done"] | None = None
    due_at: str | None = None


def _row(r: dict) -> dict:
    return {
        "id":       str(r["id"]),
        "title":    r["title"],
        "notes":    r["notes"] or "",
        "priority": r["priority"],
        "status":   r["status"],
        "due_at":   r["due_at"].isoformat() if r["due_at"] else None,
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
    }


@router.get("/")
def list_tasks(status: str | None = None):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if status:
                    cur.execute(
                        "SELECT * FROM tasks WHERE status = %s ORDER BY due_at ASC NULLS LAST, created_at DESC",
                        (status,)
                    )
                else:
                    cur.execute(
                        "SELECT * FROM tasks ORDER BY status ASC, due_at ASC NULLS LAST, created_at DESC"
                    )
                rows = cur.fetchall()
        return {"tasks": [_row(r) for r in rows]}
    except Exception as e:
        log.warning("Failed to list tasks", error=str(e))
        return {"tasks": []}


@router.post("/")
def create_task(body: TaskCreate):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO tasks (title, notes, priority, due_at)
                       VALUES (%s, %s, %s, %s) RETURNING *""",
                    (title, body.notes, body.priority, body.due_at),
                )
                row = cur.fetchone()
            conn.commit()
        log.info("Task created", title=title)
        return _row(row)
    except Exception as e:
        log.warning("Failed to create task", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{task_id}")
def update_task(task_id: str, body: TaskUpdate):
    fields, values = [], []
    if body.title    is not None: fields.append("title = %s");    values.append(body.title.strip())
    if body.notes    is not None: fields.append("notes = %s");    values.append(body.notes)
    if body.priority is not None: fields.append("priority = %s"); values.append(body.priority)
    if body.status   is not None: fields.append("status = %s");   values.append(body.status)
    if body.due_at   is not None: fields.append("due_at = %s");   values.append(body.due_at)
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")
    fields.append("updated_at = NOW()")
    values.append(task_id)
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"UPDATE tasks SET {', '.join(fields)} WHERE id = %s RETURNING *",
                    values,
                )
                row = cur.fetchone()
            conn.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        return _row(row)
    except HTTPException:
        raise
    except Exception as e:
        log.warning("Failed to update task", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{task_id}")
def delete_task(task_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to delete task", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
def task_stats():
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        COUNT(*) FILTER (WHERE status != 'done') AS pending,
                        COUNT(*) FILTER (WHERE status = 'done') AS done,
                        COUNT(*) FILTER (WHERE due_at::date = CURRENT_DATE AND status != 'done') AS due_today,
                        COUNT(*) FILTER (WHERE due_at < NOW() AND status != 'done') AS overdue
                    FROM tasks
                """)
                r = cur.fetchone()
        return {"pending": r[0], "done": r[1], "due_today": r[2], "overdue": r[3]}
    except Exception as e:
        log.warning("Failed to get task stats", error=str(e))
        return {"pending": 0, "done": 0, "due_today": 0, "overdue": 0}
