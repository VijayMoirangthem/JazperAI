"""DB-backed provider/model registry + tiered router. Secrets live only in the vault (or a named env var for the seeded
provider); no API response ever contains a key."""
import json

import structlog

from core import finops, vault
from core.telemetry import span
from core.config import settings
from core.llm.providers import AnthropicProvider, OpenAICompatProvider, Provider, StubProvider
from core.llm.router import LLMRouter
from core.llm.types import LLMRequest, LLMResult, Usage
from memory.db import aio

log = structlog.get_logger()
TIERS = ("light", "standard", "frontier")
_cached: "TieredRouter | None" = None


def _secret(row) -> str:
    key = None
    if row["secret_name"]:
        try:
            key = vault.get(row["secret_name"])
        except vault.VaultUnavailable:
            key = None
    if not key and row["secret_env"]:
        key = getattr(settings, row["secret_env"], "") or ""
    return key or ""


def _make(row, model: str, tier: str) -> Provider:
    models = {t: model for t in TIERS}
    if row["kind"] == "anthropic":
        return AnthropicProvider(_secret(row), row["base_url"] or None, models=models)
    if row["kind"] == "cli":
        from core.llm.cli_engine import CliProvider
        return CliProvider(row["slug"], row["base_url"] or "", model)
    p = OpenAICompatProvider(row["base_url"], _secret(row), models, name=row["slug"], local=row["local"])
    return p


class TieredRouter:
    """Per-tier fallback chains; each chain entry is a (provider, model) pair."""

    def __init__(self, routers: dict[str, LLMRouter]):
        self.routers = routers
        self._pins: dict[str, LLMRouter] = {}

    def _for(self, req: LLMRequest) -> LLMRouter:
        return self.routers.get(req.tier) or self.routers["standard"]

    async def _route(self, req: LLMRequest) -> LLMRouter:
        """Tier chain, or [pinned model] + tier chain when the bot has a model chosen (unknown/disabled pin falls back silently)."""
        if not req.pin or ":" not in req.pin:
            return self._for(req)
        key = f"{req.pin}|{req.tier}"
        if key not in self._pins:
            prov, _, model = req.pin.partition(":")
            rows = await aio.fetch("SELECT slug, kind, base_url, secret_name, secret_env, local FROM shared.llm_providers WHERE slug=$1 AND enabled", prov)
            if not rows:
                return self._for(req)
            base = self._for(req)
            self._pins[key] = LLMRouter([_make(rows[0], model, req.tier), *base.chain], attempts=2)
        return self._pins[key]

    async def complete(self, req: LLMRequest) -> LLMResult:
        tier = await finops.check(req.tier)  # raises BudgetExceeded at a hard cap; steps the tier down at a soft cap
        req = req.model_copy(update={"tier": tier})
        with span("llm.complete", tier=tier) as sp:
            res = await (await self._route(req)).complete(req)
            sp.set_attribute("llm.provider", res.usage.provider)
            sp.set_attribute("llm.model", res.usage.model)
            sp.set_attribute("llm.tokens.input", res.usage.input_tokens)
            sp.set_attribute("llm.tokens.output", res.usage.output_tokens)
        await finops.record(res.usage, tier)
        return res

    async def stream(self, req: LLMRequest):
        tier = await finops.check(req.tier)
        req = req.model_copy(update={"tier": tier})
        async for item in (await self._route(req)).stream(req):
            if isinstance(item, Usage):
                await finops.record(item, tier)
            yield item

    async def count_tokens(self, req: LLMRequest) -> int:
        return await self._for(req).count_tokens(req)


async def seed_if_empty() -> None:
    """First run: register the provider currently configured in .env (Groq today) and route all tiers through it."""
    if await aio.fetch("SELECT 1 FROM shared.llm_providers LIMIT 1"):
        return
    base = settings.AI_BASE_URL
    slug = "groq" if "groq.com" in base else "default"
    await aio.execute(
        "INSERT INTO shared.llm_providers (slug, name, kind, base_url, secret_env, local) VALUES ($1,$2,'openai_compat',$3,'AI_API_KEY',$4)",
        slug, slug.title(), base, "localhost" in base or "127.0.0.1" in base)
    models = {"light": "openai/gpt-oss-20b" if slug == "groq" else settings.LIGHT_MODEL, "standard": "qwen/qwen3.8-27b" if slug == "groq" else settings.AI_MODEL,
              "frontier": "openai/gpt-oss-120b" if slug == "groq" else settings.AI_MODEL}
    for tier, m in models.items():
        await aio.execute("INSERT INTO shared.llm_models (provider, model_id, label) VALUES ($1,$2,$2) ON CONFLICT DO NOTHING", slug, m)
        fallback = {"light": "qwen/qwen3.8-27b", "standard": "openai/gpt-oss-20b", "frontier": "qwen/qwen3.8-27b"}[tier] if slug == "groq" else None
        if fallback:  # limits are per model on Groq: a second model keeps a tier answering when the first is rate limited
            await aio.execute("INSERT INTO shared.llm_models (provider, model_id, label) VALUES ($1,$2,$2) ON CONFLICT DO NOTHING", slug, fallback)
        chain = [{"provider": slug, "model": m}] + ([{"provider": slug, "model": fallback}] if fallback else [])
        await aio.execute("INSERT INTO shared.llm_routing (tier, chain) VALUES ($1,$2::jsonb)", tier, json.dumps(chain))


async def build_router() -> TieredRouter:
    await seed_if_empty()
    provs = {r["slug"]: r for r in await aio.fetch("SELECT * FROM shared.llm_providers WHERE enabled")}
    routers: dict[str, LLMRouter] = {}
    for r in await aio.fetch("SELECT tier, chain FROM shared.llm_routing"):
        chain: list[Provider] = []
        for e in json.loads(r["chain"]):
            row = provs.get(e["provider"])
            if row is None or (row["local"] and not settings.EDGE_MODE and row["kind"] != "cli"):
                continue
            if row["kind"] != "cli" and not _secret(row) and not row["local"]:
                continue  # no key -> skip rather than fail every call
            chain.append(_make(row, e["model"], r["tier"]))
        routers[r["tier"]] = LLMRouter(chain or [StubProvider()])
    for t in TIERS:
        routers.setdefault(t, LLMRouter([StubProvider()]))
    return TieredRouter(routers)


async def get_router() -> TieredRouter:
    global _cached
    if _cached is None:
        _cached = await build_router()
    return _cached


def invalidate() -> None:
    global _cached
    _cached = None


async def test_provider(slug: str, model: str) -> dict:
    row = await aio.fetch("SELECT * FROM shared.llm_providers WHERE slug=$1", slug)
    if not row:
        raise LookupError(slug)
    p = _make(row[0], model, "standard")
    try:
        res = await p.complete(LLMRequest(messages=[{"role": "user", "content": "Reply with the single word: ok"}], max_tokens=8, tier="standard"))
        return {"ok": True, "latency_ms": res.usage.latency_ms, "reply": res.text[:40]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}
