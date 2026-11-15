"""list_emails fetches message metadata in ONE batched request (it was one round trip per message) and refreshes the sync marker rarely."""
import pytest

from core.services import gmail_service as g


class _Req:
    def __init__(self, svc, kind, ident=None):
        self.svc, self.kind, self.ident = svc, kind, ident

    def execute(self):
        if self.kind == "list":
            self.svc.counts["list"] += 1
            return {"messages": [{"id": i} for i in self.svc.ids], "nextPageToken": ""}
        if self.kind == "profile":
            self.svc.counts["profile"] += 1
            return {"historyId": "42"}
        self.svc.counts["get"] += 1
        return self.svc.message(self.ident)


class _Batch:
    def __init__(self, svc, callback):
        self.svc, self.cb, self.items = svc, callback, []

    def add(self, req, request_id):
        self.items.append((req, request_id))

    def execute(self):
        self.svc.counts["batch"] += 1
        if self.svc.batch_fails:
            raise RuntimeError("batch endpoint unavailable")
        for req, rid in self.items:
            self.cb(rid, self.svc.message(rid), None)


class FakeSvc:
    def __init__(self, n=12, batch_fails=False):
        self.ids = [f"m{i}" for i in range(n)]
        self.batch_fails = batch_fails
        self.counts = {"list": 0, "get": 0, "batch": 0, "profile": 0}

    def message(self, mid):
        return {"id": mid, "threadId": "t" + mid, "snippet": "s", "labelIds": ["UNREAD"],
                "payload": {"headers": [{"name": "Subject", "value": "Subject " + mid}, {"name": "From", "value": "Kunal <k@x.com>"}]}}

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, **kw):
        return _Req(self, "list")

    def get(self, userId, id, **kw):
        return _Req(self, "get", id)

    def getProfile(self, userId):
        return _Req(self, "profile")

    def new_batch_http_request(self, callback):
        return _Batch(self, callback)


@pytest.fixture
def mem(monkeypatch):
    store = {}
    monkeypatch.setattr(g, "_cache_get", lambda k: store.get(k))
    monkeypatch.setattr(g, "_cache_set", lambda k, v, ttl: store.__setitem__(k, v))
    monkeypatch.setattr(g, "_cache_ttl", lambda k: 0)
    monkeypatch.setattr(g, "_save_history_id", lambda *a: None)
    return store


def test_twelve_messages_take_one_batch_and_no_single_gets(monkeypatch, mem):
    svc = FakeSvc(12)
    monkeypatch.setattr(g, "_get_service", lambda: (svc, "me@x.com"))
    out = g.list_emails(max_results=12, force_refresh=True)
    assert [e["id"] for e in out["emails"]] == svc.ids and out["emails"][0]["subject"] == "Subject m0"   # same order, same content
    assert svc.counts["batch"] == 1 and svc.counts["get"] == 0


def test_cached_messages_are_not_fetched_again(monkeypatch, mem):
    svc = FakeSvc(5)
    monkeypatch.setattr(g, "_get_service", lambda: (svc, "me@x.com"))
    g.list_emails(max_results=5, force_refresh=True)
    g.list_emails(max_results=5, force_refresh=True)
    assert svc.counts["batch"] == 1 and svc.counts["list"] == 2          # the second list reused the cached metadata


def test_sync_marker_call_happens_at_most_every_five_minutes(monkeypatch, mem):
    svc = FakeSvc(3)
    monkeypatch.setattr(g, "_get_service", lambda: (svc, "me@x.com"))
    for _ in range(3):
        g.list_emails(max_results=3, force_refresh=True)
    assert svc.counts["profile"] == 1


def test_falls_back_to_single_requests_when_batching_fails(monkeypatch, mem):
    svc = FakeSvc(4, batch_fails=True)
    monkeypatch.setattr(g, "_get_service", lambda: (svc, "me@x.com"))
    out = g.list_emails(max_results=4, force_refresh=True)
    assert len(out["emails"]) == 4 and svc.counts["get"] == 4            # slower, but the user still gets their mail


def test_more_than_fifty_messages_use_one_batch_per_fifty(monkeypatch, mem):
    svc = FakeSvc(120)
    monkeypatch.setattr(g, "_get_service", lambda: (svc, "me@x.com"))
    out = g.list_emails(max_results=120, force_refresh=True)
    assert len(out["emails"]) == 120 and svc.counts["batch"] == 3
