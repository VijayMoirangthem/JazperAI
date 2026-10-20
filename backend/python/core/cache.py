"""Shared Redis helpers (built on memory/redis/layer.py). Redis is an accelerator and a live-state store, never the only copy of anything:
every function degrades to "miss / no-op" when Redis is down, and durable data stays in Postgres.

Used for: short-TTL caches (org tree, connection overview), the live bot-communication stream, live agent states (survive a backend restart),
persisted SLO minute counters, and per-connector locks.
"""
import asyncio
import json
from collections.abc import Awaitable, Callable

from memory.redis import layer

NS = "platform"


def k(*parts: str) -> str:
    return layer.key(NS, *parts)


async def get_json(name: str):
    try:
        v = await layer.client().get(k("cache", name))
        return json.loads(v) if v else None
    except Exception:
        return None


async def set_json(name: str, value, ttl_s: int) -> None:
    try:
        await layer.client().set(k("cache", name), json.dumps(value, default=str), ex=ttl_s)
    except Exception:
        pass


_flight: dict[str, "asyncio.Future"] = {}


async def cached(name: str, ttl_s: int, fn: Callable[[], Awaitable]):
    """Return the cached value or compute, store and return it. Concurrent misses share ONE computation (no stampede)."""
    hit = await get_json(name)
    if hit is not None:
        return hit
    if name in _flight:
        return await asyncio.shield(_flight[name])
    fut = asyncio.get_running_loop().create_future()
    _flight[name] = fut
    try:
        val = await fn()
        await set_json(name, val, ttl_s)
        fut.set_result(val)
        return val
    except Exception as e:
        fut.set_exception(e)
        fut.exception()  # mark retrieved so an unawaited failure does not log
        raise
    finally:
        _flight.pop(name, None)


async def invalidate(*names: str) -> None:
    try:
        await layer.client().delete(*[k("cache", n) for n in names])
    except Exception:
        pass


# ── live bot communication stream ───────────────────────────────────────────────────────────────────
STREAM = "comms"
STREAM_MAX = 2000


async def stream_add(entry: dict) -> None:
    try:
        await layer.client().xadd(k(STREAM), {"d": json.dumps(entry, default=str)}, maxlen=STREAM_MAX, approximate=True)
    except Exception:
        pass


async def stream_tail(limit: int = 100) -> list[dict] | None:
    """The newest `limit` entries (oldest first); None when Redis is unavailable. Cheap: reads only what is returned."""
    try:
        rows = await layer.client().xrevrange(k(STREAM), count=limit)
        return [{**json.loads(f["d"]), "sid": sid} for sid, f in reversed(rows)]
    except Exception:
        return None


async def stream_since(last_id: str = "0", limit: int = 100) -> list[dict] | None:
    """Entries after last_id as [{'sid': ..., **entry}], oldest first; None when Redis is unavailable."""
    try:
        rows = await layer.client().xrange(k(STREAM), min=f"({last_id}" if last_id != "0" else "-", max="+", count=limit)
        return [{**json.loads(f["d"]), "sid": sid} for sid, f in rows]
    except Exception:
        return None


# ── live agent state ──────────────────────────────────────────────────────────────────────────────────
async def set_agent_state(slug: str, state: str, bubble: str | None) -> None:
    import time
    try:
        await layer.client().hset(k("agents"), slug, json.dumps({"state": state, "bubble": bubble, "ts": time.time()}))
    except Exception:
        pass


async def agent_states() -> dict:
    try:
        return {s: json.loads(v) for s, v in (await layer.client().hgetall(k("agents"))).items()}
    except Exception:
        return {}


# ── SLO minute counters (survive restarts) ──────────────────────────────────────────────────────────
# One hash per day, fields "<minute>:t|e|lt|ls". Reading a window is 1-2 HGETALLs (the old one-key-per-minute layout needed a SCAN of
# thousands of keys and took seconds).
SLO_TTL = 9 * 24 * 3600


async def slo_incr(minute: int, total: int, errors: int, lat_total: int, slow: int) -> None:
    try:
        p = layer.client().pipeline()
        key = k("slo", "d", str(minute // 1440))
        for f, n in (("t", total), ("e", errors), ("lt", lat_total), ("ls", slow)):
            if n:
                p.hincrby(key, f"{minute}:{f}", n)
        p.expire(key, SLO_TTL)
        await p.execute()
    except Exception:
        pass


async def slo_rows(since_minute: int) -> list[list[int]] | None:
    """[[minute, total, errors, lat_total, slow], ...] from Redis, or None if unavailable."""
    import time
    try:
        c = layer.client()
        now_min = int(time.time() // 60)
        acc: dict[int, list[int]] = {}
        for day in range(since_minute // 1440, now_min // 1440 + 1):
            for field, v in (await c.hgetall(k("slo", "d", str(day)))).items():
                m, _, f = field.partition(":")
                minute = int(m)
                if minute >= since_minute:
                    row = acc.setdefault(minute, [minute, 0, 0, 0, 0])
                    row[{"t": 1, "e": 2, "lt": 3, "ls": 4}[f]] = int(v)
        return sorted(acc.values())
    except Exception:
        return None
