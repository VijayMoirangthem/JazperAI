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
    return cfg


async def startup() -> perf_settings.PerfSettings:
    """Load stored settings + activation state, then apply them. Called first in the app lifespan."""
    from agents import activation
    cfg = await perf_settings.load()
    await activation.load()
    apply(cfg)
    log.info("performance settings loaded", preset=cfg.preset, max_active_agents=cfg.max_active_agents,
             max_concurrent_tasks=cfg.max_concurrent_tasks)
    return cfg
