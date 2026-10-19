import json

import pytest

from core.llm.types import LLMResult, Usage
from memory import consolidate
from memory.db import aio

pytestmark = pytest.mark.db
MARK = "zq9test"


class Stub:
    def __init__(self, *texts):
        self.texts, self.calls = list(texts), 0

    async def complete(self, req):
        self.calls += 1
        t = self.texts[min(self.calls - 1, len(self.texts) - 1)]
        return LLMResult(text=t, usage=Usage(provider="s", model="s"))


@pytest.fixture(autouse=True)
async def clean():
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    from core.services.embedding_service import embed_memory
    if embed_memory("warmup") is None:
        pytest.skip("memory embedder unavailable")
    await aio.execute("DELETE FROM shared.memory_chunks WHERE namespace='fact' AND content LIKE $1", f"%{MARK}%")
    yield
    await aio.execute("DELETE FROM shared.memory_chunks WHERE namespace='fact' AND content LIKE $1", f"%{MARK}%")
    await aio.close_pool()


def test_retention_score_decays_and_usage_helps():
    s = consolidate.score
    assert s(0.5, 0, 0) > s(0.5, 60, 0) > s(0.5, 300, 0)
    assert s(0.5, 60, 20) > s(0.5, 60, 0)


async def test_extract_facts_parses_fenced_json_and_ignores_garbage():
    good = await consolidate.extract_facts(Stub('```json\n[{"fact": "User likes tea", "importance": 0.7}, {"fact": ""}]\n```'), "I like tea", "ok")
    assert good == [{"fact": "User likes tea", "importance": 0.7}]
    assert await consolidate.extract_facts(Stub("no facts here"), "hi", "hello") == []
    assert await consolidate.extract_facts(Stub("[not json"), "hi", "hello") == []


async def test_reconcile_rules_without_calling_the_model_when_obvious():
    stub = Stub('{"action": "UPDATE", "id": "x"}')
    assert (await consolidate.reconcile(stub, "f", []))["action"] == "ADD"
    assert (await consolidate.reconcile(stub, "f", [{"id": "a", "content": "c", "sim": 0.2}]))["action"] == "ADD"
    assert (await consolidate.reconcile(stub, "f", [{"id": "a", "content": "c", "sim": 0.97}])) == {"action": "NONE", "id": "a"}
    assert stub.calls == 0
    mid = [{"id": "a", "content": "User lives in Imphal", "sim": 0.8}]
    assert (await consolidate.reconcile(Stub('{"action": "UPDATE", "id": "a"}'), "User moved", mid)) == {"action": "UPDATE", "id": "a"}
    assert (await consolidate.reconcile(Stub('{"action": "DELETE", "id": "ghost"}'), "x", mid))["action"] == "ADD"  # must point at a real candidate
    assert (await consolidate.reconcile(Stub("garbage"), "x", mid))["action"] == "ADD"


async def test_add_duplicate_pii_and_recall_boost():
    router = Stub("unused")
    a = await consolidate.learn(router, f"The user prefers dark mode {MARK}", 0.6)
    assert a["action"] == "ADD"
    again = await consolidate.learn(router, f"The user prefers dark mode {MARK}", 0.6)
    assert again["action"] == "NONE" and router.calls == 0  # exact duplicate: no model call
    p = await consolidate.learn(router, f"The user PAN is ABCDE1234F and likes masala tea {MARK}", 0.6)
    stored = [f["content"] for f in await consolidate.list_facts()]
    assert not any("ABCDE1234F" in c for c in stored) and p["action"] == "ADD"
    got = await consolidate.recall("which theme does the user prefer")
    assert any("dark mode" in g for g in got)
    row = (await aio.fetch("SELECT hits FROM shared.memory_chunks WHERE id=$1::uuid", a["id"]))[0]
    assert row["hits"] >= 1


async def test_update_supersedes_instead_of_overwriting(monkeypatch):
    old = await consolidate.learn(Stub("x"), f"The user lives in Imphal {MARK}", 0.6)

    async def fake_similar(vec, k=4):
        return [{"id": old["id"], "content": "The user lives in Imphal", "sim": 0.8, "importance": 0.6}]
    monkeypatch.setattr(consolidate, "similar", fake_similar)
    new = await consolidate.learn(Stub(json.dumps({"action": "UPDATE", "id": old["id"]})), f"The user now lives in Delhi {MARK}", 0.6)
    assert new["action"] == "UPDATE" and new["id"] != old["id"]
    active = [f["content"] for f in await consolidate.list_facts()]
    assert any("Delhi" in c for c in active) and not any("Imphal" in c for c in active)
    history = {f["id"]: f for f in await consolidate.list_facts(include_inactive=True)}
    assert history[old["id"]]["superseded_by"] == new["id"]  # kept for audit


async def test_sweep_forgets_stale_unimportant_but_never_pinned():
    for content, imp in [(f"stale trivia {MARK}", 0.2), (f"pinned identity {MARK}", 0.95)]:
        r = await consolidate.learn(Stub("x"), content, imp)
        await aio.execute("UPDATE shared.memory_chunks SET created_at = now() - interval '400 days', last_used_at = NULL WHERE id=$1::uuid", r["id"])
    assert await consolidate.sweep() >= 1
    left = [f["content"] for f in await consolidate.list_facts()]
    assert not any("stale trivia" in c for c in left) and any("pinned identity" in c for c in left)


async def test_consolidate_turn_end_to_end_with_stub_model():
    router = Stub(f'[{{"fact": "The user is building Jazper {MARK}", "importance": 0.8}}]')
    acts = await consolidate.consolidate_turn(router, "I'm building Jazper", "Great!")
    assert [a["action"] for a in acts] == ["ADD"]
    assert any("building Jazper" in f["content"] for f in await consolidate.list_facts())
