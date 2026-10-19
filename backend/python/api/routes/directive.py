"""POST /api/directive (aliased /api/v1/directive): run a founder directive through the Sir Jasper supervisor graph."""
from uuid import uuid4

from fastapi import APIRouter
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel

from agents.supervisor import build_graph, new_state

router = APIRouter()
_saver = MemorySaver()  # swap to the Postgres saver (see tests/test_supervisor.py) when wiring durable runs at boot


class DirectiveIn(BaseModel):
    text: str


@router.post("/")
async def run(body: DirectiveIn):
    state = new_state(body.text)
    out = await build_graph(_saver).ainvoke(state, {"configurable": {"thread_id": state["trace_id"] or str(uuid4())}})
    return {k: out.get(k) for k in ("trace_id", "agents", "plan", "results", "answer", "status", "log")}
