"""Hive Service — the on-disk multi-agent layer (Munder Difflin hive, adapted).

Provides each COOS agent with a workspace (identity, memory, inbox, outbox), a
shared board + task kanban, a fleet snapshot, and an append-only event log.
Messages are routed file-to-file like Munder; the relational DB remains the
system of record (agent_communications) and the WebSocket plane carries live
events to the frontend.

Layout (root: <project>/storage/hive):

  agents/<codename>/
    identity.md     regenerated from agent_registry
    memory.md       append-only long-term notes
    inbox/          incoming JSON messages (one file per message)
    outbox/         outgoing JSON messages (router moves them)
  board.md          narrative plan (Jazper = scribe)
  tasks.json        structured kanban { todo, doing, blocked, done }
  fleet.json        live fleet telemetry (regenerated on demand)
  log.jsonl         append-only event log
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import structlog

log = structlog.get_logger()

# Project root = <COOS>/ (backend/python/app/services/.. x4)
_HIVE_ROOT = Path(os.environ.get("COOS_HIVE_ROOT", "")).resolve() if os.environ.get("COOS_HIVE_ROOT") else Path(__file__).resolve().parents[4] / "storage" / "hive"

# Speech acts (mirrors Munder Difflin protocol)
ACTS = ("request", "inform", "propose", "query", "agree", "refuse", "done")


def _fire(coro):
    """Run a coroutine without blocking the caller. Inside a running loop we
    schedule it as a task; otherwise we run it to completion (sync contexts)."""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    try:
        return loop.create_task(coro)
    except Exception as e:
        log.warning("hive: fire task failed", error=str(e))
        return None

_TASKS_TEMPLATE = {
    "todo": [],
    "doing": [],
    "blocked": [],
    "done": [],
}

_EMPTY_TASKS = {
    "todo": [],
    "doing": [],
    "blocked": [],
    "done": [],
}


# ── Path helpers ───────────────────────────────────────────────────────────────

def hive_root() -> Path:
    return _HIVE_ROOT


def ensure_hive() -> Path:
    root = _HIVE_ROOT
    (root / "agents").mkdir(parents=True, exist_ok=True)
    (root / "board.md").write_text("# Hive board\n\n_Shared plans live here. Jazper is the scribe._\n", encoding="utf-8")
    if not (root / "tasks.json").exists():
        (root / "tasks.json").write_text(json.dumps(_TASKS_TEMPLATE, indent=2), encoding="utf-8")
    if not (root / "log.jsonl").exists():
        (root / "log.jsonl").write_text("", encoding="utf-8")
    return root


def agent_workspace(codename: str) -> Path:
    codename = (codename or "").strip().lower().replace(" ", "-")
    return _HIVE_ROOT / "agents" / codename


def ensure_agent_workspace(codename: str, identity: Optional[dict] = None) -> Path:
    """Create an agent's workspace. Writes/refreshes identity.md from a dict
    (typically the agent_registry row)."""
    ws = agent_workspace(codename)
    (ws / "inbox").mkdir(parents=True, exist_ok=True)
    (ws / "outbox").mkdir(parents=True, exist_ok=True)
    (ws / "memory.md").touch(exist_ok=True)
    if identity:
        lines = [
            f"# {identity.get('name', codename)} ({codename})",
            "",
            f"- **Title**: {identity.get('title', '')}",
            f"- **Department**: {identity.get('department', '')}",
            f"- **Level**: {identity.get('level', '')}",
            f"- **Reports to**: {identity.get('reports_to', 'Jazper')}",
            f"- **Model**: {identity.get('model', '')}",
            f"- **Badge**: {identity.get('badge_color', '')}",
            f"- **Description**: {identity.get('description', '')}",
            "",
            "This file is managed by the hive. Append durable knowledge to memory.md.",
        ]
        (ws / "identity.md").write_text("\n".join(lines), encoding="utf-8")
    return ws


# ── Memory ─────────────────────────────────────────────────────────────────────

def read_memory(codename: str) -> str:
    ws = agent_workspace(codename)
    p = ws / "memory.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""


def write_memory(codename: str, text: str) -> Path:
    ws = ensure_agent_workspace(codename)
    p = ws / "memory.md"
    stamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    with p.open("a", encoding="utf-8") as f:
        f.write(f"\n## {stamp}\n{text.strip()}\n")
    return p


# ── Messages (inbox / outbox) ─────────────────────────────────────────────────

def _msg_path(codename: str, msg_id: str, box: str = "inbox") -> Path:
    return agent_workspace(codename) / box / f"{msg_id}.json"


def _write_msg_file(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def send_message(
    from_codename: str,
    to_codename: str,
    subject: str,
    body: str = "",
    act: str = "request",
    in_reply_to: Optional[str] = None,
) -> dict:
    """Write a message into the recipient's inbox (and sender's outbox),
    persist to agent_communications, and broadcast an AGENT_MESSAGE event.
    Returns the message dict."""
    if act not in ACTS:
        act = "inform"
    msg_id = f"{time.strftime('%Y-%m-%dT%H-%M-%S', time.gmtime())}-{uuid.uuid4().hex[:6]}"
    msg = {
        "id": msg_id,
        "from": from_codename,
        "to": to_codename,
        "act": act,
        "subject": subject,
        "body": body,
        "in_reply_to": in_reply_to,
        "ts": time.time(),
        "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "read": False,
    }
    try:
        to_ws = ensure_agent_workspace(to_codename)
        _write_msg_file(to_ws / "inbox" / f"{msg_id}.json", msg)
        from_ws = ensure_agent_workspace(from_codename)
        _write_msg_file(from_ws / "outbox" / f"{msg_id}.json", msg)
    except Exception as e:
        log.warning("hive: message file write failed", error=str(e))

    # persist + broadcast
    try:
        from core.services.agent_bus import publish
        _fire(publish(from_codename, to_codename, subject, msg))
    except Exception:
        pass

    try:
        from api.routes.ws import broadcast as ws_broadcast
        _fire(ws_broadcast("AGENT_MESSAGE", {
            "from": from_codename, "to": to_codename, "act": act,
            "subject": subject, "body": body, "id": msg_id, "ts": msg["ts"],
        }))
    except Exception:
        pass

    try:
        append_log("message", {"from": from_codename, "to": to_codename, "act": act, "subject": subject})
    except Exception:
        pass
    return msg


def list_messages(codename: str, box: str = "inbox", unread_only: bool = False) -> list[dict]:
    ws = agent_workspace(codename)
    folder = ws / box
    if not folder.exists():
        return []
    msgs = []
    for p in sorted(folder.glob("*.json"), reverse=True):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
            if unread_only and m.get("read"):
                continue
            msgs.append(m)
        except Exception:
            continue
    return msgs


def mark_message_read(codename: str, msg_id: str) -> Optional[dict]:
    p = _msg_path(codename, msg_id, "inbox")
    if not p.exists():
        return None
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
        m["read"] = True
        _write_msg_file(p, m)
        return m
    except Exception:
        return None


def route_outboxes() -> int:
    """Move files from every agent's outbox into the matching inbox. Returns the
    number of messages routed. Agents normally write straight to inbox via
    send_message, but this honors the Munder protocol where an agent may drop a
    file into its own outbox for the harness to deliver."""
    moved = 0
    agents_dir = _HIVE_ROOT / "agents"
    if not agents_dir.exists():
        return 0
    for ws in agents_dir.iterdir():
        outbox = ws / "outbox"
        if not outbox.is_dir():
            continue
        for p in outbox.glob("*.json"):
            try:
                m = json.loads(p.read_text(encoding="utf-8"))
                to = str(m.get("to", "")).strip().lower()
                if not to:
                    continue
                to_ws = ensure_agent_workspace(to)
                dest = to_ws / "inbox" / p.name
                p.replace(dest)
                moved += 1
                try:
                    from api.routes.ws import broadcast as ws_broadcast
                    _fire(ws_broadcast("AGENT_MESSAGE", {
                        "from": m.get("from"), "to": to, "act": m.get("act", "inform"),
                        "subject": m.get("subject", ""), "body": m.get("body", ""),
                        "id": m.get("id"), "ts": m.get("ts"),
                    }))
                except Exception:
                    pass
            except Exception:
                continue
    return moved


# ── Board ──────────────────────────────────────────────────────────────────────

def read_board() -> str:
    p = _HIVE_ROOT / "board.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""


def write_board(text: str) -> str:
    p = ensure_hive() / "board.md"
    p.write_text(text, encoding="utf-8")
    return text


# ── Tasks (kanban) ────────────────────────────────────────────────────────────

def read_tasks() -> dict:
    p = _HIVE_ROOT / "tasks.json"
    if not p.exists():
        return dict(_EMPTY_TASKS)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return {k: data.get(k, []) for k in ("todo", "doing", "blocked", "done")}
    except Exception:
        return dict(_EMPTY_TASKS)


def write_tasks(tasks: dict) -> dict:
    p = ensure_hive() / "tasks.json"
    data = {k: tasks.get(k, []) for k in ("todo", "doing", "blocked", "done")}
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def add_task(title: str, assignee: str = "", priority: str = "medium", deps: Optional[list] = None) -> dict:
    tasks = read_tasks()
    task = {
        "id": uuid.uuid4().hex[:10],
        "title": title,
        "assignee": assignee,
        "priority": priority,
        "deps": deps or [],
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "todo",
    }
    tasks["todo"].append(task)
    write_tasks(tasks)
    append_log("task", {"id": task["id"], "title": title, "assignee": assignee, "action": "created"})
    return task


def move_task(task_id: str, new_status: str) -> Optional[dict]:
    if new_status not in ("todo", "doing", "blocked", "done"):
        return None
    tasks = read_tasks()
    found = None
    for status in ("todo", "doing", "blocked", "done"):
        for t in tasks[status]:
            if t.get("id") == task_id:
                found = t
                tasks[status].remove(t)
                break
        if found:
            break
    if not found:
        return None
    found["status"] = new_status
    tasks[new_status].append(found)
    write_tasks(tasks)
    append_log("task", {"id": task_id, "action": "moved", "to": new_status})
    return found


# ── Event log ─────────────────────────────────────────────────────────────────

def append_log(kind: str, payload: dict) -> None:
    try:
        p = ensure_hive() / "log.jsonl"
        entry = {
            "ts": time.time(),
            "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "kind": kind,
            **payload,
        }
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        log.warning("hive: append_log failed", error=str(e))


def read_log(limit: int = 200) -> list[dict]:
    p = _HIVE_ROOT / "log.jsonl"
    if not p.exists():
        return []
    lines = p.read_text(encoding="utf-8").strip().splitlines()
    out = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


# ── Fleet snapshot ────────────────────────────────────────────────────────────

def fleet_snapshot(agents: Optional[list[dict]] = None) -> dict:
    """Build the fleet.json content. Agents is an optional list of registry rows
    (dicts with codename/name/status). Live state merges in from the runtime."""
    try:
        from core.services.agent_runtime import runtime
        live = runtime.all_states() if runtime else {}
    except Exception:
        live = {}
    fleet = {
        "ts": time.time(),
        "agents": [],
    }
    for row in agents or []:
        code = row.get("codename", "")
        st = live.get(code, {})
        fleet["agents"].append({
            "id": code,
            "name": row.get("name", code),
            "role": row.get("title", row.get("department", "")),
            "department": row.get("department", ""),
            "status": st.get("status") or ("active" if row.get("status") == "active" else "standby"),
            "action": st.get("action"),
            "lastTool": st.get("last_tool"),
            "lastActiveSecAgo": st.get("last_active_sec_ago"),
            "inboxBacklog": len(list_messages(code, "inbox", unread_only=True)),
        })
    return fleet


def hive_state(agents: Optional[list[dict]] = None, departments: Optional[list[dict]] = None) -> dict:
    """Combined snapshot for the frontend floor (one round trip)."""
    return {
        "fleet": fleet_snapshot(agents),
        "board": read_board(),
        "tasks": read_tasks(),
        "log": read_log(100),
        "agents": agents or [],
        "departments": departments or [],
    }


def agent_activity(codename: str) -> list[dict]:
    try:
        from core.services.agent_runtime import runtime
        return runtime.activity(codename)
    except Exception:
        return []


# ── Init hook ─────────────────────────────────────────────────────────────────

def init_hive() -> None:
    ensure_hive()
    try:
        from api.routes.agents import _conn
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""SELECT agent_id, codename, name, title, department, level,
                       reports_to, model, badge_color, description
                       FROM agent_registry WHERE status != 'retired'""")
        cols = ["agent_id", "codename", "name", "title", "department", "level",
                "reports_to", "model", "badge_color", "description"]
        for row in cur.fetchall():
            identity = dict(zip(cols, row))
            ensure_agent_workspace(row[1], identity)
        cur.close()
        conn.close()
    except Exception as e:
        log.warning("hive: init_hive agent workspace seeding failed", error=str(e))
    append_log("hive", {"event": "initialized"})


