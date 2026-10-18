"""
Shield — Test Runner Agent (IT Department, Stage 1 + 2).

Shield runs the pytest suite after Forge applies a change.
If tests fail, it signals Darwin to trigger a rollback.

Runs pytest in a subprocess to isolate the test environment.
"""

import asyncio
import os
import re
import subprocess
import structlog

log = structlog.get_logger()

# backend/python/ — where pytest.ini and tests/ live
_BACKEND_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)


class ShieldAgent:

    @classmethod
    async def run_tests(
        cls,
        test_path: str = "tests/",
        timeout: int = 120,
        extra_args: list[str] | None = None,
    ) -> dict:
        """
        Run pytest and return a structured result.

        Returns:
          {
            "passed":    int,
            "failed":    int,
            "errors":    int,
            "total":     int,
            "exit_code": int,   # 0 = all passed
            "output":    str,   # full pytest stdout/stderr
            "ok":        bool,  # True if exit_code == 0
          }
        """
        cmd = [
            "python", "-m", "pytest",
            test_path,
            "-x",           # stop after first failure
            "--tb=short",
            "-q",
            "--no-header",
        ]
        if extra_args:
            cmd.extend(extra_args)

        log.info("Shield: running tests", cmd=" ".join(cmd))

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
                return {
                    "passed": 0, "failed": 0, "errors": 0, "total": 0,
                    "exit_code": -1, "output": "Tests timed out", "ok": False,
                }

            output    = (result.stdout + result.stderr).decode(errors="replace")
            exit_code = result.returncode
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

            total = passed + failed + errors
            ok    = exit_code == 0

            log.info("Shield: tests complete",
                     passed=passed, failed=failed, errors=errors, ok=ok)

            return {
                "passed":    passed,
                "failed":    failed,
                "errors":    errors,
                "total":     total,
                "exit_code": exit_code,
                "output":    output[-4000:],   # cap to avoid huge DB entries
                "ok":        ok,
            }

        except FileNotFoundError:
            return {
                "passed": 0, "failed": 0, "errors": 0, "total": 0,
                "exit_code": -1,
                "output": "pytest not found — run pip install pytest pytest-asyncio",
                "ok": False,
            }
        except Exception as e:
            log.error("Shield: unexpected error", error=str(e))
            return {
                "passed": 0, "failed": 0, "errors": 0, "total": 0,
                "exit_code": -1, "output": str(e), "ok": False,
            }
