"""Shared Redis helpers (built on memory/redis/layer.py). Redis is an accelerator and a live-state store, never the only copy of anything:
every function degrades to "miss / no-op" when Redis is down, and durable data stays in Postgres.

Used for: short-TTL caches (org tree, connection overview), the live bot-communication stream, live agent states (survive a backend restart),
persisted SLO minute counters, and per-connector locks.
"""
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


async def cached(name: str, ttl_s: int, fn: Callable[[], Awaitable]):
    """Return the cached value or compute, store and return it."""
    hit = await get_json(name)
    if hit is not None:
        return hit
    val = await fn()
    await set_json(name, val, ttl_s)
    return val


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
SLO_TTL = 8 * 24 * 3600


async def slo_incr(minute: int, total: int, errors: int, lat_total: int, slow: int) -> None:
    try:
        p = layer.client().pipeline()
        key = k("slo", str(minute))
        for f, n in (("t", total), ("e", errors), ("lt", lat_total), ("ls", slow)):
            if n:
                p.hincrby(key, f, n)
        p.expire(key, SLO_TTL)
        await p.execute()
    except Exception:
        pass


async def slo_rows(since_minute: int) -> list[list[int]] | None:
    """[[minute, total, errors, lat_total, slow], ...] from Redis, or None if unavailable."""
    try:
        c, out, cur = layer.client(), [], 0
        while True:
            cur, keys = await c.scan(cur, match=k("slo", "*"), count=500)
            for key in keys:
                m = int(key.rsplit(":", 1)[1])
                if m >= since_minute:
                    h = await c.hgetall(key)
                    out.append([m, int(h.get("t", 0)), int(h.get("e", 0)), int(h.get("lt", 0)), int(h.get("ls", 0))])
            if cur == 0:
                return out
    except Exception:
        return None
