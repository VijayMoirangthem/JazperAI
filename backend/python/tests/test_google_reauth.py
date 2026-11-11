"""Expired Google login: truthful status, no Drive shortcut for email requests, a reconnect card instead of a raw API error."""
import asyncio
from types import SimpleNamespace

import pytest

from agents import fastpaths
from core.services import gmail_service as gs

INVALID_GRANT = "('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})"


def _hist(*texts):
    return [SimpleNamespace(role="user", content=t) for t in texts]


def test_email_requests_never_become_drive_file_searches():
    """The reported bug: 'first display me the email here', after 'latest emails today', opened 'your latest file' in Drive."""
    history = _hist("give me the update on latest emails today.. Is there any email from Kunal Sivach?")
    for msg in ("first display me the email here", "Sure first display me the email here and let me know", "show me the latest email from Kunal",
                "open my newest gmail message"):
        assert fastpaths.latest_request(msg, history) is None, msg
        assert fastpaths.match("jasper", msg, history) is not None, msg      # answered from the real mailbox (email_fast), never Drive
    # genuine Drive requests still use the fast path
    assert fastpaths.latest_request("open my latest document", []) is not None
    assert fastpaths.match("jasper", "open my latest document", []) is not None


def test_history_about_email_is_not_reused_for_a_later_file_request():
    history = _hist("any latest emails today?")
    assert fastpaths.latest_request("just open it", history) is None


async def _collect(gen):
    return [e async for e in gen]


async def test_expired_google_login_shows_a_reconnect_card_not_the_raw_error():
    evs = await _collect(fastpaths._drive_error(Exception(f"Google API error: {INVALID_GRANT}")))
    card = next(e["ui"] for e in evs if "ui" in e)
    assert card["kind"] == "oauth" and card["connector"] == "google-workspace" and card["url"].endswith("/api/google/oauth/authorize")
    text = " ".join(e.get("delta", "") for e in evs)
    assert "sign-in expired" in text and "invalid_grant" not in text and "Bad Request" not in text


async def test_other_drive_errors_still_report_plainly():
    evs = await _collect(fastpaths._drive_error(Exception("network is down")))
    assert [e for e in evs if "ui" in e] == [] and "Couldn't reach Drive: network is down" in evs[0]["delta"]


def test_account_health_marks_a_rejected_login_as_unhealthy_and_caches(monkeypatch):
    gs._health.clear()
    monkeypatch.setattr(gs, "list_connected_accounts", lambda: [{"email": "a@x.com", "connected_at": None}])
    monkeypatch.setattr(gs, "load_token", lambda e: {"refresh_token": "r", "access_token": "t"})
    calls = []

    def boom(creds, email_key=None):
        calls.append(email_key)
        gs._health[email_key] = (gs.time.monotonic(), False, "invalid_grant")
        raise gs.GoogleReauthRequired(gs.REAUTH_MESSAGE)
    monkeypatch.setattr(gs, "_refresh", boom)
    monkeypatch.setattr(gs, "_build_credentials", lambda td: object())
    out = gs.accounts_with_health()
    assert out[0]["healthy"] is False and "invalid_grant" in out[0]["reason"]
    gs.accounts_with_health()
    assert calls == ["a@x.com"]                              # second call served from the cache, no second Google request


def test_network_failure_is_not_reported_as_an_expired_login(monkeypatch):
    gs._health.clear()
    monkeypatch.setattr(gs, "list_connected_accounts", lambda: [{"email": "a@x.com", "connected_at": None}])
    monkeypatch.setattr(gs, "load_token", lambda e: {"refresh_token": "r"})
    monkeypatch.setattr(gs, "_build_credentials", lambda td: object())
    monkeypatch.setattr(gs, "_refresh", lambda c, k=None: (_ for _ in ()).throw(ConnectionError("offline")))
    out = gs.accounts_with_health()
    assert out[0]["healthy"] is True and "could not verify" in out[0]["reason"] and "a@x.com" not in gs._health


async def test_connector_status_is_not_connected_when_google_rejects_the_login(monkeypatch):
    from agents import connector
    monkeypatch.setattr(gs, "accounts_with_health", lambda: [{"email": "me@x.com", "connected_at": None, "healthy": False, "reason": "invalid_grant"}])
    st = await connector.check("google-workspace")
    assert st["oauth"]["connected"] is False and st["oauth"]["expired"] == ["me@x.com"] and st["ready"] is False
    assert "expired" in st["needs"].lower()
    monkeypatch.setattr(gs, "accounts_with_health", lambda: [{"email": "me@x.com", "connected_at": None, "healthy": True, "reason": ""}])
    assert (await connector.check("google-workspace"))["oauth"]["connected"] is True
