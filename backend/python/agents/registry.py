"""Hot-pluggable bot registry backed by shared.bot_definitions (spec §2 "plug-and-play").

Definitions are read from Postgres on every reload; create/update/disable call reload() so changes take effect
without a restart. Built-in persona agents (agents.roster) are exposed through the same roster via an adapter.
"""
import json
from dataclasses import dataclass, field

from core import finops
from core.eventbus import announce
from core.llm.registry import get_router
from core.llm.types import LLMRequest
from memory.db import aio


@dataclass
class BotDef:
    slug: str
    display_name: str
    role_title: str
    crew: str
    prompt: str
    reports_to: str = "jasper"
    tools: list = field(default_factory=list)
    model_policy: dict = field(default_factory=lambda: {"default_tier": "standard"})
    memory_namespace: str = ""
    lifecycle: str = "probation"
    enabled: bool = True

    def public(self) -> dict:
        return {**self.__dict__, "source": "dynamic"}


class BotRegistry:
    def __init__(self):
        self._bots: dict[str, BotDef] = {}

    async def reload(self) -> None:
        rows = await aio.fetch("SELECT * FROM shared.bot_definitions ORDER BY slug")
        self._bots = {}
        for r in rows:
            d = dict(r)
            d["tools"], d["model_policy"] = json.loads(d["tools"]), json.loads(d["model_policy"])
            for k in ("created_at", "updated_at"):
                d.pop(k)
            b = BotDef(**d)
            self._bots[b.slug] = b

    async def upsert(self, b: BotDef) -> BotDef:
        b.memory_namespace = b.memory_namespace or f"bot.{b.slug}"
        await aio.execute(
            """INSERT INTO shared.bot_definitions
               (slug, display_name, role_title, crew, reports_to, prompt, tools, model_policy, memory_namespace, lifecycle, enabled)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)
               ON CONFLICT (slug) DO UPDATE SET display_name=$2, role_title=$3, crew=$4, reports_to=$5, prompt=$6,
                 tools=$7::jsonb, model_policy=$8::jsonb, memory_namespace=$9, lifecycle=$10, enabled=$11, updated_at=now()""",
            b.slug, b.display_name, b.role_title, b.crew, b.reports_to, b.prompt, json.dumps(b.tools),
            json.dumps(b.model_policy), b.memory_namespace, b.lifecycle, b.enabled,
        )
        await self.reload()
        announce(b.slug, "idle" if b.enabled else "deprecated", bubble=b.role_title)
        return b

    async def disable(self, slug: str) -> bool:
        if slug not in self._bots:
            return False
        await aio.execute("UPDATE shared.bot_definitions SET enabled=false, updated_at=now() WHERE slug=$1", slug)
        await self.reload()
        announce(slug, "deprecated", reason="disabled")
        return True

    def get(self, slug: str) -> BotDef | None:
        return self._bots.get(slug)

    def routable(self, slug: str) -> BotDef | None:
        b = self._bots.get(slug)
        return b if b and b.enabled else None

    def roster(self) -> list[dict]:
        from agents.registry_adapter import builtin_roster
        return builtin_roster() + [b.public() for b in self._bots.values()]

    async def message(self, slug: str, text: str) -> dict:
        b = self.routable(slug)
        if b is None:
            raise LookupError(slug)
        router = await get_router()
        announce(slug, "working", bubble=text[:100])
        try:
            with finops.attribute(slug, b.crew):
                res = await router.complete(LLMRequest(system=b.prompt, messages=[{"role": "user", "content": text}],
                                                        tier=b.model_policy.get("default_tier", "standard")))
        except Exception as e:
            announce(slug, "error", reason=str(e))
            raise
        announce(slug, "idle")
        return {"slug": slug, "reply": res.text, "usage": res.usage.model_dump()}


registry = BotRegistry()
