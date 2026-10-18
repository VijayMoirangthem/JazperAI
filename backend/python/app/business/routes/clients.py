"""COOS — Business Platform: REST routes for Clients.

Thin FastAPI wrapper over app.business.client_service — the single source of
truth also used by the LLM tool bridge (app.business.tools).
"""

from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.business import client_service

router = APIRouter()
log = structlog.get_logger()


class ClientCreate(BaseModel):
    name: str
    contact_name: str = ""
    contact_email: str = ""
    phone: str = ""
    notes: str = ""


class ClientPatch(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


@router.post("")
def create_client(body: ClientCreate):
    try:
        return client_service.create_client(
            name=body.name,
            contact_name=body.contact_name,
            contact_email=body.contact_email,
            phone=body.phone,
            notes=body.notes,
        )
    except Exception as e:
        log.warning("create_client failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("")
def list_clients(status: Optional[str] = None):
    try:
        return client_service.list_clients(status=status)
    except Exception as e:
        log.warning("list_clients failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/{client_id}")
def get_client(client_id: str):
    try:
        row = client_service.get_client(client_id)
    except Exception as e:
        log.warning("get_client failed", error=str(e))
        raise HTTPException(500, str(e))
    if not row:
        raise HTTPException(404, "Client not found")
    return row


@router.patch("/{client_id}")
def patch_client(client_id: str, body: ClientPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        row = client_service.update_client(client_id, **fields)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("patch_client failed", error=str(e))
        raise HTTPException(500, str(e))
    if not row:
        raise HTTPException(404, "Client not found")
    return row


@router.delete("/{client_id}")
def delete_client(client_id: str):
    try:
        existing = client_service.get_client(client_id)
        if not existing:
            raise HTTPException(404, "Client not found")
        client_service.delete_client(client_id)
    except HTTPException:
        raise
    except Exception as e:
        log.warning("delete_client failed", error=str(e))
        raise HTTPException(500, str(e))
    return Response(status_code=204)
