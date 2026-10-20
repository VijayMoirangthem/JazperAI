"""Alerts and incidents (aliased /api/v1/alerts): what is wrong right now, what went wrong recently, and how to fix it (runbooks)."""
from fastapi import APIRouter, HTTPException

from core import alerts
from memory.db import aio

router = APIRouter()


@router.get("/")
async def get_alerts():
    return await alerts.list_alerts()


@router.post("/run")
async def run_now():
    return await alerts.run_checks()


@router.post("/{alert_id}/ack")
async def ack(alert_id: int):
    n = await aio.execute("UPDATE shared.alerts SET acked_at=now() WHERE id=$1 AND resolved_at IS NULL", alert_id)
    if n.endswith(" 0"):
        raise HTTPException(404, "no such open alert")
    return {"acked": alert_id}


@router.get("/incidents")
async def incidents(limit: int = 30):
    return {"incidents": await alerts.list_incidents(min(limit, 100))}
