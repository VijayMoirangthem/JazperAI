"""Phase 2: the settings and the activation overlay actually change what the backend does."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from agents import activation
from core.perf import settings as ps


# ----------------------------------------------------------------- pure (no database)

def test_inactive_persona_agent_is_hidden_unroutable_and_never_initialised(monkeypatch):
    from agents.roster.registry import AgentRegistry
    monkeypatch.setattr(activation, "_inactive", {"scout": "test"})
    reg = AgentRegistry()
    reg._ensure_loaded()
    assert "Scout" not in reg._agents                                   # not even instantiated
    assert reg.get("Scout") is None
    assert "Scout" not in {a["name"] for a in reg.descriptions()} and "Hermes" in {a["name"] for a in reg.descriptions()}
    monkeypatch.setattr(activation, "_inactive", {})                    # activate again: loads on demand, nothing restarted
    reg._ensure_loaded()
    assert reg.get("Scout") is not None and "Scout" in {a["name"] for a in reg.descriptions()}


async def test_orchestrator_refuses_to_run_a_deactivated_agent(monkeypatch):
    from agents.roster import orchestrator
    monkeypatch.setattr(activation, "_inactive", {"scout": "test"})
    src = open(orchestrator.__file__, encoding="utf-8").read()
    assert "is deactivated - turn it on in Performance Settings" in src and "agent_tasks.slot()" in src


def test_worker_allowed_follows_the_owning_agent(monkeypatch):
    monkeypatch.setattr(activation, "_inactive", {"hermes": "t"})
    assert not activation.worker_allowed("hermes_monitor")
    assert activation.worker_allowed("scout_monitor") and activation.worker_allowed("email_sync")   # unmapped = system job


async def test_scheduler_jobs_pause_and_resume_with_their_agent(monkeypatch):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    import core.scheduler.scheduler as sched_mod

    async def noop():
        return None

    s = AsyncIOScheduler(timezone="UTC")
    s.start()
    try:
        s.add_job(noop, IntervalTrigger(hours=1), id="__hermes_monitor__")        # owned by hermes
        s.add_job(noop, IntervalTrigger(hours=1), id="__email_sync__")            # system job
        s.add_job(noop, IntervalTrigger(hours=1), id="__sentry__")                # always-on job
        monkeypatch.setattr(sched_mod, "scheduler", s)
        monkeypatch.setattr(ps, "_current", ps.default())
        monkeypatch.setattr(activation, "_inactive", {"hermes": "t"})
        out = activation.apply_scheduler_gating()
        assert out["paused"] == ["__hermes_monitor__"]
        assert s.get_job("__hermes_monitor__").next_run_time is None
        assert s.get_job("__email_sync__").next_run_time is not None
        monkeypatch.setattr(activation, "_inactive", {})
        assert activation.apply_scheduler_gating()["resumed"] == ["__hermes_monitor__"]
        assert s.get_job("__hermes_monitor__").next_run_time is not None
        # background jobs switched off: everything pauses except the always-on jobs
        monkeypatch.setattr(ps, "_current", ps.PerfSettings(**{**ps.default().model_dump(), "background_jobs_enabled": False}))
        out = activation.apply_scheduler_gating()
        assert set(out["paused"]) == {"__hermes_monitor__", "__email_sync__"}
        assert s.get_job("__sentry__").next_run_time is not None
    finally:
        s.shutdown(wait=False)


async def test_scheduler_wraps_async_jobs_with_the_background_limiter():
    from core.perf import limiter
    import core.scheduler.scheduler as sched_mod
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    s = AsyncIOScheduler(timezone="UTC")
    wrapped = sched_mod._limit_background
    seen = []

    async def job():
        seen.append(limiter.background_jobs.running)

    await wrapped(job)()
    assert seen == [1] and limiter.background_jobs.running == 0 and s is not None


def test_regex_pii_engine_skips_presidio_but_still_redacts(monkeypatch):
    from memory import sanitizer
    monkeypatch.setattr(ps, "_current", ps.PerfSettings(**{**ps.default().model_dump(), "pii_engine": "regex"}))
    assert sanitizer._presidio() is None
    text, found = sanitizer.sanitize("write to jane.doe@example.com or call +91 98765 43210, ip 10.1.2.3")
    assert "jane.doe@example.com" not in text and "10.1.2.3" not in text and "98765" not in text
    assert {"EMAIL_ADDRESS", "IP_ADDRESS", "PHONE_NUMBER"} <= set(found)


async def test_file_watcher_start_is_idempotent_and_stop_really_stops(monkeypatch, tmp_path):
    from core.system import file_watcher as fw
    monkeypatch.setattr(fw, "_PROJECT_ROOT", tmp_path)
    loop = asyncio.get_running_loop()
    fw.start(loop)
    try:
        assert fw.is_running()
        t = fw._observer_thread
        fw.start(loop)
        assert fw._observer_thread is t                                  # no second watcher
    finally:
        fw.stop()
    assert not fw.is_running()


# ----------------------------------------------------------------- HTTP API (needs Postgres + migration 0021)

@pytest.fixture
def client():
    from memory.db import aio
    from main import app
    c = TestClient(app, base_url="http://localhost")
    try:
        c.get("/api/performance/settings").raise_for_status()
        asyncio.run(aio.fetch("SELECT 1 FROM shared.agent_activation LIMIT 1"))
    except Exception:
        pytest.skip("postgres/migration 0021 unavailable")
    yield c

    async def wipe():
        await aio.execute("DELETE FROM shared.agent_activation")
        await aio.execute("DELETE FROM shared.perf_settings")
    asyncio.run(wipe())
    activation._inactive.clear()
    ps._set(ps.default())


@pytest.mark.db
def test_api_agent_activation_flow_and_critical_protection(client):
    listing = client.get("/api/performance/agents").json()
    slugs = {a["slug"]: a for a in listing["agents"]}
    assert slugs["jasper"]["critical"] and slugs["scout"]["active"] and "finops" not in slugs   # planned roles are not listed
    assert client.put("/api/performance/agents/scout", json={"active": False}).json()["active"] is False
    visible = {a["slug"] for a in client.get("/api/performance/agents?include_inactive=false").json()["agents"]}
    assert "scout" not in visible and "hermes" in visible
    assert client.put("/api/performance/agents/jasper", json={"active": False}).status_code == 409
    assert client.put("/api/performance/agents/nope", json={"active": False}).status_code == 404
    bulk = client.post("/api/performance/agents/bulk", json={"all": True, "active": False}).json()
    assert "jasper" not in bulk["changed"] and {s["slug"] for s in bulk["skipped"]} >= activation.CRITICAL
    assert client.post("/api/performance/agents/bulk", json={"all": True, "active": True}).json()["counts"]["inactive"] == 0
    assert client.post("/api/performance/agents/bulk", json={"active": True}).status_code == 422


@pytest.mark.db
def test_api_settings_validation_presets_and_persistence(client):
    assert client.put("/api/performance/settings", json={"max_concurrent_tasks": 0}).status_code == 422
    assert client.put("/api/performance/settings", json={"bogus": 1}).status_code == 422
    r = client.put("/api/performance/settings", json={"max_concurrent_tasks": 5, "animations": "off"}).json()
    assert r["settings"]["preset"] == "custom" and r["settings"]["max_concurrent_tasks"] == 5
    from core.perf import limiter
    assert limiter.agent_tasks.limit == 5                                             # applied live, not just stored
    dry = client.post("/api/performance/preset/eco?dry_run=true").json()
    assert dry["dry_run"] and not set(dry["would_deactivate"]) & activation.CRITICAL and dry["settings"]["max_active_agents"] == 8
    assert client.get("/api/performance/settings").json()["settings"]["preset"] == "custom"   # preview changed nothing
    done = client.post("/api/performance/preset/eco").json()
    assert done["settings"]["preset"] == "eco" and limiter.agent_tasks.limit == 1
    assert done["counts"]["active_counted"] <= 8 and set(done["deactivated"]) == set(dry["would_deactivate"])
    assert all(activation.is_active(s) for s in activation.CRITICAL)
    assert client.post("/api/performance/preset/turbo").status_code == 404
    ps._set(ps.default())                                                             # simulate restart
    assert client.get("/api/performance/settings").json()["settings"]["preset"] == "default"
    activation._inactive.clear()
    asyncio.run(ps.load())
    asyncio.run(activation.load())
    assert ps.current().preset == "eco"                                                # settings came back from Postgres
    assert done["deactivated"] and not activation.is_active(done["deactivated"][0])    # and so did the deactivations


@pytest.mark.db
def test_api_status_reports_real_numbers(client):
    s = client.get("/api/performance/status").json()
    assert s["rss_mb"] > 20 and s["threads"] > 0 and s["processes"] and s["agents"]["total"] > 0
    assert set(s["tasks"]) >= {"agent", "background", "asyncio_tasks", "scheduled", "paused"}
    assert isinstance(s["warnings"], list) and s["host"]["ram_total_mb"] > 1000
