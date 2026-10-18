"""COOS — Business Platform: Finance (Invoices + Expenses) data-access + business logic.

Plain sync functions — the single source of truth used by BOTH the LLM
tool-bridge (app.business.tools) and the REST routes (app.business.routes.finance).

Also covers the biz_invoice_line_items join-ish detail table (invoices <-> line
items), since line items are a simple one-to-many sub-resource of Invoices. An
invoice's total is never stored — it's always computed on read as
SUM(quantity * unit_price) across its line items.
"""

from __future__ import annotations

import psycopg2.errors
import psycopg2.extras
import structlog

from app.services.memory_service import _pg

log = structlog.get_logger()

VALID_INVOICE_STATUSES = ("draft", "sent", "paid", "overdue", "cancelled")
VALID_EXPENSE_CATEGORIES = ("software", "contractor", "travel", "office", "other")


def _serialize(row: dict) -> dict:
    """Convert UUID/date/datetime fields to strings so both JSON responses and
    LLM tool-result stringification work without extra handling."""
    out = dict(row)
    for key in ("id", "client_id", "project_id"):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    for key in ("issue_date", "due_date", "paid_date", "created_at", "updated_at"):
        if key in out and out[key] is not None:
            out[key] = out[key].isoformat()
    return out


def _serialize_line_item(row: dict) -> dict:
    out = dict(row)
    for key in ("id", "invoice_id"):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    for key in ("created_at",):
        if key in out and out[key] is not None:
            out[key] = out[key].isoformat()
    return out


def _serialize_expense(row: dict) -> dict:
    out = dict(row)
    for key in ("id", "project_id"):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    for key in ("expense_date", "created_at"):
        if key in out and out[key] is not None:
            out[key] = out[key].isoformat()
    return out


def create_invoice(
    client_id: str,
    invoice_number: str,
    project_id: str | None = None,
    issue_date: str | None = None,
    due_date: str | None = None,
    notes: str = "",
) -> dict:
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO biz_invoices
                        (client_id, project_id, invoice_number, status, issue_date, due_date, notes)
                    VALUES (%s, %s, %s, 'draft', %s, %s, %s)
                    RETURNING *
                    """,
                    (client_id, project_id, invoice_number, issue_date, due_date, notes),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except psycopg2.errors.ForeignKeyViolation:
        raise ValueError("No client (or project) found with the given id.")
    row["total"] = 0
    return _serialize(row)


def add_invoice_line_item(
    invoice_id: str,
    description: str,
    quantity: float = 1,
    unit_price: float = 0,
) -> dict:
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO biz_invoice_line_items (invoice_id, description, quantity, unit_price)
                    VALUES (%s, %s, %s, %s)
                    RETURNING *
                    """,
                    (invoice_id, description, quantity, unit_price),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except psycopg2.errors.ForeignKeyViolation:
        raise ValueError(f"No invoice found with id '{invoice_id}'.")
    return _serialize_line_item(row)


