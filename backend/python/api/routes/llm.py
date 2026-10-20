"""LLM API (aliased /api/v1/llm): completion through the tiered router + provider/model/routing management.
API keys are write-only: they go to the OS vault and are never returned."""
import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core import vault
from core.llm import registry
from core.llm.types import LLMRequest, Tier
from memory.db import aio

router = APIRouter()


class CompleteIn(BaseModel):
    prompt: str
    system: str = ""
    tier: Tier = "standard"
    max_tokens: int = 512


@router.post("/complete")
async def complete(body: CompleteIn):
    r = await registry.get_router()
    res = await r.complete(LLMRequest(messages=[{"role": "user", "content": body.prompt}], system=body.system,
                                      tier=body.tier, max_tokens=body.max_tokens))
    return res.model_dump()


class ProviderIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,40}$")
    name: str
    kind: str = Field(pattern=r"^(openai_compat|anthropic|cli)$")
    base_url: str | None = None  # CLI kind: the command line
    api_key: str | None = None  # write-only
    local: bool = False
    enabled: bool = True


class ModelIn(BaseModel):
    provider: str
    model_id: str
    label: str | None = None


class RoutingIn(BaseModel):
    chain: list[dict]  # [{"provider": slug, "model": model_id}, ...]


@router.get("/providers")
async def providers():
    await registry.seed_if_empty()
    rows = await aio.fetch("SELECT slug, name, kind, base_url, secret_name, secret_env, enabled, local FROM shared.llm_providers ORDER BY slug")
    models = await aio.fetch("SELECT provider, model_id, label, enabled FROM shared.llm_models ORDER BY provider, model_id")
    out = []
    for r in rows:
        d = dict(r)
        d["has_key"] = bool(registry._secret(r))
        d.pop("secret_name"), d.pop("secret_env")
        d["models"] = [dict(m) for m in models if m["provider"] == r["slug"]]
        out.append(d)
    return {"providers": out}


@router.put("/providers")
async def put_provider(body: ProviderIn):
    secret_name = f"LLM_{body.slug}_KEY" if body.api_key else None
    if body.api_key:
        vault.set(secret_name, body.api_key)
    await aio.execute(
        """INSERT INTO shared.llm_providers (slug, name, kind, base_url, secret_name, enabled, local)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (slug) DO UPDATE SET name=$2, kind=$3, base_url=$4, enabled=$6, local=$7,
             secret_name=COALESCE($5, shared.llm_providers.secret_name)""",
        body.slug, body.name, body.kind, body.base_url, secret_name, body.enabled, body.local)
    registry.invalidate()
    return {"slug": body.slug, "saved": True}


@router.delete("/providers/{slug}")
async def delete_provider(slug: str):
    n = await aio.execute("DELETE FROM shared.llm_providers WHERE slug=$1", slug)
    registry.invalidate()
    if n.endswith(" 0"):
        raise HTTPException(404, "unknown provider")
    return {"slug": slug, "deleted": True}


@router.put("/models")
async def put_model(body: ModelIn):
    if not re.fullmatch(r"[\w./:@-]{1,120}", body.model_id):
        raise HTTPException(422, "bad model id")
    try:
        await aio.execute("INSERT INTO shared.llm_models (provider, model_id, label) VALUES ($1,$2,$3) "
                          "ON CONFLICT (provider, model_id) DO UPDATE SET label=$3", body.provider, body.model_id, body.label or body.model_id)
    except Exception:
        raise HTTPException(404, "unknown provider")
    return {"saved": True}


@router.delete("/models/{provider}/{model_id:path}")
async def delete_model(provider: str, model_id: str):
    await aio.execute("DELETE FROM shared.llm_models WHERE provider=$1 AND model_id=$2", provider, model_id)
    registry.invalidate()
    return {"deleted": True}


@router.get("/routing")
async def get_routing():
    await registry.seed_if_empty()
    return {r["tier"]: json.loads(r["chain"]) for r in await aio.fetch("SELECT tier, chain FROM shared.llm_routing")}


@router.put("/routing/{tier}")
async def put_routing(tier: Tier, body: RoutingIn):
    known = {(m["provider"], m["model_id"]) for m in await aio.fetch("SELECT provider, model_id FROM shared.llm_models")}
    for e in body.chain:
        if (e.get("provider"), e.get("model")) not in known:
            raise HTTPException(422, f"unknown provider/model: {e}")
    await aio.execute("INSERT INTO shared.llm_routing (tier, chain) VALUES ($1,$2::jsonb) "
                      "ON CONFLICT (tier) DO UPDATE SET chain=$2::jsonb", tier, json.dumps(body.chain))
    registry.invalidate()
    return {"tier": tier, "chain": body.chain}


