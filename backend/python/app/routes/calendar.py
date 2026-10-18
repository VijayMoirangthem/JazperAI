"""
Phase 8B — Google Calendar REST endpoints.

GET  /api/calendar/today            → today's events
GET  /api/calendar/week             → 7-day window (?start=YYYY-MM-DD)
GET  /api/calendar/events           → arbitrary range (?start=&end=&max=)
GET  /api/calendar/free-busy        → ?start=ISO&end=ISO → {free, conflicts}
POST /api/calendar/events           → create an event
DELETE /api/calendar/events/{id}    → delete an event
GET  /api/calendar/status           → whether calendar is connected
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.calendar_service import (
    CalendarNotAuthorized,
    check_free_busy,
    create_event,
    get_events,
    get_today,
    get_week,
)

router = APIRouter()
log = structlog.get_logger()
_executor = ThreadPoolExecutor(max_workers=4)


def _run(fn):
    return asyncio.get_event_loop().run_in_executor(_executor, fn)


def _handle_auth_error(exc: Exception):
    """Convert CalendarNotAuthorized into a 401 with a clear message."""
    if isinstance(exc, CalendarNotAuthorized):
        raise HTTPException(
            status_code=401,
            detail=str(exc) or "Calendar not authorized. Re-authenticate at Settings → Google.",
        )
    raise exc


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def calendar_status():
    """Returns whether Google Calendar is connected and accessible."""
    try:
        events = await _run(get_today)
        return {"connected": True, "event_count_today": len(events)}
    except CalendarNotAuthorized as exc:
        return {"connected": False, "reason": str(exc)}
    except Exception as exc:
        return {"connected": False, "reason": str(exc)}


# ── Read endpoints ─────────────────────────────────────────────────────────────

@router.get("/today")
async def today():
    try:
        events = await _run(get_today)
        return {"events": events, "count": len(events)}
    except Exception as exc:
        _handle_auth_error(exc)


@router.get("/week")
async def week(start: Optional[str] = Query(None, description="YYYY-MM-DD")):
    try:
        events = await _run(lambda: get_week(start))
        return {"events": events, "count": len(events)}
    except Exception as exc:
        _handle_auth_error(exc)


@router.get("/events")
async def list_events(
    start: str = Query(..., description="ISO 8601 datetime"),
    end:   str = Query(..., description="ISO 8601 datetime"),
    max:   int = Query(20, description="Max results"),
):
    try:
        events = await _run(lambda: get_events(start, end, max))
        return {"events": events, "count": len(events)}
    except Exception as exc:
        _handle_auth_error(exc)


@router.get("/free-busy")
async def free_busy(
    start: str = Query(..., description="ISO 8601 start"),
    end:   str = Query(..., description="ISO 8601 end"),
):
    try:
        result = await _run(lambda: check_free_busy(start, end))
        return result
    except Exception as exc:
        _handle_auth_error(exc)


# ── Write endpoints ───────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    title:       str
    start:       str
    end:         str
    description: str = ""
    attendees:   list[str] = []
    location:    str = ""


@router.post("/events")
async def create(body: EventCreate):
    try:
        event = await _run(lambda: create_event(
            title=body.title,
            start_iso=body.start,
            end_iso=body.end,
            description=body.description,
            attendees=body.attendees or None,
            location=body.location,
        ))
        return {"event": event}
    except Exception as exc:
        _handle_auth_error(exc)


@router.delete("/events/{event_id}")
async def delete(event_id: str):
    try:
        from app.services.calendar_service import _get_service
        def _del():
            svc = _get_service()
            svc.events().delete(calendarId="primary", eventId=event_id).execute()
            return {"deleted": event_id}
        return await _run(_del)
    except Exception as exc:
        _handle_auth_error(exc)


class PrepRequest(BaseModel):
    title: str
    attendees: list[str] = []
    description: str = ""
    start_time: str = ""


@router.post("/prep")
async def meeting_prep(req: PrepRequest):
    """Generate a meeting preparation brief using LLM."""
    from app.providers.ai_provider import get_ai_provider
    ai = get_ai_provider()

    attendees_str = ", ".join(req.attendees) if req.attendees else "unknown attendees"
    system = (
        "You are Jazper, a personal AI assistant. Generate a concise meeting preparation brief. "
        "Include: what this meeting is likely about, key points to prepare, questions to ask. "
        "Format as a short bulleted list. Be practical and direct."
    )
    prompt = (
        f"Meeting: {req.title}\n"
        f"Attendees: {attendees_str}\n"
        f"Time: {req.start_time or 'unspecified'}\n"
        f"Description: {req.description or 'none'}\n\n"
        "Generate a prep brief:"
    )
    try:
        brief = await ai.complete(prompt, system_prompt=system, max_tokens=350)
        return {"brief": brief.strip()}
    except Exception as e:
        return {"brief": "", "error": str(e)}
