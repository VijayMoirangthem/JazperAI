"""Durable LangGraph checkpointer: Postgres when reachable (survives restarts), in-memory fallback with a warning."""
from urllib.parse import quote_plus

import structlog
from langgraph.checkpoint.memory import MemorySaver

from core.config import settings

log = structlog.get_logger()
_saver = None
_pool = None


async def get_checkpointer():
    global _saver, _pool
    if _saver is not None:
        return _saver
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        from psycopg_pool import AsyncConnectionPool
        dsn = (f"postgresql://{settings.POSTGRES_USER}:{quote_plus(settings.POSTGRES_PASSWORD)}@{settings.POSTGRES_HOST}:"
               f"{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}")
        _pool = AsyncConnectionPool(dsn, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False, timeout=10)
        await _pool.open(wait=True, timeout=10)
        _saver = AsyncPostgresSaver(_pool)
        await _saver.setup()
        log.info("durable checkpointer: postgres")
    except Exception as e:
        log.warning("durable checkpointer unavailable, using memory (runs will not survive a restart)", error=str(e)[:160])
        _saver = MemorySaver()
    return _saver


async def close_checkpointer() -> None:
    global _saver, _pool
    if _pool is not None:
        await _pool.close()
    _saver = _pool = None
