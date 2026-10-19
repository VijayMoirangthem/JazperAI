import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.db


@pytest.fixture
def client(monkeypatch):
    from core import vault
    from core.config import settings
    import agents.registry as reg
    monkeypatch.setattr(vault, "get", lambda n: None)
    monkeypatch.setattr(settings, "CLAUDE_API_KEY", "")
    monkeypatch.setattr(settings, "AI_API_KEY", "")
    reg._router = None
    from main import app
    c = TestClient(app)
    try:
        c.get("/api/v1/bots/").raise_for_status()
    except Exception:
        pytest.skip("postgres unavailable")
    yield c
    from memory.db import aio
    import asyncio
    asyncio.run(aio.execute("DELETE FROM shared.bot_definitions WHERE slug LIKE 't-%'"))


def test_create_message_disable_flow(client):
    body = {"slug": "t-qa-bot", "display_name": "T QA", "role_title": "Test Bot", "crew": "baeit", "prompt": "You test."}
    assert client.put("/api/v1/bots/", json=body).status_code == 200
    roster = client.get("/api/v1/bots/").json()["bots"]
    slugs = {b["slug"]: b for b in roster}
    assert "t-qa-bot" in slugs and slugs["t-qa-bot"]["source"] == "dynamic"
    assert "jasper" in slugs  # builtin adapter keeps legacy roster
    r = client.post("/api/v1/bots/t-qa-bot/message", json={"text": "hi"})
    assert r.status_code == 200 and r.json()["usage"]["provider"] == "stub"
    assert client.delete("/api/v1/bots/t-qa-bot").status_code == 200
    assert client.post("/api/v1/bots/t-qa-bot/message", json={"text": "hi"}).status_code == 404
    assert client.delete("/api/v1/bots/nope-x").status_code == 404


def test_invalid_slug_rejected(client):
    r = client.put("/api/v1/bots/", json={"slug": "Bad Slug", "display_name": "x", "role_title": "x", "crew": "x", "prompt": "x"})
    assert r.status_code == 422
