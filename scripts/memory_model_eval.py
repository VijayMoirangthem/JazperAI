"""Dry run: is the configured CLOUD embedding model good enough for YOUR memories? READ-ONLY (writes only a report to storage/eval/).

No model is loaded on this PC: the memories' stored vectors (made by the previous model) are the baseline, and the cloud model embeds the same
texts through its API. Cost: one embedding request per ~32 memories (a few hundred memories = a few thousand tokens).

    cd backend\\python
    ..\\.venv\\Scripts\\python.exe ..\\..\\scripts\\memory_model_eval.py --yes
    ..\\.venv\\Scripts\\python.exe ..\\..\\scripts\\memory_model_eval.py --yes --limit 200 --queries 30

Needs EMBEDDING_BASE_URL + EMBEDDING_MODEL (config / .env) and the key in the vault as EMBEDDING_API_KEY. See docs/MEMORY_MODEL.md.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "python"))


async def load_rows(limit: int) -> list[tuple[str, list[float]]]:
    from memory import consolidate
    from memory.db import aio
    async with aio.tx("memory", (consolidate.TENANT,)) as c:
        rows = await c.fetch("SELECT content, embedding::text AS emb FROM shared.memory_chunks WHERE superseded_by IS NULL AND embedding IS NOT NULL "
                             "AND length(content) > 20 ORDER BY created_at DESC LIMIT $1", limit)
    await aio.close_pool()
    return [(r["content"], json.loads(r["emb"])) for r in rows]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="confirm: sends your (sanitised) memory texts to the configured embedding provider")
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument("--queries", type=int, default=40)
    a = ap.parse_args()

    from core.services import embedding_service as es, memory_eval as me
    from memory import sanitizer
    if not es.configured():
        print("No cloud embedding provider is configured (EMBEDDING_BASE_URL, EMBEDDING_MODEL, vault key EMBEDDING_API_KEY).")
        return 2
    if not a.yes:
        print(f"This sends up to {a.limit} memory texts (PII-sanitised) to {es._settings().EMBEDDING_BASE_URL} for embedding. Run again with --yes.")
        return 2

    import numpy as np
    rows = asyncio.run(load_rows(a.limit))
    if len(rows) < 30:
        print(f"Only {len(rows)} embedded memories found: too few for a meaningful comparison (need 30+).")
        return 4
    texts = [sanitizer.sanitize(t)[0] for t, _ in rows]
    stored = np.asarray([v for _, v in rows], dtype=float)
    idx = me.sample_queries(texts, a.queries)
    print(f"{len(texts)} memories, {len(idx)} test queries. Embedding with {es._settings().EMBEDDING_MODEL} ...")
    t0 = time.time()
    cloud_vecs = es.embed_memory_many(texts)
    prefix_vecs = es.embed_memory_many([me.query_text(texts[i]) for i in idx])
    if any(v is None for v in cloud_vecs + prefix_vecs):
        print("The provider failed for some texts (rate limit or key problem). Nothing was changed. Check the key / try --limit 100.")
        return 5
    seconds = time.time() - t0
    cmp = me.compare_stored(stored, np.asarray(cloud_vecs, dtype=float), np.asarray(prefix_vecs, dtype=float), idx)
    verdict = me.recommend(cmp)
    report = {"model": es._settings().EMBEDDING_MODEL, "endpoint": es._settings().EMBEDDING_BASE_URL, "memories": len(texts), "queries": len(idx),
              "seconds": round(seconds, 1), "approx_tokens": sum(len(t) for t in texts) // 4, "compare": cmp,
              "thresholds": me.recalibrate(cmp), "verdict": verdict}
    print(f"overlap@5 with the current memory space: {cmp['overlap_at_k']:.0%}   finds a memory from its own first words: {cmp['self_hit_new']:.0%}")
    print("verdict:", "GOOD ENOUGH" if verdict["switch"] else "NOT recommended")
    for r in verdict["reasons"]:
        print("   -", r)
    print("suggested thresholds for this model:", report["thresholds"])
    out = ROOT / "storage" / "eval"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"memory-model-{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps(report, indent=1, default=float), encoding="utf-8")
    print("report saved to", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
