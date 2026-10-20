"""Prometheus exposition + SLO / error-budget tracking (Plan V2 G4), with no extra dependency.

Requests are counted by a pure-ASGI middleware (safe for streaming responses). A minute-bucketed window feeds the SLOs:
  availability: share of requests answered without a 5xx          target 99.5 %
  latency:      share of non-streaming requests finished < 1 s     target 95 %
Error budget remaining = 1 - bad / (total * (1 - target)); 1.0 = untouched, <= 0 = exhausted. The window is in-process (7 days max,
reset on restart); durable history lives in Prometheus once it scrapes /metrics.
"""
import time
from collections import defaultdict, deque

STARTED = time.time()
PERSIST = True  # mirror counters to Redis (tests switch this off)
BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
SLOS = {"availability": 0.995, "latency": 0.95}
LATENCY_THRESHOLD_S = 1.0
WINDOW_MIN = 7 * 24 * 60
SKIP_PREFIXES = ("/metrics", "/health", "/ws", "/docs", "/openapi")
STREAMING_PREFIXES = ("/api/chat", "/api/v1/chat2", "/api/v1/voice2", "/api/voice", "/api/v1/edit", "/api/stream", "/api/direct")

_req: dict[tuple[str, str, str], int] = defaultdict(int)  # (method, route, status_class) -> n
_hist: dict[str, list[int]] = defaultdict(lambda: [0] * (len(BUCKETS) + 1))  # route -> cumulative-less bucket counts
_sum: dict[str, float] = defaultdict(float)
_minutes: deque = deque(maxlen=WINDOW_MIN)  # [minute, total, errors, lat_total, lat_slow]


