"""Per-bot settings: validation, persona suffix, tool switches, memory scopes."""
import pytest

from agents import jasper_tools, orgchart


@pytest.fixture(autouse=True)
def clean():
    saved = dict(orgchart.SETTINGS)
    yield
    orgchart.SETTINGS.clear()
    orgchart.SETTINGS.update(saved)


def test_persona_suffix_and_memory_scopes():
    orgchart.SETTINGS["t-bot"] = {"style": "concise", "language": "Hindi", "memory_scopes": {"group": False}}
    suffix = orgchart.persona_suffix("t-bot")
    assert "short" in suffix and "Hindi" in suffix
    assert orgchart.memory_scopes("t-bot") == {"founder": True, "own": True, "group": False, "org": True}
    assert orgchart.persona_suffix("nobody") == "" and all(orgchart.memory_scopes("nobody").values())


def test_llm_kwargs_pin_and_cli_never_for_tool_bots(monkeypatch):
    orgchart.SETTINGS["t-bot"] = {"model": "groq2:qwen/qwen3.8-27b", "temperature": 0.2, "max_tokens": 300, "tier": "frontier"}
    kw = orgchart.llm_kwargs("t-bot")
    assert kw == {"pin": "groq2:qwen/qwen3.8-27b", "tier": "frontier", "temperature": 0.2, "max_tokens": 300}
    orgchart.SETTINGS["t-bot"] = {"model": "opencode-cli:nemotron-3-ultra-free"}
    monkeypatch.setattr(jasper_tools, "has_tools", lambda slug: True)
    assert "pin" not in orgchart.llm_kwargs("t-bot")  # CLI agents are chat-only


def test_tools_off_removes_tools():
    base = jasper_tools.tools_for("jasper")
    orgchart.SETTINGS["jasper"] = {"tools_off": ["create_bot", "fs_write"]}
    now = jasper_tools.tools_for("jasper")
    assert "create_bot" in base and "create_bot" not in now and "fs_write" not in now and "ask_bot" in now


async def test_set_settings_validates_and_resets(monkeypatch):
    async def noop(*a, **k):
        return None
    monkeypatch.setattr(orgchart.aio, "execute", noop)
    cur = await orgchart.set_settings("t-bot", {"temperature": 9, "max_tokens": 5, "tier": "mega", "style": "concise", "daily_token_cap": 5000, "tools_off": ["fs_write"], "bogus": 1})
    assert cur == {"style": "concise", "daily_token_cap": 5000, "tools_off": ["fs_write"]}  # invalid values and unknown keys are dropped
    cur = await orgchart.set_settings("t-bot", {"style": None})
    assert "style" not in cur and cur["daily_token_cap"] == 5000
