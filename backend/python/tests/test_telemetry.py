import sys

import pytest
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from agents import org
from agents.exec_graph import run_directive
from core import telemetry
from hub.hub import Hub
from memory.db import aio

pytestmark = pytest.mark.db


@pytest.fixture
def mem():
    exp = InMemorySpanExporter()
    proc = SimpleSpanProcessor(exp)
    telemetry.provider.add_span_processor(proc)
    yield exp
    exp.clear()


async def test_one_directive_is_one_trace_tree_jasper_exec_crew_tool(mem):
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    from agents.registry import registry
    await org.ensure_org()
    await registry.reload()
    hub = Hub()
    await hub.upsert("t-otel", "Otel demo", [sys.executable, "-m", "hub.servers.demo_server"])

    async def ask(slug, text):
        if slug == "backend-services-bot":
            await hub.use_tool("t-otel.echo", {"text": "hi"}, agent=slug)  # a tool call inside a crew member
        return f"{slug} done"

    try:
        rep = await run_directive("ship the baeit marketplace feature", "ceo-baeit", ask=ask)
    finally:
        await hub.remove("t-otel")
        await hub.shutdown()
        await aio.close_pool()
    spans = mem.get_finished_spans()
    names = [s.name for s in spans]
    assert {"jasper.directive", "crew.member", "executive.report", "tool.call"} <= set(names)
    assert len({s.context.trace_id for s in spans if s.name in ("jasper.directive", "crew.member", "executive.report", "tool.call")}) == 1
    by_id = {s.context.span_id: s for s in spans}
    tool = next(s for s in spans if s.name == "tool.call")
    chain = []
    cur = tool
    while cur is not None:
        chain.append(cur.name)
        cur = by_id.get(cur.parent.span_id) if cur.parent else None
    assert chain == ["tool.call", "crew.member", "jasper.directive"]  # Jasper -> crew -> tool in one tree
    assert rep["status"] == "complete"


def test_failed_span_records_error():
    exp = InMemorySpanExporter()
    telemetry.provider.add_span_processor(SimpleSpanProcessor(exp))
    with pytest.raises(ValueError):
        with telemetry.span("will.fail", agent="x"):
            raise ValueError("boom")
    s = exp.get_finished_spans()[-1]
    assert s.name == "will.fail" and s.status.status_code.name == "ERROR"
