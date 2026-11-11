"""Performance core: presets, validation, the resizable limiter and the real resource monitor (no database needed)."""
import asyncio

import pytest
from pydantic import ValidationError

from core.perf import limiter as lim, monitor, settings as ps


def test_every_preset_is_valid_and_ordered_eco_to_performance():
    eco, bal, perf = (ps.preset(n) for n in ps.PRESETS)
    for s in (eco, bal, perf):
        assert isinstance(s, ps.PerfSettings)
    assert eco.max_concurrent_tasks <= bal.max_concurrent_tasks <= perf.max_concurrent_tasks
    assert eco.poll_scale >= bal.poll_scale >= perf.poll_scale          # eco polls least often
    assert eco.ui_update_ms >= bal.ui_update_ms >= perf.ui_update_ms
    assert eco.log_retention_entries <= bal.log_retention_entries <= perf.log_retention_entries
    assert eco.max_active_agents < bal.max_active_agents and perf.max_active_agents == 0   # 0 = unlimited
    assert eco.pii_engine == "regex" and bal.pii_engine == "presidio"
    assert eco.mcp_autoconnect is False and eco.file_watcher is False


def test_performance_preset_stays_within_hardware_limits(monkeypatch):
    monkeypatch.setattr(ps, "_hw", lambda: (4, 8192))
    p = ps.preset("performance")
    assert p.max_concurrent_tasks <= 4 // 2 + 1 and p.memory_budget_mb <= 8192 * 0.5 + 2048
    monkeypatch.setattr(ps, "_hw", lambda: (32, 131072))
    assert ps.preset("performance").max_concurrent_tasks == 12  # capped even on a big machine


def test_validation_rejects_out_of_range_and_unknown_fields():
    with pytest.raises(ValidationError):
        ps.PerfSettings(max_concurrent_tasks=0)
    with pytest.raises(ValidationError):
        ps.PerfSettings(poll_scale=0.5)
    with pytest.raises(ValidationError):
        ps.PerfSettings(animations="sparkly")
    with pytest.raises(ValidationError):
        ps.PerfSettings(not_a_setting=1)


async def test_limiter_never_exceeds_limit_and_reports_stats():
    L = lim.ResizableLimiter("t", 2)
    active = peak = 0

    async def work():
        nonlocal active, peak
        async with L.slot():
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1

    await asyncio.gather(*(work() for _ in range(10)))
    assert peak == 2 and L.peak == 2 and L.completed == 10 and L.running == 0 and L.waiting == 0


async def test_limiter_resize_takes_effect_while_tasks_wait():
    L = lim.ResizableLimiter("t", 1)
    gate = asyncio.Event()
    started = 0

    async def work():
        nonlocal started
        async with L.slot():
            started += 1
            await gate.wait()

    tasks = [asyncio.create_task(work()) for _ in range(4)]
    await asyncio.sleep(0.05)
    assert started == 1 and L.waiting == 3
    L.set_limit(4)                       # raising the limit lets the queued tasks in immediately
    await asyncio.sleep(0.05)
    assert started == 4
    gate.set()
    await asyncio.gather(*tasks)


async def test_cancelled_waiter_does_not_leak_a_slot():
    L = lim.ResizableLimiter("t", 1)
    hold = asyncio.Event()

    async def holder():
        async with L.slot():
            await hold.wait()

    h = asyncio.create_task(holder())
    await asyncio.sleep(0.02)
    waiter = asyncio.create_task(L._acquire())
    await asyncio.sleep(0.02)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    hold.set()
    await h
    async with asyncio.timeout(1):        # would hang if the cancelled waiter had kept the slot
        async with L.slot():
            pass
    assert L.running == 0


async def test_monitor_reports_real_measurements():
    s1 = await monitor.status()
    sum(i * i for i in range(300000))     # burn a little CPU between samples
    await asyncio.sleep(1.1)
    s2 = await monitor.status()
    assert s2["rss_mb"] > 20 and s2["threads"] >= 1                       # this very process has real memory and threads
    assert any(p["role"] == "backend" for p in s2["processes"])
    assert s2["cpu_pct_one_core"] >= 0 and s2["host"]["ram_total_mb"] > 1000
    assert s2["tasks"]["asyncio_tasks"] >= 1 and s2["agents"]["total"] > 0
    assert isinstance(s2["warnings"], list) and s1["ts"] < s2["ts"]


def test_first_run_default_keeps_todays_behaviour():
    d = ps.default()
    assert d.preset == "default" and d.max_active_agents == 0 and d.poll_scale == 1.0 and d.animations == "full"
    assert d.pii_engine == "presidio" and d.mcp_autoconnect and d.file_watcher


async def test_memory_warning_fires_when_over_budget(monkeypatch):
    cfg = ps.PerfSettings(memory_budget_mb=256)
    monkeypatch.setattr(ps, "_current", cfg)
    monkeypatch.setattr(monitor, "processes", lambda: [{"pid": 1, "name": "x", "role": "backend", "rss_mb": 900.0, "threads": 1}])
    s = await monitor.status()
    assert any("above the 256 MB budget" in w for w in s["warnings"])


async def test_nested_slot_does_not_deadlock_with_limit_one():
    """An agent holding the only slot calls another agent: the nested call is part of the same task and must not wait."""
    L = lim.ResizableLimiter("nest", 1)
    order = []

    async def inner():
        async with L.slot():
            order.append("inner")

    async def outer():
        async with L.slot():
            order.append("outer")
            await inner()                                              # same task
            await asyncio.create_task(inner())                         # child task inherits the context
            await asyncio.gather(inner(), inner())

    async with asyncio.timeout(2):                                     # a deadlock would hit this timeout
        await outer()
    assert order == ["outer", "inner", "inner", "inner", "inner"] and L.running == 0 and L.completed == 1


async def test_independent_tasks_still_queue_behind_the_limit():
    L = lim.ResizableLimiter("indep", 1)
    running = peak = 0

    async def work():
        nonlocal running, peak
        async with L.slot():
            running += 1
            peak = max(peak, running)
            await asyncio.sleep(0.01)
            running -= 1

    await asyncio.gather(*(work() for _ in range(5)))                  # siblings are not nested: they queue
    assert peak == 1 and L.completed == 5


def test_embedder_unloads_only_when_idle_or_forced(monkeypatch):
    from core.services import embedding_service as es
    monkeypatch.setattr(es, "_model", object())
    monkeypatch.setattr(es, "_mem_model", object())
    monkeypatch.setattr(es, "_last_used", es._time.monotonic())            # just used
    assert es.unload(False, 10) == {"unloaded": 0, "reason": "recently used"} and es.loaded_models() == 2
    monkeypatch.setattr(es, "_last_used", es._time.monotonic() - 11 * 60)  # idle 11 min
    assert es.unload(False, 10)["unloaded"] == 2 and es.loaded_models() == 0
    monkeypatch.setattr(es, "_mem_model", object())
    assert es.unload(True)["unloaded"] == 1                                # forced ignores recent use
    assert es.unload(True)["unloaded"] == 0                                # nothing loaded: harmless


def test_presets_free_models_sooner_in_eco():
    assert ps.preset("eco").embedder_idle_min < ps.preset("balanced").embedder_idle_min < ps.preset("performance").embedder_idle_min
