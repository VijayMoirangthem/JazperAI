import pytest

from core import finops
from core.llm.providers import Provider
from core.llm.registry import TIERS, TieredRouter
from core.llm.router import LLMRouter
from core.llm.types import LLMRequest, LLMResult, Usage
from memory.db import aio

pytestmark = pytest.mark.db


class Fixed(Provider):
    def __init__(self, name, tokens=100):
        self.name, self.tokens, self.calls = name, tokens, 0

    async def complete(self, req):
        self.calls += 1
        return LLMResult(text="ok", usage=Usage(provider=self.name, model=f"{self.name}-{req.tier}", input_tokens=self.tokens, output_tokens=0))


def router(p):
    return TieredRouter({t: LLMRouter([p]) for t in TIERS})


@pytest.fixture(autouse=True)
async def clean():
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    await aio.execute("DELETE FROM shared.llm_ledger WHERE agent LIKE 'fo-%'")
    await aio.execute("DELETE FROM shared.budgets WHERE scope LIKE '%fo-%'")
    yield
    await aio.execute("DELETE FROM shared.llm_ledger WHERE agent LIKE 'fo-%'")
    await aio.execute("DELETE FROM shared.budgets WHERE scope LIKE '%fo-%'")
    await aio.close_pool()


REQ = LLMRequest(messages=[{"role": "user", "content": "x"}], tier="frontier")


async def test_ledger_totals_equal_provider_usage():
    p, r = Fixed("fp", 120), None
    r = router(p)
    with finops.attribute("fo-a", "baeit"):
        for _ in range(3):
            await r.complete(REQ)
    row = (await aio.fetch("SELECT COUNT(*) AS n, SUM(input_tokens) AS t, MIN(division) AS d FROM shared.llm_ledger WHERE agent='fo-a'"))[0]
    assert (row["n"], row["t"], row["d"]) == (3, 360, "baeit")


async def test_hard_cap_halts_within_one_call():
    p = Fixed("fp", 100)
    r = router(p)
    await finops.set_budget("agent:fo-b", None, 150)
    with finops.attribute("fo-b"):
        await r.complete(REQ)  # 100 used (< 150)
        await r.complete(REQ)  # 200 used now (>= 150): the overshoot is at most one call
        with pytest.raises(finops.BudgetExceeded):
            await r.complete(REQ)
    assert p.calls == 2


async def test_soft_cap_steps_tier_down():
    p = Fixed("fp", 100)
    r = router(p)
    await finops.set_budget("agent:fo-c", 150, None)
    with finops.attribute("fo-c"):
        await r.complete(REQ)
        await r.complete(REQ)  # reaches the soft cap
        res = await r.complete(REQ)
    assert res.usage.model == "fp-standard"  # frontier -> standard


async def test_summary_and_endpoint():
    r = router(Fixed("fp", 50))
    with finops.attribute("fo-d", "boardmint"):
        await r.complete(REQ)
    s = await finops.summary()
    assert any(x["k"] == "boardmint" for x in s["by_division"]) and s["forecast"]["tokens_per_hour"] >= 0
    from fastapi.testclient import TestClient
    from main import app
    c = TestClient(app, base_url="http://localhost")
    assert c.put("/api/v1/finops/budgets", json={"scope": "agent:fo-d", "daily_hard": 10}).status_code == 200
    assert c.get("/api/v1/finops/summary").json()["today"]["calls"] >= 1


async def test_entered_prices_drive_cost():
    await finops.set_price("priced-model", 2.0, 10.0, "test")
    p = Fixed("fp", 1_000_000)
    r = router(p)
    with finops.attribute("fo-p"):
        await r.complete(LLMRequest(messages=[{"role": "user", "content": "x"}], tier="light"))  # model fp-light: unpriced
    unpriced = (await aio.fetch("SELECT cost_usd FROM shared.llm_ledger WHERE agent='fo-p'"))[0]["cost_usd"]
    assert unpriced is None
    await finops.set_price("fp-light", 1.0, 3.0, "test")
    with finops.attribute("fo-p"):
        await r.complete(LLMRequest(messages=[{"role": "user", "content": "x"}], tier="light"))
    costs = [float(x["cost_usd"]) for x in await aio.fetch("SELECT cost_usd FROM shared.llm_ledger WHERE agent='fo-p' AND cost_usd IS NOT NULL")]
    assert costs == [1.0]  # 1M input tokens at $1/M
    await aio.execute("DELETE FROM shared.model_prices WHERE model IN ('priced-model','fp-light')")
