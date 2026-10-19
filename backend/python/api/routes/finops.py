"""FinOps API (aliased /api/v1/finops): summary, budgets."""
from fastapi import APIRouter
from pydantic import BaseModel

from core import finops

router = APIRouter()


class BudgetIn(BaseModel):
    scope: str  # "global" | "division:<id>" | "agent:<slug>"
    daily_soft: int | None = None
    daily_hard: int | None = None


@router.get("/summary")
async def summary():
    return await finops.summary()


@router.put("/budgets")
async def put_budget(b: BudgetIn):
    await finops.set_budget(b.scope, b.daily_soft, b.daily_hard)
    return {"saved": b.scope}
