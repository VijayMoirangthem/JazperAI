"""POST /api/llm/complete (aliased /api/v1/llm/complete): end-to-end path through core.llm (stub when no key)."""
from fastapi import APIRouter
from pydantic import BaseModel

from core.llm.router import default_router
from core.llm.types import LLMRequest, Tier

router = APIRouter()
_router = None


class CompleteIn(BaseModel):
    prompt: str
    system: str = ""
    tier: Tier = "standard"
    max_tokens: int = 512


@router.post("/complete")
async def complete(body: CompleteIn):
    global _router
    _router = _router or default_router()
    res = await _router.complete(LLMRequest(messages=[{"role": "user", "content": body.prompt}], system=body.system,
                                            tier=body.tier, max_tokens=body.max_tokens))
    return res.model_dump()
