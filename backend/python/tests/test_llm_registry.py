import os

import pytest
from fastapi.testclient import TestClient

from core import vault

pytestmark = pytest.mark.db


@pytest.fixture
def client(monkeypatch):
    store = {}
    monkeypatch.setattr(vault, "get", lambda n: store.get(n))
    monkeypatch.setattr(vault, "set", lambda n, v: store.__setitem__(n, v))
    from core.llm.registry import invalidate
    invalidate()
    from main import app
    c = TestClient(app, base_url="http://localhost")
    try:
        c.get("/api/v1/llm/providers").raise_for_status()
    except Exception:
        pytest.skip("postgres unavailable")
    yield c
    c.delete("/api/v1/llm/providers/t-prov")
    invalidate()


def test_seed_lists_groq_without_leaking_keys(client):
    r = client.get("/api/v1/llm/providers")
    body = r.text
    assert r.status_code == 200 and "groq" in body
    assert "api_key" not in body and "secret" not in body


def test_add_provider_model_and_routing_flow(client):
    r = client.put("/api/v1/llm/providers", json={"slug": "t-prov", "name": "Test", "kind": "openai_compat",
                                                  "base_url": "http://127.0.0.1:9/v1", "api_key": "sk-supersecret-value", "local": True})
    assert r.status_code == 200
    prov = {p["slug"]: p for p in client.get("/api/v1/llm/providers").json()["providers"]}["t-prov"]
    assert prov["has_key"] is True and "sk-supersecret-value" not in str(prov)
    assert client.put("/api/v1/llm/models", json={"provider": "t-prov", "model_id": "my-model"}).status_code == 200
    assert client.put("/api/v1/llm/models", json={"provider": "nope", "model_id": "m"}).status_code == 404
    assert client.put("/api/v1/llm/routing/light", json={"chain": [{"provider": "ghost", "model": "x"}]}).status_code == 422
    original = client.get("/api/v1/llm/routing").json()["light"]
    ok = client.put("/api/v1/llm/routing/light", json={"chain": [{"provider": "t-prov", "model": "my-model"}] + original})
    assert ok.status_code == 200
    client.put("/api/v1/llm/routing/light", json={"chain": original})  # restore
    assert client.delete("/api/v1/llm/providers/t-prov").status_code == 200
    assert client.delete("/api/v1/llm/providers/t-prov").status_code == 404


@pytest.mark.skipif(not os.getenv("RUN_LIVE"), reason="live Groq call; set RUN_LIVE=1")
def test_live_groq_completion(client):
    r = client.post("/api/v1/llm/complete", json={"prompt": "Reply with exactly: pong", "tier": "light", "max_tokens": 10})
    assert r.status_code == 200 and r.json()["usage"]["provider"] == "groq", r.text
