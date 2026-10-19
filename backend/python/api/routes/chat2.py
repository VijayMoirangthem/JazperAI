"""Chat v2 (aliased /api/v1/chat2): NDJSON streaming for 1-on-1 and room conversations.

Events (one JSON object per line):
  {"t":"speaker","slug":..}  {"t":"delta","slug":..,"text":..}  {"t":"done","slug":..,"usage":{..}}  {"t":"error","message":..}
Room events also start with {"t":"route","slugs":[..],"source":..,"confidence":..}.
"""
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.decision import decide
from agents.registry import registry
from core import directory, finops
from core.eventbus import announce
from core.llm.registry import get_router
from core.llm.types import LLMRequest, Usage

router = APIRouter()
MAX_HISTORY = 20


class Attachment(BaseModel):
    name: str
    mime: str = ""
    text: str | None = None  # inlined for text-like files


class Turn(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    text: str
    slug: str = "jasper"
    history: list[Turn] = []
    attachments: list[Attachment] = []
    tier: str | None = None


class RoomIn(BaseModel):
    room: str
    text: str
    members: list[str] = ["jasper"]
    history: list[Turn] = []
    attachments: list[Attachment] = []


def _persona(slug: str) -> tuple[str, str]:
    b = registry.routable(slug)
    if b:
        return b.prompt, b.model_policy.get("default_tier", "standard")
    d = next((x for x in directory.bots() if x.id == slug), None)
    title = d.role_title if d else slug
    return (f"You are {slug}, {title} at Sir Jasper AI, a personal-to-enterprise agentic OS. Be concise and concrete.", "standard")


def _user_content(text: str, atts: list[Attachment]) -> str:
    extra = "".join(f"\n\n[Attachment: {a.name}]\n{a.text[:20000]}" if a.text else f"\n\n[Attachment: {a.name} ({a.mime or 'binary'}), not readable as text]"
                    for a in atts)
    return text + extra


def _line(o: dict) -> str:
    return json.dumps(o) + "\n"


async def _speak(r, slug: str, history: list[Turn], text: str, atts: list[Attachment], tier: str | None = None) -> AsyncIterator[str]:
    system, default_tier = _persona(slug)
    msgs = [{"role": t.role, "content": t.content} for t in history[-MAX_HISTORY:]] + [{"role": "user", "content": _user_content(text, atts)}]
    yield _line({"t": "speaker", "slug": slug})
    announce(slug, "working", bubble=text[:100])
    try:
        b = registry.routable(slug)
        with finops.attribute(slug, b.crew if b else None):
            async for item in r.stream(LLMRequest(system=system, messages=msgs, tier=tier or default_tier, max_tokens=1024)):
                if isinstance(item, Usage):
                    yield _line({"t": "done", "slug": slug, "usage": item.model_dump()})
                else:
                    yield _line({"t": "delta", "slug": slug, "text": item})
    except Exception as e:
        announce(slug, "error", reason=str(e))
        yield _line({"t": "error", "slug": slug, "message": str(e)[:200]})
        return
    announce(slug, "idle")


@router.post("/stream")
async def stream(body: ChatIn):
    async def gen():
        r = await get_router()
        async for line in _speak(r, body.slug, body.history, body.text, body.attachments, body.tier):
            yield line
    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.post("/room")
async def room(body: RoomIn):
    async def gen():
        r = await get_router()
        members = [{"slug": s, "role_title": _persona(s)[0][:80]} for s in body.members]
        route = await decide(r, body.text, members, lead=body.members[0] if body.members else "jasper")
        yield _line({"t": "route", **route})
        for slug in route["slugs"]:
            async for line in _speak(r, slug, body.history, f"[{body.room}] {body.text}", body.attachments):
                yield line
    return StreamingResponse(gen(), media_type="application/x-ndjson")
