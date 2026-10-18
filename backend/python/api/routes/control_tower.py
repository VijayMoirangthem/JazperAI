"""Phase 7A — Control Tower API.

Endpoints:
  GET  /api/control-tower/processes       → list managed processes + resource usage
  GET  /api/control-tower/resources       → host CPU/RAM/Disk snapshot
  GET  /api/control-tower/terminal/log    → recent Commander terminal history
  GET  /api/control-tower/terminal/stream → SSE stream of live Commander output
  GET  /api/control-tower/audit           → TerminalSandbox audit log
  POST /api/control-tower/run             → run a command through Commander (approved risk tiers)
  POST /api/control-tower/watchdog        → signal Watchdog to restart a process
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

import structlog
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse

log = structlog.get_logger()
router = APIRouter()


# ── GET /processes ────────────────────────────────────────────────────────────

@router.get("/processes")
def get_processes():
    from core.system.process_manager import list_processes
    return {"processes": list_processes()}


# ── GET /resources ────────────────────────────────────────────────────────────

@router.get("/resources")
def get_resources():
    from core.system.process_manager import get_system_resources
    return get_system_resources()


# ── GET /terminal/log ─────────────────────────────────────────────────────────

@router.get("/terminal/log")
def get_terminal_log(limit: int = Query(100, ge=1, le=500)):
    from agents.roster.commander_agent import get_terminal_log
    return {"entries": get_terminal_log(limit=limit)}


# ── GET /terminal/stream ──────────────────────────────────────────────────────

@router.get("/terminal/stream")
async def terminal_stream():
    """SSE stream of live Commander terminal output."""
    from agents.roster.commander_agent import subscribe_terminal, unsubscribe_terminal

    q = subscribe_terminal()

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            while True:
                try:
                    entry = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield "data: {\"heartbeat\": true}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            unsubscribe_terminal(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":              "no-cache",
            "X-Accel-Buffering":          "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ── GET /audit ────────────────────────────────────────────────────────────────

@router.get("/audit")
def get_audit(limit: int = Query(100, ge=1, le=500)):
    from core.system.terminal_sandbox import get_audit_log
    return {"entries": get_audit_log(limit=limit)}


# ── POST /run ─────────────────────────────────────────────────────────────────

@router.post("/run")
async def run_command(body: dict = Body(...)):
    """
    Run a shell command through Commander.
    Only safe and low risk tiers are allowed from this endpoint without
    going through the approval flow.
    """
    command = body.get("command", "").strip()
    cwd     = body.get("cwd", ".")
    if not command:
        raise HTTPException(400, "command is required")

    from core.system.terminal_sandbox import classify_risk, BlockedCommand
    risk = classify_risk(command)
    if risk in ("blocked", "high"):
        raise HTTPException(403, f"Command risk tier '{risk}' not allowed from Control Tower UI. Use the Approvals panel for high-risk commands.")

    from agents.roster.commander_agent import CommanderAgent
    result = await CommanderAgent.run(
        command=command, cwd=cwd,
        caller="ControlTower/UI",
        reason="Manually executed from Control Tower",
    )
    return result


# ── POST /watchdog ────────────────────────────────────────────────────────────

@router.post("/watchdog")
def signal_watchdog(body: dict = Body(...)):
    target = body.get("target", "backend")
    reason = body.get("reason", "Manual restart from Control Tower")
    if target not in ("backend", "frontend", "all"):
        raise HTTPException(400, "target must be: backend | frontend | all")
    from core.system.process_manager import signal_watchdog
    ok = signal_watchdog(target=target, reason=reason)
    return {"ok": ok, "target": target}
