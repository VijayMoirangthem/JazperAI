"""P0-3 characterization tests: lock current behaviour before the Jasper refactor.

Route snapshot: regenerate deliberately with UPDATE_SNAPSHOTS=1.
No network or DB: lifespan is not started (TestClient not used as context manager).
"""
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SNAP = Path(__file__).parent.parent / "snapshots" / "routes.json"


@pytest.fixture(scope="module")
def app():
    from main import app as _app
    return _app


@pytest.fixture(scope="module")
def client(app):
    return TestClient(app)


def _table(app):
    rows = set()
    for r in app.routes:
        for m in getattr(r, "methods", None) or ["WS"]:
            if m != "HEAD":
                rows.add((m, r.path))
    return sorted(rows)


def test_route_table_snapshot(app):
    table = [list(x) for x in _table(app)]
    if os.getenv("UPDATE_SNAPSHOTS") or not SNAP.exists():
        SNAP.write_text(json.dumps(table, indent=1))
    assert table == json.loads(SNAP.read_text())


def test_health(client):
    r = client.get("/health/")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "sirjazper-fastapi"}


def test_approvals_pending_and_unknown_resolve(client):
    assert "approvals" in client.get("/api/approvals/pending").json()
    r = client.post("/api/approvals/does-not-exist/approve")
    assert r.status_code == 200
    assert r.json() == {"ok": False, "id": "does-not-exist", "approved": True}
    assert client.post("/api/approvals/does-not-exist/deny").json()["approved"] is False


def test_credentials_roundtrip():
    from app.services import credentials_service as c
    blob = c._encrypt({"k": "secretvalue", "n": 1})
    assert "secretvalue" not in blob
    assert c._decrypt(blob) == {"k": "secretvalue", "n": 1}
