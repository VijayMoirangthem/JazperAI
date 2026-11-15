import time

import pytest

from core import health_stats
from core.services import selfcheck as sc


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def rig():
    sent = []

    async def notify(title, body, ntype):
        sent.append((title, ntype))

    clock = Clock()
    return sc.SelfCheck(notify, clock=clock), sent, clock


def probe(result):
    async def p():
        r = result["v"]
        if isinstance(r, Exception):
            raise r
        return r
    return p


async def test_one_failed_check_is_not_announced_two_in_a_row_are(rig):
    chk, sent, _ = rig
    r = {"v": (False, "cannot connect")}
    await chk.run_once({"database": probe(r)})
    assert sent == []                                              # one blip is not an incident
    await chk.run_once({"database": probe(r)})
    assert sent == [("Database has a problem", "alert")]


async def test_a_problem_is_announced_once_then_recovery_is_announced(rig):
    chk, sent, clock = rig
    r = {"v": (False, "down")}
    for _ in range(5):
        await chk.run_once({"database": probe(r)})
        clock.t += 60
    assert len(sent) == 1                                          # no repeat every minute
    r["v"] = (True, "")
    await chk.run_once({"database": probe(r)})
    assert sent[-1] == ("Database is back", "info") and len(sent) == 2
    await chk.run_once({"database": probe(r)})
    assert len(sent) == 2                                          # and nothing more once it is healthy


async def test_a_blip_that_recovers_before_the_threshold_says_nothing(rig):
    chk, sent, _ = rig
    r = {"v": (False, "x")}
    await chk.run_once({"redis": probe(r)})
    r["v"] = (True, "")
    await chk.run_once({"redis": probe(r)})
    assert sent == [] and chk.states["redis"].ok is True


async def test_a_still_open_problem_is_reminded_every_six_hours(rig):
    chk, sent, clock = rig
    r = {"v": (False, "down")}
    await chk.run_once({"google": probe(r)})
    await chk.run_once({"google": probe(r)})
    clock.t += 5 * 3600
    await chk.run_once({"google": probe(r)})
    assert len(sent) == 1
    clock.t += 1.5 * 3600
    await chk.run_once({"google": probe(r)})
    assert len(sent) == 2


async def test_a_crashing_or_hanging_probe_counts_as_a_failure(rig, monkeypatch):
    chk, sent, _ = rig

    async def hang():
        import asyncio
        await asyncio.sleep(60)

    async def run():
        import asyncio
        real = asyncio.wait_for
        monkeypatch.setattr(asyncio, "wait_for", lambda c, timeout: real(c, 0.05))
        await chk.run_once({"disk": hang, "llm": probe({"v": RuntimeError("boom")})})
        await chk.run_once({"disk": hang, "llm": probe({"v": RuntimeError("boom")})})

    await run()
    assert {s[0] for s in sent} == {"Disk space has a problem", "AI model provider has a problem"}
    assert chk.states["disk"].detail == "did not answer in 8 seconds"


async def test_probes_run_independently_and_snapshot_reports_all(rig):
    chk, _, _ = rig
    await chk.run_once({"database": probe({"v": (True, "")}), "redis": probe({"v": (False, "down")})})
    snap = {s["name"]: s for s in chk.snapshot()}
    assert snap["database"]["ok"] is True and snap["redis"]["ok"] is False and snap["redis"]["label"] == "Redis cache"


async def test_notifications_wait_in_memory_while_the_database_is_down(monkeypatch):
    stored, state = [], {"down": True}

    async def store(title, body, ntype):
        if state["down"]:
            raise ConnectionError("db down")
        stored.append(title)

    monkeypatch.setattr(sc, "_store", store)
    sc._pending.clear()
    await sc._notify("Database has a problem", "x", "alert")
    assert stored == [] and len(sc._pending) == 1
    assert await sc.flush_pending() == 0 and len(sc._pending) == 1      # still down: kept
    state["down"] = False
    assert await sc.flush_pending() == 1 and stored == ["Database has a problem"] and sc._pending == []


def test_llm_and_speech_health_come_from_real_call_outcomes():
    health_stats.reset()
    for _ in range(2):
        health_stats.record("llm", False, "429 rate limited")
    assert health_stats.failing("llm")[0] is False                     # only 2 failures: not enough
    health_stats.record("llm", False, "429 rate limited")
    assert health_stats.failing("llm") == (True, "429 rate limited")
    health_stats.record("llm", True)
    assert health_stats.failing("llm")[0] is False                     # one success clears it
    health_stats.reset()


