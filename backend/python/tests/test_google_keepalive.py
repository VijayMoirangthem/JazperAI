"""Google keep-alive: silent when healthy, opens the sign-in once when the login expired, never nags."""
import pytest

from core.services import google_keepalive as ka
from core.services import gmail_service as gs


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(ka, "_last_opened", 0.0)
    opened, notes = [], []
    monkeypatch.setattr(ka.webbrowser, "open", lambda url: opened.append(url) or True)
    monkeypatch.setattr(ka, "_notify", lambda t, b: notes.append((t, b)))
    monkeypatch.setenv("GOOGLE_AUTO_RECONNECT", "1")
    return opened, notes


def _accounts(monkeypatch, healthy):
    monkeypatch.setattr(gs, "accounts_with_health", lambda force=False: [{"email": "me@x.com", "healthy": healthy, "reason": ""}])


async def test_healthy_login_does_nothing(monkeypatch, _reset):
    _accounts(monkeypatch, True)
    out = await ka.run()
    assert out == {"healthy": 1, "expired": [], "opened": False} and _reset == ([], [])


async def test_expired_login_notifies_and_opens_prefilled_sign_in_once(monkeypatch, _reset):
    opened, notes = _reset
    _accounts(monkeypatch, False)
    out = await ka.run()
    assert out["expired"] == ["me@x.com"] and out["opened"] is True
    assert opened[0].endswith("/api/google/oauth/authorize?email=me%40x.com") and len(notes) == 1
    again = await ka.run()                                         # within 12 h: no second tab, no second notification
    assert again["opened"] is False and len(opened) == 1 and len(notes) == 1


async def test_auto_open_can_be_switched_off_but_still_notifies(monkeypatch, _reset):
    opened, notes = _reset
    monkeypatch.setenv("GOOGLE_AUTO_RECONNECT", "0")
    _accounts(monkeypatch, False)
    out = await ka.run()
    assert out["opened"] is False and opened == [] and len(notes) == 1


async def test_check_failure_never_raises(monkeypatch):
    monkeypatch.setattr(gs, "accounts_with_health", lambda force=False: (_ for _ in ()).throw(RuntimeError("db down")))
    assert (await ka.run())["expired"] == []
