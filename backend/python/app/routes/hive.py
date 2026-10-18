"""Hive API — the Munder-style coordination surface.

Endpoints:
  GET    /api/hive/state                          combined snapshot (fleet+board+tasks+log+agents+depts)
  POST   /api/hive/route                          run the outbox->inbox router
  GET    /api/hive/board                          read the board
  POST   /api/hive/board                          write the board
  GET    /api/hive/tasks                          read the kanban
  POST   /api/hive/tasks                          add a task
  POST   /api/hive/tasks/{id}/move                move a task between columns
  GET    /api/hive/activity                       live activity feed
  POST   /api/hive/send                           send a message between agents
  GET    /api/hive/agents/{codename}/inbox        list inbox
  POST   /api/hive/agents/{codename}/inbox/{id}/read   mark inbox message read
  GET    /api/hive/agents/{codename}/terminal     SSE stream of the agent terminal
  POST   /api/hive/agents/{codename}/terminal/exec     run a command in the agent's workspace
  POST   /api/hive/dispatch                       Jazper dispatches a task to an agent (chain loop)
"""

from __future__ import annotations

import asyncio
import json
from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services import hive_service
from app.services.hive_service import hive
from app.services.agent_runtime import runtime
from app.services import terminal_service

log = structlog.get_logger()
router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class SendMessage(BaseModel):
    to: str
    subject: str
    body: str = ""
    act: str = "request"
    in_reply_to: Optional[str] = None


class BoardWrite(BaseModel):
    text: str


class TaskAdd(BaseModel):
    title: str
    assignee: str = ""
    priority: str = "medium"
    deps: list = []


class TaskMove(BaseModel):
    status: str


class ExecCommand(BaseModel):
    command: str
    cwd: str = ""


