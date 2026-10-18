"""Agent activity feed — merged timeline from all agent actions."""
from fastapi import APIRouter
import psycopg2.extras
import structlog

from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


@router.get("")
def activity_feed(limit: int = 100):
    entries = []

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Automation rule fires
                cur.execute("""
                    SELECT ah.fired_at AS ts, ar.name AS rule_name,
                           ah.event_type, ah.event_data
                    FROM automation_history ah
                    LEFT JOIN automation_rules ar ON ar.id = ah.rule_id
                    WHERE ah.fired_at > NOW() - INTERVAL '30 days'
                    ORDER BY ah.fired_at DESC
                    LIMIT 30
                """)
                for r in cur.fetchall():
                    entries.append({
                        "type": "automation",
                        "ts": r["ts"].isoformat() if r["ts"] else None,
                        "title": f"Rule fired: {r['rule_name'] or 'Unknown rule'}",
                        "detail": f"Event: {r['event_type']}",
                        "color": "#8b5cf6",
                    })

                # Cron job runs (success only to reduce noise)
                cur.execute("""
                    SELECT jr.finished_at AS ts, cj.name AS job_name,
                           jr.status, jr.result
                    FROM job_runs jr
                    LEFT JOIN cron_jobs cj ON cj.id = jr.cron_job_id
                    WHERE jr.finished_at > NOW() - INTERVAL '30 days'
                      AND jr.status IN ('success', 'failed')
                    ORDER BY jr.finished_at DESC
                    LIMIT 30
                """)
                for r in cur.fetchall():
                    result = r["result"] or {}
                    applied = result.get("applied", result.get("notified", ""))
                    detail = f"Applied: {applied}" if applied else r["status"]
                    entries.append({
                        "type": "job_run",
                        "ts": r["ts"].isoformat() if r["ts"] else None,
                        "title": r["job_name"] or "Scheduled job",
                        "detail": detail,
                        "color": "#22c55e" if r["status"] == "success" else "#ef4444",
                    })

                # Notifications created by agents (email alerts, etc.)
                cur.execute("""
                    SELECT created_at AS ts, title, body, type
                    FROM notifications
                    WHERE created_at > NOW() - INTERVAL '30 days'
                    ORDER BY created_at DESC
                    LIMIT 40
                """)
                for r in cur.fetchall():
                    entries.append({
                        "type": "notification",
                        "ts": r["ts"].isoformat() if r["ts"] else None,
                        "title": r["title"],
                        "detail": (r["body"] or "")[:120],
                        "color": "#3b82f6",
                    })

    except Exception as e:
        log.warning("Activity feed failed", error=str(e))
        return {"entries": [], "error": str(e)}

    # Sort by ts descending, limit
    entries.sort(key=lambda x: x["ts"] or "", reverse=True)
    return {"entries": entries[:limit]}
