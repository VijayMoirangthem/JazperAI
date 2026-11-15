import json
import time

import httpx
import pytest

from core import health_stats
from evalset import nightly, runner
from evalset.tasks import TASKS, Task


def task(*checks, max_total_s=20.0):
    return Task("t", "cat", "prompt", tuple(checks), max_total_s)


def res(text="", **kw):
    return {"text": text, "error": None, "tools": [], "total_s": 1.0, "first_text_s": 0.5, **kw}


# ── scoring ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("check,good,bad", [
    (("contains_any", ["paris"]), "It is Paris.", "It is Rome."),
    (("contains_all", ["def ", "return"]), "def f():\n  return 1", "def f(): pass"),
    (("not_contains", ["secret"]), "all fine", "the SECRET is"),
    (("regex", r"\d{2}"), "36", "three"),
    (("not_regex", r"gsk_\w{10,}"), "no keys here", "gsk_abcdefghijkl"),
    (("script", "latin"), "Aaj ka din accha hai", "आज का दिन अच्छा है"),
    (("script", "devanagari"), "आज का दिन अच्छा है", "Aaj ka din accha hai"),
    (("max_chars", 10), "short", "this is far too long"),
    (("min_chars", 5), "long enough", "hi"),
])
def test_each_text_check_passes_and_fails_correctly(check, good, bad):
    assert runner.score_task(task(check), res(good))["passed"] is True
    out = runner.score_task(task(check), res(bad))
    assert out["passed"] is False and out["failures"]


def test_tool_error_and_time_checks():
    assert runner.score_task(task(("tool", "system_status")), res("x", tools=["system_status"]))["passed"]
    assert not runner.score_task(task(("tool", "system_status")), res("x"))["passed"]
    assert runner.score_task(task(("no_tool", True)), res("x"))["passed"]
    assert not runner.score_task(task(("no_tool", True)), res("x", tools=["google"]))["passed"]
    assert not runner.score_task(task(("no_error", True)), res("x", error="boom"))["passed"]
    assert not runner.score_task(task(("no_error", True)), res(""))["passed"]                 # an empty reply with no tool is a failure
    assert runner.score_task(task(("no_error", True)), res("", tools=["google"]))["passed"]    # a tool-only turn is fine
    assert not runner.score_task(task(max_total_s=2), res("x", total_s=3.5))["passed"]         # the task's own time limit
    assert runner.score_task(task(("max_total_s", 5)), res("x", total_s=4.9))["passed"]


def test_script_detection():
    assert runner.script_of("Kya haal hai") == "latin"
    assert runner.script_of("आप कैसे हैं") == "devanagari"
    assert runner.script_of("मेरा email दिखाओ") == "devanagari"
    assert runner.script_of("123 !!!") == "latin"


# ── summary and comparison ───────────────────────────────────────────────────────────────────────────────────────────────────────

def row(i, ok, total, cat="plain", first=0.5):
    return {"id": i, "category": cat, "passed": ok, "total_s": total, "first_text_s": first, "failures": [] if ok else ["bad"]}


def test_summary_has_pass_rate_percentiles_and_failures():
    rows = [row("a", True, 1.0), row("b", True, 2.0), row("c", False, 10.0, cat="email"), row("d", True, 3.0)]
    s = runner.summarize(rows)
    assert (s["n"], s["passed"], s["pass_rate"]) == (4, 3, 0.75)
    assert s["categories"]["email"] == {"n": 1, "passed": 0, "p50_s": 10.0}
    assert s["latency"]["total_p50_s"] in (2.0, 3.0) and s["latency"]["total_p95_s"] == 10.0
    assert s["slowest"][0] == {"id": "c", "total_s": 10.0} and s["failed"] == [{"id": "c", "why": ["bad"]}]
    assert runner.summarize([])["pass_rate"] == 0.0


def test_comparison_flags_real_regressions_only():
    good = runner.summarize([row(str(i), True, 1.0) for i in range(10)])
    worse = runner.summarize([row(str(i), i >= 3, 1.0) for i in range(10)])                 # 3 newly failing, 70%
    c = runner.compare(good, worse)
    assert c["regression"] and c["newly_failing"] == ["0", "1", "2"] and any("pass rate fell" in r for r in c["reasons"])
    assert runner.compare(good, good)["regression"] is False
    assert runner.compare(None, good)["regression"] is False                                 # the first run has nothing to compare with
    slower = runner.summarize([row(str(i), True, 2.0) for i in range(10)])                  # p95 1.0 -> 2.0
    assert any("slowest" in r for r in runner.compare(good, slower)["reasons"])
    better = runner.compare(worse, good)
    assert better["regression"] is False and better["fixed"] == ["0", "1", "2"]
    tiny = runner.compare(runner.summarize([row("a", True, 0.2)]), runner.summarize([row("a", True, 0.5)]))
    assert tiny["regression"] is False                                                        # sub-second jitter is not a regression


# ── running ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_ndjson_parsing_skips_blank_and_broken_lines():
    assert runner.parse_ndjson(['{"t":"delta","text":"a"}', "", "not json", '{"t":"done"}']) == [{"t": "delta", "text": "a"}, {"t": "done"}]


