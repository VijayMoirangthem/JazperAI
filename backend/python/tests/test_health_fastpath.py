import json

import pytest

from agents import connector, fastpaths


async def _collect(text: str, monkeypatch, google_ok=True, bad=False, connectors=()):
    async def fake_run_tool(name, args, agent):
        return json.dumps({"checks": {"database": "FAIL down" if bad else "ok"}, "connectors": [{"id": c, "connected": True} for c in connectors]})

    async def fake_google():
        return ["me@example.com"] if google_ok else []

    from agents import jasper_tools
    monkeypatch.setattr(jasper_tools, "run_tool", fake_run_tool)
    monkeypatch.setattr(connector, "_google_accounts", fake_google)
    out = ""
    async for ev in fastpaths._health(text):
        out += ev.get("delta", "")
    return out


async def test_status_counts_google_as_connected_when_its_login_is_healthy(monkeypatch):
    assert "google-workspace" in await _collect("system status", monkeypatch)            # not "Connected: none"


async def test_status_answers_in_the_language_asked(monkeypatch):
    en = await _collect("how is the system doing", monkeypatch)
    hi = await _collect("Mera system ka status batao", monkeypatch)
    dv = await _collect("सिस्टम का स्टेटस बताओ", monkeypatch)
    assert en.startswith("All good.")
    assert hi.startswith("Sab theek hai.") and "Connected: google-workspace" in hi
    assert dv.startswith("सब ठीक है।") and "google-workspace" in dv


async def test_status_reports_problems_and_says_so_when_nothing_is_connected(monkeypatch):
    assert (await _collect("system status", monkeypatch, bad=True)).startswith("Problems: database: FAIL down")
    assert "No connectors are connected" in await _collect("system status", monkeypatch, google_ok=False)
    assert "koi connector connected nahi" in await _collect("Mera system ka status batao", monkeypatch, google_ok=False)
