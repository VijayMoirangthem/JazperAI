"""W8 backend: remote guard + device pairing/auth/revocation."""
import httpx
import pytest

from core.remote_guard import is_remote

pytestmark = pytest.mark.db


def _scope(host="localhost:8000", extra=()):
    return {"headers": [(b"host", host.encode()), *extra]}


def test_remote_detection():
    assert not is_remote(_scope())
    assert not is_remote(_scope("127.0.0.1:8000"))
    assert is_remote(_scope("jasper.example.com"))                                # public hostname
    assert is_remote(_scope("localhost:8000", [(b"cf-connecting-ip", b"1.2.3.4")]))  # cloudflared forwards from localhost but adds proxy headers
    assert is_remote(_scope("localhost:8000", [(b"x-forwarded-for", b"1.2.3.4")]))


@pytest.fixture
async def client():
    from main import app
    try:
        from memory.db import aio
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000") as c:
        yield c


async def test_tunnel_can_only_reach_remote_surface(client):
    tunnel = {"Host": "jasper.example.com", "CF-Connecting-IP": "9.9.9.9"}
    for path in ("/api/v1/bots/tree", "/api/v1/system/secrets", "/api/v1/workspaces/", "/api/remote/devices", "/api/chat/sessions", "/metrics"):
        assert (await client.get(path, headers=tunnel)).status_code == 403, path
    assert (await client.get("/remote/v1/me", headers=tunnel)).status_code == 401  # reachable, but needs a token
    assert (await client.get("/health/", headers=tunnel)).status_code == 200
    assert (await client.get("/api/v1/bots/tree")).status_code == 200              # local use is unaffected


async def test_pairing_auth_and_revocation(client):
    code = (await client.post("/api/remote/pair/start")).json()["code"]
    paired = (await client.post("/remote/v1/pair/complete", json={"code": code, "name": "test-phone", "platform": "test"})).json()
    assert (await client.post("/remote/v1/pair/complete", json={"code": code, "name": "again"})).status_code == 400  # single use
    h = {"Authorization": "Bearer " + paired["access_token"]}
    assert (await client.get("/remote/v1/me", headers=h)).json()["name"] == "test-phone"
    assert (await client.get("/remote/v1/bots", headers=h)).status_code == 200
    assert (await client.get("/remote/v1/me", headers={"Authorization": "Bearer garbage"})).status_code == 401
    bad = await client.post("/remote/v1/auth/refresh", json={"device_id": paired["device_id"], "device_secret": "wrong"})
    assert bad.status_code == 401
    ok = await client.post("/remote/v1/auth/refresh", json={"device_id": paired["device_id"], "device_secret": paired["device_secret"]})
    assert ok.status_code == 200
    await client.delete(f"/api/remote/devices/{paired['device_id']}")
    assert (await client.get("/remote/v1/me", headers=h)).status_code == 401                      # revoked: the old token stops working at once
    assert (await client.post("/remote/v1/auth/refresh", json={"device_id": paired["device_id"], "device_secret": paired["device_secret"]})).status_code == 401
