"""The scheduled run: a lighter subset of the task set once a night, compared with the previous run, with a phone alert on a regression.

It never competes with you: it skips itself when the PC is short of memory or when you chatted in the last 15 minutes
(it will simply run the next night; `python -m evalset.runner` runs it on demand).
"""
from __future__ import annotations

import time
from typing import Awaitable, Callable

import structlog

from core import health_stats
from evalset import runner

log = structlog.get_logger()
MIN_FREE_MB = 1500
QUIET_FOR_S = 15 * 60


def _free_mb() -> int:
    try:
        import psutil
        return int(psutil.virtual_memory().available / 1048576)
    except Exception:  # noqa: BLE001
        return 1 << 30


async def _notify(title: str, body: str, ntype: str) -> None:
    from memory.db import aio
    await aio.execute("INSERT INTO notifications (title, body, type) VALUES ($1, $2, $3)", title, body, ntype)


async def run_nightly(call: runner.Caller | None = None, *, free_mb: Callable[[], int] = _free_mb, notify: Callable[[str, str, str], Awaitable[None]] = _notify,
                      out_dir=None, tasks=None) -> dict:
    """Returns {"ran": bool, "skipped": reason?, "summary", "compare"}."""
    if free_mb() < MIN_FREE_MB:
        return {"ran": False, "skipped": f"only {free_mb()} MB of memory free"}
    idle = health_stats.idle_seconds("chat")
    if idle is not None and idle < QUIET_FOR_S:
        return {"ran": False, "skipped": "you were chatting a moment ago"}
    call = call or runner.HttpCaller()
    chosen = tasks if tasks is not None else runner.select(nightly=True)
    prev = runner.latest_run(out_dir)
    results = await runner.run_suite(call, chosen)
    summary = runner.summarize(results)
    cmp = runner.compare(prev["summary"] if prev else None, summary)
    path = runner.save_run(summary, results, out_dir)
    log.info("nightly eval done", passed=summary["passed"], n=summary["n"], regression=cmp["regression"], file=path.name)
    if cmp["regression"]:
        body = "; ".join(cmp["reasons"])[:300]
        if cmp["newly_failing"]:
            body += " | newly failing: " + ", ".join(cmp["newly_failing"][:5])
        try:
            await notify("Jasper got worse overnight", body, "alert")
        except Exception as e:  # noqa: BLE001
            log.warning("could not send the regression alert", error=str(e)[:100])
    return {"ran": True, "summary": summary, "compare": cmp, "file": path.name}


def latest_report() -> dict:
    """For the API: the newest saved run and how it compared with the one before."""
    cur = runner.latest_run()
    if not cur:
        return {"available": False}
    files = sorted(runner.OUT_DIR.glob("run-*.json"))
    prev = None
    if len(files) >= 2:
        prev = runner.latest_run(skip=files[-1])
    return {"available": True, "at": cur["at"], "summary": cur["summary"], "compare": runner.compare(prev["summary"] if prev else None, cur["summary"])}


def seconds_since(ts: float | None) -> float | None:
    return None if ts is None else time.time() - ts
