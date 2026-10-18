"""Verify the shared.audit_log hash chain. Exit 0 = intact, 1 = tampered (prints first bad seq).
Run from backend/python:  python ../../scripts/audit_verify.py"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "python"))

from core import audit  # noqa: E402
from memory.db import aio  # noqa: E402


async def main() -> int:
    pool = await aio.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            ok, bad = await audit.verify(conn)
    print("audit chain OK" if ok else f"TAMPERED at seq {bad}")
    return 0 if ok else 1


sys.exit(asyncio.run(main()))
