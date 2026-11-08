"""Real measurements of this application (not simulated): CPU, RAM, threads and child processes of the backend process tree,
plus agent/task/job counts and threshold warnings. Reading is cheap; CPU is computed from CPU-time deltas between calls."""
from __future__ import annotations

import asyncio
import threading
import time

import psutil

from core.perf import limiter, settings as perf_settings

_proc = psutil.Process()
_lk = threading.Lock()
_last_t = time.monotonic()
_last_cpu = 0.0
_last_pct = 0.0


def _tree() -> list[psutil.Process]:
    try:
        return [_proc, *_proc.children(recursive=True)]
    except psutil.Error:
        return [_proc]


def _role(p: psutil.Process) -> str:
    try:
        cmd = " ".join(p.cmdline()).lower()
    except psutil.Error:
        cmd = ""
    if "modelcontextprotocol" in cmd or "mcp-server" in cmd:
        return "mcp-server"
    if "playwright" in cmd or "chrom" in (p.name() or "").lower():
        return "browser"
    return {"node.exe": "node", "node": "node", "python.exe": "python", "python": "python"}.get((p.name() or "").lower(), "other")


def _cpu_total(procs: list[psutil.Process]) -> float:
    total = 0.0
    for p in procs:
        try:
            t = p.cpu_times()
            total += t.user + t.system
        except psutil.Error:
            pass
    return total


def sample_cpu_pct() -> float:
    """% of ONE core used by the process tree since the previous call (>=1 s apart; cached in between)."""
    global _last_t, _last_cpu, _last_pct
    with _lk:
        now = time.monotonic()
        cpu = _cpu_total(_tree())
        if _last_cpu == 0.0 and _last_pct == 0.0:  # first call: seed from process start so the first answer is meaningful
            _last_t, _last_cpu = now - max(1.0, time.time() - _proc.create_time()), 0.0
        if now - _last_t >= 1.0:
            _last_pct = max(0.0, 100.0 * (cpu - _last_cpu) / (now - _last_t))
            _last_t, _last_cpu = now, cpu
        return round(_last_pct, 1)


def processes() -> list[dict]:
    out = []
    for p in _tree():
        try:
            out.append({"pid": p.pid, "name": p.name(), "role": "backend" if p.pid == _proc.pid else _role(p),
                        "rss_mb": round(p.memory_info().rss / 1048576, 1), "threads": p.num_threads()})
        except psutil.Error:
            pass
    return out


def _scheduler_counts() -> dict:
    try:
        from core.scheduler.scheduler import scheduler
        jobs = scheduler.get_jobs()
        return {"scheduled": len(jobs), "paused": sum(1 for j in jobs if j.next_run_time is None)}
    except Exception:
        return {"scheduled": 0, "paused": 0}


def _agent_counts() -> dict:
    from agents import activation
    return activation.counts()


def warnings(s: dict, cfg: perf_settings.PerfSettings) -> list[str]:
    w = []
    if s["rss_mb"] > cfg.memory_budget_mb:
        w.append(f"Memory use {s['rss_mb']:.0f} MB is above the {cfg.memory_budget_mb} MB budget. Deactivate agents or switch to a lighter preset.")
    if s["cpu_pct_one_core"] > 80:
        w.append(f"CPU is high ({s['cpu_pct_one_core']:.0f}% of one core).")
    waiting = s["tasks"]["agent"]["waiting"]
    if waiting:
        w.append(f"{waiting} agent task(s) are queued behind the concurrency limit of {s['tasks']['agent']['limit']}.")
    cap = cfg.max_active_agents
    if cap and s["agents"]["active_counted"] > cap:
        w.append(f"{s['agents']['active_counted']} agents are active but the limit is {cap}.")
    if s["host"]["ram_available_pct"] < 15:
        w.append("System memory is low (under 15% free); the machine may start swapping.")
    return w


async def status() -> dict:
    cfg = perf_settings.current()
    procs = processes()
    vm = psutil.virtual_memory()
    s = {
        "ts": time.time(), "preset": cfg.preset,
        "cpu_pct_one_core": sample_cpu_pct(),
        "rss_mb": round(sum(p["rss_mb"] for p in procs), 1),
        "threads": sum(p["threads"] for p in procs),
        "processes": procs,
        "agents": _agent_counts(),
        "tasks": {"agent": limiter.agent_tasks.stats(), "background": limiter.background_jobs.stats(),
                  "asyncio_tasks": len(asyncio.all_tasks()), **_scheduler_counts()},
        "host": {"cpu_pct": psutil.cpu_percent(interval=None), "logical_cores": psutil.cpu_count(),
                 "ram_total_mb": round(vm.total / 1048576), "ram_available_pct": round(100 - vm.percent, 1)},
        "limits": {"memory_budget_mb": cfg.memory_budget_mb, "max_active_agents": cfg.max_active_agents,
                   "max_concurrent_tasks": cfg.max_concurrent_tasks},
    }
    s["warnings"] = warnings(s, cfg)
    return s
