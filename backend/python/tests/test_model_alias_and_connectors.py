"""Retired Groq model names are served by current models; the connector catalogue is well formed and honest."""
from core.config import settings
from core.providers import ai_provider as ap


def test_retired_models_map_to_current_free_models(monkeypatch):
    monkeypatch.setattr(settings, "LIGHT_MODEL", "openai/gpt-oss-20b")
    monkeypatch.setattr(settings, "AI_MODEL", "openai/gpt-oss-120b")
    for old in ("llama-3.1-8b-instant", "llama3-8b-8192", "gemma2-9b-it"):
        assert ap.resolve_model(old) == "openai/gpt-oss-20b"
    for old in ("llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama3-70b-8192", "mixtral-8x7b-32768"):
        assert ap.resolve_model(old) == "openai/gpt-oss-120b"
    for current in ("openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "anything-else"):
        assert ap.resolve_model(current) == current            # current/unknown names are never rewritten


def test_no_agent_class_depends_on_a_missing_alias():
    """Every retired name still used in code must be one the alias layer knows about (else it would 404 again)."""
    import re
    from pathlib import Path
    known = ap._RETIRED_SMALL | ap._RETIRED_MAIN | {"llama-3.1-8b-instant"}
    root = Path(ap.__file__).resolve().parents[2]
    seen = set()
    for f in list((root / "agents").rglob("*.py")) + list((root / "api").rglob("*.py")):
        seen |= set(re.findall(r'"(llama-[0-9a-z.\-]+(?:-instant|-versatile))"', f.read_text(encoding="utf-8", errors="ignore")))
    assert seen <= known, f"unmapped retired models in code: {seen - known}"


def test_connector_catalogue_is_complete_and_consistent():
    from agents import connector as c
    cat = c.catalogue()
    assert len(cat) >= 24
    for cid, m in cat.items():
        assert isinstance(m["command"], list) and m["command"], cid
        assert set(m) >= {"name", "command", "env_secrets", "needs", "tool_tiers"}, cid
        for vault_name in m["env_secrets"].values():
            assert vault_name.isupper() and "=" not in vault_name and len(vault_name) < 60, (cid, vault_name)   # names only, never values
    new = ["context7", "sequential-thinking", "chrome-devtools", "firecrawl", "tavily", "apify", "sentry", "supabase", "stripe",
           "hubspot", "airtable", "todoist", "resend", "figma", "linear", "atlassian"]
    assert all(k in cat for k in new)
    verified = {"context7", "sequential-thinking"}              # launched and listed their tools on 2026-11-13; only these two may claim to be tested
    assert all(cat[k].get("untested") for k in new if k not in verified)
    assert not any(cat[k].get("untested") for k in verified)
    assert cat["brave-search"]["command"][2] == "@brave/brave-search-mcp-server"   # the maintained server, not the archived one
    assert cat["supabase"]["command"][-1] == "--read-only"
    assert cat["stripe"]["tool_tiers"]["create_refund"] == "mcp.admin"
    assert "mcp-remote" in cat["linear"]["command"] and "mcp-remote" in cat["atlassian"]["command"]


def test_every_connector_secret_has_a_label_for_the_credential_card():
    from agents import connector as c
    missing = {v for m in c.catalogue().values() for v in m["env_secrets"].values()} - set(c.LABELS)
    assert missing == set(), f"secrets without a label: {missing}"
