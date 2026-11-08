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
