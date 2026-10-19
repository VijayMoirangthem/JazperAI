import asyncio
from uuid import UUID

import pytest

from core import hitl
from core.eventbus import bus
from memory.db import aio

pytestmark = pytest.mark.db


@pytest.fixture(autouse=True)
async def _db():
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    yield
    await aio.execute("DELETE FROM shared.hitl_requests WHERE requester LIKE 'test-%'")
    await aio.close_pool()


async def _pending_id():
    for _ in range(100):
        rows = await aio.fetch("SELECT request_id FROM shared.hitl_requests WHERE status='pending' AND requester LIKE 'test-%'")
        if rows:
            return rows[0]["request_id"]
        await asyncio.sleep(0.02)
    raise AssertionError("no pending request")


def test_policy_defaults():
    assert hitl.tier_of("file.read") == 1 and hitl.tier_of("git.merge_main") == 3
    assert hitl.tier_of("totally.unknown.action") == 3


async def test_tier1_autonomous():
    assert await hitl.gate("file.read", "read x", "test-a") is True


async def test_tier3_blocks_until_respond_then_approves_and_announces():
    sub = bus.subscribe({"human-intervention-request"})
    task = asyncio.create_task(hitl.gate("git.merge_main", "merge to main", "test-b"))
    rid = await _pending_id()
    await asyncio.sleep(0.05)
    assert not task.done()  # still blocked
    env = sub.q.get_nowait()
    assert env.params["tier"] == 3 and env.params["request_id"] == str(rid)
    assert await hitl.respond(UUID(str(rid)), True, "founder")
    assert await asyncio.wait_for(task, 2) is True
    assert not await hitl.respond(UUID(str(rid)), True, "founder")  # already closed


async def test_tier3_reject_aborts_and_non_approver_forbidden():
    task = asyncio.create_task(hitl.gate("payment.authorize", "pay", "test-c"))
    rid = UUID(str(await _pending_id()))
    with pytest.raises(PermissionError):
        await hitl.respond(rid, True, "random-agent")
    assert await hitl.respond(rid, False, "ca_placeholder")
    assert await asyncio.wait_for(task, 2) is False


async def test_tier3_expiry_denies():
    assert await hitl.gate("deploy.production", "deploy", "test-d", ttl_s=0.2) is False
    row = await aio.fetch("SELECT status FROM shared.hitl_requests WHERE requester='test-d'")
    assert row[0]["status"] == "expired"


async def test_tier2_proceeds_unless_vetoed():
    assert await hitl.gate("git.create_branch", "branch", "test-e", veto_window_s=0.1) is True
    task = asyncio.create_task(hitl.gate("mcp.write", "write", "test-f", veto_window_s=2))
    rid = UUID(str(await _pending_id()))
    await hitl.respond(rid, False, "founder")
    assert await asyncio.wait_for(task, 2) is False


async def test_level_full_skips_tier2_wait_but_never_tier3():
    await hitl.set_level("test-lvl", "full")
    assert await hitl.gate("mcp.write", "write", "test-lvl", veto_window_s=30) is True  # no 30s wait
    task = asyncio.create_task(hitl.gate("git.merge_main", "merge", "test-lvl", ttl_s=5))
    rid = UUID(str(await _pending_id()))
    await asyncio.sleep(0.05)
    assert not task.done()  # tier 3 still blocks
    await hitl.respond(rid, False, "founder")
    assert await asyncio.wait_for(task, 2) is False
    await aio.execute("DELETE FROM shared.approval_levels WHERE slug='test-lvl'")
