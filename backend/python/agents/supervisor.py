"""Sir Jasper L1 supervisor as a LangGraph StateGraph: classify -> plan -> delegate -> await -> synthesize -> report.

The classify node reuses the zero-token keyword pre-classifier (spec §11 tiering). State is checkpointed (Postgres saver
in production) so a directive survives a restart. Delegation targets are injectable; the default delegate calls the
bot registry (dynamic bots) or the provider layer with the persona's role as system prompt.
"""
import operator
from collections.abc import Awaitable, Callable
from typing import Annotated, TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph

from core.eventbus import announce
from core.telemetry import traced

Delegate = Callable[[str, str], Awaitable[str]]


class SupervisorState(TypedDict, total=False):
    directive: str
    trace_id: str
    budget_tokens: int
    hitl_required: bool
    agents: list[str]
    confident: bool
    plan: list[str]
    results: Annotated[dict, lambda a, b: {**(a or {}), **(b or {})}]
    answer: str
    status: str
    log: Annotated[list, operator.add]


async def default_delegate(slug: str, text: str) -> str:
    from agents.registry import registry
    from core.llm.registry import get_router
    from core.llm.types import LLMRequest
    if registry.routable(slug):
        return (await registry.message(slug, text))["reply"]
    res = await (await get_router()).complete(LLMRequest(system=f"You are the {slug} agent of Sir Jasper AI.",
                                                     messages=[{"role": "user", "content": text}], tier="light"))
    return res.text


def build_graph(checkpointer=None, delegate: Delegate = default_delegate, interrupt_before: list[str] | None = None):
    from agents.roster.orchestrator import _keyword_route

    @traced("supervisor.classify")
    async def classify(s: SupervisorState):
        announce("jasper", "planning", bubble=s["directive"][:100])
        agents, _reason, confident = _keyword_route(s["directive"], False)
        return {"agents": list(agents) or ["jasper"], "confident": confident, "log": ["classify"]}

    async def plan(s: SupervisorState):
        steps = [f"{a}: {s['directive'][:80]}" for a in s["agents"]]
        return {"plan": steps, "log": ["plan"]}

    @traced("supervisor.delegate")
    async def delegate_node(s: SupervisorState):
        out = {}
        for a in s["agents"]:
            announce(a, "working", bubble=s["directive"][:100])
            out[a] = await delegate(a, s["directive"])
            announce(a, "idle")
        return {"results": out, "log": ["delegate"]}

    async def await_results(s: SupervisorState):
        missing = [a for a in s["agents"] if a not in (s.get("results") or {})]
        return {"status": "incomplete" if missing else "complete", "log": ["await"]}

    async def synthesize(s: SupervisorState):
        res = s.get("results") or {}
        answer = next(iter(res.values()), "") if len(res) == 1 else "\n\n".join(f"[{a}] {t}" for a, t in res.items())
        return {"answer": answer, "log": ["synthesize"]}

    async def report(s: SupervisorState):
        announce("jasper", "idle")
        return {"status": s.get("status") or "complete", "log": ["report"]}

    g = StateGraph(SupervisorState)
    for name, fn in [("classify", classify), ("plan", plan), ("delegate", delegate_node), ("await", await_results),
                     ("synthesize", synthesize), ("report", report)]:
        g.add_node(name, fn)
    g.add_edge(START, "classify")
    for a, b in [("classify", "plan"), ("plan", "delegate"), ("delegate", "await"), ("await", "synthesize"),
                 ("synthesize", "report"), ("report", END)]:
        g.add_edge(a, b)
    return g.compile(checkpointer=checkpointer, interrupt_before=interrupt_before)


def new_state(directive: str) -> SupervisorState:
    return {"directive": directive, "trace_id": str(uuid4()), "budget_tokens": 50_000, "hitl_required": False,
            "results": {}, "log": []}
