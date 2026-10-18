"""Notifications — CRUD for in-app alerts."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2.extras
import structlog

from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()


def _row(r: dict) -> dict:
    return {
        "id":         str(r["id"]),
        "title":      r["title"],
        "body":       r["body"] or "",
        "type":       r["type"],
        "read":       r["read"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "job_run_id": str(r["job_run_id"]) if r["job_run_id"] else None,
        "metadata":   r.get("metadata") or {},
    }


@router.get("/")
def list_notifications(unread_only: bool = False, limit: int = 50):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if unread_only:
                    cur.execute(
                        "SELECT * FROM notifications WHERE read = FALSE ORDER BY created_at DESC LIMIT %s",
                        (limit,)
                    )
                else:
                    cur.execute(
                        "SELECT * FROM notifications ORDER BY created_at DESC LIMIT %s",
                        (limit,)
                    )
                rows = cur.fetchall()
        return {"notifications": [_row(r) for r in rows]}
    except Exception as e:
        log.warning("Failed to list notifications", error=str(e))
        return {"notifications": []}


@router.get("/unread-count")
def unread_count():
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM notifications WHERE read = FALSE")
                count = cur.fetchone()[0]
        return {"count": count}
    except Exception as e:
        log.warning("Failed to get unread count", error=str(e))
        return {"count": 0}


class NotificationCreate(BaseModel):
    title: str
    body: str = ""
    type: str = "info"


@router.post("/")
def create_notification(body: NotificationCreate):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "INSERT INTO notifications (title, body, type) VALUES (%s, %s, %s) RETURNING *",
                    (body.title.strip(), body.body, body.type),
                )
                row = cur.fetchone()
            conn.commit()
        return _row(row)
    except Exception as e:
        log.warning("Failed to create notification", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{notif_id}/read")
def mark_read(notif_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE notifications SET read = TRUE WHERE id = %s", (notif_id,))
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to mark read", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/read-all")
def mark_all_read():
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE notifications SET read = TRUE WHERE read = FALSE")
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to mark all read", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{notif_id}")
def delete_notification(notif_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM notifications WHERE id = %s", (notif_id,))
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to delete notification", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/")
def clear_all():
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM notifications")
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to clear notifications", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
