"""P1-08: async memory path + guard against new sync-psycopg2 usage."""
import asyncio
import random
import re
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

# Ratchet: files that still import psycopg2 (sync defs run in FastAPI's threadpool). Must only shrink.
LEGACY_LIMIT = 70


def test_psycopg2_ratchet_and_memory_path_clean():
    users = [p for p in ROOT.rglob("*.py")
             if ".venv" not in p.parts and "tests" not in p.parts and re.search(r"^\s*(import|from) psycopg2", p.read_text("utf-8", "ignore"), re.M)]
    assert len(users) <= LEGACY_LIMIT, f"psycopg2 spread: {len(users)}"
    assert not any(p.name == "memory_service.py" for p in users)


@pytest.mark.db
async def test_100_concurrent_memory_searches_do_not_block_loop():
    from core.services.memory_service import memory_service
    from memory.db import aio
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    dim = (await aio.fetch("SELECT atttypmod AS d FROM pg_attribute WHERE attrelid='semantic_memories'::regclass AND attname='embedding'"))[0]["d"]
    await asyncio.gather(*(aio.fetch("SELECT 1") for _ in range(10)))  # warm pool (connect+auth cost)
    lags: list[float] = []
    stop = False

    async def monitor():
        while not stop:
            t = time.perf_counter()
            await asyncio.sleep(0.005)
            lags.append(time.perf_counter() - t - 0.005)

    m = asyncio.create_task(monitor())
    embs = [[random.random() for _ in range(dim)] for _ in range(100)]
    res = await asyncio.gather(*(memory_service.search_memories(e) for e in embs))
    stop = True
    await m
    await aio.close_pool()
    assert len(res) == 100
    assert max(lags) < 0.25, f"event loop blocked {max(lags):.3f}s"
