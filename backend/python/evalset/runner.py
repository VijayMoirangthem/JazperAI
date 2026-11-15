"""Runs the task set against a live Jasper and reports quality AND speed; compares with the previous run to catch regressions.

    python -m evalset.runner --base http://127.0.0.1:8000 [--nightly] [--category plain] [--limit 10]

Everything except `HttpCaller` is pure (no network), so the scoring, summary and comparison are unit-tested.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import time
from pathlib import Path
from typing import Awaitable, Callable

from evalset.tasks import TASKS, Task

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = ROOT / "storage" / "eval"
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
Caller = Callable[[str], Awaitable[dict]]


# ── scoring ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def script_of(text: str) -> str:
    """'devanagari' when more than a quarter of the letters are Devanagari, else 'latin'."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "latin"
    return "devanagari" if len(_DEVANAGARI.findall(text)) / len(letters) > 0.25 else "latin"


def score_task(task: Task, r: dict) -> dict:
    """{passed, failures:[..]} for one task result `r` ({text, error, tools, total_s, ...})."""
    text = r.get("text") or ""
    low = text.lower()
    fails: list[str] = []
    for kind, value in task.checks:
        if kind == "no_error" and (r.get("error") or not text.strip() and not r.get("tools")):
            fails.append("error or empty reply" + (f": {r.get('error')}" if r.get("error") else ""))
        elif kind == "contains_any" and not any(v.lower() in low for v in value):
            fails.append(f"none of {value[:4]} in the reply")
        elif kind == "contains_all" and not all(v.lower() in low for v in value):
            fails.append(f"missing one of {value[:4]}")
        elif kind == "not_contains" and any(v.lower() in low for v in value):
            fails.append(f"forbidden text present: {[v for v in value if v.lower() in low][:2]}")
        elif kind == "regex" and not re.search(value, text):
            fails.append(f"no match for /{value[:40]}/")
        elif kind == "not_regex" and re.search(value, text):
            fails.append(f"forbidden pattern matched /{value[:40]}/")
        elif kind == "script" and script_of(text) != value:
            fails.append(f"reply is in {script_of(text)}, expected {value}")
        elif kind == "max_chars" and len(text) > value:
            fails.append(f"too long ({len(text)} > {value})")
        elif kind == "min_chars" and len(text.strip()) < value:
            fails.append(f"too short ({len(text.strip())} < {value})")
        elif kind == "tool" and value not in (r.get("tools") or []):
            fails.append(f"tool {value} was not used")
        elif kind == "no_tool" and r.get("tools"):
            fails.append(f"used tools {r['tools'][:2]} for a plain question")
        elif kind == "max_total_s" and (r.get("total_s") or 0) > value:
            fails.append(f"took {r.get('total_s'):.1f}s (limit {value}s)")
    limit = task.max_total_s
    if (r.get("total_s") or 0) > limit and not any(k == "max_total_s" for k, _ in task.checks):
        fails.append(f"took {r.get('total_s'):.1f}s (limit {limit:g}s)")
    return {"passed": not fails, "failures": fails}


def _pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    vals = sorted(values)
    k = min(len(vals) - 1, max(0, int(round(p * (len(vals) - 1)))))
    return round(vals[k], 2)


def summarize(results: list[dict]) -> dict:
    """Pass rate (overall and per category), latency percentiles, the slowest tasks and the failing ids."""
    n = len(results)
    passed = sum(1 for r in results if r["passed"])
    by_cat: dict[str, dict] = {}
    for r in results:
        c = by_cat.setdefault(r["category"], {"n": 0, "passed": 0, "totals": []})
        c["n"] += 1
        c["passed"] += 1 if r["passed"] else 0
        if r.get("total_s") is not None:
            c["totals"].append(r["total_s"])
    totals = [r["total_s"] for r in results if r.get("total_s") is not None]
    firsts = [r["first_text_s"] for r in results if r.get("first_text_s") is not None]
    return {
        "n": n,
        "passed": passed,
        "pass_rate": round(passed / n, 4) if n else 0.0,
        "categories": {k: {"n": v["n"], "passed": v["passed"], "p50_s": _pct(v["totals"], 0.5)} for k, v in sorted(by_cat.items())},
        "latency": {"total_p50_s": _pct(totals, 0.5), "total_p95_s": _pct(totals, 0.95), "first_text_p50_s": _pct(firsts, 0.5),
                    "first_text_p95_s": _pct(firsts, 0.95), "mean_total_s": round(statistics.mean(totals), 2) if totals else None},
        "slowest": [{"id": r["id"], "total_s": r["total_s"]} for r in sorted(results, key=lambda r: -(r.get("total_s") or 0))[:5]],
        "failed": [{"id": r["id"], "why": r["failures"][:2]} for r in results if not r["passed"]],
    }


