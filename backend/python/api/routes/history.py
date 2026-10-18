from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2.extras
import structlog

from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


@router.get("/")
def list_sessions():
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT s.id, s.title, s.expires_at, s.created_at, s.updated_at,
                           COUNT(m.id) AS message_count
                    FROM chat_sessions s
                    LEFT JOIN chat_messages m ON m.session_id = s.id
                    WHERE (s.expires_at IS NULL OR s.expires_at > NOW())
                    GROUP BY s.id
                    ORDER BY s.updated_at DESC
                    LIMIT 200
                """)
                rows = cur.fetchall()
        return {"sessions": [dict(r) for r in rows]}
    except Exception as e:
        log.warning("Failed to list sessions", error=str(e))
        return {"sessions": []}


@router.get("/{session_id}")
def get_session(session_id: str):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT role, content, meta, created_at
                    FROM chat_messages
                    WHERE session_id = %s
                    ORDER BY created_at ASC
                """, (session_id,))
                rows = cur.fetchall()
        return {"messages": [dict(r) for r in rows]}
    except Exception as e:
        log.warning("Failed to get session", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{session_id}")
def delete_session(session_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM chat_sessions WHERE id = %s", (session_id,))
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to delete session", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


class RenameBody(BaseModel):
    title: str


@router.patch("/{session_id}")
def rename_session(session_id: str, body: RenameBody):
    title = body.title.strip()[:100]
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE chat_sessions SET title = %s WHERE id = %s",
                    (title, session_id),
                )
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to rename session", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
