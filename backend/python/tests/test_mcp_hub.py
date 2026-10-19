import sys

import pytest

from hub.hub import Hub, ToolError
from memory.db import aio

pytestmark = pytest.mark.db


@pytest.fixture
async def hub():
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    h = Hub()
    await h.upsert("t-demo", "Test demo", [sys.executable, "-m", "hub.servers.demo_server"], tool_tiers={"wipe": "mcp.admin"}, rate_per_min=1000)
    yield h
    await h.remove("t-demo")
    await h.shutdown()
    await aio.execute("DELETE FROM shared.hitl_requests WHERE requester LIKE 'mt-%'")
    await aio.close_pool()


async def test_discovery_find_and_call_read_tool(hub):
    names = {t["name"] for t in await hub.catalogue()}
    assert {"t-demo.echo", "t-demo.wipe", "t-demo.write_note"} <= names
    found = await hub.find_tool("echo some text")
    assert found and found[0]["name"] == "t-demo.echo" and found[0]["tier"] == 1
    res = await hub.use_tool("t-demo.echo", {"text": "hello"}, agent="mt-a")
    assert res == {"blocked": False, "is_error": False, "text": "hello"}


async def test_invalid_arguments_rejected_before_execution(hub):
    with pytest.raises(ToolError, match="invalid arguments"):
        await hub.use_tool("t-demo.echo", {"text": 5}, agent="mt-b")
    with pytest.raises(ToolError, match="invalid arguments"):
        await hub.use_tool("t-demo.write_note", {"title": "x"}, agent="mt-b")
    with pytest.raises(ToolError, match="unknown tool"):
        await hub.use_tool("t-demo.nope", {}, agent="mt-b")


async def test_tier3_tool_is_blocked_without_approval_and_audited(hub):
    res = await hub.use_tool("t-demo.wipe", {"target": "everything"}, agent="mt-c", gate_ttl_s=0.3)
    assert res["blocked"] is True and "Tier 3" in res["reason"]
    row = await aio.fetch("SELECT status FROM shared.hitl_requests WHERE requester='mt-c'")
    assert row and row[0]["status"] == "expired"


async def test_rate_limit(hub):
    await hub.upsert("t-demo", "Test demo", [sys.executable, "-m", "hub.servers.demo_server"], rate_per_min=2)
    await hub.use_tool("t-demo.echo", {"text": "1"}, agent="mt-d")
    await hub.use_tool("t-demo.echo", {"text": "2"}, agent="mt-d")
    with pytest.raises(ToolError, match="rate limit"):
        await hub.use_tool("t-demo.echo", {"text": "3"}, agent="mt-d")


async def test_connector_crash_restarts_and_new_connector_appears_without_restart(hub):
    with pytest.raises(ToolError):
        await hub.use_tool("t-demo.crash", {}, agent="mt-e")  # kills the server; both attempts fail -> DEGRADED
    res = await hub.use_tool("t-demo.echo", {"text": "alive again"}, agent="mt-e")  # fresh process on the next call
    assert res["text"] == "alive again"
    await hub.upsert("t-demo2", "Second", [sys.executable, "-m", "hub.servers.demo_server"])
    assert "t-demo2.echo" in {t["name"] for t in await hub.catalogue()}  # hot discovery, no restart
    await hub.remove("t-demo2")
    assert "t-demo2.echo" not in {t["name"] for t in await hub.catalogue()}
