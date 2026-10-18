"""
Probe — Unit Test Runner Agent (IT Department, Phase 6 QA).

Probe runs the pytest suite and returns a structured per-test breakdown.
Unlike Shield (which stops at the first failure for Darwin's repair loop),
Probe collects ALL failures so Aria can build a complete picture of suite health.

Darwin uses Shield (fast, -x, stops early).
Aria uses Probe (thorough, full suite, all failures reported).

Output contract:
  {
    "ok":        bool,
    "passed":    int,
    "failed":    int,
    "errors":    int,
    "total":     int,
    "duration_s": float,
    "failures":  [{"test_id": "...", "file": "...", "line": "...", "message": "..."}],
    "output":    str,    # capped pytest stdout
    "error":     null | "reason if Probe itself failed"
  }
"""

import asyncio
import os
import re
import subprocess
import time
import structlog

log = structlog.get_logger()

# backend/python/ — where pytest.ini and tests/ live
_BACKEND_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)


class ProbeAgent:
    """Runs the full pytest suite and extracts per-failure details for Aria."""

    @classmethod
    async def run_suite(
        cls,
        target_path: str = "tests/",
        timeout: int = 180,
        stop_on_first: bool = False,
    ) -> dict:
        """
        Run pytest on the full suite or a specific file/directory.

        Args:
          target_path:    Path relative to backend/python/ (default: all tests)
          timeout:        Max seconds before killing pytest
          stop_on_first:  If True, pass -x (same as Shield — used by Aria for quick checks)
        """
        cmd = [
            "python", "-m", "pytest",
            target_path,
            "--tb=short",
            "-q",
            "--no-header",
        ]
        if stop_on_first:
            cmd.append("-x")

        log.info("Probe: running suite", target=target_path, stop_on_first=stop_on_first)
        t0 = time.monotonic()

        def _run_sync():
            return subprocess.run(
                cmd,
                cwd=_BACKEND_ROOT,
                capture_output=True,
                timeout=timeout,
            )

        try:
            loop = asyncio.get_event_loop()
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, _run_sync),
                    timeout=timeout + 5,
                )
            except asyncio.TimeoutError:
                return cls._timeout_result(target_path, timeout)

            output     = (result.stdout + result.stderr).decode(errors="replace")
            exit_code  = result.returncode
            duration_s = round(time.monotonic() - t0, 2)

            passed = errors = failed = 0
            m = re.search(r"(\d+) passed", output)
            if m:
                passed = int(m.group(1))
            m = re.search(r"(\d+) failed", output)
            if m:
                failed = int(m.group(1))
            m = re.search(r"(\d+) error", output)
            if m:
                errors = int(m.group(1))

            failures = cls._parse_failures(output)

            log.info("Probe: suite complete",
                     passed=passed, failed=failed, errors=errors,
                     duration_s=duration_s)

            return {
                "ok":         exit_code == 0,
                "passed":     passed,
                "failed":     failed,
                "errors":     errors,
                "total":      passed + failed + errors,
                "duration_s": duration_s,
                "failures":   failures,
                "output":     output[-5000:],
                "error":      None,
            }

        except FileNotFoundError:
            return cls._error_result("pytest not found — run: pip install pytest pytest-asyncio")
        except Exception as e:
            log.error("Probe: unexpected error", error=str(e))
            return cls._error_result(str(e))

    # ── Failure parser ────────────────────────────────────────────────────────

    @classmethod
    def _parse_failures(cls, output: str) -> list[dict]:
        """
        Extract per-test failure records from pytest --tb=short output.

        Looks for blocks like:
          FAILED tests/test_foo.py::TestBar::test_baz - AssertionError: ...
        and short-tb sections like:
          tests/test_foo.py:42: AssertionError
        """
        failures = []
        seen = set()

        # Pattern 1: FAILED summary line
        for m in re.finditer(
            r"FAILED\s+([\w/\\.\-]+\.py)::([\w:]+)\s*-\s*(.+)", output
        ):
            test_id = f"{m.group(1)}::{m.group(2)}"
            if test_id not in seen:
                seen.add(test_id)
                failures.append({
                    "test_id": test_id,
                    "file":    m.group(1),
                    "line":    "",
                    "message": m.group(3).strip()[:300],
                })

        # Pattern 2: short-tb file:line lines — enrich existing failures with line numbers
        for m in re.finditer(r"([\w/\\.\-]+\.py):(\d+):\s*([\w].*)", output):
            file_path = m.group(1).replace("\\", "/")
            for f in failures:
                if file_path in f["file"] and not f["line"]:
                    f["line"] = m.group(2)
                    break

        return failures

    # ── Error helpers ─────────────────────────────────────────────────────────

    @classmethod
    def _timeout_result(cls, target: str, timeout: int) -> dict:
        msg = f"Probe timed out after {timeout}s on {target}"
        log.warning(msg)
        return {
            "ok": False, "passed": 0, "failed": 0, "errors": 0, "total": 0,
            "duration_s": float(timeout), "failures": [], "output": msg, "error": msg,
        }

    @classmethod
    def _error_result(cls, reason: str) -> dict:
        return {
            "ok": False, "passed": 0, "failed": 0, "errors": 0, "total": 0,
            "duration_s": 0.0, "failures": [], "output": reason, "error": reason,
        }
