"""
Evolution log API — read the audit trail of all agent self-modification actions.
Agents write to this table via _log_evolution() in agent_tools.py.
"""

from fastapi import APIRouter
import psycopg2
import structlog
from core.config import settings

log = structlog.get_logger()
router = APIRouter(prefix="/api/evolution", tags=["evolution"])


def _db_conn():
    s = settings
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


@router.get("")
def list_evolution(
    limit: int = 50,
    agent: str = "",
    action_type: str = "",
):
    """Return the most recent evolution log entries, optionally filtered."""
    try:
        conn = _db_conn()
        try:
            cur = conn.cursor()
            conditions: list[str] = []
            params: list = []
            if agent:
                conditions.append("LOWER(agent_codename) = LOWER(%s)")
                params.append(agent)
            if action_type:
                conditions.append("action_type = %s")
                params.append(action_type)

            where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
            params.append(min(limit, 200))

            cur.execute(
                f"SELECT id, agent_codename, action_type, target, description, "
                f"       payload, outcome, created_at "
                f"FROM evolution_log {where} "
                f"ORDER BY created_at DESC LIMIT %s",
                params,
            )
            rows = cur.fetchall()
            cur.close()
        finally:
            conn.close()

        return {
            "entries": [
                {
                    "id":             str(r[0]),
                    "agent_codename": r[1],
                    "action_type":    r[2],
                    "target":         r[3],
                    "description":    r[4],
                    "payload":        r[5] or {},
                    "outcome":        r[6],
                    "created_at":     r[7].isoformat() if r[7] else None,
                }
                for r in rows
            ]
        }
    except Exception as e:
        log.error("evolution_list_fail", error=str(e))
        return {"entries": [], "error": str(e)}


@router.get("/stats")
def evolution_stats():
    """Return summary stats: total actions, breakdown by type and agent."""
    try:
        conn = _db_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT action_type, COUNT(*) FROM evolution_log "
                "GROUP BY action_type ORDER BY COUNT(*) DESC"
            )
            by_type = [{"action_type": r[0], "count": r[1]} for r in cur.fetchall()]

            cur.execute(
                "SELECT agent_codename, COUNT(*) FROM evolution_log "
                "GROUP BY agent_codename ORDER BY COUNT(*) DESC LIMIT 20"
            )
            by_agent = [{"agent": r[0], "count": r[1]} for r in cur.fetchall()]

            cur.execute("SELECT COUNT(*) FROM evolution_log")
            total = cur.fetchone()[0]
            cur.close()
        finally:
            conn.close()

        return {"total": total, "by_type": by_type, "by_agent": by_agent}
    except Exception as e:
        return {"total": 0, "by_type": [], "by_agent": [], "error": str(e)}
