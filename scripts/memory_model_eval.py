"""Dry run: would a lighter memory-embedding model work as well as the current one on YOUR memories? READ-ONLY (nothing is written anywhere
except a report file in storage/eval/). Needs about 3 GB of free RAM and downloads each candidate model once (about 0.5 GB each).

    cd backend\\python
    ..\\.venv\\Scripts\\python.exe ..\\..\\scripts\\memory_model_eval.py --yes
    ..\\.venv\\Scripts\\python.exe ..\\..\\scripts\\memory_model_eval.py --yes --candidates multilingual-e5-small --limit 400

What it reports per candidate: neighbour overlap with the current model, how often a memory is found from its own first words, load time, memory use,
speed per text, and the similarity thresholds that would suit the candidate's own score scale (the memory code's thresholds were tuned for bge-m3).
The verdict is advice. Switching needs the migration in docs/MEMORY_MODEL.md, which this script does not perform.
"""
from __future__ import annotations

import argparse
import asyncio
import gc
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "python"))

BASELINE = {"name": "BAAI/bge-m3", "q": "", "p": ""}
CANDIDATES = {
    "multilingual-e5-small": {"name": "intfloat/multilingual-e5-small", "q": "query: ", "p": "passage: "},          # 384-dim, Hindi included
    "multilingual-MiniLM": {"name": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", "q": "", "p": ""},  # 384-dim, Hindi included
}
MIN_FREE_MB = 3500


def rss_mb() -> float:
    import psutil
    return psutil.Process().memory_info().rss / 1048576


def free_mb() -> float:
    import psutil
    return psutil.virtual_memory().available / 1048576


async def load_texts(limit: int) -> list[str]:
    from memory import consolidate
    from memory.db import aio
    async with aio.tx("memory", (consolidate.TENANT,)) as c:
        rows = await c.fetch("SELECT content FROM shared.memory_chunks WHERE superseded_by IS NULL AND length(content) > 20 "
                             "ORDER BY created_at DESC LIMIT $1", limit)
    await aio.close_pool()
    return [r["content"] for r in rows]


def embed_all(spec: dict, corpus: list[str], queries: list[str]) -> dict:
    """Loads one model, embeds corpus and queries, measures time and memory, and releases the model."""
    import numpy as np
    from sentence_transformers import SentenceTransformer
    before = rss_mb()
    t0 = time.time()
    model = SentenceTransformer(spec["name"])
    load_s = time.time() - t0
    ram = rss_mb() - before
    t1 = time.time()
    c = model.encode([spec["p"] + t for t in corpus], batch_size=16, normalize_embeddings=True, show_progress_bar=False)
    per_text_ms = (time.time() - t1) * 1000 / max(1, len(corpus))
    q = model.encode([spec["q"] + t for t in queries], batch_size=16, normalize_embeddings=True, show_progress_bar=False)
    del model
    gc.collect()
    return {"corpus": np.asarray(c), "queries": np.asarray(q), "load_s": round(load_s, 1), "ram_mb": round(ram), "ms_per_text": round(per_text_ms, 1)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="confirm: loads ~2 models (about 3 GB RAM) and downloads them if needed")
    ap.add_argument("--limit", type=int, default=800, help="how many memory chunks to use (newest first)")
    ap.add_argument("--queries", type=int, default=60)
    ap.add_argument("--candidates", nargs="*", default=list(CANDIDATES), choices=list(CANDIDATES))
    a = ap.parse_args()
    if not a.yes:
        print("This loads two embedding models (about 3 GB RAM) and reads your memories (read-only). Run again with --yes.")
        return 2
    if free_mb() < MIN_FREE_MB:
        print(f"Only {free_mb():.0f} MB of RAM is free; close heavy apps first (need about {MIN_FREE_MB} MB).")
        return 3

    from core.services import memory_eval as me
    texts = asyncio.run(load_texts(a.limit))
    if len(texts) < 30:
        print(f"Only {len(texts)} memories found: too few for a meaningful comparison (need 30+).")
        return 4
    idx = me.sample_queries(texts, a.queries)
    queries = [me.query_text(texts[i]) for i in idx]
    print(f"{len(texts)} memories, {len(idx)} test queries. Loading the current model ({BASELINE['name']}) ...")
    base = embed_all(BASELINE, texts, queries)
    print(f"  current: load {base['load_s']} s, {base['ram_mb']} MB, {base['ms_per_text']} ms/text")

    report: dict = {"memories": len(texts), "queries": len(idx), "baseline": {k: base[k] for k in ("load_s", "ram_mb", "ms_per_text")}, "candidates": {}}
    for key in a.candidates:
        print(f"Loading {CANDIDATES[key]['name']} ...")
        cand = embed_all(CANDIDATES[key], texts, queries)
        cmp = me.compare(base["corpus"], cand["corpus"], base["queries"], cand["queries"], idx)
        speed = {"load_s": cand["load_s"], "ram_mb": cand["ram_mb"], "ms_per_text": cand["ms_per_text"], "baseline": report["baseline"]}
        report["candidates"][key] = {"model": CANDIDATES[key]["name"], "dim": int(cand["corpus"].shape[1]), "compare": cmp, "speed": speed,
                                     "thresholds": me.recalibrate(cmp), "verdict": me.recommend(cmp, speed)}
        v = report["candidates"][key]["verdict"]
        print(f"  {key}: overlap@5 {cmp['overlap_at_k']:.0%}, self-hit {cmp['self_hit_new']:.0%} (current {cmp['self_hit_old']:.0%}) -> "
              f"{'GOOD ENOUGH' if v['switch'] else 'NOT recommended'}")
        for r in v["reasons"]:
            print("     -", r)
        print("     suggested thresholds:", report["candidates"][key]["thresholds"])
    out = ROOT / "storage" / "eval"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"memory-model-{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps(report, indent=1, default=float), encoding="utf-8")
    print("report saved to", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
