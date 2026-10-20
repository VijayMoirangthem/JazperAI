import json

import pytest
from fastapi.testclient import TestClient

from agents.decision import decide, mentions
from core.llm.router import LLMRouter
from core.llm.providers import StubProvider
from core.llm.types import LLMResult, Usage


class FakeRouter:
    def __init__(self, text):
        self.text = text

    async def complete(self, req):
        return LLMResult(text=self.text, usage=Usage(provider="f", model="f"))


MEMBERS = [{"slug": "jasper", "role_title": "orchestrator"}, {"slug": "forge", "role_title": "backend"}]


def test_mentions_only_known_members():
    assert mentions("hey @forge and @ghost", ["jasper", "forge"]) == ["forge"]


async def test_decide_mention_model_and_fallbacks():
    assert (await decide(FakeRouter("x"), "@forge fix it", MEMBERS))["source"] == "mention"
    r = await decide(FakeRouter('{"slugs":["forge"],"confidence":0.9}'), "build the api", MEMBERS)
    assert r["slugs"] == ["forge"] and r["source"] == "model"
    low = await decide(FakeRouter('{"slugs":["forge"],"confidence":0.3}'), "hmm", MEMBERS)
    assert low["source"] == "fallback" and low["slugs"] == ["jasper"]
    junk = await decide(FakeRouter("not json at all"), "hmm", MEMBERS)
    assert junk["source"] == "fallback"
    bad = await decide(FakeRouter('{"slugs":["ghost"],"confidence":0.99}'), "hmm", MEMBERS)
    assert bad["source"] == "fallback"


@pytest.mark.db
def test_stream_endpoints_with_stub_provider(monkeypatch):
    import core.llm.registry as reg
    from agents.registry import registry
    stub = reg.TieredRouter({t: LLMRouter([StubProvider("hello there friend")]) for t in reg.TIERS})

    async def fake_get_router():
        return stub

    monkeypatch.setattr("api.routes.chat2.get_router", fake_get_router)
    from main import app
    c = TestClient(app, base_url="http://localhost")
    r = c.post("/api/v1/chat2/stream", json={"text": "hi", "slug": "jasper",
                                             "attachments": [{"name": "a.txt", "mime": "text/plain", "text": "data"}]})
    evs = [json.loads(line) for line in r.text.splitlines()]
    assert evs[0]["t"] == "speaker" and "".join(e.get("text", "") for e in evs if e["t"] == "delta").strip() == "hello there friend"
    assert evs[-1]["t"] == "done"
    rr = c.post("/api/v1/chat2/room", json={"room": "Baeit", "text": "@forge status?", "members": ["jasper", "forge"]})
    evs = [json.loads(line) for line in rr.text.splitlines()]
    assert evs[0] == {"t": "route", "slugs": ["forge"], "source": "mention", "confidence": 1.0}
