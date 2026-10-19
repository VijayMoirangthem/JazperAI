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
