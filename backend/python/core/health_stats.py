"""Passive health signals: the outcome of the last real calls to the model provider and to the speech service.
Costs nothing (no probe calls): the router and the speech route record what actually happened."""
from __future__ import annotations

import time
from collections import deque

_outcomes: dict[str, deque] = {"llm": deque(maxlen=12), "tts": deque(maxlen=12)}


def record(kind: str, ok: bool, detail: str = "") -> None:
    if kind in _outcomes:
        _outcomes[kind].append((time.time(), bool(ok), detail[:120]))


def recent(kind: str) -> list[tuple[float, bool, str]]:
    return list(_outcomes.get(kind, ()))


def failing(kind: str, consecutive: int = 3, within_s: float = 900) -> tuple[bool, str]:
    """True when the last `consecutive` calls ALL failed and the newest is recent (a stale failure does not count)."""
    items = recent(kind)
    if len(items) < consecutive:
        return False, ""
    last = items[-consecutive:]
    if all(not ok for _t, ok, _d in last) and time.time() - last[-1][0] <= within_s:
        return True, last[-1][2] or "recent calls failed"
    return False, ""


def reset() -> None:
    for d in _outcomes.values():
        d.clear()


# ── activity: when did the founder last use a feature (so background jobs can stay out of the way) ──────────────────────────────
_activity: dict[str, float] = {}


def touch(kind: str) -> None:
    _activity[kind] = time.time()


def idle_seconds(kind: str) -> float | None:
    """Seconds since `touch(kind)`, or None if it never happened in this process."""
    t = _activity.get(kind)
    return None if t is None else time.time() - t
