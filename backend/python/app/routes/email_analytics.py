"""Email analytics — volume, type breakdown, activity trends."""
from fastapi import APIRouter
import psycopg2.extras
import structlog
import datetime

from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


@router.get("")
def email_analytics(days: int = 30):
    result = {
        "total": 0,
        "by_type": {},
        "by_day": [],   # [{date, count}] last N days
        "reply_count": 0,
        "automation_fires": 0,
        "peak_hour": None,
        "unread_rate": 0.0,
    }
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Total email-type notifications in window
                cur.execute("""
                    SELECT COUNT(*) as total,
                           SUM(CASE WHEN read = false THEN 1 ELSE 0 END) as unread
                    FROM notifications
                    WHERE type IN ('email','recruiter','interview','offer','rejection','action_required','important')
                      AND created_at > NOW() - INTERVAL '%s days'
                """, (days,))
                row = cur.fetchone()
                if row:
                    total = int(row["total"] or 0)
                    unread = int(row["unread"] or 0)
                    result["total"] = total
                    result["unread_rate"] = round((unread / total * 100) if total > 0 else 0, 1)

                # By type
                cur.execute("""
                    SELECT type, COUNT(*) as cnt
                    FROM notifications
                    WHERE type IN ('email','recruiter','interview','offer','rejection','action_required','important')
                      AND created_at > NOW() - INTERVAL '%s days'
                    GROUP BY type ORDER BY cnt DESC
                """, (days,))
                result["by_type"] = {r["type"]: int(r["cnt"]) for r in cur.fetchall()}

                # Volume by day (last 30 days)
                cur.execute("""
                    SELECT DATE(created_at) as day, COUNT(*) as cnt
                    FROM notifications
                    WHERE created_at > NOW() - INTERVAL '%s days'
                    GROUP BY day ORDER BY day ASC
                """, (days,))
                result["by_day"] = [
                    {"date": str(r["day"]), "count": int(r["cnt"])}
                    for r in cur.fetchall()
                ]

                # Peak hour (when most emails arrive)
                cur.execute("""
                    SELECT EXTRACT(HOUR FROM created_at) as hr, COUNT(*) as cnt
                    FROM notifications
                    WHERE type IN ('email','recruiter','interview','offer','rejection')
                      AND created_at > NOW() - INTERVAL '%s days'
                    GROUP BY hr ORDER BY cnt DESC LIMIT 1
                """, (days,))
                row = cur.fetchone()
                if row:
                    h = int(row["hr"])
                    result["peak_hour"] = f"{h:02d}:00"

                # Automation fires (how many rules were triggered)
                cur.execute("""
                    SELECT COUNT(*) FROM automation_history
                    WHERE fired_at > NOW() - INTERVAL '%s days'
                """, (days,))
                row = cur.fetchone()
                result["automation_fires"] = int((row or {}).get("count", 0) or 0)

                # Reply count (notifications that have metadata with msg_id, indicating tracked replies)
                cur.execute("""
                    SELECT COUNT(*) FROM notifications
                    WHERE metadata->>'msg_id' IS NOT NULL
                      AND created_at > NOW() - INTERVAL '%s days'
                """, (days,))
                row = cur.fetchone()
                result["reply_count"] = int((row or {}).get("count", 0) or 0)

    except Exception as e:
        log.warning("Email analytics failed", error=str(e))
        result["error"] = str(e)

    return result
