"""Agent activation overlay: switch any agent (built-in persona or DB-defined bot) on or off without touching its data.

* No row in shared.agent_activation means ACTIVE, so nothing changes until an agent is switched off.
* Deactivating keeps the agent's definition, settings, memory and history; it only stops the agent from being routed work
  and pauses the scheduled jobs that belong to it (see JOB_AGENT / WORKER_AGENT).
* CRITICAL agents cannot be deactivated by bulk actions or presets, and a single deactivation needs force=True.
* `max_active_agents` (PerfSettings) caps how many non-critical agents can be active at once.
"""
from __future__ import annotations

import structlog

from core.eventbus import announce
from core.perf import settings as perf_settings
from memory.db import aio

log = structlog.get_logger()

# Agents the system depends on: the L1 orchestrator, the dispatcher that is the only agent allowed to run commands, and the
# test/rollback gate that guards automated changes. (The Sentry error-watcher is a scheduled job, kept on via ALWAYS_ON_JOBS.)
CRITICAL: frozenset[str] = frozenset({"jasper", "commander", "shield"})

# Scheduler job id -> owning agent (only unambiguous, persona-owned jobs; the rest are system jobs and keep running).
JOB_AGENT: dict[str, str] = {
    "__hermes_monitor__": "hermes", "__atlas_daily__": "atlas", "__atlas_weekly__": "atlas", "__scout_monitor__": "scout",
    "job_radar_scan": "scout", "__sage_consolidation__": "sage", "__pulse_smoke__": "pulse",
    "__aria_nightly__": "aria", "__warden_health__": "warden",
}
# DB-defined cron jobs run a worker by type; map worker type -> owning agent.
WORKER_AGENT: dict[str, str] = {
    "hermes_monitor": "hermes", "atlas_scheduled": "atlas", "scout_monitor": "scout", "sage_consolidation": "sage",
    "Warden": "warden",
}
# Keep running even when background jobs are switched off globally.
ALWAYS_ON_JOBS = frozenset({"__expiry_purge__", "__sentry__", "__alerts__"})

_inactive: dict[str, str] = {}      # slug -> reason, mirrors shared.agent_activation where active = false
_paused_by_us: set[str] = set()     # scheduler jobs this module paused (so it only ever resumes its own pauses)


class ActivationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


# ------------------------------------------------------------------ state

async def load() -> None:
    global _inactive
    try:
        rows = await aio.fetch("SELECT slug, reason FROM shared.agent_activation WHERE NOT active")
    except Exception as e:  # before migration 0021 / DB down: everything stays active
        log.warning("agent activation unavailable, treating all agents as active", error=str(e)[:120])
        return
    _inactive = {r["slug"]: r["reason"] for r in rows}


def is_active(slug: str) -> bool:
    """The overlay only (a bot's own `enabled` flag is applied by effective())."""
    return slug not in _inactive


def inactive_slugs() -> set[str]:
    return set(_inactive)


def implemented(r: dict) -> bool:
    return r.get("source") != "spec"


def effective(r: dict) -> bool:
    """Can this agent receive work right now? enabled flag AND overlay AND actually implemented."""
    return bool(r.get("enabled", True)) and is_active(r["slug"]) and implemented(r)


def _roster() -> list[dict]:
    from agents.registry import registry
    return registry.roster()


def counts() -> dict:
    roster = _roster()
    impl = [r for r in roster if implemented(r)]
    active = [r for r in impl if effective(r)]
    return {"total": len(impl), "active": len(active), "inactive": len(impl) - len(active),
            "critical": sum(1 for r in impl if r["slug"] in CRITICAL),
            "active_counted": sum(1 for r in active if r["slug"] not in CRITICAL)}


def annotate(roster: list[dict]) -> list[dict]:
    return [{**r, "active": effective(r), "critical": r["slug"] in CRITICAL, "implemented": implemented(r),
             "deactivated": r["slug"] in _inactive, "deactivated_reason": _inactive.get(r["slug"], "")} for r in roster]


# ------------------------------------------------------------------ changes

def _known(slug: str) -> dict | None:
    return next((r for r in _roster() if r["slug"] == slug), None)


async def _persist(slug: str, active: bool, reason: str) -> None:
    await aio.execute(
        """INSERT INTO shared.agent_activation(slug, active, reason) VALUES($1,$2,$3)
           ON CONFLICT (slug) DO UPDATE SET active=$2, reason=$3, updated_at=now()""", slug, active, reason)
    if active:
        _inactive.pop(slug, None)
    else:
        _inactive[slug] = reason


