"""Move the stored memories to the CLOUD embedding provider (a new vector space). NOT run yet; needs the database and a configured provider.

Why a script: vectors from different models cannot be compared, so ALL memories must be re-embedded together. Until this finishes, memory
recall and storage stay off (embedding_service.memory_space_ok() is False), so nothing ever mixes two spaces.

Safe sequence (each step is resumable; nothing is lost until --swap):
    cd backend\\python
    ..\\.venv\\Scripts\\python.exe ..\\..\\scripts\\memory_reembed.py                  # dry run: counts and cost estimate only
    ..\\.venv\\Scripts\\python.exe ..\\..\\scripts\\memory_reembed.py --apply --yes     # adds column embedding_v2 and fills it in batches
    ..\\.venv\\Scripts\\python.exe ..\\..\\scripts\\memory_reembed.py --swap --yes      # when 0 remain AND you have a backup (scripts\\backup.ps1)

--swap replaces `embedding` with `embedding_v2` in one transaction, clears vectors that could not be re-embedded (they are in the old space), and records
the new space so recall switches on. Roll back by restoring the backup.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "python"))
BATCH = 32


async def counts(c, tenant) -> dict:
    r = await c.fetch("SELECT count(*) FILTER (WHERE superseded_by IS NULL) AS live, "
                      "count(*) FILTER (WHERE superseded_by IS NULL AND embedding_v2 IS NULL) AS todo, "
                      "COALESCE(sum(length(content)) FILTER (WHERE superseded_by IS NULL AND embedding_v2 IS NULL), 0) AS chars "
                      "FROM shared.memory_chunks WHERE tenant=$1", tenant)
    return dict(r[0])


async def main_async(a) -> int:
    from core.services import embedding_service as es
    from memory import consolidate, sanitizer
    from memory.db import aio
    if not es.configured():
        print("No cloud embedding provider is configured (EMBEDDING_BASE_URL, EMBEDDING_MODEL, vault key EMBEDDING_API_KEY).")
        return 2
    tenant = consolidate.TENANT
    async with aio.tx("memory", (tenant,)) as c:
        if a.apply or a.swap:
            await c.execute("ALTER TABLE shared.memory_chunks ADD COLUMN IF NOT EXISTS embedding_v2 vector(1024)")
        try:
            n = await counts(c, tenant)
        except Exception:                                   # the column does not exist yet (dry run before --apply)
            n = {"live": 0, "todo": 0, "chars": 0}
            r = await c.fetch("SELECT count(*) AS live, COALESCE(sum(length(content)), 0) AS chars FROM shared.memory_chunks WHERE tenant=$1 AND superseded_by IS NULL", tenant)
            n.update(live=r[0]["live"], todo=r[0]["live"], chars=r[0]["chars"])
    print(f"{n['live']} live memories, {n['todo']} still to embed (about {int(n['chars']) // 4:,} tokens) with {es._settings().EMBEDDING_MODEL} at {es._settings().EMBEDDING_BASE_URL}")
    if not (a.apply or a.swap):
        print("Dry run only. Use --apply --yes to start (resumable), then --swap --yes.")
        return 0
    if not a.yes:
        print("Add --yes to confirm (memory texts, PII-sanitised, are sent to the embedding provider).")
        return 2

    if a.apply:
        done = 0
        while True:
            async with aio.tx("memory", (tenant,)) as c:
                rows = await c.fetch("SELECT id, content FROM shared.memory_chunks WHERE tenant=$1 AND superseded_by IS NULL AND embedding_v2 IS NULL "
                                     "ORDER BY created_at LIMIT $2", tenant, BATCH)
            if not rows:
                break
            texts = [sanitizer.sanitize(r["content"])[0] for r in rows]
            vecs = await asyncio.to_thread(es.embed_memory_many, texts, BATCH)
            if any(v is None for v in vecs):
                print(f"The provider failed (rate limit / key / network) after {done} memories. Run --apply again later: it resumes.")
                return 5
            async with aio.tx("memory", (tenant,)) as c:
                for r, v in zip(rows, vecs):
                    await c.execute("UPDATE shared.memory_chunks SET embedding_v2 = $1::vector WHERE id = $2", "[" + ",".join(str(x) for x in v) + "]", r["id"])
            done += len(rows)
            print(f"  {done} embedded")
            time.sleep(0.2)                                  # be gentle with free-tier rate limits
        print("All live memories are embedded in the new space. Back up, then run --swap --yes.")

    if a.swap:
        async with aio.tx("memory", (tenant,)) as c:
            n = await counts(c, tenant)
            if n["todo"]:
                print(f"{n['todo']} memories are not embedded yet: run --apply first.")
                return 3
            await c.execute("UPDATE shared.memory_chunks SET embedding = embedding_v2 WHERE tenant=$1 AND embedding_v2 IS NOT NULL", tenant)
            await c.execute("UPDATE shared.memory_chunks SET embedding = NULL WHERE tenant=$1 AND embedding_v2 IS NULL", tenant)   # old-space leftovers
        es.record_memory_space()
        print("Swapped. Memory recall is now ON with", es.space_id())
    await aio.close_pool()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--swap", action="store_true")
    ap.add_argument("--yes", action="store_true")
    return asyncio.run(main_async(ap.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
