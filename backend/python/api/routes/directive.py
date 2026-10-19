"""POST /api/directive (aliased /api/v1/directive): run a founder directive through the Sir Jasper supervisor graph."""
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel

from agents.supervisor import build_graph, new_state
from core.durable import get_checkpointer

router = APIRouter()


class DirectiveIn(BaseModel):
    text: str


@router.post("/")
async def run(body: DirectiveIn):
    state = new_state(body.text)
    out = await build_graph(await get_checkpointer()).ainvoke(state, {"configurable": {"thread_id": state["trace_id"] or str(uuid4())}})
    return {k: out.get(k) for k in ("trace_id", "agents", "plan", "results", "answer", "status", "log")}
