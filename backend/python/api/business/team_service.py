"""COOS — Business Platform: Team Member data-access + business logic.

Plain sync functions — the single source of truth used by BOTH the LLM
tool-bridge (api.business.tools) and the REST routes (api.business.routes.team).

Also covers the biz_project_assignments join table (team members <-> projects),
since assignments are a simple many-to-many sub-resource of Team Members.
"""

from __future__ import annotations

import psycopg2.errors
import psycopg2.extras
import structlog

from core.services.memory_service import _pg

log = structlog.get_logger()

VALID_MEMBER_TYPES = ("employee", "freelancer", "intern", "contractor")
VALID_RATE_UNITS = ("hourly", "daily", "monthly", "fixed")
VALID_STATUSES = ("active", "on_leave", "inactive")

_UPDATABLE_FIELDS = (
    "name", "email", "role", "member_type", "rate", "rate_unit",
    "status", "end_date", "notes",
)


def _serialize(row: dict) -> dict:
    """Convert UUID/date/datetime fields to strings so both JSON responses and
    LLM tool-result stringification work without extra handling."""
    out = dict(row)
    for key in ("id",):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    for key in ("start_date", "end_date", "created_at", "updated_at"):
        if key in out and out[key] is not None:
            out[key] = out[key].isoformat()
    return out


def _serialize_assignment(row: dict) -> dict:
    """Serialize an assignment row (optionally joined with team member fields)."""
    out = dict(row)
    for key in ("id", "project_id", "team_member_id"):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    for key in ("assigned_at",):
        if key in out and out[key] is not None:
            out[key] = out[key].isoformat()
    return out


def create_team_member(
    name: str,
    email: str = "",
    role: str = "",
    member_type: str = "employee",
    rate: float = 0,
    rate_unit: str = "hourly",
    start_date: str | None = None,
    notes: str = "",
) -> dict:
    if member_type not in VALID_MEMBER_TYPES:
        raise ValueError(
            f"Invalid member_type '{member_type}'. Must be one of: {', '.join(VALID_MEMBER_TYPES)}"
        )
    if rate_unit not in VALID_RATE_UNITS:
        raise ValueError(
            f"Invalid rate_unit '{rate_unit}'. Must be one of: {', '.join(VALID_RATE_UNITS)}"
        )

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO biz_team_members
                    (name, email, role, member_type, rate, rate_unit, start_date, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (name, email, role, member_type, rate, rate_unit, start_date, notes),
            )
            row = dict(cur.fetchone())
        conn.commit()
    return _serialize(row)


def list_team_members(member_type: str | None = None, status: str | None = None) -> list[dict]:
    clauses = []
    params: list = []
    if member_type:
        clauses.append("member_type = %s")
        params.append(member_type)
    if status:
        clauses.append("status = %s")
        params.append(status)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"SELECT * FROM biz_team_members {where} ORDER BY created_at DESC",
                params,
            )
            rows = [dict(r) for r in cur.fetchall()]
    return [_serialize(r) for r in rows]


def get_team_member(member_id: str) -> dict | None:
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM biz_team_members WHERE id = %s", (member_id,))
            row = cur.fetchone()
    return _serialize(dict(row)) if row else None


def update_team_member(member_id: str, **fields) -> dict | None:
    if (
        "member_type" in fields
        and fields["member_type"] is not None
        and fields["member_type"] not in VALID_MEMBER_TYPES
    ):
        raise ValueError(
            f"Invalid member_type '{fields['member_type']}'. Must be one of: {', '.join(VALID_MEMBER_TYPES)}"
        )
    if (
        "rate_unit" in fields
        and fields["rate_unit"] is not None
        and fields["rate_unit"] not in VALID_RATE_UNITS
    ):
        raise ValueError(
            f"Invalid rate_unit '{fields['rate_unit']}'. Must be one of: {', '.join(VALID_RATE_UNITS)}"
        )
    if (
        "status" in fields
        and fields["status"] is not None
        and fields["status"] not in VALID_STATUSES
    ):
        raise ValueError(
            f"Invalid status '{fields['status']}'. Must be one of: {', '.join(VALID_STATUSES)}"
        )

    updates = {k: v for k, v in fields.items() if k in _UPDATABLE_FIELDS and v is not None}
    if not updates:
        return get_team_member(member_id)

    set_clause = ", ".join(f"{k} = %s" for k in updates) + ", updated_at = NOW()"
    values = list(updates.values()) + [member_id]

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"UPDATE biz_team_members SET {set_clause} WHERE id = %s RETURNING *",
                values,
            )
            row = cur.fetchone()
        conn.commit()
    return _serialize(dict(row)) if row else None


def delete_team_member(member_id: str) -> bool:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM biz_team_members WHERE id = %s", (member_id,))
            deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def assign_to_project(project_id: str, team_member_id: str, role_on_project: str = "") -> dict:
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO biz_project_assignments (project_id, team_member_id, role_on_project)
                    VALUES (%s, %s, %s)
                    RETURNING *
                    """,
                    (project_id, team_member_id, role_on_project),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except psycopg2.errors.UniqueViolation:
        raise ValueError("This team member is already assigned to this project.")
    except psycopg2.errors.ForeignKeyViolation:
        raise ValueError("Project or team member not found — check both IDs.")
    return _serialize_assignment(row)


def list_project_assignments(project_id: str) -> list[dict]:
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    a.*,
                    m.name AS member_name,
                    m.email AS member_email,
                    m.role AS member_role
                FROM biz_project_assignments a
                JOIN biz_team_members m ON m.id = a.team_member_id
                WHERE a.project_id = %s
                ORDER BY a.assigned_at DESC
                """,
                (project_id,),
            )
            rows = [dict(r) for r in cur.fetchall()]
    return [_serialize_assignment(r) for r in rows]


def unassign_from_project(project_id: str, team_member_id: str) -> bool:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM biz_project_assignments WHERE project_id = %s AND team_member_id = %s",
                (project_id, team_member_id),
            )
            deleted = cur.rowcount > 0
        conn.commit()
    return deleted
