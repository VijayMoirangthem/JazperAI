"""Feature runs on the phone: see the change (redacted diff), request a merge (Tier-3 approval that says what changes), discard."""
import asyncio

import pytest
from fastapi import HTTPException

from agents import feature_flow as ff
from api.routes import remote
from core import diffstats

DIFF = """diff --git a/calc.py b/calc.py
index 111..222 100644
--- a/calc.py
+++ b/calc.py
@@ -1,2 +1,4 @@
 def add(a, b):
-    return a - b
+    return a + b
+
+KEY = "gsk_abcdefghijklmnopqrstuvwx"
diff --git a/test_calc.py b/test_calc.py
new file mode 100644
--- /dev/null
+++ b/test_calc.py
@@ -0,0 +1,3 @@
+from calc import add
+def test_add():
+    assert add(2, 3) == 5
"""


def test_diff_stats_counts_files_and_lines_without_counting_headers():
    st = diffstats.diff_stats(DIFF)
    assert [(f["path"], f["added"], f["removed"]) for f in st["files"]] == [("calc.py", 3, 1), ("test_calc.py", 3, 0)]
    assert (st["added"], st["removed"]) == (6, 1)
    assert diffstats.diff_stats("") == {"files": [], "added": 0, "removed": 0}


def test_stats_line_reads_well():
    assert diffstats.stats_line(diffstats.diff_stats(DIFF)) == "2 files changed (+6 -1): calc.py, test_calc.py"
    assert diffstats.stats_line(diffstats.diff_stats("")) == "no file changes"
    many = "".join(f"diff --git a/f{i}.py b/f{i}.py\n+x\n" for i in range(7))
    assert diffstats.stats_line(diffstats.diff_stats(many)).endswith("f0.py, f1.py, f2.py, f3.py, ...")


def test_safe_diff_redacts_secrets_and_cuts_on_a_line_boundary():
    text, cut = diffstats.safe_diff(DIFF)
    assert "gsk_abcdef" not in text and "<redacted>" in text and cut is False
    big = "+" + "x" * 50 + "\n"
    text, cut = diffstats.safe_diff(big * 1000, limit=500)
    assert cut is True and len(text) <= 500 and text.endswith("x") and "\n" in text


@pytest.fixture
def runs(monkeypatch):
    async def no_audit(*a, **k):
        return None

    monkeypatch.setattr(remote.audit, "write", no_audit)
    monkeypatch.setattr(ff, "RUNS", {
        "r1": {"id": "r1", "task": "fix add", "group": "g", "status": "verified", "merge": None, "branch": "agent/fix-add", "diff": DIFF, "report": "all good gsk_abcdefghijklmnopqrstuvwx"},
        "r2": {"id": "r2", "task": "wip", "group": "g", "status": "running", "merge": None, "branch": "b2", "diff": ""},
        "r3": {"id": "r3", "task": "done", "group": "g", "status": "verified", "merge": "merged", "branch": "b3", "diff": DIFF},
    })
    return ff.RUNS


D = {"id": "dev-1"}


async def test_phone_lists_runs_with_change_size(runs):
    out = await remote.phone_features(d=D)
    cards = {c["id"]: c for c in out["runs"]}
    assert cards["r1"]["files"] == 2 and cards["r1"]["added"] == 6 and cards["r1"]["removed"] == 1 and cards["r1"]["status"] == "verified"
    assert cards["r2"]["files"] == 0
    assert "diff" not in cards["r1"]                                           # the list stays small; the diff is fetched per run


async def test_phone_run_detail_has_a_redacted_diff_and_report(runs):
    out = await remote.phone_feature("r1", d=D)
    assert "gsk_abcdef" not in out["diff"] and "gsk_abcdef" not in out["report"]
    assert [f["path"] for f in out["files_changed"]] == ["calc.py", "test_calc.py"] and out["diff_cut"] is False
    with pytest.raises(HTTPException) as e:
        await remote.phone_feature("nope", d=D)
    assert e.value.status_code == 404


async def test_requesting_a_merge_only_starts_the_approval_and_only_for_verified_runs(runs, monkeypatch):
    started = []

    async def fake_merge(rid):
        started.append(rid)

    monkeypatch.setattr(ff, "merge", fake_merge)
    out = await remote.phone_feature_merge("r1", d=D)
    await asyncio.sleep(0)
    assert out == {"id": "r1", "merge": "awaiting-approval"} and started == ["r1"]
    for rid in ("r2", "r3"):                                                  # still running / already merged
        with pytest.raises(HTTPException) as e:
            await remote.phone_feature_merge(rid, d=D)
        assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        await remote.phone_feature_merge("nope", d=D)
    assert e.value.status_code == 404


async def test_discard_works_but_never_for_a_merged_run(runs, monkeypatch):
    gone = []

    async def fake_discard(rid):
        gone.append(rid)

    monkeypatch.setattr(ff, "discard", fake_discard)
    assert await remote.phone_feature_discard("r2", d=D) == {"discarded": "r2"} and gone == ["r2"]
    with pytest.raises(HTTPException) as e:
        await remote.phone_feature_discard("r3", d=D)
    assert e.value.status_code == 409 and gone == ["r2"]


async def test_the_merge_approval_card_says_what_changes(runs, monkeypatch):
    seen = {}

    async def gate(action, summary, requester, ttl_s=0, **k):
        seen.update(action=action, summary=summary)
        return False                                                           # the founder says no

    monkeypatch.setattr(ff.hitl, "gate", gate)
    runs["r1"].update(repo="D:/repo", lead="lead")
    await ff.merge("r1")
    assert seen["action"] == "git.merge_main"
    assert "2 files changed (+6 -1): calc.py, test_calc.py" in seen["summary"] and "agent/fix-add" in seen["summary"]
    assert runs["r1"]["merge"] == "denied"                                    # nothing merged
