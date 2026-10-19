"""FinOps (spec §11): usage ledger, per-agent/division/global token budgets, hard-cap circuit breaker, soft-cap tier step-down,
burn-rate forecast. Agent identity travels in a ContextVar so any LLM call site can be attributed without signature changes."""
import contextvars
from contextlib import contextmanager
from pathlib import Path

import structlog
import yaml

from core.llm.types import Usage
from memory.db import aio

log = structlog.get_logger()
_ctx: contextvars.ContextVar[tuple[str, str]] = contextvars.ContextVar("finops_ctx", default=("system", "create_origins"))
DIVISION_OF_CREW = {"baeit": "baeit", "boardmint": "boardmint"}
DOWNGRADE = {"frontier": "standard", "standard": "light"}
_pricing = None


class BudgetExceeded(RuntimeError):
    def __init__(self, scope: str, kind: str):
        super().__init__(f"{kind} token budget exhausted for {scope}")
        self.scope, self.kind = scope, kind


@contextmanager
def attribute(agent: str, crew: str | None = None, division: str | None = None):
    tok = _ctx.set((agent, division or DIVISION_OF_CREW.get(crew or "", "create_origins")))
    try:
        yield
    finally:
        try:
            _ctx.reset(tok)
        except ValueError:  # generator closed from another context (client disconnect): nothing to restore
            pass


def current() -> tuple[str, str]:
    return _ctx.get()


def _price(model: str) -> dict | None:
    global _pricing
    if _pricing is None:
        _pricing = yaml.safe_load((Path(__file__).parent / "pricing.yaml").read_text())["models"]
    return _pricing.get(model)


def cost_of(u: Usage) -> float | None:
    p = _price(u.model)
    if not p or p.get("input") is None or p.get("output") is None:
        return None
    return (u.input_tokens * p["input"] + u.output_tokens * p["output"]) / 1_000_000


async def record(u: Usage, tier: str | None = None) -> None:
    agent, division = current()
    try:
        await aio.execute(
            "INSERT INTO shared.llm_ledger (agent, division, provider, model, tier, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", agent, division, u.provider, u.model, tier, u.input_tokens, u.output_tokens,
            u.cache_read_tokens, u.cache_write_tokens, cost_of(u), u.latency_ms)
    except Exception as e:  # accounting must never break a user request
        log.warning("finops record failed", error=str(e)[:120])


async def used_today(scope_sql: str, arg: str | None = None) -> int:
    q = "SELECT COALESCE(SUM(input_tokens + output_tokens),0) AS t FROM shared.llm_ledger WHERE ts >= date_trunc('day', now())" + scope_sql
    rows = await aio.fetch(q, *([arg] if arg else []))
    return int(rows[0]["t"])


async def check(tier: str) -> str:
    """Raise BudgetExceeded at a hard cap; return the (possibly downgraded) tier at a soft cap."""
    agent, division = current()
    scopes = [(f"agent:{agent}", " AND agent=$1", agent), (f"division:{division}", " AND division=$1", division), ("global", "", None)]
    out = tier
    for scope, sql, arg in scopes:
        row = await aio.fetch("SELECT daily_soft, daily_hard FROM shared.budgets WHERE scope=$1", scope)
        if not row:
            continue
        used = await used_today(sql, arg)
        if row[0]["daily_hard"] is not None and used >= row[0]["daily_hard"]:
            raise BudgetExceeded(scope, "hard")
        if row[0]["daily_soft"] is not None and used >= row[0]["daily_soft"]:
            out = DOWNGRADE.get(out, out)
            log.warning("soft budget cap: tier stepped down", scope=scope, tier=out)
    return out


async def set_budget(scope: str, daily_soft: int | None, daily_hard: int | None) -> None:
    await aio.execute("INSERT INTO shared.budgets (scope, daily_soft, daily_hard) VALUES ($1,$2,$3) "
                      "ON CONFLICT (scope) DO UPDATE SET daily_soft=$2, daily_hard=$3, updated_at=now()", scope, daily_soft, daily_hard)


async def summary() -> dict:
    base = "FROM shared.llm_ledger WHERE ts >= date_trunc('day', now())"
    tot = (await aio.fetch(f"SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cache_read_tokens),0) AS cr, COALESCE(SUM(cost_usd),0) AS cost {base}"))[0]
    by = lambda col: aio.fetch(f"SELECT {col} AS k, COUNT(*) AS calls, SUM(input_tokens + output_tokens) AS tokens {base} GROUP BY {col} ORDER BY tokens DESC")  # noqa: E731
    last3h = (await aio.fetch("SELECT COALESCE(SUM(input_tokens + output_tokens),0) AS t FROM shared.llm_ledger WHERE ts >= now() - interval '3 hours'"))[0]["t"]
    per_hour = float(last3h) / 3
    return {
        "today": {"calls": tot["calls"], "input_tokens": int(tot["i"]), "output_tokens": int(tot["o"]), "cache_read_tokens": int(tot["cr"]),
                  "cost_usd": float(tot["cost"]) if _pricing_known() else None},
        "by_division": [dict(r) for r in await by("division")], "by_agent": [dict(r) for r in await by("agent")][:20],
        "by_model": [dict(r) for r in await by("model")],
        "forecast": {"tokens_per_hour": round(per_hour), "tokens_next_24h": round(per_hour * 24)},
        "budgets": [dict(r) for r in await aio.fetch("SELECT scope, daily_soft, daily_hard FROM shared.budgets ORDER BY scope")],
    }


def _pricing_known() -> bool:
    _price("")
    return any(v.get("input") is not None for v in (_pricing or {}).values())
