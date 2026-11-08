"""Performance settings: one validated model, three presets (hardware-aware), persisted in Postgres.

Presets are a starting point; every field stays individually editable and the result is stored, so it survives restarts.
`current()` is a cheap synchronous read used by hot paths; it defaults to the no-limits `default()` until `load()` has run.
"""
from __future__ import annotations

import json
from typing import Literal

import psutil
import structlog
from pydantic import BaseModel, ConfigDict, Field

from memory.db import aio

log = structlog.get_logger()
KEY = "main"


class PerfSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    preset: str = "balanced"  # last applied preset, or "custom" once a field is edited by hand
    # agents + concurrency
    max_active_agents: int = Field(16, ge=0, le=500, description="0 = unlimited. Critical agents never count against the limit.")
    max_concurrent_tasks: int = Field(3, ge=1, le=64, description="Agent calls running at the same time; extra calls queue.")
    max_background_jobs: int = Field(2, ge=1, le=32, description="Scheduled/background jobs running at the same time.")
    background_jobs_enabled: bool = True
    # polling / realtime
    poll_scale: float = Field(1.5, ge=1.0, le=10.0, description="Multiplier on UI polling intervals and server housekeeping loops.")
    ui_update_ms: int = Field(400, ge=50, le=5000, description="Minimum gap between real-time UI updates (event coalescing).")
    # visuals
    animations: Literal["off", "reduced", "full"] = "reduced"
    max_fps: int = Field(30, ge=10, le=120)
    show_inactive_agents: bool = False
    # logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_retention_entries: int = Field(500, ge=50, le=20000, description="Entries kept in the in-memory live log buffer.")
    # optional always-on subsystems
    mcp_autoconnect: bool = True
    file_watcher: bool = True
    auto_repair_loop: bool = True
    pii_engine: Literal["presidio", "regex"] = "presidio"  # regex covers the same entity types; presidio adds a second opinion
    # monitoring
    memory_budget_mb: int = Field(1500, ge=256, le=262144, description="Warn when the app's total RAM exceeds this.")


def _hw() -> tuple[int, int]:
    return psutil.cpu_count() or 4, int(psutil.virtual_memory().total / 1048576)


def preset_values(name: str) -> dict:
    """Preset definitions, scaled to this machine so PERFORMANCE stays inside safe hardware limits."""
    cores, ram_mb = _hw()
    if name == "eco":
        return dict(preset="eco", max_active_agents=8, max_concurrent_tasks=1, max_background_jobs=1, background_jobs_enabled=True,
                    poll_scale=3.0, ui_update_ms=1000, animations="off", max_fps=20, show_inactive_agents=False,
                    log_level="WARNING", log_retention_entries=200, mcp_autoconnect=False, file_watcher=False,
                    auto_repair_loop=False, pii_engine="regex", memory_budget_mb=max(512, int(ram_mb * 0.10)))
    if name == "balanced":
        return dict(preset="balanced", max_active_agents=16, max_concurrent_tasks=3, max_background_jobs=2, background_jobs_enabled=True,
                    poll_scale=1.5, ui_update_ms=400, animations="reduced", max_fps=30, show_inactive_agents=False,
                    log_level="INFO", log_retention_entries=500, mcp_autoconnect=True, file_watcher=True,
                    auto_repair_loop=True, pii_engine="presidio", memory_budget_mb=max(1024, int(ram_mb * 0.20)))
    if name == "performance":
        return dict(preset="performance", max_active_agents=0, max_concurrent_tasks=max(2, min(12, cores // 2)),
                    max_background_jobs=max(2, min(8, cores // 3)), background_jobs_enabled=True, poll_scale=1.0, ui_update_ms=100,
                    animations="full", max_fps=60, show_inactive_agents=False, log_level="INFO", log_retention_entries=2000,
                    mcp_autoconnect=True, file_watcher=True, auto_repair_loop=True, pii_engine="presidio",
                    memory_budget_mb=max(2048, int(ram_mb * 0.50)))
    raise KeyError(name)


PRESETS = ("eco", "balanced", "performance")


def preset(name: str) -> PerfSettings:
    return PerfSettings(**preset_values(name))


def default() -> PerfSettings:
    """First run (nothing stored): keep today's behaviour - no agent cap, no throttling - with sane concurrency limits for this machine."""
    return PerfSettings(**{**preset_values("performance"), "preset": "default"})


_current: PerfSettings = default()


def current() -> PerfSettings:
    return _current


def _set(s: PerfSettings) -> PerfSettings:
    global _current
    _current = s
    return s


async def load() -> PerfSettings:
    """Read the stored settings (or keep the defaults when none are stored / the database is unreachable)."""
    try:
        rows = await aio.fetch("SELECT value FROM shared.perf_settings WHERE key=$1", KEY)
    except Exception as e:  # first boot before migration 0021, or DB down: stay on defaults
        log.warning("perf settings unavailable, using defaults", error=str(e)[:120])
        return _current
    if not rows:
        return _current
    raw = rows[0]["value"]
    data = json.loads(raw) if isinstance(raw, str) else dict(raw)
    try:
        return _set(PerfSettings(**data))
    except Exception as e:  # stored document from an older/newer version: keep valid fields, default the rest
        log.warning("stored perf settings invalid, merging onto defaults", error=str(e)[:160])
        base = _current.model_dump()
        for k, v in data.items():
            if k in base:
                try:
                    PerfSettings(**{**base, k: v})
                    base[k] = v
                except Exception:
                    pass
        return _set(PerfSettings(**base))


async def save(s: PerfSettings) -> PerfSettings:
    await aio.execute(
        """INSERT INTO shared.perf_settings(key, value) VALUES($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=now()""", KEY, json.dumps(s.model_dump()))
    return _set(s)


async def update(patch: dict) -> PerfSettings:
    """Partial update; editing any field marks the preset as 'custom'. Raises pydantic ValidationError on bad values."""
    merged = {**_current.model_dump(), **patch}
    if "preset" not in patch:
        merged["preset"] = "custom"
    return await save(PerfSettings(**merged))


async def apply_preset(name: str) -> PerfSettings:
    return await save(preset(name))