# ── Singleton facade ──────────────────────────────────────────────────────────

class _Hive:
    root = staticmethod(hive_root)
    ensure = staticmethod(ensure_hive)
    workspace = staticmethod(agent_workspace)
    ensure_workspace = staticmethod(ensure_agent_workspace)
    read_memory = staticmethod(read_memory)
    write_memory = staticmethod(write_memory)
    send = staticmethod(send_message)
    inbox = staticmethod(list_messages)
    mark_read = staticmethod(mark_message_read)
    route = staticmethod(route_outboxes)
    board = staticmethod(read_board)
    set_board = staticmethod(write_board)
    tasks = staticmethod(read_tasks)
    set_tasks = staticmethod(write_tasks)
    add_task = staticmethod(add_task)
    move_task = staticmethod(move_task)
    log_append = staticmethod(append_log)
    log_read = staticmethod(read_log)
    fleet = staticmethod(fleet_snapshot)
    state = staticmethod(hive_state)
    activity = staticmethod(agent_activity)
    init = staticmethod(init_hive)


hive = _Hive()

# ── Postgres mirror (P1-14): PG is the source of truth, files remain an export ───────────────
_STATUSES = ("todo", "doing", "blocked", "done")


def _pg_try(fn):
    try:
        from memory.db.legacy_pg import _pg
        with _pg() as conn:
            with conn.cursor() as cur:
                out = fn(cur)
            conn.commit()
            return out
    except Exception as e:
        log.warning("hive: postgres unavailable, using files", error=str(e))
        return None


