"""
COOS Watchdog — Phase 7B

External guardian process for CREATE ORIGINS OS.
Started by start.bat alongside uvicorn and npm dev.

Responsibilities:
  - Poll for restart signal file written by Darwin / Control Tower
  - On "backend" target: kill port 8000, restart uvicorn
  - On "frontend" target: kill port 3001, restart npm run dev
  - On "all": restart both
  - Log every action to storage/logs/watchdog.log

Signal file: %TEMP%\\coos_restart_signal.json
  {
    "target":    "backend",        // "backend" | "frontend" | "all"
    "reason":    "Darwin applied fix",
    "timestamp": 1719740000
  }

The signal file is consumed (deleted) on read so each signal fires exactly once.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

PYTHON       = r"C:\Users\vijay\AppData\Local\Programs\Python\Python311\python.exe"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR  = PROJECT_ROOT / "backend" / "python"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
SIGNAL_FILE  = Path(os.environ.get("TEMP", "C:/Users/vijay/AppData/Local/Temp")) / "coos_restart_signal.json"
LOG_FILE     = PROJECT_ROOT / "storage" / "logs" / "watchdog.log"
CHECK_INTERVAL = 3   # seconds between polls
DRAIN_WAIT     = 2   # seconds after killing before spawning


# ── Logging ───────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] WATCHDOG  {msg}"
    print(line, flush=True)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ── Process helpers ───────────────────────────────────────────────────────────

def _kill_port(port: int) -> None:
    """Kill whatever process is listening on port (Windows netstat approach)."""
    try:
        result = subprocess.run(
            ["netstat", "-aon"],
            capture_output=True, text=True, timeout=6,
        )
        for line in result.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.strip().split()
                if parts:
                    pid = parts[-1]
                    subprocess.run(
                        ["taskkill", "/PID", pid, "/F"],
                        capture_output=True, timeout=5,
                    )
                    _log(f"Killed PID {pid} (was on port {port})")
    except Exception as exc:
        _log(f"kill_port({port}) error: {exc}")


def _spawn(args: list[str], cwd: str, title: str) -> None:
    """Open a new CMD window with the given command (matches restart.bat style)."""
    cmd = ["cmd", "/k"] + args
    subprocess.Popen(
        cmd,
        cwd=cwd,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    _log(f"Spawned: {' '.join(args)}  (cwd={cwd})")


# ── Restart actions ───────────────────────────────────────────────────────────

def restart_backend() -> None:
    _log("Restarting backend (uvicorn) ...")
    _kill_port(8000)
    time.sleep(DRAIN_WAIT)
    _spawn(
        [PYTHON, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"],
        cwd=str(BACKEND_DIR),
        title="COOS - FastAPI",
    )
    _log("Backend restart complete.")


def restart_frontend() -> None:
    _log("Restarting frontend (npm run dev) ...")
    _kill_port(3001)
    time.sleep(DRAIN_WAIT)
    _spawn(
        ["npm", "run", "dev"],
        cwd=str(FRONTEND_DIR),
        title="COOS - Frontend",
    )
    _log("Frontend restart complete.")


# ── Signal processing ─────────────────────────────────────────────────────────

def _handle_signal(sig: dict) -> None:
    target = sig.get("target", "backend")
    reason = sig.get("reason", "")
    _log(f"Signal consumed — target={target!r}  reason={reason!r}")

    if target in ("backend", "all"):
        restart_backend()
    if target in ("frontend", "all"):
        restart_frontend()


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    _log(f"Started.  Project root: {PROJECT_ROOT}")
    _log(f"Polling signal file every {CHECK_INTERVAL}s: {SIGNAL_FILE}")

    while True:
        try:
            if SIGNAL_FILE.exists():
                raw = SIGNAL_FILE.read_text(encoding="utf-8").strip()
                try:
                    SIGNAL_FILE.unlink()          # consume first — prevent double-fire
                except Exception:
                    pass
                try:
                    sig = json.loads(raw)
                    _handle_signal(sig)
                except json.JSONDecodeError as exc:
                    _log(f"Bad signal JSON: {exc} — raw={raw[:200]!r}")
        except Exception as exc:
            _log(f"Main loop error: {exc}")

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    main()
