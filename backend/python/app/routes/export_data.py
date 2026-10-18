"""Data export — full JSON dump of all user data."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
import psycopg2.extras
import structlog
import datetime

from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


def _ser(row: dict) -> dict:
    """Serialize a RealDictRow — convert datetime/date to ISO strings."""
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, (list, dict)):
            out[k] = v
        else:
            out[k] = str(v) if v is not None else None
    return out


@router.get("")
def export_all():
    data: dict = {
        "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
        "tasks": [],
        "contacts": [],
        "applications": [],
        "knowledge": [],
        "habits": [],
        "habit_completions": [],
        "notifications": [],
    }

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT id, title, status, priority, notes, due_at, created_at, updated_at FROM tasks ORDER BY created_at")
                data["tasks"] = [_ser(dict(r)) for r in cur.fetchall()]

                cur.execute("SELECT id, name, company, title, email, linkedin_url, phone, relationship_type, notes, tags, last_contact_at, created_at FROM contacts ORDER BY name")
                data["contacts"] = [_ser(dict(r)) for r in cur.fetchall()]

                cur.execute("SELECT id, company, title, status, applied_at, notes, cover_letter FROM job_applications ORDER BY applied_at DESC")
                data["applications"] = [_ser(dict(r)) for r in cur.fetchall()]

                cur.execute("SELECT id, title, source_type, source_url, tags, created_at FROM knowledge_items ORDER BY created_at")
                data["knowledge"] = [_ser(dict(r)) for r in cur.fetchall()]

                cur.execute("SELECT id, title, emoji, created_at FROM habits ORDER BY created_at")
                data["habits"] = [_ser(dict(r)) for r in cur.fetchall()]

                cur.execute("SELECT habit_id::text, completed_date FROM habit_completions ORDER BY completed_date DESC LIMIT 365")
                data["habit_completions"] = [_ser(dict(r)) for r in cur.fetchall()]

                cur.execute("SELECT id, title, body, type, read, created_at FROM notifications ORDER BY created_at DESC LIMIT 500")
                data["notifications"] = [_ser(dict(r)) for r in cur.fetchall()]

    except Exception as e:
        log.warning("Export failed", error=str(e))
        data["error"] = str(e)

    return JSONResponse(content=data, headers={
        "Content-Disposition": f"attachment; filename=sirjazper-export-{datetime.datetime.utcnow().strftime('%Y%m%d')}.json",
    })