def list_invoices(client_id: str | None = None, status: str | None = None) -> list[dict]:
    clauses = []
    params: list = []
    if client_id:
        clauses.append("i.client_id = %s")
        params.append(client_id)
    if status:
        clauses.append("i.status = %s")
        params.append(status)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT
                    i.*,
                    COALESCE(SUM(li.quantity * li.unit_price), 0) AS total
                FROM biz_invoices i
                LEFT JOIN biz_invoice_line_items li ON li.invoice_id = i.id
                {where}
                GROUP BY i.id
                ORDER BY i.created_at DESC
                """,
                params,
            )
            rows = [dict(r) for r in cur.fetchall()]
    return [_serialize(r) for r in rows]


def get_invoice(invoice_id: str) -> dict | None:
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    i.*,
                    COALESCE(SUM(li.quantity * li.unit_price), 0) AS total
                FROM biz_invoices i
                LEFT JOIN biz_invoice_line_items li ON li.invoice_id = i.id
                WHERE i.id = %s
                GROUP BY i.id
                """,
                (invoice_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            row = dict(row)

            cur.execute(
                "SELECT * FROM biz_invoice_line_items WHERE invoice_id = %s ORDER BY created_at ASC",
                (invoice_id,),
            )
            items = [dict(r) for r in cur.fetchall()]

    invoice = _serialize(row)
    line_items = []
    for item in items:
        serialized = _serialize_line_item(item)
        serialized["line_total"] = item["quantity"] * item["unit_price"]
        line_items.append(serialized)
    invoice["line_items"] = line_items
    return invoice


def update_invoice_status(invoice_id: str, status: str) -> dict | None:
    if status not in VALID_INVOICE_STATUSES:
        raise ValueError(
            f"Invalid status '{status}'. Must be one of: {', '.join(VALID_INVOICE_STATUSES)}"
        )

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if status == "paid":
                cur.execute(
                    """
                    UPDATE biz_invoices
                    SET status = %s,
                        paid_date = COALESCE(paid_date, CURRENT_DATE),
                        updated_at = NOW()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (status, invoice_id),
                )
            else:
                cur.execute(
                    """
                    UPDATE biz_invoices
                    SET status = %s, updated_at = NOW()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (status, invoice_id),
                )
            row = cur.fetchone()
        conn.commit()
    if not row:
        return None
    return get_invoice(invoice_id)


def delete_invoice(invoice_id: str) -> bool:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM biz_invoices WHERE id = %s", (invoice_id,))
            deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def create_expense(
    description: str,
    amount: float,
    project_id: str | None = None,
    category: str = "other",
    expense_date: str | None = None,
    notes: str = "",
) -> dict:
    if category not in VALID_EXPENSE_CATEGORIES:
        raise ValueError(
            f"Invalid category '{category}'. Must be one of: {', '.join(VALID_EXPENSE_CATEGORIES)}"
        )

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO biz_expenses (project_id, description, amount, category, expense_date, notes)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (project_id, description, amount, category, expense_date, notes),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except psycopg2.errors.ForeignKeyViolation:
        raise ValueError(f"No project found with id '{project_id}'.")
    return _serialize_expense(row)


def list_expenses(project_id: str | None = None, category: str | None = None) -> list[dict]:
    clauses = []
    params: list = []
    if project_id:
        clauses.append("project_id = %s")
        params.append(project_id)
    if category:
        clauses.append("category = %s")
        params.append(category)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"SELECT * FROM biz_expenses {where} ORDER BY created_at DESC",
                params,
            )
            rows = [dict(r) for r in cur.fetchall()]
    return [_serialize_expense(r) for r in rows]


def delete_expense(expense_id: str) -> bool:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM biz_expenses WHERE id = %s", (expense_id,))
            deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def get_finance_summary(client_id: str | None = None) -> dict:
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            invoice_clauses = ["i.status != 'cancelled'"]
            invoice_params: list = []
            if client_id:
                invoice_clauses.append("i.client_id = %s")
                invoice_params.append(client_id)
            invoice_where = f"WHERE {' AND '.join(invoice_clauses)}"

            cur.execute(
                f"""
                SELECT
                    COALESCE(SUM(li.quantity * li.unit_price), 0) AS total_invoiced,
                    COALESCE(SUM(li.quantity * li.unit_price) FILTER (WHERE i.status = 'paid'), 0) AS total_paid,
                    COUNT(DISTINCT i.id) AS invoice_count
                FROM biz_invoices i
                LEFT JOIN biz_invoice_line_items li ON li.invoice_id = i.id
                {invoice_where}
                """,
                invoice_params,
            )
            invoice_row = dict(cur.fetchone())

            if client_id:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(e.amount), 0) AS total_expenses
                    FROM biz_expenses e
                    JOIN biz_projects p ON p.id = e.project_id
                    WHERE p.client_id = %s
                    """,
                    (client_id,),
                )
            else:
                cur.execute("SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM biz_expenses")
            expense_row = dict(cur.fetchone())

    total_invoiced = float(invoice_row["total_invoiced"])
    total_paid = float(invoice_row["total_paid"])
    return {
        "total_invoiced": total_invoiced,
        "total_paid": total_paid,
        "total_outstanding": total_invoiced - total_paid,
        "total_expenses": float(expense_row["total_expenses"]),
        "invoice_count": int(invoice_row["invoice_count"]),
    }