@router.post("/providers/{slug}/test")
async def test(slug: str, model: str):
    try:
        return await registry.test_provider(slug, model)
    except LookupError:
        raise HTTPException(404, "unknown provider")


# ── model catalogue, tests, comparison ───────────────────────────────────────────────────────────────
class TestIn(BaseModel):
    provider: str
    model: str


class CompareIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    models: list[str] = Field(min_length=2, max_length=3)  # "provider:model"
    max_tokens: int = Field(default=400, ge=16, le=2000)


class VoteIn(BaseModel):
    winner: str
    others: list[str] = []


def _tests_key():
    from core import cache
    return cache.k("model_tests")


def _votes_key():
    from core import cache
    return cache.k("model_votes")


@router.get("/catalog")
async def catalog():
    """Every registered model with price (per 1M tokens), 7-day usage, the last test result and the comparison win/loss record."""
    from core import finops
    from memory.redis import layer
    await registry.seed_if_empty()
    prices = await finops._load_prices()
    rows = await aio.fetch("SELECT p.slug, p.name, p.kind, p.local, (p.secret_name IS NOT NULL OR p.secret_env IS NOT NULL OR p.kind='cli') AS usable, m.model_id, m.enabled "
                           "FROM shared.llm_models m JOIN shared.llm_providers p ON p.slug = m.provider WHERE p.enabled ORDER BY p.slug, m.model_id")
    stats = {r["model"]: r for r in await aio.fetch("SELECT model, count(*) AS calls, round(avg(latency_ms)) AS avg_ms, COALESCE(sum(cost_usd),0) AS cost FROM shared.llm_ledger WHERE ts > now() - interval '7 days' GROUP BY model")}
    try:
        tests = {k: json.loads(v) for k, v in (await layer.client().hgetall(_tests_key())).items()}
        votes = await layer.client().hgetall(_votes_key())
    except Exception:
        tests, votes = {}, {}
    out = []
    for r in rows:
        key = f"{r['slug']}:{r['model_id']}"
        pr = prices.get(r["model_id"]) or finops._price(r["model_id"]) or {}
        st = stats.get(r["model_id"])
        out.append({"key": key, "provider": r["slug"], "provider_name": r["name"], "kind": r["kind"], "model": r["model_id"], "enabled": r["enabled"],
                    "input_per_m": pr.get("input"), "output_per_m": pr.get("output"),
                    "calls_7d": int(st["calls"]) if st else 0, "avg_latency_ms": int(st["avg_ms"]) if st else None, "cost_7d": float(st["cost"]) if st else 0.0,
                    "last_test": tests.get(key), "wins": int(votes.get(key + "|w", 0)), "losses": int(votes.get(key + "|l", 0))})
    return {"models": out}


@router.post("/catalog/test")
async def catalog_test(body: TestIn):
    from memory.redis import layer
    try:
        res = await registry.test_provider(body.provider, body.model)
    except LookupError:
        raise HTTPException(404, "unknown provider")
    import time
    res["at"] = time.time()
    try:
        await layer.client().hset(_tests_key(), f"{body.provider}:{body.model}", json.dumps(res))
    except Exception:
        pass
    return res


@router.post("/compare")
async def compare(body: CompareIn):
    """Same prompt to 2-3 specific models at once (no fallback, so each answer really comes from the model named)."""
    import asyncio
    import time

    from core import finops
    prices = await finops._load_prices()

    async def one(key: str):
        prov, _, model = key.partition(":")
        t0 = time.perf_counter()
        try:
            res = await registry.complete_pinned(prov, model, LLMRequest(messages=[{"role": "user", "content": body.prompt}], max_tokens=body.max_tokens, tier="standard"))
            return {"key": key, "ok": True, "text": res.text, "ms": int((time.perf_counter() - t0) * 1000), "input_tokens": res.usage.input_tokens,
                    "output_tokens": res.usage.output_tokens, "cost_usd": finops.cost_of(res.usage, prices)}
        except Exception as e:
            return {"key": key, "ok": False, "error": str(e)[:160], "ms": int((time.perf_counter() - t0) * 1000)}
    return {"results": await asyncio.gather(*(one(k) for k in body.models))}


@router.post("/compare/vote")
async def compare_vote(body: VoteIn):
    from memory.redis import layer
    try:
        p = layer.client().pipeline()
        p.hincrby(_votes_key(), body.winner + "|w", 1)
        for o in body.others:
            p.hincrby(_votes_key(), o + "|l", 1)
        await p.execute()
    except Exception:
        raise HTTPException(503, "vote store unavailable")
    return {"ok": True}
