"""Memory v2 API (aliased /api/v1/memory2): inspect, forget, sweep and teach long-term facts."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.llm.registry import get_router
from memory import consolidate

router = APIRouter()


class RememberIn(BaseModel):
    fact: str
    importance: float = 0.6


@router.get("/facts")
async def facts(include_inactive: bool = False):
    return {"facts": await consolidate.list_facts(include_inactive)}


@router.post("/facts")
async def remember(body: RememberIn):
    return await consolidate.learn(await get_router(), body.fact, body.importance)


@router.delete("/facts/{memory_id}")
async def forget(memory_id: str):
    if not await consolidate.forget(memory_id):
        raise HTTPException(404, "unknown memory")
    return {"forgotten": memory_id}


@router.post("/sweep")
async def sweep():
    return {"forgotten": await consolidate.sweep()}
