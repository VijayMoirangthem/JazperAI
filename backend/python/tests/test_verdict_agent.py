"""
VerdictAgent unit tests — diff auditing, new-file auditing, and Darwin integration.

LLM and filesystem calls are mocked so tests run fully offline.
"""
import sys
import os
from unittest.mock import patch, AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _llm_response(payload: dict):
    """Build a fake ai_provider.chat() return value."""
    import json
    mock = MagicMock()
    mock.content = json.dumps(payload)
    return mock

SAFE_RESULT   = {"safe": True,  "issues": [], "summary": "Looks good."}
CRITICAL_RESULT = {
    "safe": False,
    "issues": [{"severity": "CRITICAL", "line_hint": "line 5",
                "description": "old_string not found in file"}],
    "summary": "CRITICAL issue found.",
}
HIGH_RESULT = {
    "safe": False,
    "issues": [{"severity": "HIGH", "line_hint": "line 12",
                "description": "Unclosed database connection"}],
    "summary": "HIGH severity issue.",
}


# ── review_diff — LLM path ────────────────────────────────────────────────────

class TestReviewDiff:

    @patch("agents.roster.verdict_agent.read_codebase_file", return_value="def foo():\n    pass\n    old_code_here\n")
    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_safe_diff_returns_safe_true(self, mock_chat, mock_read):
        mock_chat.return_value = _llm_response(SAFE_RESULT)
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_diff(
            file_path="backend/python/app/foo.py",
            old_string="old_code_here",
            new_string="new_code_here",
        )
        assert result["safe"] is True
        assert result["issues"] == []

    @patch("agents.roster.verdict_agent.read_codebase_file", return_value="def foo():\n    pass\n    old_code_here\n")
    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_critical_issue_returns_safe_false(self, mock_chat, mock_read):
        mock_chat.return_value = _llm_response(CRITICAL_RESULT)
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_diff(
            file_path="backend/python/app/foo.py",
            old_string="old_code_here",
            new_string="new_code_here",
        )
        assert result["safe"] is False
        assert any(i["severity"] == "CRITICAL" for i in result["issues"])

    @patch("agents.roster.verdict_agent.read_codebase_file", return_value="def foo():\n    pass\n")
    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_old_string_not_in_file_blocks_without_llm(self, mock_chat, mock_read):
        """Verdict should catch old_string mismatch before even calling the LLM."""
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_diff(
            file_path="backend/python/app/foo.py",
            old_string="this string is NOT in the file",
            new_string="replacement",
        )
        assert result["safe"] is False
        assert any(i["severity"] == "CRITICAL" for i in result["issues"])
        mock_chat.assert_not_called()  # LLM should not be hit

    @patch("agents.roster.verdict_agent.read_codebase_file", return_value="some code here\n")
    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_high_issue_still_returns_issues_list(self, mock_chat, mock_read):
        mock_chat.return_value = _llm_response(HIGH_RESULT)
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_diff(
            file_path="backend/python/app/foo.py",
            old_string="some code here",
            new_string="better code here",
        )
        assert any(i["severity"] == "HIGH" for i in result["issues"])

    @patch("agents.roster.verdict_agent.read_codebase_file",
           side_effect=__import__("mcp.tools.filesystem_tool", fromlist=["FilesystemError"]))
    async def test_unreadable_file_returns_safe_true_fail_open(self, _):
        """If Verdict can't read the file it fails open so Darwin is not permanently blocked."""
        from mcp.tools.filesystem_tool import FilesystemError
        from agents.roster.verdict_agent import VerdictAgent
        with patch("agents.roster.verdict_agent.read_codebase_file",
                   side_effect=FilesystemError("not found")):
            result = await VerdictAgent.review_diff(
                file_path="backend/python/app/missing.py",
                old_string="x", new_string="y",
            )
        assert result["safe"] is True
        assert result["error"] is not None

    @patch("agents.roster.verdict_agent.read_codebase_file", return_value="old_code_here\n")
    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_llm_invalid_json_returns_safe_true_fail_open(self, mock_chat, mock_read):
        mock_chat.return_value.content = "not valid json {{{"
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_diff(
            file_path="backend/python/app/foo.py",
            old_string="old_code_here",
            new_string="new_code_here",
        )
        assert result["safe"] is True  # fail-open
        assert result["error"] is not None

    @patch("agents.roster.verdict_agent.read_codebase_file", return_value="old_code_here\n")
    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_result_always_has_required_keys(self, mock_chat, mock_read):
        mock_chat.return_value = _llm_response(SAFE_RESULT)
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_diff("backend/python/app/foo.py", "old_code_here", "new")
        assert "safe" in result
        assert "issues" in result
        assert "summary" in result
        assert "error" in result


# ── review_new_file ───────────────────────────────────────────────────────────

class TestReviewNewFile:

    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_safe_new_file(self, mock_chat):
        mock_chat.return_value = _llm_response(SAFE_RESULT)
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_new_file(
            file_path="backend/python/app/agents/new_agent.py",
            content="class NewAgent:\n    pass\n",
        )
        assert result["safe"] is True

    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_critical_new_file_returns_false(self, mock_chat):
        mock_chat.return_value = _llm_response(CRITICAL_RESULT)
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_new_file(
            file_path="backend/python/app/agents/bad_agent.py",
            content="import os\nos.system('rm -rf /')\n",
        )
        assert result["safe"] is False

    @patch("core.providers.ai_provider.ai_provider.chat", new_callable=AsyncMock)
    async def test_new_file_result_has_required_keys(self, mock_chat):
        mock_chat.return_value = _llm_response(SAFE_RESULT)
        from agents.roster.verdict_agent import VerdictAgent
        result = await VerdictAgent.review_new_file("backend/python/app/x.py", "pass\n")
        assert "safe" in result and "issues" in result and "summary" in result


