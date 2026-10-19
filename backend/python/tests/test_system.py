import pytest
from fastapi.testclient import TestClient

from core import vault

pytestmark = pytest.mark.db


@pytest.fixture
def client(monkeypatch):
    store = {}
    monkeypatch.setattr(vault, "get", lambda n: store.get(n))
    monkeypatch.setattr(vault, "set", lambda n, v: store.__setitem__(n, v))
    monkeypatch.setattr(vault, "delete", lambda n: store.pop(n, None))
    from main import app
    c = TestClient(app)
    try:
        c.get("/api/v1/system/health").raise_for_status()
    except Exception:
        pytest.skip("postgres unavailable")
    return c


def test_health_has_all_checks(client):
    body = client.get("/api/v1/system/health").json()
    assert set(body["checks"]) == {"database", "redis", "llm", "mcp", "disk", "backup"}
    assert body["checks"]["database"]["ok"] is True


def test_secrets_are_write_only_and_validated(client):
    assert client.put("/api/v1/system/secrets", json={"name": "bad name!", "value": "x"}).status_code == 422
    assert client.put("/api/v1/system/secrets", json={"name": "GITHUB_TOKEN", "value": "  "}).status_code == 422
    assert client.put("/api/v1/system/secrets", json={"name": "GITHUB_TOKEN", "value": "ghp_supersecret"}).status_code == 200
    r = client.get("/api/v1/system/secrets")
    assert "ghp_supersecret" not in r.text
    assert {"name": "GITHUB_TOKEN", "set": True} in r.json()["secrets"]
    assert client.delete("/api/v1/system/secrets/GITHUB_TOKEN").status_code == 200
    assert {"name": "GITHUB_TOKEN", "set": False} in client.get("/api/v1/system/secrets").json()["secrets"]
