"""
Probe and Pulse unit tests — all external calls mocked.
"""
import pytest
import sys
import os
from unittest.mock import patch, AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ══════════════════════════════════════════════════════════════════════════════
# Probe tests
# ══════════════════════════════════════════════════════════════════════════════

class TestProbeRunSuite:

    def _make_proc(self, stdout: bytes, returncode: int):
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(stdout, b""))
        proc.returncode  = returncode
        proc.kill        = MagicMock()
        return proc

    @patch("asyncio.create_subprocess_exec")
    async def test_all_pass_returns_ok_true(self, mock_exec):
        mock_exec.return_value = self._make_proc(
            b"45 passed in 1.09s", returncode=0
        )
        from app.agents.probe_agent import ProbeAgent
        result = await ProbeAgent.run_suite()
        assert result["ok"] is True
        assert result["passed"] == 45
        assert result["failed"] == 0

    @patch("asyncio.create_subprocess_exec")
    async def test_some_failures_ok_false(self, mock_exec):
        output = (
            b"FAILED tests/test_foo.py::TestBar::test_bad - AssertionError: got 1\n"
            b"3 failed, 42 passed in 2.3s\n"
        )
        mock_exec.return_value = self._make_proc(output, returncode=1)
        from app.agents.probe_agent import ProbeAgent
        result = await ProbeAgent.run_suite()
        assert result["ok"] is False
        assert result["failed"] == 3
        assert result["passed"] == 42

    @patch("asyncio.create_subprocess_exec")
    async def test_failures_list_populated(self, mock_exec):
        output = (
            b"FAILED tests/test_foo.py::TestBar::test_bad - AssertionError: expected 1\n"
            b"FAILED tests/test_foo.py::TestBar::test_worse - KeyError: 'x'\n"
            b"2 failed in 1.0s\n"
        )
        mock_exec.return_value = self._make_proc(output, returncode=1)
        from app.agents.probe_agent import ProbeAgent
        result = await ProbeAgent.run_suite()
        assert len(result["failures"]) == 2
        assert result["failures"][0]["test_id"] == "tests/test_foo.py::TestBar::test_bad"

    @patch("asyncio.create_subprocess_exec")
    async def test_result_has_required_keys(self, mock_exec):
        mock_exec.return_value = self._make_proc(b"1 passed in 0.5s", returncode=0)
        from app.agents.probe_agent import ProbeAgent
        result = await ProbeAgent.run_suite()
        for key in ("ok", "passed", "failed", "errors", "total", "duration_s", "failures", "output", "error"):
            assert key in result, f"Missing key: {key}"

    @patch("asyncio.create_subprocess_exec")
    async def test_timeout_returns_ok_false(self, mock_exec):
        import asyncio as _asyncio
        async def _slow_communicate():
            raise _asyncio.TimeoutError()
        proc = AsyncMock()
        proc.communicate = _slow_communicate
        proc.kill = MagicMock()
        mock_exec.return_value = proc
        from app.agents.probe_agent import ProbeAgent
        result = await ProbeAgent.run_suite(timeout=1)
        assert result["ok"] is False
        assert "timed out" in result["error"].lower()

    @patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError())
    async def test_pytest_not_found_returns_error(self, mock_exec):
        from app.agents.probe_agent import ProbeAgent
        result = await ProbeAgent.run_suite()
        assert result["ok"] is False
        assert result["error"] is not None

    @patch("asyncio.create_subprocess_exec")
    async def test_stop_on_first_passes_x_flag(self, mock_exec):
        mock_exec.return_value = self._make_proc(b"5 passed in 0.5s", returncode=0)
        from app.agents.probe_agent import ProbeAgent
        await ProbeAgent.run_suite(stop_on_first=True)
        called_cmd = mock_exec.call_args[0]
        assert "-x" in called_cmd

    @patch("asyncio.create_subprocess_exec")
    async def test_full_suite_no_x_flag_by_default(self, mock_exec):
        mock_exec.return_value = self._make_proc(b"5 passed in 0.5s", returncode=0)
        from app.agents.probe_agent import ProbeAgent
        await ProbeAgent.run_suite()
        called_cmd = mock_exec.call_args[0]
        assert "-x" not in called_cmd


class TestProbeParseFailures:

    def test_parses_failed_summary_lines(self):
        from app.agents.probe_agent import ProbeAgent
        output = (
            "FAILED tests/test_foo.py::TestBar::test_one - AssertionError: wrong\n"
            "FAILED tests/test_baz.py::TestX::test_two - KeyError: 'key'\n"
            "2 failed in 1.0s\n"
        )
        failures = ProbeAgent._parse_failures(output)
        assert len(failures) == 2
        assert failures[0]["message"] == "AssertionError: wrong"
        assert failures[1]["file"]    == "tests/test_baz.py"

    def test_deduplicates_same_test(self):
        from app.agents.probe_agent import ProbeAgent
        output = (
            "FAILED tests/test_foo.py::TestBar::test_one - AssertionError: x\n"
            "FAILED tests/test_foo.py::TestBar::test_one - AssertionError: x\n"
        )
        failures = ProbeAgent._parse_failures(output)
        assert len(failures) == 1

    def test_empty_output_returns_empty_list(self):
        from app.agents.probe_agent import ProbeAgent
        assert ProbeAgent._parse_failures("5 passed in 1.0s") == []


