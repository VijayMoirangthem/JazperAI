"""
Company Dashboard — aggregated OS-level KPIs for the Sir Jazper Command view.
"""
from fastapi import APIRouter
import structlog

log = structlog.get_logger()
router = APIRouter(prefix="/api/company", tags=["company"])


def _conn():
    import psycopg2
    from core.config import settings as s
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


@router.get("/kpis")
def get_kpis():
    """Top-level KPIs: agents, tasks, errors, messages, cost."""
    try:
        conn = _conn()
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM agent_registry WHERE status = 'active'")
        active_agents = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM agent_registry")
        total_agents = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM tasks WHERE created_at >= CURRENT_DATE")
        tasks_today = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM tasks WHERE status = 'done' AND updated_at >= CURRENT_DATE")
        tasks_done_today = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM chat_messages WHERE created_at >= CURRENT_DATE")
        messages_today = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM agent_errors WHERE created_at >= CURRENT_DATE")
        errors_today = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM it_department_log WHERE status NOT IN ('resolved', 'failed', 'rejected', 'needs_human') AND applied = FALSE")
        open_tickets = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM agent_actions WHERE created_at >= CURRENT_DATE")
        actions_today = cur.fetchone()[0]

        cur.close()
        conn.close()
        return {
            "active_agents": active_agents,
            "total_agents": total_agents,
            "tasks_today": tasks_today,
            "tasks_done_today": tasks_done_today,
            "messages_today": messages_today,
            "errors_today": errors_today,
            "open_tickets": open_tickets,
            "actions_today": actions_today,
        }
    except Exception as exc:
        log.error("company kpis failed", error=str(exc))
        return {}


@router.get("/departments")
def get_department_scorecard():
    """Per-department health scorecard."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT d.name, d.id,
                   COUNT(ar.id) FILTER (WHERE ar.status = 'active') AS active,
                   COUNT(ar.id) FILTER (WHERE ar.status = 'standby') AS standby,
                   COUNT(ar.id) AS total,
                   ROUND(AVG(ar.health_score)::numeric, 1) AS avg_health,
                   SUM(ar.tasks_completed) AS tasks_completed,
                   SUM(ar.tasks_failed) AS tasks_failed
            FROM departments d
            LEFT JOIN agent_registry ar ON ar.department = d.id
            GROUP BY d.id, d.name
            ORDER BY d.name
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {"departments": [
            {
                "name": r[0], "id": str(r[1]),
                "active": r[2] or 0, "standby": r[3] or 0, "total": r[4] or 0,
                "avg_health": float(r[5]) if r[5] else 100.0,
                "tasks_completed": r[6] or 0, "tasks_failed": r[7] or 0,
            }
            for r in rows
        ]}
    except Exception as exc:
        log.error("company departments failed", error=str(exc))
        return {"departments": []}


@router.post("/kill-switch")
def kill_switch(enabled: bool = True):
    """Master kill switch — disables/re-enables all non-executive agents."""
    try:
        conn = _conn()
        cur = conn.cursor()
        new_status = "standby" if enabled else "active"
        cur.execute(
            "UPDATE agent_registry SET status = %s WHERE level > 1",
            (new_status,),
        )
        affected = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "affected": affected, "new_status": new_status}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@router.post("/departments/{dept_id}/toggle")
def toggle_department(dept_id: str, enabled: bool = True):
    """Enable or disable all agents in a department."""
    try:
        conn = _conn()
        cur = conn.cursor()
        new_status = "active" if enabled else "standby"
        cur.execute(
            "UPDATE agent_registry SET status = %s WHERE department = %s",
            (new_status, dept_id),
        )
        affected = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "affected": affected}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