def _bucket() -> list:
    m = int(time.time() // 60)
    if not _minutes or _minutes[-1][0] != m:
        _minutes.append([m, 0, 0, 0, 0])
    return _minutes[-1]


def observe(method: str, route: str, status: int, seconds: float, path: str = "") -> None:
    if path.startswith(SKIP_PREFIXES):
        return
    _req[(method, route, f"{status // 100}xx")] += 1
    i = next((k for k, b in enumerate(BUCKETS) if seconds <= b), len(BUCKETS))
    _hist[route][i] += 1
    _sum[route] += seconds
    b = _bucket()
    err = 1 if status >= 500 else 0
    streaming = path.startswith(STREAMING_PREFIXES)
    slow = 1 if (not streaming and seconds > LATENCY_THRESHOLD_S) else 0
    b[1] += 1
    b[2] += err
    if not streaming:
        b[3] += 1
        b[4] += slow
    if not PERSIST:
        return
    try:  # mirror to Redis so the error budget survives a backend restart
        import asyncio

        from core import cache
        asyncio.get_running_loop().create_task(cache.slo_incr(b[0], 1, err, 0 if streaming else 1, slow))
    except RuntimeError:
        pass


class MetricsMiddleware:
    """Pure ASGI: records status + duration without buffering the body."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        t0, status = time.perf_counter(), 500

        async def _send(msg):
            nonlocal status
            if msg["type"] == "http.response.start":
                status = msg["status"]
            await send(msg)

        try:
            await self.app(scope, receive, _send)
        finally:
            route = getattr(scope.get("route"), "path", None) or "unmatched"
            observe(scope["method"], route, status, time.perf_counter() - t0, scope.get("path", ""))


async def slo_status_async(window_min: int = 60 * 24) -> dict:
    """Like slo_status but reads the Redis counters (durable across restarts); falls back to the in-process window."""
    from core import cache
    rows = await cache.slo_rows(int(time.time() // 60) - window_min)
    return slo_status(window_min, rows)


def slo_status(window_min: int = 60 * 24, rows: list | None = None) -> dict:
    cutoff = int(time.time() // 60) - window_min
    rows = [m for m in (rows if rows is not None else _minutes) if m[0] >= cutoff]
    total, errors = sum(r[1] for r in rows), sum(r[2] for r in rows)
    lat_total, slow = sum(r[3] for r in rows), sum(r[4] for r in rows)

    def one(name: str, good: float, n: int, bad: int) -> dict:
        target = SLOS[name]
        allowed = n * (1 - target)
        return {"slo": name, "target": target, "sli": round(good, 5) if n else None, "events": n, "bad": bad,
                "budget_remaining": None if n == 0 else round(1 - bad / allowed, 3) if allowed else 0.0,
                "status": "no-data" if n == 0 else "ok" if bad <= allowed else "breached"}
    return {"window_minutes": window_min, "uptime_s": int(time.time() - STARTED), "slos": [
        one("availability", 1 - errors / total if total else 1, total, errors),
        one("latency", 1 - slow / lat_total if lat_total else 1, lat_total, slow)]}


def _esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


async def render() -> str:
    out = ["# HELP jasper_http_requests_total HTTP requests by route and status class", "# TYPE jasper_http_requests_total counter"]
    for (m, r, c), n in sorted(_req.items()):
        out.append(f'jasper_http_requests_total{{method="{m}",route="{_esc(r)}",status="{c}"}} {n}')
    out += ["# HELP jasper_http_request_duration_seconds Request latency", "# TYPE jasper_http_request_duration_seconds histogram"]
    for r, counts in sorted(_hist.items()):
        cum = 0
        for b, n in zip(BUCKETS, counts):
            cum += n
            out.append(f'jasper_http_request_duration_seconds_bucket{{route="{_esc(r)}",le="{b}"}} {cum}')
        cum += counts[-1]
        out.append(f'jasper_http_request_duration_seconds_bucket{{route="{_esc(r)}",le="+Inf"}} {cum}')
        out.append(f'jasper_http_request_duration_seconds_sum{{route="{_esc(r)}"}} {_sum[r]:.6f}')
        out.append(f'jasper_http_request_duration_seconds_count{{route="{_esc(r)}"}} {cum}')
    out += ["# TYPE jasper_slo_sli gauge", "# TYPE jasper_slo_error_budget_remaining gauge"]
    for s in (await slo_status_async())["slos"]:
        if s["sli"] is not None:
            out.append(f'jasper_slo_sli{{slo="{s["slo"]}"}} {s["sli"]}')
            out.append(f'jasper_slo_error_budget_remaining{{slo="{s["slo"]}"}} {s["budget_remaining"]}')
    out += ["# TYPE jasper_process_uptime_seconds gauge", f"jasper_process_uptime_seconds {int(time.time() - STARTED)}"]
    try:  # business gauges from Postgres; metrics must never fail the scrape
        from memory.db import aio
        for r in await aio.fetch("SELECT agent, COALESCE(SUM(input_tokens+output_tokens),0) AS t, COALESCE(SUM(cost_usd),0) AS c FROM shared.llm_ledger "
                                 "WHERE ts >= date_trunc('day', now()) GROUP BY agent"):
            out.append(f'jasper_llm_tokens_today{{agent="{_esc(r["agent"] or "")}"}} {int(r["t"])}')
            out.append(f'jasper_llm_cost_usd_today{{agent="{_esc(r["agent"] or "")}"}} {float(r["c"]):.6f}')
        for r in await aio.fetch("SELECT slug, calls, errors, thumbs_up, thumbs_down FROM shared.bot_stats"):
            for k in ("calls", "errors", "thumbs_up", "thumbs_down"):
                out.append(f'jasper_bot_{k}_total{{bot="{_esc(r["slug"])}"}} {r[k]}')
        n = await aio.fetch("SELECT count(*) AS n FROM shared.hitl_requests WHERE status='pending'")
        out.append(f"jasper_hitl_pending {n[0]['n']}")
    except Exception:
        out.append("# business gauges unavailable")
    return "\n".join(out) + "\n"
