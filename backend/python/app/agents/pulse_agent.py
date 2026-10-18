"""
Pulse — Smoke Tester Agent (IT Department, Phase 6 QA).

Pulse makes lightweight HTTP GET/POST requests to every registered API endpoint
and verifies the service is alive and responding within latency thresholds.

It is scheduled to run every 15 minutes via APScheduler.
When any endpoint fails twice in a row, Pulse records the failure to error_store
so Sentry can escalate to Darwin if the consecutive threshold is reached.

Output contract (from check_all()):
  {
    "ok":        bool,   # True if every endpoint returned a healthy response
    "checked":   int,
    "failed":    int,
    "results":   [
      {
        "endpoint":    "/api/health",
        "method":      "GET",
        "status_code": 200,
        "latency_ms":  42,
        "ok":          true,
        "error":       null
      },
      ...
    ],
    "error": null | "Pulse itself failed (e.g. httpx not installed)"
  }
"""

import asyncio
import time
import structlog

log = structlog.get_logger()

# ── Endpoint registry ─────────────────────────────────────────────────────────
# Each entry: (method, path, expected_status)
# Pulse treats any non-expected status OR latency > LATENCY_WARN_MS as a failure.

LATENCY_WARN_MS = 5000   # 5 s

_ENDPOINTS: list[tuple[str, str, int]] = [
    ("GET",  "/api/health",                200),
    ("GET",  "/api/agents",                200),
    ("GET",  "/api/notifications",         200),
    ("GET",  "/api/memory/stats",          200),
    ("GET",  "/api/workflows",             200),
    ("GET",  "/api/it/errors",             200),
    ("GET",  "/api/it/tickets",            200),
    ("GET",  "/api/plans",                 200),
    ("GET",  "/api/approvals/pending",     200),
    ("GET",  "/api/storage/list",          200),
    ("GET",  "/api/voice-profiles",        200),
    ("GET",  "/api/settings",              200),
]


class PulseAgent:
    """Smoke-tests all live API endpoints and records failures to error_store."""

    @classmethod
    async def check_all(cls, base_url: str | None = None) -> dict:
        """
        Hit every registered endpoint and return a structured health report.

        Args:
          base_url:  Override the default localhost base (useful for testing).
        """
        from app.core.config import settings
        url_base = base_url or f"http://localhost:{settings.FASTAPI_PORT}"

        try:
            import httpx
        except ImportError:
            return cls._error_result("httpx not installed — run: pip install httpx")

        results = []
        failed  = 0

        async with httpx.AsyncClient(base_url=url_base, timeout=10.0) as client:
            tasks = [
                cls._check_one(client, method, path, expected)
                for method, path, expected in _ENDPOINTS
            ]
            raw = await asyncio.gather(*tasks, return_exceptions=True)

        for (method, path, _), outcome in zip(_ENDPOINTS, raw):
            if isinstance(outcome, Exception):
                results.append({
                    "endpoint":    path,
                    "method":      method,
                    "status_code": 0,
                    "latency_ms":  0,
                    "ok":          False,
                    "error":       str(outcome),
                })
                failed += 1
            else:
                results.append(outcome)
                if not outcome["ok"]:
                    failed += 1

        ok = failed == 0
        log.info("Pulse: smoke check complete",
                 checked=len(results), failed=failed, ok=ok)

        if not ok:
            await cls._record_failures(results)

        return {
            "ok":      ok,
            "checked": len(results),
            "failed":  failed,
            "results": results,
            "error":   None,
        }

    # ── Single endpoint check ─────────────────────────────────────────────────

    @classmethod
    async def _check_one(
        cls,
        client,
        method: str,
        path: str,
        expected_status: int,
    ) -> dict:
        t0 = time.monotonic()
        try:
            response = await client.request(method, path)
            latency_ms = round((time.monotonic() - t0) * 1000)
            status_ok  = response.status_code == expected_status
            latency_ok = latency_ms < LATENCY_WARN_MS
            ok = status_ok and latency_ok

            error = None
            if not status_ok:
                error = f"Expected {expected_status}, got {response.status_code}"
            elif not latency_ok:
                error = f"Latency {latency_ms}ms exceeds {LATENCY_WARN_MS}ms threshold"

            return {
                "endpoint":    path,
                "method":      method,
                "status_code": response.status_code,
                "latency_ms":  latency_ms,
                "ok":          ok,
                "error":       error,
            }
        except Exception as e:
            latency_ms = round((time.monotonic() - t0) * 1000)
            return {
                "endpoint":    path,
                "method":      method,
                "status_code": 0,
                "latency_ms":  latency_ms,
                "ok":          False,
                "error":       str(e),
            }

    # ── Error recording ───────────────────────────────────────────────────────

    @classmethod
    async def _record_failures(cls, results: list[dict]) -> None:
        """Push each failed endpoint to error_store so Sentry can escalate."""
        try:
            from app.services.error_store import capture_current_exception, error_store
            for r in results:
                if not r["ok"]:
                    error_store.record_sync(
                        agent="Pulse",
                        error=f"Endpoint down: {r['method']} {r['endpoint']} — {r['error']}",
                        context={
                            "endpoint":    r["endpoint"],
                            "status_code": r["status_code"],
                            "latency_ms":  r["latency_ms"],
                        },
                    )
        except Exception as e:
            log.warning("Pulse: could not record failure to error_store", error=str(e))

    @classmethod
    def _error_result(cls, reason: str) -> dict:
        log.error("Pulse: fatal error", reason=reason)
        return {
            "ok": False, "checked": 0, "failed": 0, "results": [], "error": reason,
        }
