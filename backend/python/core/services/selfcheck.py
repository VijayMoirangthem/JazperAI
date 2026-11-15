"""Self-check: every minute, test the things Jasper depends on and tell the founder (a phone notification) when one breaks and when it recovers.

Rules that keep it useful and quiet:
* a problem is announced only after 2 failed checks in a row (one blip is not an incident);
* it is announced once, reminded at most every 6 hours while it lasts, and a "recovered" notice follows when it is fixed;
* probes cost nothing: database/Redis/disk are local, Google uses the saved-login check, model provider and speech service are judged from
  the outcome of their real recent calls (core/health_stats.py), not from extra requests.
"""
from __future__ import annotations

import asyncio
import shutil
import time
from dataclasses import asdict, dataclass, field
from typing import Awaitable, Callable

import structlog

log = structlog.get_logger()
Probe = Callable[[], Awaitable[tuple[bool, str]]]
THRESHOLD = 2            # consecutive failures before announcing
REMIND_S = 6 * 3600      # re-announce a still-open problem this often
LABELS = {"database": "Database", "redis": "Redis cache", "google": "Google login", "llm": "AI model provider",
          "speech": "Speech (voice) service", "disk": "Disk space"}


@dataclass
class CheckState:
    name: str
    ok: bool | None = None          # None until the first run
    detail: str = ""
    fails: int = 0
    since: float = field(default_factory=time.time)
    announced_at: float = 0.0       # when the open problem was last announced (0 = not announced)


class SelfCheck:
    def __init__(self, notify: Callable[[str, str, str], Awaitable[None]], threshold: int = THRESHOLD, remind_s: float = REMIND_S, clock=time.time):
        self.notify, self.threshold, self.remind_s, self.clock = notify, threshold, remind_s, clock
        self.states: dict[str, CheckState] = {}

    async def run_once(self, probes: dict[str, Probe]) -> list[dict]:
        """Runs every probe (a crashing or slow probe counts as a failure), updates the states, sends notifications. Returns what it announced."""
        sent: list[dict] = []
        results = await asyncio.gather(*(self._probe(n, p) for n, p in probes.items()))
        for name, (ok, detail) in zip(probes, results):
            st = self.states.setdefault(name, CheckState(name, since=self.clock()))
            label = LABELS.get(name, name)
            if ok:
                if st.announced_at:
                    await self._send(sent, f"{label} is back", f"{label} recovered after {self._ago(st.since)}.", "info", name)
                if st.ok is not True:
                    st.since = self.clock()
                st.ok, st.detail, st.fails, st.announced_at = True, detail, 0, 0.0
                continue
            if st.ok is not False:
                st.since = self.clock()
            st.ok, st.detail, st.fails = False, detail, st.fails + 1
            due = st.fails >= self.threshold and (not st.announced_at or self.clock() - st.announced_at >= self.remind_s)
            if due:
                st.announced_at = self.clock()
                await self._send(sent, f"{label} has a problem", detail or f"{label} is not responding.", "alert", name)
        return sent

    async def _probe(self, name: str, probe: Probe) -> tuple[bool, str]:
        try:
            return await asyncio.wait_for(probe(), timeout=8)
        except asyncio.TimeoutError:
            return False, "did not answer in 8 seconds"
        except Exception as e:  # noqa: BLE001 - a crashing probe is itself a failed check
            return False, str(e)[:160] or type(e).__name__

    async def _send(self, sent: list[dict], title: str, body: str, ntype: str, name: str) -> None:
        sent.append({"check": name, "title": title, "body": body, "type": ntype})
        try:
            await self.notify(title, body, ntype)
        except Exception as e:  # noqa: BLE001
            log.warning("self-check could not send a notification", error=str(e)[:120])

    def _ago(self, since: float) -> str:
        s = max(0, int(self.clock() - since))
        return f"{s // 3600} h {s % 3600 // 60} min" if s >= 3600 else f"{max(1, s // 60)} min"

    def snapshot(self) -> list[dict]:
        return [{"name": s.name, "label": LABELS.get(s.name, s.name), "ok": s.ok, "detail": s.detail, "fails": s.fails,
                 "since": s.since, "announced": bool(s.announced_at)} for s in self.states.values()]


# ── real probes ──────────────────────────────────────────────────────────────────────────────────────────────

async def probe_database() -> tuple[bool, str]:
    from memory.db import aio
    await aio.fetch("SELECT 1")
    return True, ""


async def probe_redis() -> tuple[bool, str]:
    from memory.redis import layer
    await layer.client().ping()
    return True, ""


async def probe_google() -> tuple[bool, str]:
    from agents import connector
    accounts = await connector._google_health()
    bad = [a["email"] for a in accounts if not a.get("healthy")]
    if bad:
        return False, f"Google no longer accepts the saved login for {', '.join(bad)}. Reconnect it in Settings."
    return True, "" if accounts else "not connected"


async def probe_llm() -> tuple[bool, str]:
    from core import health_stats
    bad, detail = health_stats.failing("llm")
    return (not bad), (f"the last 3 model calls failed: {detail}" if bad else "")


async def probe_speech() -> tuple[bool, str]:
    from core import health_stats
    bad, detail = health_stats.failing("tts", consecutive=3)
    return (not bad), (f"the last 3 voice requests failed: {detail}" if bad else "")


async def probe_disk() -> tuple[bool, str]:
    from core.logfile import ROOT
    free_gb = shutil.disk_usage(ROOT).free / 1e9
    return (free_gb >= 2.0), (f"only {free_gb:.1f} GB free on the Jasper drive" if free_gb < 2.0 else "")


PROBES: dict[str, Probe] = {"database": probe_database, "redis": probe_redis, "google": probe_google, "llm": probe_llm,
                            "speech": probe_speech, "disk": probe_disk}


_pending: list[tuple[str, str, str]] = []   # announcements that could not be stored yet (the database itself may be what is down)


async def _store(title: str, body: str, ntype: str) -> None:
    from memory.db import aio
    await aio.execute("INSERT INTO notifications (title, body, type) VALUES ($1, $2, $3)", title, body, ntype)


async def _notify(title: str, body: str, ntype: str) -> None:
    try:
        await _store(title, body, ntype)
    except Exception:  # noqa: BLE001 - keep it and deliver when the database is back
        _pending.append((title, body, ntype))
        del _pending[:-20]


async def flush_pending() -> int:
    sent = 0
    while _pending:
        try:
            await _store(*_pending[0])
        except Exception:  # noqa: BLE001 - still down
            break
        _pending.pop(0)
        sent += 1
    return sent


_checker: SelfCheck | None = None


def checker() -> SelfCheck:
    global _checker
    if _checker is None:
        _checker = SelfCheck(_notify)
    return _checker


async def run() -> list[dict]:
    """Scheduled every minute."""
    sent = await checker().run_once(PROBES)
    if _pending:
        await flush_pending()
    return sent
