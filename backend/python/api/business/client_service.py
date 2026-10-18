"""COOS — Business Platform: Client data-access + business logic.

Plain sync functions — the single source of truth used by BOTH the LLM
tool-bridge (api.business.tools) and the REST routes (api.business.routes.clients).
"""

from __future__ import annotations

import psycopg2.extras
import structlog

from memory.db.legacy_pg import _pg

log = structlog.get_logger()

VALID_STATUSES = ("prospect", "active", "paused", "churned")

_UPDATABLE_FIELDS = ("name", "contact_name", "contact_email", "phone", "status", "notes")


def _serialize(row: dict) -> dict:
    """Convert UUID/datetime fields to strings so both JSON responses and
    LLM tool-result stringification work without extra handling."""
    out = dict(row)
    for key in ("id",):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    for key in ("created_at", "updated_at"):
        if key in out and out[key] is not None:
            out[key] = out[key].isoformat()
    return out


def create_client(
    name: str,
    contact_name: str = "",
    contact_email: str = "",
    phone: str = "",
    notes: str = "",
) -> dict:
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO biz_clients (name, contact_name, contact_email, phone, notes)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
                """,
                (name, contact_name, contact_email, phone, notes),
            )
            row = dict(cur.fetchone())
        conn.commit()
    return _serialize(row)


def list_clients(status: str | None = None) -> list[dict]:
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if status:
                cur.execute(
                    "SELECT * FROM biz_clients WHERE status = %s ORDER BY created_at DESC",
                    (status,),
                )
            else:
                cur.execute("SELECT * FROM biz_clients ORDER BY created_at DESC")
            rows = [dict(r) for r in cur.fetchall()]
    return [_serialize(r) for r in rows]


def get_client(client_id: str) -> dict | None:
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM biz_clients WHERE id = %s", (client_id,))
            row = cur.fetchone()
    return _serialize(dict(row)) if row else None


def update_client(client_id: str, **fields) -> dict | None:
    if "status" in fields and fields["status"] is not None and fields["status"] not in VALID_STATUSES:
        raise ValueError(
            f"Invalid status '{fields['status']}'. Must be one of: {', '.join(VALID_STATUSES)}"
        )

    updates = {k: v for k, v in fields.items() if k in _UPDATABLE_FIELDS and v is not None}
    if not updates:
        return get_client(client_id)

    set_clause = ", ".join(f"{k} = %s" for k in updates) + ", updated_at = NOW()"
    values = list(updates.values()) + [client_id]

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"UPDATE biz_clients SET {set_clause} WHERE id = %s RETURNING *",
                values,
            )
            row = cur.fetchone()
        conn.commit()
    return _serialize(dict(row)) if row else None


def delete_client(client_id: str) -> bool:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM biz_clients WHERE id = %s", (client_id,))
            deleted = cur.rowcount > 0
        conn.commit()
    return deleted