# ══════════════════════════════════════════════════════════════════════════════
# Pulse tests
# ══════════════════════════════════════════════════════════════════════════════

def _mock_response(status_code: int, latency_s: float = 0.01):
    resp = MagicMock()
    resp.status_code = status_code
    return resp


class TestPulseCheckAll:

    def _healthy_response(self):
        r = MagicMock()
        r.status_code = 200
        return r

    @patch("app.agents.pulse_agent.PulseAgent._record_failures", new_callable=AsyncMock)
    async def test_all_healthy_returns_ok_true(self, mock_record):
        import httpx
        with patch("httpx.AsyncClient") as mock_client_cls:
            instance = AsyncMock()
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            instance.request = AsyncMock(return_value=self._healthy_response())
            mock_client_cls.return_value = instance

            from app.agents.pulse_agent import PulseAgent, _ENDPOINTS
            result = await PulseAgent.check_all(base_url="http://localhost:8000")

        assert result["ok"] is True
        assert result["failed"] == 0
        assert result["checked"] == len(_ENDPOINTS)
        mock_record.assert_not_called()

    @patch("app.agents.pulse_agent.PulseAgent._record_failures", new_callable=AsyncMock)
    async def test_one_failure_recorded_to_error_store(self, mock_record):
        call_count = 0

        def _side_effect(method, path):
            nonlocal call_count
            r = MagicMock()
            r.status_code = 500 if call_count == 0 else 200
            call_count += 1
            return r

        with patch("httpx.AsyncClient") as mock_client_cls:
            instance = AsyncMock()
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            instance.request = AsyncMock(side_effect=_side_effect)
            mock_client_cls.return_value = instance

            from app.agents.pulse_agent import PulseAgent
            result = await PulseAgent.check_all(base_url="http://localhost:8000")

        assert result["ok"] is False
        assert result["failed"] >= 1
        mock_record.assert_called_once()

    async def test_httpx_not_installed_returns_error(self):
        import sys
        # Temporarily hide httpx
        real_httpx = sys.modules.get("httpx")
        sys.modules["httpx"] = None
        try:
            from app.agents.pulse_agent import PulseAgent
            result = await PulseAgent.check_all()
            assert result["ok"] is False
            assert result["error"] is not None
        finally:
            if real_httpx is not None:
                sys.modules["httpx"] = real_httpx
            else:
                del sys.modules["httpx"]

    async def test_result_has_required_keys(self):
        with patch("httpx.AsyncClient") as mock_client_cls:
            instance = AsyncMock()
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            instance.request = AsyncMock(return_value=self._healthy_response())
            mock_client_cls.return_value = instance
            with patch("app.agents.pulse_agent.PulseAgent._record_failures", new_callable=AsyncMock):
                from app.agents.pulse_agent import PulseAgent
                result = await PulseAgent.check_all(base_url="http://localhost:8000")

        for key in ("ok", "checked", "failed", "results", "error"):
            assert key in result

    async def test_each_result_has_required_keys(self):
        with patch("httpx.AsyncClient") as mock_client_cls:
            instance = AsyncMock()
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            instance.request = AsyncMock(return_value=self._healthy_response())
            mock_client_cls.return_value = instance
            with patch("app.agents.pulse_agent.PulseAgent._record_failures", new_callable=AsyncMock):
                from app.agents.pulse_agent import PulseAgent
                result = await PulseAgent.check_all(base_url="http://localhost:8000")

        for r in result["results"]:
            for key in ("endpoint", "method", "status_code", "latency_ms", "ok", "error"):
                assert key in r, f"Result missing key '{key}': {r}"


class TestPulseEndpointRegistry:

    def test_all_endpoints_have_method_path_status(self):
        from app.agents.pulse_agent import _ENDPOINTS
        for entry in _ENDPOINTS:
            assert len(entry) == 3, f"Bad endpoint entry: {entry}"
            method, path, status = entry
            assert method in ("GET", "POST", "PUT", "DELETE")
            assert path.startswith("/")
            assert isinstance(status, int)

    def test_no_duplicate_paths(self):
        from app.agents.pulse_agent import _ENDPOINTS
        paths = [path for _, path, _ in _ENDPOINTS]
        assert len(paths) == len(set(paths)), "Duplicate endpoint paths found"

    def test_has_health_endpoint(self):
        from app.agents.pulse_agent import _ENDPOINTS
        paths = [path for _, path, _ in _ENDPOINTS]
        assert "/api/health" in paths
