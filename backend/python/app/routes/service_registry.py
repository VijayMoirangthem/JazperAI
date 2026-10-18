"""Phase 7E — Service Registry API routes."""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Body, HTTPException

log = structlog.get_logger()
router = APIRouter()


@router.get("/")
def list_services():
    from app.services.service_registry import list_services
    return {"services": list_services()}


@router.post("/")
def add_service(body: dict = Body(...)):
    name      = (body.get("name") or "").strip()
    start_cmd = (body.get("start_cmd") or "").strip()
    if not name or not start_cmd:
        raise HTTPException(400, "name and start_cmd are required")

    from app.services.service_registry import add_service
    entry = add_service(
        name=name,
        start_cmd=start_cmd,
        path=body.get("path", ""),
        stop_cmd=body.get("stop_cmd"),
        health_url=body.get("health_url"),
        tags=body.get("tags", []),
    )
    return entry


@router.get("/{service_id}")
def get_service(service_id: str):
    from app.services.service_registry import get_service
    entry = get_service(service_id)
    if not entry:
        raise HTTPException(404, "Service not found")
    return entry


@router.patch("/{service_id}")
def update_service(service_id: str, body: dict = Body(...)):
    from app.services.service_registry import update_service, get_service
    if not get_service(service_id):
        raise HTTPException(404, "Service not found")
    entry = update_service(service_id, **body)
    return entry


@router.delete("/{service_id}")
def remove_service(service_id: str):
    from app.services.service_registry import remove_service
    if not remove_service(service_id):
        raise HTTPException(404, "Service not found")
    return {"ok": True}


@router.post("/{service_id}/start")
async def start_service(service_id: str):
    from app.services.service_registry import start_service, get_service
    if not get_service(service_id):
        raise HTTPException(404, "Service not found")
    result = await start_service(service_id)
    return result


@router.post("/{service_id}/stop")
async def stop_service(service_id: str):
    from app.services.service_registry import stop_service, get_service
    if not get_service(service_id):
        raise HTTPException(404, "Service not found")
    result = await stop_service(service_id)
    return result


@router.post("/{service_id}/health")
async def check_health(service_id: str):
    from app.services.service_registry import check_health, get_service
    if not get_service(service_id):
        raise HTTPException(404, "Service not found")
    result = await check_health(service_id)
    return result
