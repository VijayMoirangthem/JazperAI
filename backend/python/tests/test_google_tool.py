import asyncio

from agents import connector, healer, jasper_tools as jt
from core import hitl
from core.services import drive_service as ds

FILES = [{"id": "a1", "name": "Real Plan", "mimeType": "application/vnd.google-apps.document", "modifiedTime": "2026-10-21T10:00:00Z"},
         {"id": "b2", "name": "Real Budget", "mimeType": "application/vnd.google-apps.spreadsheet", "modifiedTime": "2026-10-20T09:00:00Z"}]


def run(args, agent="jasper"):
    return asyncio.run(jt.run_tool("google", args, agent))


def test_list_returns_exactly_the_api_data(monkeypatch):
    monkeypatch.setattr(ds, "list_recent", lambda limit, folder=None: FILES[:limit])
    out = run({"action": "list", "limit": 2})
    assert "1. Real Plan (Doc, modified 2026-10-21" in out and "2. Real Budget (Sheet, modified 2026-10-20" in out
    assert "March" not in out and "Mar " not in out


def test_edit_needs_approval(monkeypatch):
    async def deny(*a, **k):
        return False
    monkeypatch.setattr(hitl, "gate", deny)
    monkeypatch.setattr(ds, "search", lambda q, n=5: FILES)
    called = []
    monkeypatch.setattr(ds, "docs_append", lambda i, t: called.append(i) or {"ok": 1})
    assert run({"action": "append", "name": "Real Plan", "text": "hi"}).startswith("blocked")
    assert not called


def test_edit_runs_when_approved(monkeypatch):
    async def allow(*a, **k):
        return True
    monkeypatch.setattr(hitl, "gate", allow)
    monkeypatch.setattr(ds, "search", lambda q, n=5: FILES)
    monkeypatch.setattr(ds, "docs_append", lambda i, t: {"id": i, "appended_chars": len(t)})
    assert "'a1'" in run({"action": "append", "name": "Real Plan", "text": "hello"})


def test_api_disabled_is_healed_into_one_card(monkeypatch):
    def boom(limit, folder=None):
        raise RuntimeError("Google refused: this API is not enabled in the Google Cloud project")
    monkeypatch.setattr(ds, "list_recent", boom)

    async def needs_click(cap):
        return {"ok": False, "request": {"kind": "oauth", "connector": "google-workspace", "capability": "cloud", "reason": "One last click"}}
    monkeypatch.setattr(connector, "ensure", needs_click)

    async def no_ledger(*a, **k):
        return None
    monkeypatch.setattr(healer, "_ledger", no_ledger)
    out = run({"action": "list"})
    assert out.startswith("Needs ONE founder click")


def test_unknown_action():
    assert run({"action": "launch_rockets"}).startswith("error: action must be one of")
