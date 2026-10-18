"""Async Postgres access (asyncpg pool). Pool is bound to the running event loop and rebuilt if the loop changes."""
import asyncio
from contextlib import asynccontextmanager

import asyncpg
import structlog

from core.config import settings

log = structlog.get_logger()
_pool: asyncpg.Pool | None = None
_pool_loop: asyncio.AbstractEventLoop | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool, _pool_loop
    loop = asyncio.get_running_loop()
    if _pool is None or _pool_loop is not loop:
        _pool = await asyncpg.create_pool(
            host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT, user=settings.POSTGRES_USER,
            password=settings.POSTGRES_PASSWORD, database=settings.POSTGRES_DB, min_size=1, max_size=10,
        )
        _pool_loop = loop
    return _pool


@asynccontextmanager
async def tx(principal_id: str = "", tenants: tuple[str, ...] = ()):
    """Transaction with tenancy context applied (SET LOCAL ROLE app_runtime + GUCs) when tenants are given."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if tenants:
                await conn.execute("SET LOCAL ROLE app_runtime")
                await conn.execute(
                    "SELECT set_config('app.principal_id', $1, true), set_config('app.tenants', $2, true)",
                    principal_id, ",".join(tenants),
                )
            yield conn


async def fetch(sql: str, *args):
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetch(sql, *args)


async def execute(sql: str, *args):
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.execute(sql, *args)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
