"""Chat v2 (aliased /api/v1/chat2): NDJSON streaming for 1-on-1 and room conversations.

Events (one JSON object per line):
  {"t":"speaker","slug":..}  {"t":"delta","slug":..,"text":..}  {"t":"done","slug":..,"usage":{..}}  {"t":"error","message":..}
Room events also start with {"t":"route","slugs":[..],"source":..,"confidence":..}.
"""
import asyncio
import json
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents import discussion, jasper_tools, orgchart, workspaces
from agents.decision import decide
from agents.registry import registry
from core import directory, finops
from core.eventbus import announce
from core.llm.registry import get_router
from core.llm.types import LLMRequest, Usage
from memory import consolidate

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
    system, tier = _persona_base(slug)
    return system + orgchart.persona_suffix(slug), tier


def _persona_base(slug: str) -> tuple[str, str]:
    b = registry.routable(slug)
    if b:
        return orgchart.OVERRIDES.get(slug) or b.prompt, b.model_policy.get("default_tier", "standard")
    d = next((x for x in directory.bots() if x.id == slug), None)
    title = d.role_title if d else slug
    return (orgchart.OVERRIDES.get(slug) or f"You are {slug}, {title} at Sir Jasper AI, a personal-to-enterprise agentic OS. Be concise and concrete.", "standard")


def _wrap_attachment(name: str, text: str) -> str:
    """Attachment text is data, not instructions: tag it (and scan it) before it reaches a model."""
    from core import untrusted
    s = untrusted.scan(text)
    flag = f' flags="{",".join(s.flags)}"' if s.flags else ""
    body = text.replace("</untrusted", "<\\/untrusted")
    return f'<untrusted source="attachment"{flag} name="{name}">\n{body}\n</untrusted>'


def _user_content(text: str, atts: list[Attachment]) -> str:
    extra = "".join(f"\n\n[Attachment: {a.name}]\n" + _wrap_attachment(a.name, a.text[:20000]) if a.text else f"\n\n[Attachment: {a.name} ({a.mime or 'binary'}), not readable as text]"
                    for a in atts)
    return text + extra


def _line(o: dict) -> str:
    return json.dumps(o) + "\n"


async def _speak(r, slug: str, history: list[Turn], text: str, atts: list[Attachment], tier: str | None = None) -> AsyncIterator[str]:
    system, default_tier = _persona(slug)
    
    # Memory layers, embedded once: founder facts (shared by all bots), this bot's own lessons, its group's memory, company-wide memory. Never blocks the chat.
    try:
        grp = workspaces.GROUP_OF.get(slug)
        if orgchart.SETTINGS.get(slug, {}).get("memory") is False:
            raise LookupError  # this bot has memory switched off
        sc = orgchart.memory_scopes(slug)  # which memory layers this bot may read (founder-controlled)
        spec = {}
        if sc["founder"]:
            spec["fact"] = 4
        if sc["own"]:
            spec[f"bot.{slug}"] = 3
        if sc["org"]:
            spec["org"] = 2
        if grp and grp not in ("legacy", "chief") and sc["group"]:
            spec[f"group.{grp}"] = 3
        if not spec:
            raise LookupError  # every layer is switched off
        got = await asyncio.wait_for(consolidate.recall_multi(text, spec), timeout=4.0)
        for ns, title in (("fact", "What you know about the founder"), (f"bot.{slug}", "Lessons from your own past work"), (f"group.{grp}", "Your group's shared memory"), ("org", "Company-wide memory")):
            if got.get(ns):
                system = f"{system}\n\n{title}:\n" + "\n".join(f"- {f}" for f in got[ns])
    except Exception:
        pass  # includes TimeoutError: memory must never break a conversation

    msgs = [{"role": t.role, "content": t.content} for t in history[-MAX_HISTORY:]] + [{"role": "user", "content": _user_content(text, atts)}]
    yield _line({"t": "speaker", "slug": slug})
    if await orgchart.over_cap(slug):
        yield _line({"t": "error", "slug": slug, "message": f"{slug} reached its daily token cap (change it in the bot settings)"})
        return
    announce(slug, "working", bubble=text[:100])
    reply_parts: list[str] = []
    t0 = time.monotonic()
    try:
        b = registry.routable(slug)
        with finops.attribute(slug, b.crew if b else None):
            if jasper_tools.has_tools(slug):  # bots with a tool allowlist (Jasper, Connector, ...) use the tool loop
                async for ev in jasper_tools.stream_with_tools(r, system, msgs, tier or default_tier, agent=slug):
                    if "delta" in ev:
                        reply_parts.append(ev["delta"])
                        yield _line({"t": "delta", "slug": slug, "text": ev["delta"]})
                    elif "tool" in ev:
                        yield _line({"t": "tool", "slug": slug, **ev["tool"]})
                    elif "ui" in ev:
                        yield _line({"t": "ui", "slug": slug, **ev["ui"]})
                    else:
                        yield _line({"t": "done", "slug": slug, "usage": ev["usage"].model_dump()})
            else:
                async for item in r.stream(LLMRequest(**{"system": system, "messages": msgs, "tier": tier or default_tier, "max_tokens": 1024, **orgchart.llm_kwargs(slug)})):
                    if isinstance(item, Usage):
                        yield _line({"t": "done", "slug": slug, "usage": item.model_dump()})
                    else:
                        reply_parts.append(item)
                        yield _line({"t": "delta", "slug": slug, "text": item})
    except Exception as e:
        announce(slug, "error", reason=str(e))
        await orgchart.record_call(slug, False, int((time.monotonic() - t0) * 1000))
        yield _line({"t": "error", "slug": slug, "message": str(e)[:200]})
        return
    announce(slug, "idle")
    await orgchart.record_call(slug, True, int((time.monotonic() - t0) * 1000))
    
    # Memory v2: consolidate the turn after the reply (only for jasper)
    if reply_parts:
        asyncio.create_task(consolidate.consolidate_turn(r, text, "".join(reply_parts)))


@router.post("/stream")
async def stream(body: ChatIn):
    async def gen():
        r = await get_router()
        async for line in _speak(r, body.slug, body.history, body.text, body.attachments, body.tier):
            yield line
    return StreamingResponse(gen(), media_type="application/x-ndjson")


class MeetingIn(BaseModel):
    group: str
    topic: str
    rounds: int = 2


@router.post("/meeting")
async def meeting(body: MeetingIn):
    """Group discussion: the group's bots debate the topic (rounds), then the lead concludes. Streams chat2 events plus {"t":"phase"}."""
    async def gen():
        r = await get_router()
        async for ev in discussion.stream(r, body.group, body.topic, max(1, min(body.rounds, 3))):
            yield _line(ev)
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
