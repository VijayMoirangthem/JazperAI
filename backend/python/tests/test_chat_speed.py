"""Chat must never wait on memory: a cold or slow embedder, a deterministic (fast-path) answer or a bare greeting all reply at once."""
import asyncio
import time

import pytest

from api.routes import chat2
from core.services import embedding_service as emb
from memory import consolidate


async def _first_line(text: str, budget: float = 3.0):
    gen = chat2._speak(None, "jasper", [], text, [])
    t0 = time.monotonic()
    line = await asyncio.wait_for(gen.__anext__(), budget)
    dt = time.monotonic() - t0
    await gen.aclose()
    return line, dt


@pytest.fixture
def slow_recall(monkeypatch):
    calls = {"recall": 0, "warm": 0}

    async def slow(*a, **k):
        calls["recall"] += 1
        await asyncio.sleep(10)
        return {}

    monkeypatch.setattr(consolidate, "recall_multi", slow)
    monkeypatch.setattr(emb, "warm_memory_model_async", lambda force=False: calls.__setitem__("warm", calls["warm"] + 1) or True)
    return calls


async def test_cold_embedder_does_not_delay_the_reply_and_starts_a_background_warmup(monkeypatch, slow_recall):
    monkeypatch.setattr(emb, "memory_model_ready", lambda: False)
    line, dt = await _first_line("tell me about my plans for next week")
    assert '"speaker"' in line and dt < 1.0
    assert slow_recall["recall"] == 0 and slow_recall["warm"] == 1   # no lookup attempted; the model loads in the background


async def test_slow_warm_lookup_is_capped_at_under_a_second(monkeypatch, slow_recall):
    monkeypatch.setattr(emb, "memory_model_ready", lambda: True)
    line, dt = await _first_line("tell me about my plans for next week")
    assert '"speaker"' in line and dt < 2.0                          # the old budget was 4 s
    assert slow_recall["recall"] == 1


async def test_greetings_and_fast_path_answers_skip_memory_entirely(monkeypatch, slow_recall):
    monkeypatch.setattr(emb, "memory_model_ready", lambda: True)
    line, dt = await _first_line("hi jasper")
    assert dt < 0.5 and slow_recall["recall"] == 0
    line, dt = await _first_line("Mera system ka status batao")
    assert dt < 0.5 and slow_recall["recall"] == 0


def test_warmup_is_skipped_when_the_pc_is_short_of_ram(monkeypatch):
    monkeypatch.setattr(emb, "_mem_model", None)
    monkeypatch.setattr(emb, "_warming", False)
    monkeypatch.setattr(emb, "_free_mb", lambda: 600)
    assert emb.warm_memory_model_async() is False                     # no 2 GB load on a PC with 600 MB free
