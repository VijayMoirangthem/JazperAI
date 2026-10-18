"""Phase 7C — Voyager browser agent API routes."""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator

import structlog
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

log = structlog.get_logger()
router = APIRouter()


# ── GET /api/voyager/last-run ─────────────────────────────────────────────────

@router.get("/last-run")
def last_run():
    """Return the results from the most recent Voyager golden path run."""
    from agents.roster.voyager_agent import get_last_run
    return get_last_run()


# ── POST /api/voyager/test-panel ─────────────────────────────────────────────

@router.post("/test-panel")
async def test_panel(body: dict = Body(...)):
    """
    Run Voyager on a single panel.
    Body: {"panel": "chat", "headless": true}
    """
    panel    = body.get("panel", "dashboard")
    headless = body.get("headless", True)

    from agents.roster.voyager_agent import VoyagerAgent
    result = await VoyagerAgent.test_panel(panel, headless=headless)
    return result


# ── POST /api/voyager/golden-path ─────────────────────────────────────────────

@router.post("/golden-path")
async def golden_path(body: dict = Body(default={})):
    """
    Run the full Voyager golden path suite.
    Body: {"panels": ["chat", "tasks"], "headless": true}  (panels optional)
    """
    panels   = body.get("panels") or None
    headless = body.get("headless", True)

    from agents.roster.voyager_agent import VoyagerAgent
    result = await VoyagerAgent.run_golden_path(panels=panels, headless=headless)
    return result


# ── GET /api/voyager/events (SSE — live screenshot stream) ────────────────────

@router.get("/events")
async def voyager_events():
    """
    SSE stream of Voyager panel results (used by Control Tower Browser tab).
    Each event: {"type":"panel_result", "panel":..., "ok":..., "has_shot":..., ...}
    """
    from agents.roster.voyager_agent import add_subscriber, remove_subscriber
    import asyncio

    q: asyncio.Queue[str] = asyncio.Queue(maxsize=50)
    add_subscriber(q)

    async def generate() -> AsyncGenerator[str, None]:
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield 'data: {"heartbeat":true}\n\n'
        except asyncio.CancelledError:
            pass
        finally:
            remove_subscriber(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        },
    )