def compare(prev: dict | None, cur: dict) -> dict:
    """Regression report between two summaries: lower pass rate, newly failing tasks, slower p95."""
    out = {"regression": False, "reasons": [], "newly_failing": [], "fixed": []}
    if not prev:
        return out
    pf, cf = {f["id"] for f in prev.get("failed", [])}, {f["id"] for f in cur.get("failed", [])}
    out["newly_failing"], out["fixed"] = sorted(cf - pf), sorted(pf - cf)
    drop = prev.get("pass_rate", 0) - cur.get("pass_rate", 0)
    if drop >= 0.08:
        out["reasons"].append(f"pass rate fell from {prev['pass_rate']:.0%} to {cur['pass_rate']:.0%}")
    p_old, p_new = (prev.get("latency") or {}).get("total_p95_s"), (cur.get("latency") or {}).get("total_p95_s")
    if p_old and p_new and p_old >= 1.0 and p_new > p_old * 1.3:
        out["reasons"].append(f"slowest 5% of replies went from {p_old:g}s to {p_new:g}s")
    if len(out["newly_failing"]) >= 3:
        out["reasons"].append(f"{len(out['newly_failing'])} tasks started failing")
    out["regression"] = bool(out["reasons"])
    return out


# ── running ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def parse_ndjson(lines: list[str]) -> list[dict]:
    out = []
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out


class HttpCaller:
    """Sends a prompt to /api/chat2/stream (the same brain the phone uses) and measures first event / first text / total time."""

    def __init__(self, base: str = "http://127.0.0.1:8000", slug: str = "jasper", timeout: float = 120.0, transport=None):
        self.base, self.slug, self.timeout, self.transport = base.rstrip("/"), slug, timeout, transport  # transport: for tests

    async def __call__(self, prompt: str) -> dict:
        import httpx
        t0 = time.monotonic()
        res = {"text": "", "error": None, "tools": [], "first_s": None, "first_text_s": None, "total_s": None}
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as c:
                async with c.stream("POST", f"{self.base}/api/chat2/stream", json={"text": prompt, "slug": self.slug, "history": []}) as r:
                    if r.status_code != 200:
                        res["error"] = f"HTTP {r.status_code}"
                    async for line in r.aiter_lines():
                        now = time.monotonic() - t0
                        for ev in parse_ndjson([line]):
                            if res["first_s"] is None:
                                res["first_s"] = round(now, 2)
                            t = ev.get("t")
                            if t == "delta":
                                if res["first_text_s"] is None:
                                    res["first_text_s"] = round(now, 2)
                                res["text"] += ev.get("text", "")
                            elif t == "tool" and ev.get("name") and ev["name"] not in res["tools"]:
                                res["tools"].append(ev["name"])
                            elif t == "error":
                                res["error"] = str(ev.get("message", "error"))[:200]
        except Exception as e:  # noqa: BLE001 - a failed call is a failed task, not a crashed run
            res["error"] = f"{type(e).__name__}: {str(e)[:150]}"
        res["total_s"] = round(time.monotonic() - t0, 2)
        return res


async def run_suite(call: Caller, tasks: list[Task], progress: Callable[[int, int, dict], None] | None = None) -> list[dict]:
    """One task at a time (never adds load while it measures); returns scored results."""
    results = []
    for i, task in enumerate(tasks, 1):
        r = await call(task.prompt)
        row = {"id": task.id, "category": task.category, "prompt": task.prompt, **r, **score_task(task, r)}
        row["text"] = (row.get("text") or "")[:600]
        results.append(row)
        if progress:
            progress(i, len(tasks), row)
    return results


def select(category: str | None = None, nightly: bool = False, limit: int | None = None) -> list[Task]:
    tasks = [t for t in TASKS if (not category or t.category == category) and (not nightly or t.nightly)]
    return tasks[:limit] if limit else tasks


def save_run(summary: dict, results: list[dict], out_dir: Path | None = None) -> Path:
    d = out_dir or OUT_DIR
    d.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    p = d / f"run-{stamp}.json"
    p.write_text(json.dumps({"at": stamp, "summary": summary, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    return p


def latest_run(out_dir: Path | None = None, skip: Path | None = None) -> dict | None:
    d = out_dir or OUT_DIR
    files = sorted(p for p in d.glob("run-*.json") if p != skip) if d.exists() else []
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def format_report(summary: dict, cmp: dict | None = None) -> str:
    lat = summary["latency"]
    lines = [f"Passed {summary['passed']}/{summary['n']} ({summary['pass_rate']:.0%})   "
             f"reply time p50 {lat['total_p50_s']}s  p95 {lat['total_p95_s']}s   first words p50 {lat['first_text_p50_s']}s"]
    for k, v in summary["categories"].items():
        lines.append(f"  {k:9s} {v['passed']}/{v['n']}   p50 {v['p50_s']}s")
    for f in summary["failed"][:15]:
        lines.append(f"  FAIL {f['id']}: {'; '.join(f['why'])}")
    if cmp and cmp.get("regression"):
        lines.append("  REGRESSION: " + "; ".join(cmp["reasons"]))
    return "\n".join(lines)


async def main_async(args) -> int:
    tasks = select(args.category, args.nightly, args.limit)
    caller = HttpCaller(args.base)
    results = await run_suite(caller, tasks, progress=lambda i, n, r: print(f"[{i}/{n}] {'ok  ' if r['passed'] else 'FAIL'} {r['id']}  {r.get('total_s')}s"))
    summary = summarize(results)
    prev = latest_run()
    path = save_run(summary, results)
    cmp = compare(prev["summary"] if prev else None, summary)
    print(format_report(summary, cmp))
    print("saved", path)
    return 1 if cmp["regression"] else 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Jasper quality + latency test set")
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--category")
    ap.add_argument("--nightly", action="store_true", help="the lighter subset used for the nightly run")
    ap.add_argument("--limit", type=int)
    raise SystemExit(asyncio.run(main_async(ap.parse_args())))


if __name__ == "__main__":
    main()
