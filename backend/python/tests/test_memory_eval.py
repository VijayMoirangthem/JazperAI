import numpy as np
import pytest

from core.services import memory_eval as me


def corpus(n=60, dim=32, seed=1):
    rng = np.random.default_rng(seed)
    return rng.normal(size=(n, dim))


def test_topk_returns_the_nearest_rows_best_first():
    c = me.normalize(np.eye(4))
    idx, sc = me.topk(c, me.normalize(np.array([0.1, 0.9, 0.0, 0.0])), 2)
    assert idx.tolist() == [1, 0] and sc[0] > sc[1]
    idx, _ = me.topk(c, c[2], 10)                       # asking for more than exist is fine
    assert len(idx) == 4 and idx[0] == 2


def test_overlap_metric():
    assert me.overlap_at_k(np.array([1, 2, 3]), np.array([3, 2, 1])) == 1.0
    assert me.overlap_at_k(np.array([1, 2, 3, 4]), np.array([1, 2, 9, 8])) == 0.5
    assert me.overlap_at_k(np.array([1]), np.array([2])) == 0.0


def test_sampling_is_deterministic_and_skips_fragments():
    texts = ["short", "this is a longer memory about the founder and tea " * 2] * 30
    a, b = me.sample_queries(texts, 5), me.sample_queries(texts, 5)
    assert a == b and len(a) == 5 and all(i % 2 == 1 for i in a)            # only the long chunks qualify
    assert me.query_text("one two three four five six seven eight nine ten eleven twelve thirteen", 12).endswith("twelve")


def test_an_identical_model_scores_perfectly():
    c = corpus()
    idx = list(range(0, 60, 3))
    q = c[idx] + 0.01 * np.random.default_rng(2).normal(size=(len(idx), 32))    # a query is a slightly different view of its own chunk
    r = me.compare(c, c, q, q, idx)
    assert r["overlap_at_k"] == 1.0 and r["self_hit_old"] == 1.0 and r["self_hit_new"] == 1.0 and r["queries"] == len(idx)


def test_an_unrelated_model_scores_badly_and_is_not_recommended():
    c_old, c_new = corpus(seed=1), corpus(dim=16, seed=99)          # a candidate that embeds everything differently
    idx = list(range(0, 60, 3))
    q_old = c_old[idx] + 0.01 * np.random.default_rng(5).normal(size=(len(idx), 32))
    q_new = np.random.default_rng(6).normal(size=(len(idx), 16))     # and whose queries do not match their chunks
    r = me.compare(c_old, c_new, q_old, q_new, idx)
    assert r["overlap_at_k"] < 0.3 and r["self_hit_new"] < 0.3 and r["self_hit_old"] == 1.0
    verdict = me.recommend(r)
    assert verdict["switch"] is False and verdict["reasons"]


def test_a_good_candidate_is_recommended_with_the_savings_listed():
    r = {"overlap_at_k": 0.82, "self_hit_old": 1.0, "self_hit_new": 0.98}
    v = me.recommend(r, {"load_s": 3, "ram_mb": 450, "baseline": {"load_s": 25, "ram_mb": 2300}})
    assert v["switch"] is True
    text = " ".join(v["reasons"])
    assert "1850 MB less memory" in text and "3 s instead of 25 s" in text


def test_a_candidate_worse_at_self_retrieval_is_rejected_even_with_good_overlap():
    v = me.recommend({"overlap_at_k": 0.9, "self_hit_old": 1.0, "self_hit_new": 0.91})
    assert v["switch"] is False and any("worse" in x for x in v["reasons"])


def test_thresholds_are_recalibrated_to_the_candidates_own_scale():
    # e5-style models score unrelated text high (~0.7-0.8): the recall floor must move up, not stay at the baseline's 0.5
    t = me.recalibrate({"new_unrelated_score_p95": 0.80})
    assert t["recall_floor"] == 0.82 and t["recall_floor"] < t["related"] < t["duplicate"] < 1.0
    assert t["baseline"] == {"recall_floor": 0.5, "related": 0.78, "duplicate": 0.93}
    low = me.recalibrate({"new_unrelated_score_p95": 0.20})
    assert low["recall_floor"] == 0.22 and low["related"] < t["related"]
    assert me.recalibrate({}) == {}


def test_score_scale_is_reported_from_the_real_corpus():
    c = me.normalize(corpus(n=80, dim=24)) + 0.0
    idx = list(range(0, 80, 4))
    r = me.compare(c, c, c[idx], c[idx], idx)
    assert -1 < r["new_unrelated_score_median"] < 1 and r["new_unrelated_score_p95"] >= r["new_unrelated_score_median"]
    assert r["new_top1_score_median"] == pytest.approx(1.0, abs=1e-3)
