"""Redis layer (spec §4): namespaced keys, typed pub/sub bus, distributed locks, TTL scratchpads, health.

Every operation degrades gracefully: when Redis is down, reads return None/False and writes are dropped with a
warning (callers that need strictness check `await health()`).
"""
import asyncio
import json
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import redis.asyncio as aioredis
import structlog
from pydantic import BaseModel, ConfigDict, Field
from redis.asyncio.retry import Retry
from redis.backoff import ExponentialBackoff
from redis.exceptions import RedisError

from core.config import settings

log = structlog.get_logger()
_client: aioredis.Redis | None = None
_client_loop: asyncio.AbstractEventLoop | None = None


def key(tenant: str, *parts: str) -> str:
    """tenant:{id}:… namespacing (spec §11)."""
    return ":".join(["tenant", tenant, *parts])


def client() -> aioredis.Redis:
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client_loop is not loop:
        _client = aioredis.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT, password=settings.REDIS_PASSWORD,
            decode_responses=True, socket_connect_timeout=1.0, socket_timeout=2.0,
            retry=Retry(ExponentialBackoff(cap=1.0, base=0.05), 3), retry_on_error=[ConnectionError, TimeoutError],
            health_check_interval=15,
        )
        _client_loop = loop
    return _client


async def health() -> bool:
    try:
        return bool(await client().ping())
    except (RedisError, OSError):
        return False


# ── Typed pub/sub bus ────────────────────────────────────────────────────────

class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topic: str
    tenant: str
    trace_id: str = Field(default_factory=lambda: secrets.token_hex(8))
    sent_at: float = Field(default_factory=time.time)
    payload: dict[str, Any] = {}


async def publish(env: Envelope) -> int:
    try:
        return await client().publish(key(env.tenant, "bus", env.topic), env.model_dump_json())
    except (RedisError, OSError) as e:
        log.warning("redis publish dropped", topic=env.topic, error=str(e))
        return 0


async def subscribe(tenant: str, topic: str) -> AsyncIterator[Envelope]:
    ps = client().pubsub()
    await ps.subscribe(key(tenant, "bus", topic))
    try:
        async for msg in ps.listen():
            if msg["type"] == "message":
                yield Envelope.model_validate_json(msg["data"])
    finally:
        await ps.aclose()


# ── Distributed lock (SET NX PX + token, compare-and-delete release) ─────────

_RELEASE = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end"


@asynccontextmanager
async def lock(tenant: str, name: str, ttl_ms: int = 10_000, wait_s: float = 5.0):
    """Yields True if acquired within wait_s, else False. Redis down -> False."""
    k, token = key(tenant, "lock", name), secrets.token_hex(16)
    deadline = time.monotonic() + wait_s
    got = False
    try:
        while True:
            if await client().set(k, token, nx=True, px=ttl_ms):
                got = True
                break
            if time.monotonic() >= deadline:
                break
            await asyncio.sleep(0.02)
    except (RedisError, OSError) as e:
        log.warning("redis lock unavailable", name=name, error=str(e))
    try:
        yield got
    finally:
        if got:
            try:
                await client().eval(_RELEASE, 1, k, token)
            except (RedisError, OSError):
                pass


# ── Scratchpads (TTL JSON) ───────────────────────────────────────────────────

async def scratch_set(tenant: str, pad: str, value: Any, ttl_s: int = 3600) -> bool:
    try:
        return bool(await client().set(key(tenant, "scratch", pad), json.dumps(value), ex=ttl_s))
    except (RedisError, OSError):
        return False


async def scratch_get(tenant: str, pad: str) -> Any | None:
    try:
        raw = await client().get(key(tenant, "scratch", pad))
        return json.loads(raw) if raw else None
    except (RedisError, OSError):
        return None
