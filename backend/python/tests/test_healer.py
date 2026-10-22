import asyncio

import pytest

from agents import healer

CASES = [
    ("Google refused: this API is not enabled in the Google Cloud project (enable the Drive/Docs/Sheets/Slides API).", "google_api_disabled"),
    ("Google Drive API has not been used in project 233101942611 before or it is disabled", "google_api_disabled"),
    ("HttpError 403: Request had insufficient authentication scopes.", "google_scope"),
    ("Google refused: the connected account has not granted this permission (re-authorise Google with the full scopes).", "google_scope"),
    ("invalid_grant: Token has been expired or revoked.", "google_reauth"),
    ("No Google account connected. Authorise via /api/google/oauth/authorize", "google_reauth"),
    ("connector google-workspace is DEGRADED: connection closed", "connector_down"),
    ("unknown tool github.make_coffee", "tool_unknown"),
    ("401 Bad credentials", "credentials"),
    ("HTTP 429 Too Many Requests: rate limit exceeded", "rate_limited"),
    ("ProviderError: all providers failed: ['groq: 429']", "provider_down"),
    ("request timed out after 30s", "timeout"),
    ("404 File not found", "not_found"),
    ("403 Forbidden", "denied"),
    ("something nobody has seen", "unknown"),
]


@pytest.mark.parametrize("text,kind", CASES)
def test_classify(text, kind):
    assert healer.classify(text)[0] == kind


def test_is_failure():
    assert healer.is_failure(None)
    assert healer.is_failure({"blocked": False, "is_error": True, "text": "boom"})
    assert healer.is_failure({"blocked": False, "is_error": False, "text": '{"error": "Google refused: x"}'})
    assert healer.is_failure({"blocked": True, "reason": "connector exploded"})
    assert not healer.is_failure({"blocked": True, "reason": "Tier 2 action mcp.write was not approved"})  # a denied approval is an answer, not a fault
    assert not healer.is_failure({"blocked": False, "is_error": False, "text": '{"files": []}'})


def test_capability_from_tool_name():
    assert healer._cap_of("google-workspace.drive_list_recent") == "drive"
    assert healer._cap_of("google-workspace.sheets_write") == "sheets"
    assert healer._cap_of("github.search_code") is None


def test_heal_google_scope_asks_one_card_and_verified_retries(monkeypatch):
    from agents import connector

    async def no_ledger(*a, **k):
        return None
    monkeypatch.setattr(healer, "_ledger", no_ledger)

    async def needs_click(cap):
        return {"ok": False, "request": {"kind": "oauth", "connector": "google-workspace", "capability": cap, "reason": "approve"}}
    monkeypatch.setattr(connector, "ensure", needs_click)
    out = asyncio.run(healer.heal("google-workspace.drive_list_recent", {}, "insufficient authentication scopes"))
    assert out.request and out.request["capability"] == "drive" and not out.retry

    async def fixed(cap):
        return {"ok": True, "verified": True, "capability": cap}
    monkeypatch.setattr(connector, "ensure", fixed)
    out = asyncio.run(healer.heal("google-workspace.docs_read", {}, "API is not enabled"))
    assert out.fixed and out.retry and out.request is None


def test_heal_never_raises(monkeypatch):
    from agents import connector

    async def no_ledger(*a, **k):
        return None
    monkeypatch.setattr(healer, "_ledger", no_ledger)

    async def boom(cap):
        raise RuntimeError("kaboom")
    monkeypatch.setattr(connector, "ensure", boom)
    out = asyncio.run(healer.heal("google-workspace.drive_list_recent", {}, "insufficient scopes"))
    assert "healing itself failed" in out.message