def _pg_write_tasks(data: dict) -> None:
    def run(cur):
        cur.execute("DELETE FROM co.hive_tasks")
        for st in _STATUSES:
            for i, t in enumerate(data.get(st, [])):
                cur.execute("INSERT INTO co.hive_tasks (id, status, position, data) VALUES (%s,%s,%s,%s)",
                            (t.get("id") or uuid.uuid4().hex[:10], st, i, json.dumps(t)))
    _pg_try(run)


def _pg_read_tasks() -> dict | None:
    def run(cur):
        cur.execute("SELECT status, data FROM co.hive_tasks ORDER BY status, position")
        rows = cur.fetchall()
        if not rows:
            return None
        out = {k: [] for k in _STATUSES}
        for st, d in rows:
            out[st].append(d if isinstance(d, dict) else json.loads(d))
        return out
    return _pg_try(run)


_file_read_tasks, _file_write_tasks = read_tasks, write_tasks


def read_tasks() -> dict:  # noqa: F811
    return _pg_read_tasks() or _file_read_tasks()


def write_tasks(tasks: dict) -> dict:  # noqa: F811
    data = _file_write_tasks(tasks)
    _pg_write_tasks(data)
    return data


_file_append_log, _file_read_log = append_log, read_log


def append_log(kind: str, payload: dict) -> None:  # noqa: F811
    _file_append_log(kind, payload)
    entry = {"ts": time.time(), "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "kind": kind, **payload}
    _pg_try(lambda cur: cur.execute("INSERT INTO co.hive_log (data) VALUES (%s)", (json.dumps(entry),)))


def read_log(limit: int = 200) -> list[dict]:  # noqa: F811
    def run(cur):
        cur.execute("SELECT data FROM (SELECT seq, data FROM co.hive_log ORDER BY seq DESC LIMIT %s) s ORDER BY seq", (limit,))
        return [d if isinstance(d, dict) else json.loads(d) for (d,) in cur.fetchall()]
    rows = _pg_try(run)
    return rows if rows else _file_read_log(limit)


_file_read_board, _file_write_board = read_board, write_board


def write_board(text: str) -> str:  # noqa: F811
    _file_write_board(text)
    _pg_try(lambda cur: cur.execute(
        "INSERT INTO co.hive_board (id, body) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body", (text,)))
    return text


def read_board() -> str:  # noqa: F811
    def run(cur):
        cur.execute("SELECT body FROM co.hive_board WHERE id = 1")
        r = cur.fetchone()
        return r[0] if r else None
    got = _pg_try(run)
    return got if got is not None else _file_read_board()
