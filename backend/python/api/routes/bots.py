"""Bot management (aliased at /api/v1/bots): create/update/disable bots at runtime, list roster, message a bot."""
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents import orgchart
from core import cache
from agents.registry import BotDef, registry

router = APIRouter()


class BotIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{1,62}$")
    display_name: str
    role_title: str
    crew: str
    prompt: str
    reports_to: str = "jasper"
    tools: list[str] = []
    model_policy: dict = {"default_tier": "standard"}


class MessageIn(BaseModel):
    text: str


@router.get("/")
async def roster():
    await registry.reload()
    return {"bots": registry.roster()}


@router.put("/")
async def upsert(body: BotIn):
    b = await registry.upsert(BotDef(**body.model_dump()))
    return b.public()


@router.delete("/{slug}")
async def disable(slug: str):
    if not await registry.disable(slug):
        raise HTTPException(404, "unknown bot")
    return {"slug": slug, "enabled": False}


@router.post("/{slug}/message")
async def message(slug: str, body: MessageIn):
    try:
        return await registry.message(slug, body.text)
    except LookupError:
        raise HTTPException(404, "bot not found or disabled")


# ── organisation: tree, ID card, placement, prompt, rating ─────────────────────────────────────────────
class PlaceIn(BaseModel):
    org_group: str | None = None
    department: str | None = None
    position: str | None = None
    sort_order: int | None = None


class OrderItem(PlaceIn):
    slug: str


class PromptIn(BaseModel):
    prompt: str | None = None  # empty/None resets to the default


class RateIn(BaseModel):
    up: bool


class GroupIn(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9_]{2,40}$")
    label: str
    kind: str = "company"


@router.get("/tree")
async def tree():
    return await cache.cached("org_tree", 3, orgchart.tree)


@router.put("/order")
async def reorder(items: list[OrderItem]):
    for it in items:
        await orgchart.place(it.slug, it.org_group, it.department, it.position, it.sort_order)
    await cache.invalidate("org_tree")
    return {"updated": len(items)}


@router.post("/groups")
async def add_group(body: GroupIn):
    from memory.db import aio
    await aio.execute("INSERT INTO shared.org_groups(id,label,kind) VALUES($1,$2,$3) ON CONFLICT (id) DO UPDATE SET label=$2", body.id, body.label, body.kind)
    return body


class SettingsIn(BaseModel):
    model: str | None = None
    tier: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    memory: bool | None = None
    tools_off: list[str] | None = None
    memory_scopes: dict | None = None
    style: str | None = None
    language: str | None = None
    daily_token_cap: int | None = None


@router.put("/{slug}/settings")
async def put_settings(slug: str, body: SettingsIn):
    """Per-bot runtime settings. Fields sent as null/empty are reset to default (so the UI sends the whole form)."""
    st = await orgchart.set_settings(slug, body.model_dump(exclude_unset=True))  # unsent fields stay as they are; an explicit null resets one
    await cache.invalidate("org_tree")
    return {"slug": slug, "settings": st}


class DuplicateIn(BaseModel):
    new_slug: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{1,62}$")
    display_name: str | None = None


class ImportIn(BaseModel):
    bot: dict
    settings: dict = {}
    org: dict = {}


@router.post("/{slug}/enable")
async def enable(slug: str):
    from memory.db import aio
    if not registry.get(slug):
        raise HTTPException(404, "only dynamic bots can be re-enabled")
    await aio.execute("UPDATE shared.bot_definitions SET enabled=true, updated_at=now() WHERE slug=$1", slug)
    await registry.reload()
    await cache.invalidate("org_tree")
    return {"slug": slug, "enabled": True}


