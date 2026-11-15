"""Embeddings come from a cloud API (no local model), and memory stays off until it has been re-embedded with the current provider."""
import json

import httpx
import pytest

from core import health_stats
from core.services import embedding_service as es


@pytest.fixture
def cloud(monkeypatch, tmp_path):
    class S:
        EMBEDDING_PROVIDER = "cloud"
        EMBEDDING_BASE_URL = "https://api.example.com/v1"
        EMBEDDING_MODEL = "embed-multi-1"
        EMBEDDING_API_KEY = "test-key"

    monkeypatch.setattr(es, "_settings", lambda: S)
    monkeypatch.setattr(es, "_api_key", lambda: "test-key")
    monkeypatch.setattr(es, "STATE_FILE", tmp_path / "state" / "memory_embedding.json")
    es._cache.clear()
    health_stats.reset()
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append((str(request.url), request.headers["authorization"], body))
        dim = body["dimensions"]
        data = [{"index": i, "embedding": [float(len(t)) % 7] * dim} for i, t in enumerate(body["input"])]
        return httpx.Response(200, json={"data": data[::-1]})             # returned out of order on purpose

    monkeypatch.setattr(es, "_transport", httpx.MockTransport(handler))
    yield calls, S
    es._cache.clear()


def test_nothing_is_called_when_no_provider_is_configured(monkeypatch):
    class Off:
        EMBEDDING_PROVIDER, EMBEDDING_BASE_URL, EMBEDDING_MODEL, EMBEDDING_API_KEY = "cloud", "", "", ""

    monkeypatch.setattr(es, "_settings", lambda: Off)
    monkeypatch.setattr(es, "_api_key", lambda: "")
    assert es.configured() is False and es.embed("hello") is None and es.embed_memory("hello", force=True) is None
    assert es.is_available() is False and es.memory_model_ready() is False


def test_request_goes_to_the_configured_endpoint_with_the_right_size(cloud):
    calls, _ = cloud
    v = es.embed("def add(a, b): return a + b")
    assert len(v) == 384
    url, auth, body = calls[0]
    assert url == "https://api.example.com/v1/embeddings" and auth == "Bearer test-key"
    assert body["model"] == "embed-multi-1" and body["dimensions"] == 384 and body["input"] == ["def add(a, b): return a + b"]
    assert len(es.embed_memory("a memory", force=True)) == 1024 and calls[1][2]["dimensions"] == 1024


def test_same_text_is_not_sent_twice(cloud):
    calls, _ = cloud
    a, b = es.embed("same text"), es.embed("same text")
    assert a == b and len(calls) == 1
    es.embed("other text")
    assert len(calls) == 2


def test_a_provider_returning_the_wrong_size_is_refused(monkeypatch, cloud):
    calls, _ = cloud
    monkeypatch.setattr(es, "_transport", httpx.MockTransport(lambda r: httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.1] * 768}]})))
    assert es.embed("hello") is None                               # never store vectors of the wrong size
    assert health_stats.recent("embed")[-1][1] is False and "expected 384" in health_stats.recent("embed")[-1][2]


def test_rate_limit_is_retried_once_then_gives_up_quietly(monkeypatch, cloud):
    monkeypatch.setattr(es._time, "sleep", lambda s: None)
    seen = {"n": 0}

    def flaky(request):
        seen["n"] += 1
        return httpx.Response(429, text="slow down") if seen["n"] == 1 else httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.5] * 384}]})

    monkeypatch.setattr(es, "_transport", httpx.MockTransport(flaky))
    assert es.embed("hello") is not None and seen["n"] == 2

    es._cache.clear()
    seen["n"] = 0
    monkeypatch.setattr(es, "_transport", httpx.MockTransport(lambda r: (seen.__setitem__("n", seen["n"] + 1), httpx.Response(401, text="bad key"))[1]))
    assert es.embed("hello again") is None and seen["n"] == 1      # a bad key is not retried
    assert "HTTP 401" in health_stats.recent("embed")[-1][2]


def test_network_failure_returns_none_instead_of_raising(monkeypatch, cloud):
    monkeypatch.setattr(es._time, "sleep", lambda s: None)

    def down(request):
        raise httpx.ConnectError("no network")

    monkeypatch.setattr(es, "_transport", httpx.MockTransport(down))
    assert es.embed("hello") is None and es.embed_memory("x", force=True) is None


def test_memory_stays_off_until_everything_was_re_embedded_with_the_current_provider(cloud):
    calls, S = cloud
    assert es.configured() and es.memory_space_ok() is False
    assert es.embed_memory("a stored fact") is None and es.memory_model_ready() is False and calls == []   # configured is not enough
    es.record_memory_space()                                        # the re-embedding script writes this after a COMPLETE run
    assert es.memory_space_ok() is True and es.memory_model_ready() is True
    assert len(es.embed_memory("a stored fact")) == 1024
    S.EMBEDDING_MODEL = "a-different-model"                         # changing provider or model invalidates the memories again
    assert es.memory_space_ok() is False and es.embed_memory("x") is None


def test_re_embedding_helper_batches_and_keeps_order(cloud):
    calls, _ = cloud
    texts = [f"memory number {i}" * (i + 1) for i in range(70)]
    out = es.embed_memory_many(texts, batch=32)
    assert len(out) == 70 and all(v is not None and len(v) == 1024 for v in out)
    assert [len(c[2]["input"]) for c in calls] == [32, 32, 6]
    assert out[5][0] == float(len(texts[5])) % 7                    # each vector belongs to its own text despite the reversed reply


def test_old_local_model_entry_points_are_harmless_no_ops():
    assert es.warm_memory_model_async() is False and es.loaded_models() == 0 and es.trim_working_set() is False
    assert es.unload(True)["unloaded"] == 0
