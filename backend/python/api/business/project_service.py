"""COOS — Business Platform: Project data-access + business logic.

Plain sync functions — the single source of truth used by BOTH the LLM
tool-bridge (api.business.tools) and the REST routes (api.business.routes.projects).
"""

from __future__ import annotations

import psycopg2.errors
import psycopg2.extras
import structlog

from core.services.memory_service import _pg

log = structlog.get_logger()

VALID_STATUSES = ("planning", "active", "on_hold", "completed", "cancelled")

_UPDATABLE_FIELDS = ("title", "description", "status", "start_date", "due_date", "notes")


def _serialize(row: dict) -> dict:
    """Convert UUID/date/datetime fields to strings so both JSON responses and
    LLM tool-result stringification work without extra handling."""
    out = dict(row)
    for key in ("id", "client_id"):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    for key in ("start_date", "due_date", "created_at", "updated_at"):
        if key in out and out[key] is not None:
            out[key] = out[key].isoformat()
    return out


def create_project(
    client_id: str,
    title: str,
    description: str = "",
    start_date: str | None = None,
    due_date: str | None = None,
    notes: str = "",
) -> dict:
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO biz_projects (client_id, title, description, start_date, due_date, notes)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (client_id, title, description, start_date, due_date, notes),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except psycopg2.errors.ForeignKeyViolation:
        raise ValueError(f"No client found with id '{client_id}'.")
    return _serialize(row)


def list_projects(client_id: str | None = None, status: str | None = None) -> list[dict]:
    clauses = []
    params: list = []
    if client_id:
        clauses.append("client_id = %s")
        params.append(client_id)
    if status:
        clauses.append("status = %s")
        params.append(status)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"SELECT * FROM biz_projects {where} ORDER BY created_at DESC",
                params,
            )
            rows = [dict(r) for r in cur.fetchall()]
    return [_serialize(r) for r in rows]


def get_project(project_id: str) -> dict | None:
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM biz_projects WHERE id = %s", (project_id,))
            row = cur.fetchone()
    return _serialize(dict(row)) if row else None


def update_project(project_id: str, **fields) -> dict | None:
    if "status" in fields and fields["status"] is not None and fields["status"] not in VALID_STATUSES:
        raise ValueError(
            f"Invalid status '{fields['status']}'. Must be one of: {', '.join(VALID_STATUSES)}"
        )

    updates = {k: v for k, v in fields.items() if k in _UPDATABLE_FIELDS and v is not None}
    if not updates:
        return get_project(project_id)

    set_clause = ", ".join(f"{k} = %s" for k in updates) + ", updated_at = NOW()"
    values = list(updates.values()) + [project_id]

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"UPDATE biz_projects SET {set_clause} WHERE id = %s RETURNING *",
                values,
            )
            row = cur.fetchone()
        conn.commit()
    return _serialize(dict(row)) if row else None


def delete_project(project_id: str) -> bool:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM biz_projects WHERE id = %s", (project_id,))
            deleted = cur.rowcount > 0
        conn.commit()
    return deleted
