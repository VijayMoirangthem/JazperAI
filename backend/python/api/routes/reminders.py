"""Smart reminders — time-based notifications via Telegram."""
from fastapi import APIRouter
from pydantic import BaseModel
import psycopg2.extras
import structlog
import datetime

from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


@router.get("")
def list_reminders(status: str = "pending", limit: int = 50):
    reminders = []
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if status == "all":
                    cur.execute("""
                        SELECT id::text, title, body, remind_at, related_type, related_id, status, created_at
                        FROM reminders ORDER BY remind_at ASC LIMIT %s
                    """, (limit,))
                else:
                    cur.execute("""
                        SELECT id::text, title, body, remind_at, related_type, related_id, status, created_at
                        FROM reminders WHERE status = %s ORDER BY remind_at ASC LIMIT %s
                    """, (status, limit))
                for r in cur.fetchall():
                    row = dict(r)
                    row["remind_at"] = row["remind_at"].isoformat() if row.get("remind_at") else None
                    row["created_at"] = row["created_at"].isoformat() if row.get("created_at") else None
                    reminders.append(row)
    except Exception as e:
        log.warning("Reminders list failed", error=str(e))
    return {"reminders": reminders}


class ReminderCreate(BaseModel):
    title: str
    body: str = ""
    remind_at: str  # ISO datetime string
    related_type: str = ""  # task / email / application / ""
    related_id: str = ""


@router.post("")
def create_reminder(body: ReminderCreate):
    try:
        remind_dt = datetime.datetime.fromisoformat(body.remind_at.replace("Z", "+00:00"))
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO reminders (title, body, remind_at, related_type, related_id, status)
                    VALUES (%s, %s, %s, %s, %s, 'pending') RETURNING id::text
                """, (body.title.strip(), body.body.strip(), remind_dt, body.related_type, body.related_id))
                row = cur.fetchone()
        return {"ok": True, "id": row[0] if row else None}
    except Exception as e:
        return {"ok": False, "error": str(e)}


class StatusPatch(BaseModel):
    status: str  # pending | fired | dismissed | snoozed


@router.patch("/{reminder_id}")
def update_reminder(reminder_id: str, body: StatusPatch):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                if body.status == "snoozed":
                    cur.execute("""
                        UPDATE reminders
                        SET status = 'pending',
                            remind_at = remind_at + INTERVAL '1 hour'
                        WHERE id = %s
                    """, (reminder_id,))
                else:
                    cur.execute(
                        "UPDATE reminders SET status = %s WHERE id = %s",
                        (body.status, reminder_id)
                    )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.delete("/{reminder_id}")
def delete_reminder(reminder_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM reminders WHERE id = %s", (reminder_id,))
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
