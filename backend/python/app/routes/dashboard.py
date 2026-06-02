"""Dashboard stats — aggregates from all services."""
import time
from fastapi import APIRouter
import structlog
import psycopg2.extras

from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()
_start_time = time.time()


@router.get("/stats")
def dashboard_stats():
    stats = {
        "uptime_seconds": int(time.time() - _start_time),
        "tasks": {"pending": 0, "done": 0, "due_today": 0, "overdue": 0},
        "memory": {"core": 0, "extracted": 0, "auto": 0},
        "chat": {"sessions": 0, "messages_today": 0},
        "services": {},
    }
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                # Tasks
                cur.execute("""
                    SELECT
                        COUNT(*) FILTER (WHERE status != 'done') AS pending,
                        COUNT(*) FILTER (WHERE status = 'done') AS done,
                        COUNT(*) FILTER (WHERE due_at::date = CURRENT_DATE AND status != 'done') AS due_today,
                        COUNT(*) FILTER (WHERE due_at < NOW() AND status != 'done') AS overdue
                    FROM tasks
                """)
                r = cur.fetchone()
                stats["tasks"] = {"pending": r[0], "done": r[1], "due_today": r[2], "overdue": r[3]}

                # Memory
                cur.execute("SELECT COUNT(*) FROM core_memories")
                stats["memory"]["core"] = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM extracted_memories")
                stats["memory"]["extracted"] = cur.fetchone()[0]

                # Chat
                cur.execute("SELECT COUNT(*) FROM chat_sessions WHERE expires_at IS NULL OR expires_at > NOW()")
                stats["chat"]["sessions"] = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM chat_messages WHERE created_at::date = CURRENT_DATE")
                stats["chat"]["messages_today"] = cur.fetchone()[0]

                # Notifications unread
                cur.execute("SELECT COUNT(*) FROM notifications WHERE read = FALSE")
                stats["unread_notifications"] = cur.fetchone()[0]

        stats["services"]["database"] = "online"
    except Exception as e:
        stats["services"]["database"] = "offline"

    # LM Studio ping
    try:
        import urllib.request
        urllib.request.urlopen("http://localhost:1234/v1/models", timeout=1)
        stats["services"]["lm_studio"] = "online"
    except Exception:
        stats["services"]["lm_studio"] = "offline"

    return stats
