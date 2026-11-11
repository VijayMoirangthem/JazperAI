"""Applies PerfSettings to the running process (limiters, log level/buffer, scheduler gating). Idempotent; safe to call often."""
from __future__ import annotations

import logging
import sys
from collections import deque

import structlog

from core.perf import limiter, settings as perf_settings

log = structlog.get_logger()


def apply(cfg: perf_settings.PerfSettings | None = None) -> perf_settings.PerfSettings:
    cfg = cfg or perf_settings.current()
    limiter.agent_tasks.set_limit(cfg.max_concurrent_tasks)
    limiter.background_jobs.set_limit(cfg.max_background_jobs)

    level = getattr(logging, cfg.log_level)
    logging.getLogger().setLevel(level)
    structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(level))

    main = sys.modules.get("main")  # the live log ring buffer lives in main.py; resizing keeps the newest entries
    buf = getattr(main, "log_buffer", None)
    if buf is not None and buf.maxlen != cfg.log_retention_entries:
        main.log_buffer = deque(buf, maxlen=cfg.log_retention_entries)

    from agents import activation
    activation.apply_scheduler_gating()
    _apply_housekeeping(cfg)
    _apply_embedder_job(cfg)
    _apply_file_watcher(cfg)
    return cfg


def _embedder_tick() -> None:
    from core.services import embedding_service
    embedding_service.unload(False, perf_settings.current().embedder_idle_min)


def _apply_embedder_job(cfg: perf_settings.PerfSettings) -> None:
    """Every 2 minutes free the embedding models if they have been idle longer than embedder_idle_min."""
    try:
        from apscheduler.triggers.interval import IntervalTrigger
        from core.scheduler.scheduler import scheduler
        scheduler.add_job(_embedder_tick, IntervalTrigger(minutes=2), id="__embedder_idle__", replace_existing=True, misfire_grace_time=120)
    except Exception as e:
        log.debug("embedder idle job skipped", error=str(e)[:100])


def _apply_housekeeping(cfg: perf_settings.PerfSettings) -> None:
    """Alert checks normally run every 2 min; stretch the interval by poll_scale (when that job exists)."""
    try:
        from apscheduler.triggers.interval import IntervalTrigger
        from core.scheduler.scheduler import scheduler
        if scheduler.get_job("__alerts__") is not None:
            scheduler.reschedule_job("__alerts__", trigger=IntervalTrigger(seconds=int(120 * cfg.poll_scale)))
    except Exception as e:
        log.debug("housekeeping reschedule skipped", error=str(e)[:120])


def _apply_file_watcher(cfg: perf_settings.PerfSettings) -> None:
    """Start/stop the project file watcher live. Only touches it once the app is running (the lifespan starts it at boot)."""
    if sys.modules.get("main") is None:
        return
    try:
        import asyncio
        from core.system import file_watcher as fw
        if cfg.file_watcher and not fw.is_running():
            fw.start(asyncio.get_running_loop())
        elif not cfg.file_watcher and fw.is_running():
            fw.stop()
    except Exception as e:  # no running loop (sync caller) or watchdog missing: leave as is
        log.debug("file watcher toggle skipped", error=str(e)[:120])


async def startup() -> perf_settings.PerfSettings:
    """Load stored settings + activation state, then apply them. Called first in the app lifespan."""
    from agents import activation
    cfg = await perf_settings.load()
    await activation.load()
    apply(cfg)
    log.info("performance settings loaded", preset=cfg.preset, max_active_agents=cfg.max_active_agents,
             max_concurrent_tasks=cfg.max_concurrent_tasks)
    return cfg