def _cap_room() -> int | None:
    cap = perf_settings.current().max_active_agents
    return None if cap == 0 else cap - counts()["active_counted"]


async def set_active(slug: str, active: bool, *, force: bool = False, reason: str = "") -> dict:
    r = _known(slug)
    if r is None:
        raise ActivationError("not_found", f"unknown agent '{slug}'")
    if not implemented(r):
        raise ActivationError("not_implemented", f"'{slug}' is a planned role with no implementation yet")
    if not active and slug in CRITICAL and not force:
        raise ActivationError("critical", f"'{slug}' is a critical system agent; pass force=true to deactivate it deliberately")
    if active and not is_active(slug) and slug not in CRITICAL:
        room = _cap_room()
        if room is not None and room <= 0:
            raise ActivationError("cap", f"active-agent limit reached ({perf_settings.current().max_active_agents}); "
                                         "deactivate another agent or raise the limit in Performance Settings")
    await _persist(slug, active, "" if active else (reason or "deactivated by user"))
    apply_scheduler_gating()
    announce(slug, "idle" if active else "deprecated", reason="activated" if active else "deactivated")
    return {"slug": slug, "active": effective(r)}


async def bulk(slugs: list[str], active: bool, *, reason: str = "") -> dict:
    """Activate/deactivate many agents. Critical agents are never deactivated here; activation stops at the active-agent limit."""
    changed, skipped = [], []
    for slug in slugs:
        r = _known(slug)
        if r is None or not implemented(r):
            skipped.append({"slug": slug, "why": "unknown or not implemented"})
        elif not active and slug in CRITICAL:
            skipped.append({"slug": slug, "why": "critical system agent"})
        elif active == is_active(slug):
            continue
        else:
            if active and slug not in CRITICAL:
                room = _cap_room()
                if room is not None and room <= 0:
                    skipped.append({"slug": slug, "why": "active-agent limit reached"})
                    continue
            await _persist(slug, active, "" if active else (reason or "deactivated by user"))
            changed.append(slug)
    apply_scheduler_gating()
    for slug in changed:
        announce(slug, "idle" if active else "deprecated", reason="activated" if active else "deactivated")
    return {"changed": changed, "skipped": skipped, "counts": counts()}


async def priority_order() -> list[str]:
    """Most worth keeping active first: critical agents, then by recorded use (calls), then name."""
    try:
        stats = {r["slug"]: r["calls"] for r in await aio.fetch("SELECT slug, calls FROM shared.bot_stats")}
    except Exception:
        stats = {}
    impl = [r["slug"] for r in _roster() if implemented(r) and r.get("enabled", True)]
    return sorted(impl, key=lambda s: (s not in CRITICAL, -stats.get(s, 0), s))


async def plan_for_cap(cap: int) -> list[str]:
    """Which non-critical agents would have to be deactivated to fit `cap` (0 = no limit)? Does not change anything."""
    if cap == 0:
        return []
    keep, drop = 0, []
    for slug in await priority_order():
        if slug in CRITICAL:
            continue
        if not is_active(slug):
            continue
        if keep < cap:
            keep += 1
        else:
            drop.append(slug)
    return drop


# ------------------------------------------------------------------ scheduler gating

def apply_scheduler_gating() -> dict:
    """Pause scheduled jobs whose agent is inactive (and all non-essential jobs when background jobs are off); resume ours otherwise."""
    cfg = perf_settings.current()
    paused, resumed = [], []
    try:
        from core.scheduler.scheduler import scheduler
        for job in scheduler.get_jobs():
            owner = JOB_AGENT.get(job.id)
            want_pause = (owner is not None and not is_active(owner)) or \
                         (not cfg.background_jobs_enabled and job.id not in ALWAYS_ON_JOBS)
            if want_pause and job.next_run_time is not None:
                scheduler.pause_job(job.id)
                _paused_by_us.add(job.id)
                paused.append(job.id)
            elif not want_pause and job.id in _paused_by_us:
                scheduler.resume_job(job.id)
                _paused_by_us.discard(job.id)
                resumed.append(job.id)
    except Exception as e:  # scheduler not started yet (tests, early boot): gating is re-applied after startup
        log.debug("scheduler gating deferred", error=str(e)[:120])
    return {"paused": paused, "resumed": resumed}


def worker_allowed(worker_type: str) -> bool:
    """Used by the scheduler's job runner: a DB cron job whose owning agent is inactive must not execute."""
    owner = WORKER_AGENT.get(worker_type)
    return owner is None or is_active(owner)