async def test_disk_probe_flags_low_space(monkeypatch):
    import shutil
    from collections import namedtuple
    Usage = namedtuple("Usage", "total used free")
    monkeypatch.setattr(shutil, "disk_usage", lambda p: Usage(500e9, 499e9, 1.2e9))
    ok, detail = await sc.probe_disk()
    assert ok is False and "1.2 GB" in detail
    monkeypatch.setattr(shutil, "disk_usage", lambda p: Usage(500e9, 400e9, 100e9))
    assert (await sc.probe_disk())[0] is True


async def test_llm_probe_uses_recorded_outcomes():
    health_stats.reset()
    assert await sc.probe_llm() == (True, "")
    for _ in range(3):
        health_stats.record("llm", False, "all providers failed")
    ok, detail = await sc.probe_llm()
    assert ok is False and "all providers failed" in detail
    health_stats.reset()


async def test_router_records_the_outcome_of_real_model_calls(monkeypatch):
    from core import finops
    from core.llm import registry
    from core.llm.types import LLMRequest, Usage

    async def check(tier):
        return tier

    async def record(*a, **k):
        return None

    monkeypatch.setattr(finops, "check", check)
    monkeypatch.setattr(finops, "record", record)

    class Good:
        async def stream(self, req):
            yield "hi"
            yield Usage(provider="p", model="m")

    class Bad:
        async def stream(self, req):
            raise RuntimeError("all providers failed")
            yield  # pragma: no cover

    req = LLMRequest(messages=[{"role": "user", "content": "x"}])
    health_stats.reset()
    r = registry.TieredRouter({"standard": Good()})
    assert [x async for x in r.stream(req)][0] == "hi"
    assert health_stats.recent("llm")[-1][1] is True
    r = registry.TieredRouter({"standard": Bad()})
    for _ in range(3):
        with pytest.raises(RuntimeError):
            async for _x in r.stream(req):
                pass
    assert health_stats.failing("llm")[0] is True and "all providers failed" in health_stats.failing("llm")[1]
    health_stats.reset()


async def test_speech_route_records_failures_and_successes(monkeypatch):
    import edge_tts
    from fastapi import HTTPException

    from api.routes import voice2

    class Dead:
        def __init__(self, t, v):
            pass

        async def stream(self):
            raise ConnectionError("service unreachable")
            yield  # pragma: no cover

    class Alive:
        def __init__(self, t, v):
            pass

        async def stream(self):
            yield {"type": "audio", "data": b"x"}

    health_stats.reset()
    monkeypatch.setattr(edge_tts, "Communicate", Dead)
    for _ in range(3):
        with pytest.raises(HTTPException):
            await voice2.synth_complete("hi", "en-GB-RyanNeural", attempts=1)
    assert health_stats.failing("tts")[0] is True
    monkeypatch.setattr(edge_tts, "Communicate", Alive)
    await voice2.synth_complete("hi", "en-GB-RyanNeural")
    assert health_stats.failing("tts")[0] is False
    health_stats.reset()


async def test_phone_diagnostics_handler_combines_checks_and_log_problems(tmp_path, monkeypatch):
    """Runs without the database: the handler only reads the self-check state and the log file."""
    from api.routes import remote
    from core import logfile

    p = tmp_path / "jasper.log"
    p.write_text("2026-11-15 10:00:00 [error    ] Gmail failed status=401\n", encoding="utf-8")
    monkeypatch.setattr(logfile, "LOG_FILE", p)
    chk = sc.checker()
    chk.states.clear()
    await chk.run_once({"disk": probe({"v": (True, "")})})
    out = await remote.diagnostics(d={"id": "x"})
    assert [c["name"] for c in out["checks"]] == ["disk"] and out["checks"][0]["ok"] is True
    assert out["problems"][0]["message"].startswith("Gmail failed")
    chk.states.clear()


async def test_embeddings_probe_explains_why_memory_is_off_and_alerts_only_on_real_failures(monkeypatch):
    from core.services import embedding_service as es
    health_stats.reset()
    monkeypatch.setattr(es, "configured", lambda: False)
    ok, note = await sc.probe_embeddings()
    assert ok is True and "not configured" in note                                  # neutral, never an alert
    monkeypatch.setattr(es, "configured", lambda: True)
    monkeypatch.setattr(es, "memory_space_ok", lambda: False)
    ok, note = await sc.probe_embeddings()
    assert ok is True and "not re-embedded" in note
    monkeypatch.setattr(es, "memory_space_ok", lambda: True)
    assert await sc.probe_embeddings() == (True, "")
    for _ in range(3):
        health_stats.record("embed", False, "HTTP 401: bad key")
    ok, note = await sc.probe_embeddings()
    assert ok is False and "bad key" in note
    health_stats.reset()