class DispatchRequest(BaseModel):
    agent: str
    task: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _registry_rows():
    """Fetch agent + department rows from the DB (graceful degradation)."""
    try:
        from app.routes.agents import _conn
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""SELECT agent_id, codename, name, status, department, title,
                       level, reports_to, model, badge_color, avatar_emoji,
                       avatar_source, avatar_style, avatar_seed, description,
                       health_score, tasks_completed, tasks_failed, last_active
                       FROM agent_registry ORDER BY level, name""")
        cols = ["agent_id", "codename", "name", "status", "department", "title",
                "level", "reports_to", "model", "badge_color", "avatar_emoji",
                "avatar_source", "avatar_style", "avatar_seed", "description",
                "health_score", "tasks_completed", "tasks_failed", "last_active"]
        agents = [dict(zip(cols, r)) for r in cur.fetchall()]

        cur.execute("""SELECT id, name, description, head_agent, enabled,
                       budget_daily_usd, budget_used_today, badge_color,
                       floor_position, created_at FROM departments ORDER BY name""")
        dcols = ["id", "name", "description", "head_agent", "enabled",
                 "budget_daily_usd", "budget_used_today", "badge_color",
                 "floor_position", "created_at"]
        departments = []
        for r in cur.fetchall():
            d = dict(zip(dcols, r))
            if isinstance(d.get("floor_position"), str):
                try:
                    d["floor_position"] = json.loads(d["floor_position"])
                except Exception:
                    d["floor_position"] = {}
            departments.append(d)
        cur.close(); conn.close()
        return agents, departments
    except Exception as e:
        log.warning("hive: registry fetch failed", error=str(e))
        return [], []


# ── State ─────────────────────────────────────────────────────────────────────

@router.get("/state")
def state():
    agents, departments = _registry_rows()
    for a in agents:
        code = a.get("codename", "")
        st = runtime.state(code)
        a["runtime"] = st
        if "last_active" in a and a["last_active"] is not None:
            a["last_active"] = a["last_active"].isoformat() if hasattr(a["last_active"], "isoformat") else str(a["last_active"])
    return hive.state(agents, departments)


# ── Router / board / tasks ────────────────────────────────────────────────────

@router.post("/route")
async def route_messages():
    loop = asyncio.get_running_loop()
    moved = await loop.run_in_executor(None, hive.route)
    return {"routed": moved}


@router.get("/board")
def get_board():
    return {"board": hive.board()}


@router.post("/board")
def set_board(body: BoardWrite):
    hive.set_board(body.text)
    hive.log_append("board", {"action": "updated"})
    return {"ok": True, "board": body.text}


@router.get("/tasks")
def get_tasks():
    return hive.tasks()


@router.post("/tasks")
def add_task(body: TaskAdd):
    task = hive.add_task(body.title, body.assignee, body.priority, body.deps)
    return task


@router.post("/tasks/{task_id}/move")
def move_task(task_id: str, body: TaskMove):
    task = hive.move_task(task_id, body.status)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Activity ──────────────────────────────────────────────────────────────────

@router.get("/activity")
def activity(limit: int = 200):
    return {"activities": runtime.all_activity(limit)}


@router.get("/agents/{codename}/activity")
def agent_activity(codename: str, limit: int = 100):
    return {"activities": runtime.activity(codename, limit)}


# ── Messaging ─────────────────────────────────────────────────────────────────

@router.post("/send")
async def send(body: SendMessage):
    msg = hive.send("human", body.to, body.subject, body.body, body.act, body.in_reply_to)
    return msg


@router.get("/agents/{codename}/inbox")
def inbox(codename: str, unread_only: bool = False):
    return {"messages": hive.inbox(codename, "inbox", unread_only)}


@router.post("/agents/{codename}/inbox/{msg_id}/read")
def mark_read(codename: str, msg_id: str):
    m = hive.mark_read(codename, msg_id)
    if not m:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True, "message": m}


# ── Agent terminal ────────────────────────────────────────────────────────────

def _workspace_cwd(codename: str) -> str:
    ws = hive.workspace(codename)
    try:
        ws.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(ws)


@router.get("/agents/{codename}/terminal")
async def terminal_stream(codename: str):
    """SSE stream of the agent's live activity + terminal lines."""
    q: asyncio.Queue = asyncio.Queue()

    async def event_pump():
        try:
            while True:
                entry = await q.get()
                yield f"data: {json.dumps(entry)}\n\n"
        except asyncio.CancelledError:
            return

    # seed with recent activity
    for entry in runtime.activity(codename, 50):
        try:
            q.put_nowait(entry)
        except Exception:
            break
    sub = runtime.subscribe_terminal(codename)
    task = asyncio.create_task(event_pump())

    async def gen():
        try:
            # forward from the live subscription
            while True:
                entry = await sub.get()
                yield f"data: {json.dumps(entry)}\n\n"
        except asyncio.CancelledError:
            return
        finally:
            runtime.unsubscribe_terminal(codename, sub)
            task.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/agents/{codename}/terminal/exec")
async def terminal_exec(codename: str, body: ExecCommand):
    """Run a command in the agent's workspace. Output streams to the terminal SSE
    and the runtime activity feed."""
    cwd = body.cwd or _workspace_cwd(codename)
    sid = terminal_service.create_session(cwd, label=f"{codename} terminal").id

    async def _run():
        await terminal_service.run_command(sid, body.command)
        runtime.push_activity(codename, f"[exit] {body.command}", kind="system")

    asyncio.create_task(_run())
    runtime.push_activity(codename, f"$ {body.command}", kind="cmd")
    return {"ok": True, "session_id": sid, "cwd": cwd}


# ── Dispatch (Jazper delegates a task to an agent) ───────────────────────────

@router.post("/dispatch")
async def dispatch(body: DispatchRequest):
    """Use the chain-loop delegation machinery to hand a task to an agent.
    Returns the agent's response."""
    try:
        from app.routes.chain_loop import _delegate as delegate_to_agent_impl
        runtime.set_status("jazper", "working", f"dispatching to {body.agent}", codename="jazper")
        runtime.push_activity("jazper", f"dispatching task to @{body.agent}: {body.task}", kind="dispatch")
        result = await delegate_to_agent_impl(body.agent, body.task, None)
        runtime.set_status("jazper", "idle", "", codename="jazper")
        return {"ok": True, "agent": body.agent, "result": result}
    except Exception as e:
        runtime.set_status("jazper", "error", f"dispatch failed: {e}", codename="jazper")
        raise HTTPException(status_code=500, detail=str(e))
