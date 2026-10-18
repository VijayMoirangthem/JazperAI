"""Phase 8B — IDE Agent Activity Bus.

A lightweight in-memory event bus. Oracle, Forge, Voyager, Commander, and
Aria emit here when they touch files or run commands. The /api/ide/events
SSE endpoint broadcasts these to the COOS Studio Activity Feed.

Events are dropped if no SSE clients are listening — non-blocking by design.
Events are NOT persisted — they are only for real-time visibility.

Usage (in an agent):
  from core.services.ide_bus import ide_bus
  ide_bus.emit({
      "agent":   "Oracle",
      "action":  "reading",
      "file":    "backend/python/app/routes/chat.py",
      "lines":   [45, 67],
      "reason":  "diagnosing NullPointerError",
  })
"""

from __future__ import annotations

import asyncio
import datetime
import json
from typing import Any


class IdeBus:
    """
    Singleton in-memory pub/sub for agent file activity events.
    Thread-safe via asyncio queue.
    """

    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[str]] = []
        # Keep last 200 events for late-joining clients
        self._history: list[dict] = []
        self._MAX_HISTORY = 200
        # Track which files are currently "active" (agent is touching them)
        self._active_files: dict[str, str] = {}  # path → agent name

    def emit(self, event: dict[str, Any]) -> None:
        """
        Emit an event to all subscribed SSE clients.
        Non-blocking — if a queue is full, that subscriber is dropped.
        """
        stamped = {**event, "ts": datetime.datetime.utcnow().isoformat() + "Z"}

        # Track active files
        file_path = event.get("file")
        action    = event.get("action", "")
        agent     = event.get("agent", "")
        if file_path:
            if action in ("reading", "editing"):
                self._active_files[file_path] = agent
            elif action in ("done", "result", "closed"):
                self._active_files.pop(file_path, None)

        # History
        self._history.append(stamped)
        if len(self._history) > self._MAX_HISTORY:
            del self._history[:-self._MAX_HISTORY]

        payload = json.dumps(stamped)
        dead: list[asyncio.Queue[str]] = []
        for q in self._subscribers:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            try:
                self._subscribers.remove(q)
            except ValueError:
                pass

    def subscribe(self) -> asyncio.Queue[str]:
        """Subscribe to the event stream. Returns a queue of JSON strings."""
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=500)
        # Replay recent history to new client
        for item in self._history[-50:]:
            try:
                q.put_nowait(json.dumps(item))
            except asyncio.QueueFull:
                break
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    def get_active_files(self) -> dict[str, str]:
        """Return {file_path: agent_name} for all currently active files."""
        return dict(self._active_files)

    def get_history(self, limit: int = 50) -> list[dict]:
        return list(reversed(self._history[-limit:]))


# Module-level singleton
ide_bus = IdeBus()
