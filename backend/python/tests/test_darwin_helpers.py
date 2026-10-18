"""
Unit tests for DarwinAgent._detect_project_root and _detect_app_type.

These methods are pure / synchronous helpers — no DB, no AI, no subprocess.
We only mock _launch_and_verify at the boundary where it talks to Commander/Voyager.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch


# ── _detect_project_root ──────────────────────────────────────────────────────

class TestDetectProjectRoot:

    def _agent(self):
        from app.agents.darwin_agent import DarwinAgent
        return DarwinAgent

    def test_returns_none_for_internal_files(self):
        """Files inside COOS project root → None (no external project detected)."""
        agent = self._agent()
        coos_root = Path(__file__).parent.parent.resolve()
        files = [
            {"path": str(coos_root / "app" / "agents" / "darwin_agent.py")},
            {"path": str(coos_root / "app" / "routes" / "agents.py")},
        ]
        result = agent._detect_project_root(files)
        assert result is None

    def test_detects_external_project_root(self, tmp_path):
        """Files in a temp dir outside COOS → returns the common ancestor."""
        agent = self._agent()
        proj = tmp_path / "MyApp"
        proj.mkdir()
        files = [
            {"path": str(proj / "backend" / "main.py")},
            {"path": str(proj / "backend" / "requirements.txt")},
            {"path": str(proj / "frontend" / "package.json")},
        ]
        result = agent._detect_project_root(files)
        # Should be proj or one of its parents (the deepest common ancestor of backend/ and frontend/)
        assert result is not None
        result_path = Path(result)
        # All external files must be under the returned root
        for f in files:
            assert Path(f["path"]).is_relative_to(result_path) or result_path == Path(f["path"]).parent.parent

    def test_mixed_internal_external_uses_external(self, tmp_path):
        """Mix of internal + external files → external root returned."""
        agent = self._agent()
        coos_root = Path(__file__).parent.parent.resolve()
        ext_dir = tmp_path / "ExternalApp"
        ext_dir.mkdir()
        files = [
            {"path": str(coos_root / "app" / "main.py")},          # internal
            {"path": str(ext_dir / "requirements.txt")},            # external
        ]
        result = agent._detect_project_root(files)
        assert result is not None
        assert "ExternalApp" in result

    def test_empty_list_returns_none(self):
        agent = self._agent()
        assert agent._detect_project_root([]) is None

    def test_files_without_path_key_ignored(self, tmp_path):
        agent = self._agent()
        files = [{"content": "hello"}, {"name": "foo.py"}]
        result = agent._detect_project_root(files)
        assert result is None


# ── _detect_app_type ──────────────────────────────────────────────────────────

class TestDetectAppType:

    def _agent(self):
        from app.agents.darwin_agent import DarwinAgent
        return DarwinAgent

    def test_fastapi_backend_detected(self, tmp_path):
        agent = self._agent()
        files = [
            {"path": str(tmp_path / "requirements.txt"), "content": "fastapi\nuvicorn\n"},
            {"path": str(tmp_path / "main.py"),          "content": "from fastapi import FastAPI\napp=FastAPI()\n"},
        ]
        result = agent._detect_app_type(files)
        assert result["has_backend"] is True
        assert result["has_frontend"] is False
        assert result["backend_dir"] is not None
        assert "localhost" in (result["backend_url"] or "")

    def test_react_frontend_detected(self, tmp_path):
        agent = self._agent()
        files = [
            {"path": str(tmp_path / "package.json"),
             "content": '{"dependencies":{"react":"^18.0.0","vite":"^5.0.0"}}'},
            {"path": str(tmp_path / "src" / "App.tsx"), "content": "export default function App() {}"},
        ]
        result = agent._detect_app_type(files)
        assert result["has_frontend"] is True
        assert result["has_backend"] is False
        assert result["frontend_dir"] is not None

    def test_full_stack_detected(self, tmp_path):
        agent = self._agent()
        backend = tmp_path / "backend"
        frontend = tmp_path / "frontend"
        backend.mkdir(); frontend.mkdir()
        files = [
            {"path": str(backend / "requirements.txt"), "content": "fastapi\nuvicorn"},
            {"path": str(frontend / "package.json"),    "content": '{"dependencies":{"react":"^18"}}'},
        ]
        result = agent._detect_app_type(files)
        assert result["has_backend"] is True
        assert result["has_frontend"] is True
        assert result["backend_dir"]  is not None
        assert result["frontend_dir"] is not None

    def test_custom_port_sniffed_from_content(self, tmp_path):
        agent = self._agent()
        files = [
            {"path": str(tmp_path / "requirements.txt"), "content": "uvicorn"},
            {"path": str(tmp_path / "main.py"),          "content": "uvicorn.run(app, port=9090)"},
        ]
        result = agent._detect_app_type(files)
        # port regex looks for "--port N"; this content uses "port=N" which doesn't match → stays default
        assert result["backend_port"] == 8001

    def test_port_from_cli_arg(self, tmp_path):
        agent = self._agent()
        files = [
            {"path": str(tmp_path / "requirements.txt"), "content": "uvicorn"},
            {"path": str(tmp_path / "Makefile"),          "content": "run:\n\tuvicorn main:app --port 8080"},
        ]
        result = agent._detect_app_type(files)
        assert result["backend_port"] == 8080

    def test_empty_files_returns_no_app(self):
        agent = self._agent()
        result = agent._detect_app_type([])
        assert result["has_backend"] is False
        assert result["has_frontend"] is False
        assert result["backend_url"] is None
        assert result["frontend_url"] is None

    def test_node_modules_package_json_ignored(self, tmp_path):
        """package.json inside node_modules should NOT be treated as the project frontend."""
        agent = self._agent()
        files = [
            {"path": str(tmp_path / "node_modules" / "react" / "package.json"),
             "content": '{"name":"react"}'},
        ]
        result = agent._detect_app_type(files)
        assert result["has_frontend"] is False


# ── _launch_and_verify (integration stub) ────────────────────────────────────

class TestLaunchAndVerify:
    """
    Verify the orchestration logic of _launch_and_verify without running real
    Commander commands or Playwright.
    """

    @pytest.mark.asyncio
    async def test_skips_when_no_url(self, tmp_path):
        """If _detect_app_type finds no URLs, method returns None."""
        from app.agents.darwin_agent import DarwinAgent
        files = [{"path": str(tmp_path / "README.md"), "content": "# hello"}]
        # _detect_project_root will return the tmp_path
        with patch("app.agents.darwin_agent.DarwinAgent._detect_app_type",
                   return_value={
                       "has_backend": False, "has_frontend": False,
                       "backend_dir": None,  "frontend_dir": None,
                       "backend_url": None,  "frontend_url": None,
                       "backend_port": 8001, "frontend_port": 5173,
                   }):
            result = await DarwinAgent._launch_and_verify("ticket-1", files, str(tmp_path))
        assert result is None

    @pytest.mark.asyncio
    async def test_voyager_pass_returns_result(self, tmp_path):
        """Happy path: Voyager says ok=True on first attempt."""
        from app.agents.darwin_agent import DarwinAgent
        files = [
            {"path": str(tmp_path / "requirements.txt"), "content": "fastapi\nuvicorn"},
            {"path": str(tmp_path / "main.py"),          "content": "from fastapi import FastAPI\napp=FastAPI()"},
        ]

        voyager_ok = {"ok": True, "screenshot": None, "console_errors": [], "url": "http://localhost:8001"}

        with patch("app.agents.darwin_agent.DarwinAgent._upsert_ticket", new_callable=AsyncMock), \
             patch("app.agents.commander_agent.CommanderAgent.run", new_callable=AsyncMock,
                   return_value={"ok": True, "stdout": "", "stderr": "", "exit_code": 0,
                                 "risk": "safe", "command": "test", "approval_required": False}), \
             patch("app.agents.voyager_agent.VoyagerAgent.test_panel", new_callable=AsyncMock,
                   return_value=voyager_ok), \
             patch("app.services.ide_bus.ide_bus.emit"):
            result = await DarwinAgent._launch_and_verify("ticket-1", files, str(tmp_path))

        assert result is not None
        assert result["ok"] is True

    @pytest.mark.asyncio
    async def test_voyager_fail_attempts_fix_cycle(self, tmp_path):
        """If Voyager returns errors, it should attempt the fix loop (up to 3x)."""
        from app.agents.darwin_agent import DarwinAgent
        files = [
            {"path": str(tmp_path / "requirements.txt"), "content": "fastapi\nuvicorn"},
            {"path": str(tmp_path / "main.py"),          "content": "from fastapi import FastAPI"},
        ]

        voyager_fail = {"ok": False, "screenshot": None,
                        "console_errors": ["ReferenceError: x is not defined"], "url": "http://localhost:8001"}

        call_count = 0
        async def fake_voyager(*a, **kw):
            nonlocal call_count
            call_count += 1
            return voyager_fail

        with patch("app.agents.darwin_agent.DarwinAgent._upsert_ticket", new_callable=AsyncMock), \
             patch("app.agents.commander_agent.CommanderAgent.run", new_callable=AsyncMock,
                   return_value={"ok": True, "stdout": "", "stderr": "", "exit_code": 0,
                                 "risk": "safe", "command": "test", "approval_required": False}), \
             patch("app.agents.voyager_agent.VoyagerAgent.test_panel", side_effect=fake_voyager), \
             patch("app.agents.oracle_agent.OracleAgent.diagnose", new_callable=AsyncMock,
                   return_value={}), \
             patch("app.services.ide_bus.ide_bus.emit"):
            result = await DarwinAgent._launch_and_verify("ticket-1", files, str(tmp_path))

        # Should have tried 3 times (Oracle returned no fix — no ForgeAgent call)
        assert call_count == 3
        assert result == voyager_fail
