"""Bot management (aliased at /api/v1/bots): create/update/disable bots at runtime, list roster, message a bot."""
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


@router.put("/{slug}/settings")
async def put_settings(slug: str, body: SettingsIn):
    """Per-bot runtime settings. Fields sent as null/empty are reset to default (so the UI sends the whole form)."""
    st = await orgchart.set_settings(slug, body.model_dump())
    await cache.invalidate("org_tree")
    return {"slug": slug, "settings": st}


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