@router.post("/{slug}/duplicate")
async def duplicate(slug: str, body: DuplicateIn):
    """Copy a bot (any source) into a new dynamic bot with the same prompt, tier, settings and placement."""
    from api.routes.chat2 import _persona_base
    src = await orgchart.card(slug)
    if not src:
        raise HTTPException(404, "unknown bot")
    if registry.get(body.new_slug) or any(r["slug"] == body.new_slug for r in registry.roster()):
        raise HTTPException(409, "that slug is taken")
    prompt = src["prompt"] or _persona_base(slug)[0]
    await registry.upsert(BotDef(slug=body.new_slug, display_name=body.display_name or f"{src['display_name']} copy", role_title=src["role_title"], crew=src["crew"],
                                 prompt=prompt, reports_to=src.get("reports_to") or "jasper", tools=list(src.get("tools") or []), model_policy={"default_tier": src.get("tier", "standard")}, lifecycle="probation"))
    await orgchart.place(body.new_slug, src["group"], src["department"], src["position"])
    if src.get("settings"):
        await orgchart.set_settings(body.new_slug, dict(src["settings"]))
    await cache.invalidate("org_tree")
    return await orgchart.card(body.new_slug)


@router.get("/{slug}/export")
async def export_bot(slug: str):
    c = await orgchart.card(slug)
    if not c:
        raise HTTPException(404, "unknown bot")
    keep = ("slug", "display_name", "role_title", "crew", "reports_to", "tools", "tier", "prompt")
    return {"format": "jasper-bot/1", "bot": {k: c.get(k) for k in keep}, "settings": c.get("settings", {}),
            "org": {"org_group": c["group"], "department": c["department"], "position": c["position"]}}


@router.post("/import")
async def import_bot(body: ImportIn):
    b = body.bot
    slug = str(b.get("slug", ""))
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,62}", slug):
        raise HTTPException(422, "bad slug")
    if any(r["slug"] == slug for r in registry.roster()) and not registry.get(slug):
        raise HTTPException(409, "a built-in bot with this slug exists; change the slug")
    await registry.upsert(BotDef(slug=slug, display_name=str(b.get("display_name") or slug), role_title=str(b.get("role_title", "")), crew=str(b.get("crew", "personal")),
                                 prompt=str(b.get("prompt", "")), reports_to=str(b.get("reports_to") or "jasper"), tools=list(b.get("tools") or []),
                                 model_policy={"default_tier": b.get("tier", "standard")}, lifecycle="probation"))
    if body.org:
        await orgchart.place(slug, body.org.get("org_group"), body.org.get("department"), body.org.get("position"))
    if body.settings:
        await orgchart.set_settings(slug, body.settings)
    await cache.invalidate("org_tree")
    return await orgchart.card(slug)


class EvalIn(BaseModel):
    kind: str = Field(pattern="^(clearance|pip)$")


@router.post("/{slug}/evaluate")
async def evaluate(slug: str, body: EvalIn):
    """Start a clearance (interview + benchmark) or a performance-improvement plan in the background; results land in the evaluation history."""
    import asyncio

    from agents import lifecycle
    if not any(r["slug"] == slug for r in registry.roster()):
        raise HTTPException(404, "unknown bot")
    asyncio.create_task(lifecycle.clear(slug) if body.kind == "clearance" else lifecycle.pip(slug))
    return {"started": body.kind, "slug": slug, "note": "takes a few minutes; watch the ID card history"}


@router.get("/{slug}/evaluations")
async def evaluations(slug: str):
    from agents import lifecycle
    return {"evaluations": await lifecycle.history(slug, 20)}


@router.get("/{slug}/card")
async def card(slug: str):
    c = await orgchart.card(slug)
    if not c:
        raise HTTPException(404, "unknown bot")
    return c


@router.put("/{slug}/org")
async def place(slug: str, body: PlaceIn):
    await orgchart.place(slug, **body.model_dump())
    await cache.invalidate("org_tree")
    return await orgchart.card(slug)


@router.put("/{slug}/prompt")
async def set_prompt(slug: str, body: PromptIn):
    await orgchart.set_prompt(slug, body.prompt)
    await cache.invalidate("org_tree")
    return {"slug": slug, "override": bool(body.prompt)}


@router.post("/{slug}/rate")
async def rate(slug: str, body: RateIn):
    await orgchart.rate(slug, body.up)
    await cache.invalidate("org_tree")
    return (await orgchart.card(slug)) or {}
