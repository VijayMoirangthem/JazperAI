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


async def test_notifications_endpoint_reports_the_unread_count_instead_of_crashing(client):
    """Regression: the handler awaited a synchronous function (TypeError -> HTTP 500), so the phone's unread badge never worked."""
    start = (await client.post("/api/remote/pair/start")).json()
    paired = (await client.post("/remote/v1/pair/complete", json={"code": start["code"], "name": "notif-test", "platform": "test"})).json()
    h = {"Authorization": "Bearer " + paired["access_token"]}
    try:
        r = await client.get("/remote/v1/notifications", headers=h)
        assert r.status_code == 200 and isinstance(r.json()["unread"], int)
    finally:
        await client.delete(f"/api/remote/devices/{paired['device_id']}")


async def test_events_long_poll_delivers_new_notifications_and_approvals(client):
    """Own-ecosystem push: the phone long-polls /events; a new notification or pending approval arrives without any third party."""
    import time
    from memory.db import aio
    start = (await client.post("/api/remote/pair/start")).json()
    paired = (await client.post("/remote/v1/pair/complete", json={"code": start["code"], "name": "events-test", "platform": "test"})).json()
    h = {"Authorization": "Bearer " + paired["access_token"]}
    try:
        first = (await client.get("/remote/v1/events", headers=h)).json()
        assert first["events"] == [] and first["cursor"]
        assert (await client.get("/remote/v1/events", params={"since": "not-a-date"}, headers=h)).status_code == 400
        t0 = time.monotonic()
        assert (await client.get("/remote/v1/events", params={"since": first["cursor"], "wait": 1}, headers=h)).json()["events"] == []
        assert time.monotonic() - t0 < 5  # the wait is bounded
        await aio.execute("INSERT INTO notifications (title, body, type) VALUES ('events-test ping', 'hello', 'mail')")
        got = (await client.get("/remote/v1/events", params={"since": first["cursor"], "wait": 5}, headers=h)).json()
        assert [e["title"] for e in got["events"]] == ["events-test ping"] and got["events"][0]["type"] == "mail"
        again = (await client.get("/remote/v1/events", params={"since": got["cursor"], "wait": 1}, headers=h)).json()
        assert again["events"] == []  # the cursor moves forward: no repeats
    finally:
        await aio.execute("DELETE FROM notifications WHERE title='events-test ping'")
        await client.delete(f"/api/remote/devices/{paired['device_id']}")


async def test_phone_approval_end_to_end_tier3_needs_device_confirmation(client):
    """A Tier-3 action blocks; the phone sees it (events feed + approvals list); approving without the device confirmation is refused;
    approving with it releases the action; a second approve is rejected."""
    import asyncio
    from core import hitl
    from memory.db import aio
    start = (await client.post("/api/remote/pair/start")).json()
    paired = (await client.post("/remote/v1/pair/complete", json={"code": start["code"], "name": "approval-test", "platform": "test"})).json()
    h = {"Authorization": "Bearer " + paired["access_token"]}
    try:
        cursor = (await client.get("/remote/v1/events", headers=h)).json()["cursor"]
        task = asyncio.create_task(hitl.gate("git.merge_main", "test-approval merge to main", "test-phone-approval"))
        got = (await client.get("/remote/v1/events", params={"since": cursor, "wait": 10}, headers=h)).json()
        ev = [e for e in got["events"] if e["kind"] == "approval" and "test-approval" in e["body"]]
        assert ev and ev[0]["title"].startswith("Approval needed (Tier 3)")
        rid = ev[0]["id"]
        listed = (await client.get("/remote/v1/approvals", headers=h)).json()["requests"]
        assert any(r["request_id"] == rid and r["tier"] == 3 for r in listed)
        assert not task.done()                                                     # still blocked
        denied = await client.post(f"/remote/v1/approvals/{rid}/respond", json={"approve": True}, headers=h)
        assert denied.status_code == 403 and not task.done()                       # Tier 3 needs the biometric-released secret
        wrong = await client.post(f"/remote/v1/approvals/{rid}/respond", json={"approve": True, "confirm": "wrong"}, headers=h)
        assert wrong.status_code == 403 and not task.done()
        ok = await client.post(f"/remote/v1/approvals/{rid}/respond", json={"approve": True, "confirm": paired["device_secret"]}, headers=h)
        assert ok.status_code == 200 and ok.json()["resolved"] is True
        assert await asyncio.wait_for(task, 3) is True                             # the blocked action was released
        assert (await client.post(f"/remote/v1/approvals/{rid}/respond", json={"approve": False}, headers=h)).status_code == 404  # already decided
    finally:
        await aio.execute("DELETE FROM shared.hitl_requests WHERE requester='test-phone-approval'")
        await client.delete(f"/api/remote/devices/{paired['device_id']}")


async def test_phone_can_reject_a_tier3_approval_without_confirmation(client):
    """Rejecting is always safe, so it needs no biometric confirmation."""
    import asyncio
    from core import hitl
    from memory.db import aio
    start = (await client.post("/api/remote/pair/start")).json()
    paired = (await client.post("/remote/v1/pair/complete", json={"code": start["code"], "name": "reject-test", "platform": "test"})).json()
    h = {"Authorization": "Bearer " + paired["access_token"]}
    try:
        task = asyncio.create_task(hitl.gate("payment.authorize", "test-reject pay", "test-phone-approval"))
        rid = None
        for _ in range(100):
            rows = (await client.get("/remote/v1/approvals", headers=h)).json()["requests"]
            rid = next((r["request_id"] for r in rows if r["summary"] == "test-reject pay"), None)
            if rid:
                break
            await asyncio.sleep(0.05)
        assert rid
        r = await client.post(f"/remote/v1/approvals/{rid}/respond", json={"approve": False}, headers=h)
        assert r.status_code == 200 and r.json()["resolved"] is True
        assert await asyncio.wait_for(task, 3) is False
    finally:
        await aio.execute("DELETE FROM shared.hitl_requests WHERE requester='test-phone-approval'")
        await client.delete(f"/api/remote/devices/{paired['device_id']}")
