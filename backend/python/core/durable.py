"""Durable LangGraph checkpointer: Postgres when reachable (survives restarts), in-memory fallback with a warning.

The psycopg pool is bound to the event loop that opened it, so the module remembers that loop (`_loop`). A caller on a
different loop never reuses the pool: it gets a fresh one, and the old pool is closed on its own loop (or dropped if that
loop is already closed, which also closes its sockets). A per-loop lock stops concurrent first calls building two pools.
"""
import asyncio
import weakref
from urllib.parse import quote_plus

import structlog
from langgraph.checkpoint.memory import MemorySaver

from core.config import settings

log = structlog.get_logger()
_saver = None
_pool = None
_loop = None  # event loop that owns _pool
_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = weakref.WeakKeyDictionary()


def _lock_for(loop: asyncio.AbstractEventLoop) -> asyncio.Lock:
    lock = _locks.get(loop)
    if lock is None:
        lock = _locks[loop] = asyncio.Lock()
    return lock


async def _release(pool, owner) -> None:
    """Close `pool` on the loop that owns it. Never awaits pool code on a loop that cannot run it."""
    if pool is None:
        return
    try:
        if owner is None or owner is asyncio.get_running_loop():
            await pool.close()
        elif owner.is_running():  # another live loop (e.g. another thread): hand the close to it
            await asyncio.wait_for(asyncio.wrap_future(asyncio.run_coroutine_threadsafe(pool.close(), owner)), 10)
        # else: owner loop is closed/stopped; its connections went down with it, nothing left to await
    except Exception as e:
        log.warning("durable checkpointer pool close failed", error=str(e)[:160])


async def get_checkpointer():
    global _saver, _pool, _loop
    loop = asyncio.get_running_loop()
    async with _lock_for(loop):
        if _saver is not None and (_pool is None or _loop is loop):  # MemorySaver fallback has no loop affinity
            return _saver
        if _pool is not None:  # opened on another loop: never reuse it here
            stale, owner = _pool, _loop
            _saver = _pool = _loop = None
            await _release(stale, owner)
        pool = None
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
            from psycopg_pool import AsyncConnectionPool
            dsn = (f"postgresql://{settings.POSTGRES_USER}:{quote_plus(settings.POSTGRES_PASSWORD)}@{settings.POSTGRES_HOST}:"
                   f"{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}")
            pool = AsyncConnectionPool(dsn, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False, timeout=10)
            await pool.open(wait=True, timeout=10)
            saver = AsyncPostgresSaver(pool)
            await saver.setup()
            _pool, _loop, _saver = pool, loop, saver
            log.info("durable checkpointer: postgres")
        except Exception as e:
            await _release(pool, loop)  # don't leak a half-open pool when falling back
            log.warning("durable checkpointer unavailable, using memory (runs will not survive a restart)", error=str(e)[:160], loop=type(loop).__name__)
            _saver = MemorySaver()
        return _saver


async def close_checkpointer() -> None:
    global _saver, _pool, _loop
    pool, owner = _pool, _loop
    _saver = _pool = _loop = None
    await _release(pool, owner)
