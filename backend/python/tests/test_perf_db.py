"""Agent activation + settings persistence against a real Postgres (needs migration 0021)."""
import pytest

from agents import activation
from core.perf import settings as ps
from memory.db import aio

pytestmark = pytest.mark.db


@pytest.fixture(autouse=True)
async def clean():
    try:
        await aio.fetch("SELECT 1 FROM shared.agent_activation LIMIT 1")
    except Exception:
        pytest.skip("postgres/migration 0021 unavailable")
    async def wipe():
        await aio.execute("DELETE FROM shared.agent_activation")
        await aio.execute("DELETE FROM shared.perf_settings")
        activation._inactive.clear()
        ps._set(ps.default())
    await wipe()
    yield
    await wipe()
    await aio.close_pool()


async def test_deactivate_and_reactivate_keeps_the_agent_and_persists():
    r = await activation.set_active("scout", False, reason="test")
    assert r["active"] is False and not activation.is_active("scout")
    from agents.registry import registry
    assert "scout" in {a["slug"] for a in registry.roster()}                       # still known: nothing was deleted
    activation._inactive.clear()                                                    # simulate a restart: memory gone ...
    await activation.load()                                                         # ... state comes back from Postgres
    assert not activation.is_active("scout")
    assert (await activation.set_active("scout", True))["active"] is True and activation.is_active("scout")


async def test_critical_agents_are_protected():
    for slug in activation.CRITICAL:
        with pytest.raises(activation.ActivationError) as e:
            await activation.set_active(slug, False)
        assert e.value.code == "critical" and activation.is_active(slug)
    res = await activation.bulk(sorted(activation.CRITICAL) + ["scout"], False)
    assert {s["slug"] for s in res["skipped"]} >= activation.CRITICAL and res["changed"] == ["scout"]
    assert all(activation.is_active(s) for s in activation.CRITICAL)
    forced = await activation.set_active("shield", False, force=True)             # deliberate override still possible
    assert forced["active"] is False


async def test_unknown_and_unimplemented_agents_are_rejected():
    with pytest.raises(activation.ActivationError) as e:
        await activation.set_active("no-such-agent", False)
    assert e.value.code == "not_found"
    with pytest.raises(activation.ActivationError) as e:
        await activation.set_active("finops", True)                                # planned role, no implementation
    assert e.value.code == "not_implemented"


async def test_active_agent_limit_is_enforced_and_critical_agents_do_not_count():
    await ps.update({"max_active_agents": 3})
    everyone = [r["slug"] for r in activation._roster() if activation.implemented(r)]
    await activation.bulk([s for s in everyone if s not in activation.CRITICAL], False)     # start from nothing active
    res = await activation.bulk(["scout", "atlas", "sage", "hermes", "darwin"], True)
    assert len(res["changed"]) == 3 and {s["why"] for s in res["skipped"]} == {"active-agent limit reached"}
    with pytest.raises(activation.ActivationError) as e:
        await activation.set_active("aria", True)
    assert e.value.code == "cap"
    assert activation.counts()["active_counted"] == 3
    assert all(activation.is_active(s) for s in activation.CRITICAL)                # critical still on, not counted


async def test_preset_plan_keeps_critical_and_most_used_agents():
    plan = await activation.plan_for_cap(2)
    assert not set(plan) & activation.CRITICAL
    assert len(plan) == activation.counts()["active_counted"] - 2


async def test_settings_persist_across_restart_and_edits_mark_preset_custom():
    cfg = await ps.apply_preset("eco")
    assert cfg.preset == "eco"
    cfg = await ps.update({"poll_scale": 4.5, "animations": "reduced"})
    assert cfg.preset == "custom" and cfg.poll_scale == 4.5
    ps._set(ps.preset("performance"))                                                # "restart": process forgets, DB remembers
    loaded = await ps.load()
    assert loaded.poll_scale == 4.5 and loaded.animations == "reduced" and loaded.pii_engine == "regex"
    assert ps.current() == loaded
