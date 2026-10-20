# SLOs and error budgets (Plan V2 G4)

Scope: the local backend API on this PC. Source of truth: `backend/python/core/metrics.py` (pure-ASGI middleware, no extra dependency).

| SLO | SLI | Target | Excluded |
|---|---|---|---|
| Availability | requests answered without a 5xx / all requests | **99.5 %** | `/health`, `/metrics`, `/ws`, `/docs` |
| Latency | non-streaming requests finished in under 1 s / all non-streaming requests | **95 %** | streaming and LLM routes (`/api/chat`, `/chat2`, `/voice`, `/edit`, `/stream`, `/direct`) |

**Error budget remaining** = `1 - bad / (events x (1 - target))`. 1.0 = untouched, 0 = spent, negative = breached.
Example: 1 000 requests allow 5 failures at 99.5 %; 5 failures leaves 0 budget.

## Where to see it
- `GET /api/v1/slo/?window_minutes=1440`: JSON status per SLO (`ok` / `breached` / `no-data`). Jasper can read it with the `slo` tool.
- `GET /metrics`: Prometheus text format (`jasper_http_requests_total`, `jasper_http_request_duration_seconds` histogram, `jasper_slo_sli`,
  `jasper_slo_error_budget_remaining`, `jasper_llm_tokens_today`, `jasper_llm_cost_usd_today`, `jasper_bot_*_total`, `jasper_hitl_pending`).
  Scrape config: job `jasper`, target `localhost:8000`.

## Limits (honest)
The budget window lives in process memory (max 7 days, reset on every restart). Durable history needs a Prometheus instance scraping `/metrics`;
none is installed. Nothing pages you yet; a budget breach is only visible on these endpoints.

## Policy when the budget is spent
Freeze feature work, fix the top failing route (`jasper_http_requests_total{status="5xx"}`), resume once the 24 h window is back above 0.

## Chaos experiments (ChaosBot, sandbox only)
`POST /api/v1/slo/chaos/{name}` or `all`; Jasper has `run_chaos` (Tier 2, needs approval). Targets are disposable by construction: fake LLM providers,
the Docker sandbox, and a private demo connector. They never touch the live router, hub or processes.

First run 2026-10-20, all five passed:
- `provider_failover`: fallback answers, breaker opens on the failing primary.
- `provider_total_outage`: fails fast with a clear error.
- `sandbox_memory_bomb`: OOM-killed (exit 137), host unaffected.
- `sandbox_fork_bomb`: capped by the 32-pid limit.
- `connector_crash_recovery`: reported DEGRADED, recovers on the next call (takes about 45 s because of the hub's own retry window).
