"""Measure the real backend's resource usage (no simulation): starts run_server.py, waits until /health/ answers, then samples
the whole process tree for a fixed window and writes JSON.

  python scripts/perf/measure_backend.py --label baseline --out baseline.json [--duration 60] [--warmup 20] [--port 8011]

Needs the same environment as the backend (POSTGRES_*/REDIS_*; see scripts/dev/env.sh). Point it at a throwaway database,
not at data you care about. Reported values:
  startup_s      process start -> /health/ 200
  rss_mb_*       resident memory of the server process tree (avg / max over the window, and right after startup)
  cpu_pct_avg    CPU time used by the tree / wall time, as a percentage of ONE core (100 = one core fully busy)
  threads_avg    OS threads in the tree
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[2]


def tree(proc: psutil.Process) -> list[psutil.Process]:
    try:
        return [proc, *proc.children(recursive=True)]
    except psutil.Error:
        return []


def snapshot(proc: psutil.Process) -> dict:
    rss = cpu = threads = 0
    for p in tree(proc):
        try:
            rss += p.memory_info().rss
            t = p.cpu_times()
            cpu += t.user + t.system
            threads += p.num_threads()
        except psutil.Error:
            pass
    return {"rss": rss, "cpu": cpu, "threads": threads, "procs": len(tree(proc))}


def get(url: str, timeout: float = 3.0):
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 (local loopback only)
        return r.status, r.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    ap.add_argument("--out", default=None)
    ap.add_argument("--port", type=int, default=8011)
    ap.add_argument("--duration", type=int, default=60)
    ap.add_argument("--warmup", type=int, default=20)
    ap.add_argument("--startup-timeout", type=int, default=240)
    a = ap.parse_args()

    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    t0 = time.time()
    server = subprocess.Popen([sys.executable, str(ROOT / "backend" / "python" / "run_server.py"), "--port", str(a.port)],
                              cwd=ROOT / "backend" / "python", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc = psutil.Process(server.pid)
    base = f"http://127.0.0.1:{a.port}"
    try:
        ready = None
        while time.time() - t0 < a.startup_timeout:
            if server.poll() is not None:
                print("server exited early", file=sys.stderr)
                return 2
            try:
                if get(base + "/health/")[0] == 200:
                    ready = time.time() - t0
                    break
            except Exception:
                time.sleep(1)
        if ready is None:
            print("server did not become healthy", file=sys.stderr)
            return 3
        after_start = snapshot(proc)
        time.sleep(a.warmup)  # let startup tasks (seeding, autoconnect, first scheduler runs) settle

        s0, w0 = snapshot(proc), time.time()
        rss, threads = [], []
        while time.time() - w0 < a.duration:
            time.sleep(2)
            s = snapshot(proc)
            rss.append(s["rss"])
            threads.append(s["threads"])
        s1, w1 = snapshot(proc), time.time()

        extra = {}
        for name, path in (("performance", "/api/performance/status"),):  # present once the performance module exists
            try:
                extra[name] = json.loads(get(base + path)[1])
            except Exception:
                pass
        res = {
            "label": a.label, "startup_s": round(ready, 1),
            "rss_mb_after_startup": round(after_start["rss"] / 1048576, 1),
            "rss_mb_avg": round(sum(rss) / len(rss) / 1048576, 1), "rss_mb_max": round(max(rss) / 1048576, 1),
            "cpu_pct_avg": round(100 * (s1["cpu"] - s0["cpu"]) / (w1 - w0), 2),
            "threads_avg": round(sum(threads) / len(threads), 1), "processes": s1["procs"],
            "window_s": round(w1 - w0), "logical_cores": psutil.cpu_count(), "server_status": extra.get("performance"),
        }
        print(json.dumps(res, indent=2))
        if a.out:
            Path(a.out).write_text(json.dumps(res, indent=2), encoding="utf-8")
        return 0
    finally:
        for p in reversed(tree(proc)):
            try:
                p.kill()
            except psutil.Error:
                pass
        server.wait(timeout=20)


if __name__ == "__main__":
    sys.exit(main())
