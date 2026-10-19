"""Executive sub-graph: pick_members -> crew_work -> report. Each run carries parent/child trace ids (spec §17):
Sir Jasper (parent span) -> executive span -> one span per crew member, returned in a structured status report."""
import asyncio
from typing import TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph

from agents import org
from agents.registry import registry
from core.eventbus import announce

Ask = "async callable (slug, system_prompt, user_text) -> str"


class ExecState(TypedDict, total=False):
    directive: str
    exec_slug: str
    trace_id: str
    parent_span: str
    exec_span: str
    members: list[str]
    crew_results: dict
    spans: list
    report: dict


async def default_ask(slug: str, text: str) -> str:
    return (await registry.message(slug, text))["reply"]


def build_exec_graph(ask=default_ask, max_members: int = 3):
    async def pick_members(s: ExecState):
        e = org.exec_by_slug(s["exec_slug"])
        pool = [b for b in registry.roster() if b.get("source") == "dynamic" and b.get("enabled") and e and b["crew"] in e.crews]
        words = set(s["directive"].lower().split())
        pool.sort(key=lambda b: -len(words & set(f"{b['role_title']} {b['prompt']}".lower().replace("&", " ").split())))
        return {"members": [b["slug"] for b in pool[:max_members]], "exec_span": uuid4().hex[:16]}

    async def crew_work(s: ExecState):
        spans, results = [], {}

        async def one(slug: str):
            span = uuid4().hex[:16]
            announce(slug, "working", bubble=s["directive"][:100])
            try:
                results[slug] = await ask(slug, s["directive"])
                status = "ok"
            except Exception as err:  # a failed member must not sink the whole report
                results[slug], status = f"[failed: {str(err)[:120]}]", "error"
            announce(slug, "idle")
            spans.append({"span_id": span, "parent_id": s["exec_span"], "agent": slug, "status": status})

        await asyncio.gather(*(one(m) for m in s["members"]))
        return {"crew_results": results, "spans": spans}

    async def report(s: ExecState):
        e = org.exec_by_slug(s["exec_slug"])
        try:
            own = await ask(s["exec_slug"], f"Directive from Sir Jasper: {s['directive']}\n\nCrew input:\n" +
                            "\n".join(f"- {k}: {v}" for k, v in (s.get("crew_results") or {}).items()))
            ok = True
        except Exception as err:
            own, ok = f"[executive unavailable: {str(err)[:120]}]", False
        failed = [sp for sp in s.get("spans", []) if sp["status"] != "ok"]
        return {"report": {
            "executive": s["exec_slug"], "title": e.title if e else s["exec_slug"], "division": e.division if e else None,
            "status": "complete" if ok and not failed else "partial", "summary": own, "crew": s.get("crew_results", {}),
            "trace": {"trace_id": s["trace_id"], "parent_span": s["parent_span"], "exec_span": s["exec_span"], "member_spans": s.get("spans", [])},
        }}

    g = StateGraph(ExecState)
    for n, f in [("pick_members", pick_members), ("crew_work", crew_work), ("report", report)]:
        g.add_node(n, f)
    g.add_edge(START, "pick_members")
    g.add_edge("pick_members", "crew_work")
    g.add_edge("crew_work", "report")
    g.add_edge("report", END)
    return g.compile()


async def run_directive(text: str, exec_slug: str | None = None, ask=default_ask) -> dict:
    slug = exec_slug or org.route_executive(text)
    if org.exec_by_slug(slug) is None:
        raise LookupError(slug)
    announce("jasper", "planning", bubble=f"Delegating to {slug}")
    out = await build_exec_graph(ask).ainvoke({"directive": text, "exec_slug": slug, "trace_id": uuid4().hex, "parent_span": uuid4().hex[:16]})
    announce("jasper", "idle")
    return out["report"]
