"""
DB Change Service — records every significant agent-initiated DB write.

Agents call record_change() fire-and-forget (via asyncio.get_event_loop().run_in_executor).
The UI polls /api/db-changes to show diffs and offers 24-hour rollback.
"""
from __future__ import annotations
import json
import datetime
import structlog

log = structlog.get_logger()


def _conn():
    import psycopg2
    from app.core.config import settings as s
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


def record_change(
    agent_name: str,
    table_name: str,
    operation: str,
    row_id: str = "",
    before: dict | None = None,
    after: dict | None = None,
    sql_hint: str = "",
) -> None:
    """Fire-and-forget: log an agent DB write. Never crashes caller."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO db_change_log
               (agent_name, table_name, operation, row_id, before_json, after_json, sql_hint)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (
                agent_name, table_name, operation, str(row_id),
                json.dumps(before) if before else None,
                json.dumps(after) if after else None,
                sql_hint,
            ),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        log.warning("db_change_service: record failed", error=str(exc))


def get_recent_changes(hours: int = 24, limit: int = 100) -> list[dict]:
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """SELECT id, agent_name, table_name, operation, row_id,
                      before_json, after_json, sql_hint, created_at, rolled_back_at, rolled_back_by
               FROM db_change_log
               WHERE created_at > NOW() - (%s || ' hours')::INTERVAL
               ORDER BY created_at DESC LIMIT %s""",
            (hours, limit),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [
            {
                "id": str(r[0]), "agent_name": r[1], "table_name": r[2],
                "operation": r[3], "row_id": r[4],
                "before_json": r[5], "after_json": r[6], "sql_hint": r[7],
                "created_at": r[8].isoformat() if r[8] else None,
                "rolled_back_at": r[9].isoformat() if r[9] else None,
                "rolled_back_by": r[10],
                "can_rollback": r[9] is None and (
                    datetime.datetime.utcnow() - r[8].replace(tzinfo=None)
                ).total_seconds() < 86400,
            }
            for r in rows
        ]
    except Exception as exc:
        log.error("db_change_service: get_recent_changes failed", error=str(exc))
        return []


def rollback_change(change_id: str, rolled_back_by: str = "user") -> dict:
    """
    Best-effort rollback using before_json.
    For UPDATE: restores previous column values.
    For INSERT: deletes the row.
    For DELETE: re-inserts from before_json.
    Returns {ok, message}.
    """
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT table_name, operation, row_id, before_json, after_json, rolled_back_at FROM db_change_log WHERE id = %s",
            (change_id,),
        )
        row = cur.fetchone()
        if not row:
            return {"ok": False, "message": "Change not found"}
        table, op, row_id, before, after, rolled_back_at = row
        if rolled_back_at:
            return {"ok": False, "message": "Already rolled back"}

        msg = "Rolled back"
        if op == "UPDATE" and before:
            cols = list(before.keys())
            vals = [before[c] for c in cols]
            set_clause = ", ".join(f"{c} = %s" for c in cols)
            cur.execute(f"UPDATE {table} SET {set_clause} WHERE id = %s", vals + [row_id])
            msg = f"Restored {table} row {row_id} to previous state"
        elif op == "INSERT" and row_id:
            cur.execute(f"DELETE FROM {table} WHERE id = %s", (row_id,))
            msg = f"Deleted inserted row {row_id} from {table}"
        elif op == "DELETE" and before:
            cols = list(before.keys())
            vals = [before[c] for c in cols]
            placeholders = ", ".join(["%s"] * len(cols))
            cur.execute(
                f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})",
                vals,
            )
            msg = f"Re-inserted deleted row into {table}"
        else:
            return {"ok": False, "message": "Cannot rollback: insufficient snapshot data"}

        cur.execute(
            "UPDATE db_change_log SET rolled_back_at = NOW(), rolled_back_by = %s WHERE id = %s",
            (rolled_back_by, change_id),
        )
        conn.commit()
        cur.close()
        conn.close()
        log.info("db_change_service: rollback complete", change_id=change_id, msg=msg)
        return {"ok": True, "message": msg}
    except Exception as exc:
        log.error("db_change_service: rollback failed", error=str(exc))
        return {"ok": False, "message": str(exc)}
