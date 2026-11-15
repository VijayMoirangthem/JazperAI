"""Is a lighter memory-embedding model good enough for THIS founder's memories? (pure comparison logic; the script that loads the models is
scripts/memory_model_eval.py, and nothing here touches the database.)

Method, no labels needed: take real memory chunks as the corpus; queries are the first words of random chunks (what a real question looks like:
the start of something you stored). For the baseline model and a candidate we ask:
  * overlap@k      do they retrieve the same neighbours? (1.0 = identical lists)
  * self-hit@1     does the query find its own chunk first?
  * score scale    the similarity numbers differ between models; memory.consolidate has thresholds tuned for the baseline (related / duplicate /
                   recall floor), so we report where the candidate's "unrelated" scores sit to recalibrate them.
"""
from __future__ import annotations

import random

import numpy as np


def normalize(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=-1, keepdims=True)
    return m / np.where(n == 0, 1, n)


def topk(corpus: np.ndarray, q: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Indices and cosine scores of the k nearest corpus rows (rows and q are normalised)."""
    scores = corpus @ q
    k = min(k, len(scores))
    idx = np.argpartition(-scores, k - 1)[:k]
    idx = idx[np.argsort(-scores[idx])]
    return idx, scores[idx]


def overlap_at_k(a: np.ndarray, b: np.ndarray) -> float:
    return len(set(a.tolist()) & set(b.tolist())) / max(1, len(a))


def sample_queries(texts: list[str], n: int, words: int = 12, seed: int = 7) -> list[int]:
    """Indices of corpus chunks to use as queries (those long enough to have a meaningful beginning)."""
    ok = [i for i, t in enumerate(texts) if len(t.split()) >= max(6, words // 2)]
    rng = random.Random(seed)
    rng.shuffle(ok)
    return sorted(ok[:n])


def query_text(text: str, words: int = 12) -> str:
    return " ".join(text.split()[:words])


def compare(corpus_old: np.ndarray, corpus_new: np.ndarray, q_old: np.ndarray, q_new: np.ndarray, query_idx: list[int], k: int = 5) -> dict:
    """corpus_*: (n, dim) matrices; q_*: (len(query_idx), dim) query vectors from each model; query i came from corpus row query_idx[i]."""
    co, cn, qo, qn = normalize(corpus_old), normalize(corpus_new), normalize(q_old), normalize(q_new)
    overlaps, self_old, self_new, top1_new, others_new = [], 0, 0, [], []
    for i, src in enumerate(query_idx):
        io, _so = topk(co, qo[i], k)
        inn, sn = topk(cn, qn[i], k)
        overlaps.append(overlap_at_k(io, inn))
        self_old += int(io[0] == src)
        self_new += int(inn[0] == src)
        top1_new.append(float(sn[0]))
        if len(sn) > 1:
            others_new.append(float(sn[1]))
    # the score of an UNRELATED pair under the candidate: median / 95th percentile of random corpus pairs
    rng = np.random.default_rng(3)
    a = rng.integers(0, len(cn), size=min(2000, len(cn) * 4))
    b = rng.integers(0, len(cn), size=len(a))
    keep = a != b
    pair = np.sum(cn[a[keep]] * cn[b[keep]], axis=1)
    n = max(1, len(query_idx))
    return {
        "queries": len(query_idx),
        "k": k,
        "overlap_at_k": round(float(np.mean(overlaps)) if overlaps else 0.0, 3),
        "self_hit_old": round(self_old / n, 3),
        "self_hit_new": round(self_new / n, 3),
        "new_top1_score_median": round(float(np.median(top1_new)), 3) if top1_new else None,
        "new_second_score_median": round(float(np.median(others_new)), 3) if others_new else None,
        "new_unrelated_score_median": round(float(np.median(pair)), 3) if len(pair) else None,
        "new_unrelated_score_p95": round(float(np.percentile(pair, 95)), 3) if len(pair) else None,
    }


def recalibrate(report: dict, old_related: float = 0.78, old_duplicate: float = 0.93, old_floor: float = 0.5) -> dict:
    """Suggested replacement thresholds for the candidate, placed relative to ITS scale of unrelated scores (not copied from the baseline).

    Rule: a recall floor just above the 95th percentile of unrelated pairs, 'related' halfway between that and 1, 'duplicate' near the top.
    The result is a starting point to confirm on real examples, never to apply blindly."""
    p95 = report.get("new_unrelated_score_p95")
    if p95 is None:
        return {}
    floor = min(0.9, round(p95 + 0.02, 2))
    related = round(floor + (1 - floor) * 0.45, 2)
    duplicate = round(floor + (1 - floor) * 0.8, 2)
    return {"recall_floor": floor, "related": related, "duplicate": duplicate,
            "baseline": {"recall_floor": old_floor, "related": old_related, "duplicate": old_duplicate}}


def recommend(report: dict, speed: dict | None = None, min_overlap: float = 0.6, min_self_hit: float = 0.9) -> dict:
    """A plain verdict. `speed` = {"load_s", "ms_per_text", "ram_mb"} of the candidate (and optionally of the baseline under "baseline")."""
    reasons, ok = [], True
    if report["overlap_at_k"] < min_overlap:
        ok = False
        reasons.append(f"retrieves different neighbours than the current model (overlap {report['overlap_at_k']:.0%}, wanted {min_overlap:.0%}+)")
    if report["self_hit_new"] < min_self_hit:
        ok = False
        reasons.append(f"finds a memory from its own first words only {report['self_hit_new']:.0%} of the time (wanted {min_self_hit:.0%}+)")
    if report.get("self_hit_old") is not None and report["self_hit_new"] + 0.05 < report["self_hit_old"]:
        reasons.append(f"noticeably worse than the current model at finding a memory from its own words ({report['self_hit_new']:.0%} vs {report['self_hit_old']:.0%})")
        ok = False
    if speed and speed.get("baseline"):
        b = speed["baseline"]
        if speed.get("ram_mb") and b.get("ram_mb"):
            reasons.append(f"uses about {b['ram_mb'] - speed['ram_mb']:.0f} MB less memory ({speed['ram_mb']:.0f} vs {b['ram_mb']:.0f} MB)")
        if speed.get("load_s") is not None and b.get("load_s"):
            reasons.append(f"loads in {speed['load_s']:.0f} s instead of {b['load_s']:.0f} s")
    return {"switch": ok, "reasons": reasons}


def compare_stored(stored: np.ndarray, cloud: np.ndarray, cloud_prefix_q: np.ndarray, query_idx: list[int], k: int = 5) -> dict:
    """Judge a CLOUD model against the memories' STORED vectors (made by the previous model) without loading that model.

    stored / cloud: (n, dim) vectors of the same n chunks in the old and the new space. Each test chunk is used as a query in both spaces
    (itself excluded) and the neighbour lists are compared: overlap@k. `cloud_prefix_q[i]` is the cloud embedding of the first words of
    chunk query_idx[i]: self-hit is how often it finds its own chunk (a realistic 'remember something from its start' query)."""
    so, cn, qp = normalize(stored), normalize(cloud), normalize(cloud_prefix_q)
    overlaps, hits = [], 0
    for i, src in enumerate(query_idx):
        io, _ = topk(so, so[src], k + 1)
        inn, _ = topk(cn, cn[src], k + 1)
        io, inn = io[io != src][:k], inn[inn != src][:k]
        overlaps.append(overlap_at_k(io, inn) if len(io) else 0.0)
        top, _ = topk(cn, qp[i], 1)
        hits += int(top[0] == src)
    base = compare(stored, cloud, stored[query_idx], cn[query_idx], query_idx, k)   # reuse the score-scale statistics of the cloud space
    n = max(1, len(query_idx))
    return {**base, "overlap_at_k": round(float(np.mean(overlaps)) if overlaps else 0.0, 3), "self_hit_new": round(hits / n, 3), "self_hit_old": None}
