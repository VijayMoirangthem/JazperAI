"""Bot management (aliased at /api/v1/bots): create/update/disable bots at runtime, list roster, message a bot."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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
