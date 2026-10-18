"""Agent Runtime — live status/action/activity registry + WebSocket fan-out.

Single source of truth for the floor's animation and the activity feed.
Backend producers (agent chat tool loop, workers, scheduler, chain loop) report
into this registry; the frontend consumes it via WebSocket events and
/api/hive/state.

Per-agent tracked state:
  agent_id, codename, status, action, last_tool, activity[] (ring buffer),
  terminal lines (queue), last_active_sec_ago, workspace cwd.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

import structlog

log = structlog.get_logger()

STATUSES = ("idle", "thinking", "working", "blocked", "compacting", "looping", "error", "success", "offline")

_ACTIVITY_MAX = 200
_TERMINAL_MAX = 2000


class _AgentRuntime:
    def __init__(self) -> None:
        self._states: dict[str, dict[str, Any]] = {}
        self._activity: dict[str, list[dict]] = {}
        self._terminals: dict[str, list[asyncio.Queue]] = {}

    # ── State ─────────────────────────────────────────────────────────────────

    def register(self, agent_id: str, codename: str, workspace: str = "") -> None:
        st = self._states.setdefault(codename, {})
        st.setdefault("agent_id", agent_id)
        st.setdefault("codename", codename)
        st.setdefault("status", "idle")
        st.setdefault("action", "")
        st.setdefault("last_tool", None)
        st.setdefault("workspace", workspace)
        st.setdefault("last_seen", time.time())

    def set_status(self, agent_id: str, status: str, action: Optional[str] = None,
                   codename: Optional[str] = None, emit: bool = True) -> None:
        if status not in STATUSES:
            status = "idle"
        key = codename or agent_id
        st = self._states.setdefault(key, {"agent_id": agent_id, "codename": key, "status": "idle"})
        st["agent_id"] = agent_id
        st["codename"] = key
        st["status"] = status
        st["last_seen"] = time.time()
        if action is not None:
            st["action"] = action
        if emit:
            self._emit("AGENT_STATUS", {
                "agent_id": agent_id,
                "codename": key,
                "status": status,
                "action": st.get("action", ""),
                "ts": time.time(),
            })

    def set_action(self, agent_id: str, action: str, codename: Optional[str] = None) -> None:
        key = codename or agent_id
        st = self._states.setdefault(key, {"agent_id": agent_id, "codename": key, "status": "idle"})
        st["action"] = action
        st["last_seen"] = time.time()
        self._emit("AGENT_STATUS", {
            "agent_id": agent_id,
            "codename": key,
            "status": st.get("status", "idle"),
            "action": action,
            "ts": time.time(),
        })

    def report_tool(self, agent_id: str, tool: str, args: Optional[dict] = None) -> None:
        """Shortcut: mark an agent as using a tool + push an activity line."""
        key = self._codename_for(agent_id)
        st = self._states.setdefault(key, {"agent_id": agent_id, "codename": key, "status": "working"})
        st["status"] = "working"
        st["last_tool"] = tool
        st["last_seen"] = time.time()
        arg_preview = ""
        if args:
            try:
                arg_preview = " " + " ".join(str(v) for v in args.values())[:80]
            except Exception:
                pass
        text = f"using {tool}{arg_preview}"
        st["action"] = text
        self.push_activity(agent_id, f"[tool] {tool}{arg_preview}", kind="tool", codename=key)
        self._emit("AGENT_STATUS", {
            "agent_id": agent_id,
            "codename": key,
            "status": "working",
            "action": text,
            "tool": tool,
            "ts": time.time(),
        })

    def idle(self, agent_id: str, codename: Optional[str] = None) -> None:
        self.set_status(agent_id, "idle", "", codename=codename)

    def mark_blocked(self, agent_id: str, reason: str = "", codename: Optional[str] = None) -> None:
        self.set_status(agent_id, "blocked", reason or "needs you", codename=codename)
        self.push_activity(agent_id, f"[blocked] {reason}" if reason else "[blocked] needs your input", kind="block", codename=codename)

    # ── Activity + terminal stream ────────────────────────────────────────────

    def push_activity(self, agent_id: str, text: str, kind: str = "log",
                      codename: Optional[str] = None) -> None:
        key = codename or agent_id
        entry = {
            "agent_id": agent_id,
            "codename": key,
            "text": text,
            "kind": kind,
            "ts": time.time(),
        }
        buf = self._activity.setdefault(key, [])
        buf.append(entry)
        if len(buf) > _ACTIVITY_MAX:
            del buf[: len(buf) - _ACTIVITY_MAX]
        # terminal stream
        for q in self._terminals.get(key, []):
            try:
                q.put_nowait(entry)
            except Exception:
                pass
        self._emit("AGENT_ACTION", entry)

    def activity(self, codename: str, limit: int = 100) -> list[dict]:
        buf = self._activity.get(codename, [])
        return list(buf[-limit:])

    def all_activity(self, limit: int = 200) -> list[dict]:
        merged: list[dict] = []
        for buf in self._activity.values():
            merged.extend(buf)
        merged.sort(key=lambda e: e.get("ts", 0), reverse=True)
        return merged[:limit]

    # ── Terminal subscription ─────────────────────────────────────────────────

    def subscribe_terminal(self, codename: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=_TERMINAL_MAX)
        self._terminals.setdefault(codename, []).append(q)
        return q

    def unsubscribe_terminal(self, codename: str, q: asyncio.Queue) -> None:
        try:
            self._terminals.get(codename, []).remove(q)
        except ValueError:
            pass

    # ── Snapshot ──────────────────────────────────────────────────────────────

    def state(self, codename: str) -> dict:
        st = dict(self._states.get(codename, {}))
        st["last_active_sec_ago"] = round(time.time() - st.get("last_seen", time.time()), 1) if st.get("last_seen") else None
        return st

    def all_states(self) -> dict[str, dict]:
        out = {}
        now = time.time()
        for key, st in self._states.items():
            s = dict(st)
            s["last_active_sec_ago"] = round(now - s.get("last_seen", now), 1) if s.get("last_seen") else None
            out[key] = s
        return out

    # ── Internals ─────────────────────────────────────────────────────────────

    def _codename_for(self, agent_id: str) -> str:
        for key, st in self._states.items():
            if st.get("agent_id") == agent_id:
                return key
        return agent_id

    def _emit(self, event: str, payload: dict) -> None:
        try:
            from api.routes.ws import broadcast as ws_broadcast
            loop = asyncio.get_event_loop()
            try:
                loop.create_task(ws_broadcast(event, payload))
            except Exception:
                asyncio.ensure_future(ws_broadcast(event, payload))
        except Exception as e:
            log.warning("agent_runtime: ws emit failed", error=str(e))


runtime = _AgentRuntime()