"""COOS — Business Platform: REST routes for Finance (Invoices + Expenses).

Thin FastAPI wrapper over api.business.finance_service — the single source of
truth also used by the LLM tool bridge (api.business.tools). Invoices, their
line items, and expenses all live in this one file since this is still an
early-stage platform and finance is a small, cohesive slice.
"""

from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from api.business import finance_service

router = APIRouter()
log = structlog.get_logger()


class InvoiceCreate(BaseModel):
    client_id: str
    invoice_number: str
    project_id: Optional[str] = None
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    notes: str = ""


class InvoiceLineItemCreate(BaseModel):
    description: str
    quantity: float = 1
    unit_price: float = 0


class InvoiceStatusPatch(BaseModel):
    status: str


class ExpenseCreate(BaseModel):
    description: str
    amount: float
    project_id: Optional[str] = None
    category: str = "other"
    expense_date: Optional[str] = None
    notes: str = ""


@router.post("/invoices")
def create_invoice(body: InvoiceCreate):
    try:
        return finance_service.create_invoice(
            client_id=body.client_id,
            invoice_number=body.invoice_number,
            project_id=body.project_id,
            issue_date=body.issue_date,
            due_date=body.due_date,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("create_invoice failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/invoices")
def list_invoices(client_id: Optional[str] = None, status: Optional[str] = None):
    try:
        return finance_service.list_invoices(client_id=client_id, status=status)
    except Exception as e:
        log.warning("list_invoices failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: str):
    try:
        row = finance_service.get_invoice(invoice_id)
    except Exception as e:
        log.warning("get_invoice failed", error=str(e))
        raise HTTPException(500, str(e))
    if not row:
        raise HTTPException(404, "Invoice not found")
    return row


@router.post("/invoices/{invoice_id}/items")
def add_invoice_line_item(invoice_id: str, body: InvoiceLineItemCreate):
    try:
        return finance_service.add_invoice_line_item(
            invoice_id=invoice_id,
            description=body.description,
            quantity=body.quantity,
            unit_price=body.unit_price,
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        log.warning("add_invoice_line_item failed", error=str(e))
        raise HTTPException(500, str(e))


@router.patch("/invoices/{invoice_id}/status")
def patch_invoice_status(invoice_id: str, body: InvoiceStatusPatch):
    try:
        row = finance_service.update_invoice_status(invoice_id, status=body.status)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("patch_invoice_status failed", error=str(e))
        raise HTTPException(500, str(e))
    if not row:
        raise HTTPException(404, "Invoice not found")
    return row


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: str):
    try:
        existing = finance_service.get_invoice(invoice_id)
        if not existing:
            raise HTTPException(404, "Invoice not found")
        finance_service.delete_invoice(invoice_id)
    except HTTPException:
        raise
    except Exception as e:
        log.warning("delete_invoice failed", error=str(e))
        raise HTTPException(500, str(e))
    return Response(status_code=204)


@router.post("/expenses")
def create_expense(body: ExpenseCreate):
    try:
        return finance_service.create_expense(
            description=body.description,
            amount=body.amount,
            project_id=body.project_id,
            category=body.category,
            expense_date=body.expense_date,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("create_expense failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/expenses")
def list_expenses(project_id: Optional[str] = None, category: Optional[str] = None):
    try:
        return finance_service.list_expenses(project_id=project_id, category=category)
    except Exception as e:
        log.warning("list_expenses failed", error=str(e))
        raise HTTPException(500, str(e))


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: str):
    try:
        finance_service.delete_expense(expense_id)
    except Exception as e:
        log.warning("delete_expense failed", error=str(e))
        raise HTTPException(500, str(e))
    return Response(status_code=204)


@router.get("/summary")
def get_finance_summary(client_id: Optional[str] = None):
    try:
        return finance_service.get_finance_summary(client_id=client_id)
    except Exception as e:
        log.warning("get_finance_summary failed", error=str(e))
        raise HTTPException(500, str(e))
