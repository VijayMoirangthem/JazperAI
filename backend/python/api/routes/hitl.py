"""HITL API (aliased /api/v1/hitl): list pending requests, respond, inspect policy."""
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import hitl
from memory.db import aio

router = APIRouter()


class RespondIn(BaseModel):
    approve: bool
    by: str = "founder"


@router.get("/pending")
async def pending():
    rows = await aio.fetch("SELECT request_id::text, tier, action, summary, requester, approvers::text, created_at, expires_at "
                           "FROM shared.hitl_requests WHERE status='pending' ORDER BY created_at")
    return {"requests": [dict(r) for r in rows]}


@router.post("/{request_id}/respond")
async def respond(request_id: UUID, body: RespondIn):
    try:
        ok = await hitl.respond(request_id, body.approve, body.by)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    if not ok:
        raise HTTPException(404, "request not found or already decided")
    return {"request_id": str(request_id), "approved": body.approve}


@router.get("/policy")
async def policy():
    return {"policy": hitl.POLICY, "default_tier": 3}


class LevelIn(BaseModel):
    level: str


@router.get("/levels")
async def levels():
    return {"levels": {r["slug"]: r["level"] for r in await aio.fetch("SELECT slug, level FROM shared.approval_levels")}, "options": list(hitl.LEVELS)}


@router.put("/levels/{slug}")
async def put_level(slug: str, body: LevelIn):
    try:
        await hitl.set_level(slug, body.level)
    except ValueError:
        raise HTTPException(422, "unknown level")
    return {"slug": slug, "level": body.level}
