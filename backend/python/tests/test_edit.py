import json

import pytest
from fastapi.testclient import TestClient

from core.diffstream import HunkStreamer, apply_hunks, diff_hunks
from core.llm.providers import Provider
from core.llm.types import Usage
from core.llm.router import LLMRouter

class Exact(Provider):
    name = "exact"

    def __init__(self, text):
        self.text = text

    async def stream(self, req):
        for i in range(0, len(self.text), 5):
            yield self.text[i:i + 5]
        yield Usage(provider="exact", model="exact")


OLD = [f"line {i}" for i in range(12)]
NEW = OLD[:2] + ["CHANGED A"] + OLD[3:8] + ["extra", "CHANGED B"] + OLD[9:]


def test_diff_and_apply_roundtrip():
    hunks = diff_hunks(OLD, NEW)
    assert len(hunks) == 2
    assert apply_hunks(OLD, hunks) == NEW
    assert apply_hunks(OLD, hunks[:1]) != NEW  # rejecting a hunk leaves the old text there
    assert apply_hunks(OLD, []) == OLD


def test_streaming_emits_stable_hunks_incrementally_and_matches_final():
    text = "\n".join(NEW) + "\n"
    s, got = HunkStreamer(OLD), []
    first_emit_at = None
    for i in range(1, len(text) + 1, 7):
        out = s.feed(text[:i])
        if out and first_emit_at is None:
            first_emit_at = i
        got += out
    got += s.finish(text.rstrip("\n"))
    assert first_emit_at is not None and first_emit_at < len(text)  # first hunk arrived before the stream ended
    assert apply_hunks(OLD, got) == NEW
    assert len(got) == 2


def test_path_safety():
    from main import app
    c = TestClient(app, base_url="http://localhost")
    for bad in ["../outside.txt", "backend/python/.env", ".git/config", "storage/user/x", "node_modules/x/y.js"]:
        assert c.get("/api/v1/edit/file", params={"path": bad}).status_code in (403, 404), bad


@pytest.mark.db
def test_edit_stream_endpoint_with_stub_model(monkeypatch, tmp_path):
    import core.llm.registry as reg
    import api.routes.edit as edit
    target = edit.ROOT / "docs" / "_edit_test.txt"
    target.write_text("a\nb\nc\nd\ne\nf\ng\n", encoding="utf-8")
    try:
        stub = reg.TieredRouter({t: LLMRouter([Exact("a\nb\nX\nd\ne\nf\ng\n")]) for t in reg.TIERS})

        async def fake():
            return stub
        monkeypatch.setattr(edit, "get_router", fake)
        from main import app
        r = TestClient(app, base_url="http://localhost").post("/api/v1/edit/stream", json={"path": "docs/_edit_test.txt", "instruction": "replace c"})
        evs = [json.loads(line) for line in r.text.splitlines()]
        assert evs[0]["op"] == "begin" and evs[-1]["op"] == "end"
        hunks = [h for e in evs if e["op"] == "hunk" for h in e["hunks"]]
        assert len(hunks) == 1 and "+X" in hunks[0]["patch"] and "-c" in hunks[0]["patch"]
        ap = TestClient(app, base_url="http://localhost").post("/api/v1/edit/apply", json={"path": "docs/_edit_test.txt", "content": "a\nb\nX\nd\n"})
        assert ap.status_code == 200 and target.read_text() == "a\nb\nX\nd\n"
    finally:
        target.unlink(missing_ok=True)
        (edit.ROOT / "docs" / "_edit_test.txt.jasper-bak").unlink(missing_ok=True)