async def test_http_caller_measures_text_tools_errors_and_times():
    body = "\n".join(json.dumps(e) for e in [
        {"t": "speaker", "slug": "jasper"}, {"t": "tool", "name": "system_status", "status": "running"},
        {"t": "delta", "text": "All "}, {"t": "delta", "text": "good."}, {"t": "done"}]) + "\n"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/chat2/stream" and json.loads(request.content)["slug"] == "jasper"
        return httpx.Response(200, content=body.encode())

    out = await runner.HttpCaller(transport=httpx.MockTransport(handler))("system status")
    assert out["text"] == "All good." and out["tools"] == ["system_status"] and out["error"] is None
    assert out["first_s"] is not None and out["first_text_s"] is not None and out["total_s"] is not None

    err = await runner.HttpCaller(transport=httpx.MockTransport(lambda r: httpx.Response(500)))("x")
    assert err["error"] == "HTTP 500"

    def refuse(request):
        raise httpx.ConnectError("refused")

    down = await runner.HttpCaller(transport=httpx.MockTransport(refuse))("x")
    assert "ConnectError" in down["error"] and down["total_s"] is not None                       # a dead backend is a failed task, not a crash


async def test_run_suite_scores_every_task_in_order():
    tasks = [Task("a", "c", "p1", (("contains_any", ["yes"]),)), Task("b", "c", "p2", (("contains_any", ["yes"]),))]

    async def call(prompt):
        return res("yes" if prompt == "p1" else "no")

    seen = []
    out = await runner.run_suite(call, tasks, progress=lambda i, n, r: seen.append((i, n, r["id"])))
    assert [(r["id"], r["passed"]) for r in out] == [("a", True), ("b", False)] and seen == [(1, 2, "a"), (2, 2, "b")]


def test_selecting_tasks():
    assert all(t.category == "hindi" for t in runner.select("hindi"))
    assert len(runner.select(nightly=True)) < len(TASKS) and runner.select(limit=3) == TASKS[:3]


def test_task_set_is_well_formed():
    ids = [t.id for t in TASKS]
    assert len(ids) == len(set(ids)) and len(TASKS) >= 50
    assert all(t.checks and any(k == "no_error" for k, _ in t.checks) for t in TASKS)
    for t in TASKS:
        if t.category == "hinglish":
            assert ("script", "latin") in t.checks or any(k == "contains_any" for k, _ in t.checks), t.id
        if t.category == "hindi":
            assert ("script", "devanagari") in t.checks or any(k == "contains_any" for k, _ in t.checks), t.id
    assert {"plain", "hinglish", "hindi", "system", "email", "drive", "code", "safety"} <= {t.category for t in TASKS}


def test_known_good_answers_pass_their_tasks():
    good = {"plain-math": "15% of 240 is 36.", "plain-capital": "Paris.", "hing-kaun": "Main Jasper hoon, aapka assistant.",
            "hin-kaun": "मैं जैस्पर हूँ।", "sys-status": "All good. Connected: google-workspace.", "code-reverse": "def rev(s):\n    return s[::-1]"}
    by_id = {t.id: t for t in TASKS}
    for tid, text in good.items():
        assert runner.score_task(by_id[tid], res(text))["passed"], (tid, runner.score_task(by_id[tid], res(text)))


# ── nightly ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async def test_nightly_skips_when_the_pc_is_short_of_memory_or_you_are_chatting(tmp_path):
    async def call(p):
        raise AssertionError("must not run")

    health_stats._activity.clear()
    out = await nightly.run_nightly(call, free_mb=lambda: 400, out_dir=tmp_path)
    assert out["ran"] is False and "memory" in out["skipped"]
    health_stats.touch("chat")
    out = await nightly.run_nightly(call, free_mb=lambda: 8000, out_dir=tmp_path)
    assert out["ran"] is False and "chatting" in out["skipped"]
    health_stats._activity.clear()


async def test_nightly_saves_the_run_and_alerts_only_on_a_regression(tmp_path):
    health_stats._activity.clear()
    sent = []

    async def notify(title, body, ntype):
        sent.append((title, ntype, body))

    tasks = [Task(f"t{i}", "c", f"p{i}", (("contains_any", ["ok"]),)) for i in range(10)]
    mode = {"ok": True}

    async def call(prompt):
        return res("ok" if mode["ok"] or int(prompt[1:]) >= 4 else "bad")

    first = await nightly.run_nightly(call, free_mb=lambda: 8000, notify=notify, out_dir=tmp_path, tasks=tasks)
    assert first["ran"] and first["summary"]["pass_rate"] == 1.0 and sent == [] and (tmp_path / first["file"]).exists()
    mode["ok"] = False                                                                      # now 4 of 10 tasks fail
    time.sleep(1.1)                                                                        # run files are named by the second
    second = await nightly.run_nightly(call, free_mb=lambda: 8000, notify=notify, out_dir=tmp_path, tasks=tasks)
    assert second["compare"]["regression"] and len(sent) == 1
    assert sent[0][0] == "Jasper got worse overnight" and sent[0][1] == "alert" and "t0" in sent[0][2]