# ── Darwin integration: Verdict blocks repair ─────────────────────────────────

class TestDarwinVerdictIntegration:

    @patch("agents.roster.darwin_agent.DarwinAgent._upsert_ticket", new_callable=AsyncMock)
    @patch("agents.roster.darwin_agent.DarwinAgent._get_ticket_field", new_callable=AsyncMock,
           return_value='{"diagnosis":"bug"}')
    @patch("agents.roster.darwin_agent.DarwinAgent._request_approval", new_callable=AsyncMock,
           return_value=True)
    @patch("agents.roster.oracle_agent.OracleAgent.diagnose", new_callable=AsyncMock)
    @patch("agents.roster.aria_agent.AriaAgent.gate_diff", new_callable=AsyncMock)
    @patch("core.services.error_store.error_store.get_by_id")
    async def test_verdict_critical_blocks_forge(
        self, mock_get_err, mock_gate_diff, mock_oracle, mock_approval, mock_get_field, mock_upsert
    ):
        """When Aria Gate 1 (Verdict) blocks, Darwin must not call Forge."""
        from core.services.error_store import AgentError
        import datetime

        fake_err = AgentError(
            error_id="err-001", agent="Scout",
            error_message="RuntimeError: boom",
            traceback_str='File "backend/python/app/workers/scout.py", line 10',
            context={}, timestamp=datetime.datetime.utcnow().isoformat() + "Z",
        )
        mock_get_err.return_value = fake_err
        mock_oracle.return_value = {
            "diagnosis": "null pointer", "file_path": "backend/python/app/workers/scout.py",
            "old_string": "bad_code", "new_string": "good_code", "confidence": 0.9, "error": None,
        }
        mock_gate_diff.return_value = {
            "approved": False,
            "blocking_issue": "Verdict CRITICAL: Syntax error in new_string",
            "verdict": {"safe": False, "issues": [{"severity": "CRITICAL",
                        "line_hint": "line 10", "description": "Syntax error"}], "summary": ""},
            "summary": "Gate 1 BLOCKED — Syntax error in new_string",
        }

        from agents.roster.darwin_agent import DarwinAgent
        with patch("agents.roster.forge_agent.ForgeAgent.apply_fix", new_callable=AsyncMock) as mock_forge:
            result = await DarwinAgent.handle_repair("err-001")

        assert result["ok"] is False
        assert result["reason"] == "qa_gate1_blocked"
        mock_forge.assert_not_called()

    @patch("agents.roster.darwin_agent.DarwinAgent._upsert_ticket", new_callable=AsyncMock)
    @patch("agents.roster.darwin_agent.DarwinAgent._get_ticket_field", new_callable=AsyncMock,
           return_value='{"diagnosis":"bug"}')
    @patch("agents.roster.darwin_agent.DarwinAgent._request_approval", new_callable=AsyncMock,
           return_value=True)
    @patch("agents.roster.oracle_agent.OracleAgent.diagnose", new_callable=AsyncMock)
    @patch("agents.roster.aria_agent.AriaAgent.gate_diff", new_callable=AsyncMock)
    @patch("agents.roster.aria_agent.AriaAgent.gate_deployment", new_callable=AsyncMock)
    @patch("agents.roster.forge_agent.ForgeAgent.apply_fix", new_callable=AsyncMock)
    @patch("agents.roster.darwin_agent.CommanderAgent.run", new_callable=AsyncMock,
           return_value={"ok": True, "stdout": "123 passed", "stderr": "",
                         "exit_code": 0, "duration_s": 1.0, "risk": "safe",
                         "command": "pytest tests/ -q --tb=short"})
    @patch("core.services.error_store.error_store.get_by_id")
    @patch("core.services.error_store.error_store.mark_resolved", new_callable=AsyncMock)
    @patch("core.services.error_store.error_store.clear_consecutive")
    async def test_verdict_safe_allows_forge(
        self, mock_clear, mock_resolve, mock_get_err,
        mock_cmd, mock_forge, mock_gate_deploy, mock_gate_diff,
        mock_oracle, mock_approval, mock_get_field, mock_upsert
    ):
        """When Aria gates pass, Darwin proceeds to Forge and succeeds."""
        from core.services.error_store import AgentError
        import datetime

        fake_err = AgentError(
            error_id="err-002", agent="Hermes",
            error_message="KeyError: 'token'",
            traceback_str='File "backend/python/app/workers/hermes.py", line 5',
            context={}, timestamp=datetime.datetime.utcnow().isoformat() + "Z",
        )
        mock_get_err.return_value = fake_err
        mock_oracle.return_value = {
            "diagnosis": "missing key", "file_path": "backend/python/app/workers/hermes.py",
            "old_string": "old", "new_string": "new", "confidence": 0.9, "error": None,
        }
        mock_gate_diff.return_value = {
            "approved": True, "blocking_issue": None,
            "verdict": {"safe": True, "issues": [], "summary": "Gate 1 passed"},
            "summary": "Gate 1 passed",
        }
        mock_forge.return_value = {"ok": True, "bak_path": "/tmp/hermes.bak"}
        mock_gate_deploy.return_value = {
            "approved": True, "blocking_issue": None,
            "probe": {"ok": True, "passed": 44, "failed": 0, "errors": 0,
                      "failures": [], "duration_s": 1.2},
            "pulse": {"ok": True, "checked": 0, "failed": 0, "skipped": True},
            "summary": "Gates 2+3 passed — 44 test(s) passing",
        }

        from agents.roster.darwin_agent import DarwinAgent
        result = await DarwinAgent.handle_repair("err-002")

        assert result["ok"] is True
        mock_forge.assert_called_once()
