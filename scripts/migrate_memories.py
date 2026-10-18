"""Idempotent: copy legacy memory rows through the sanitizer + 1024-dim embedder into shared.memory_chunks.
Run from backend/python:  python ../../scripts/migrate_memories.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "python"))

from core.services.memory_service import memory_service  # noqa: E402
from memory.db import aio  # noqa: E402

SOURCES = [("semantic_memories", "conversation"), ("extracted_memories", "extracted"), ("core_memories", "core")]


async def main() -> None:
    n = 0
    for table, ns in SOURCES:
        for r in await aio.fetch(f"SELECT id::text AS id, content FROM {table}"):
            clean, vec, _ = await memory_service._embed_clean(r["content"])
            await memory_service._store_chunk(ns, clean, vec, source_ref=f"{table}:{r['id']}")
            n += 1
    print(f"migrated {n} rows")
    await aio.close_pool()


asyncio.run(main())
