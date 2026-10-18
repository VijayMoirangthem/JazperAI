"""Phase 7A — Process Manager.

Provides a COOS-aware view of running processes.
Used by Control Tower to show process health, PID, resource usage.
Also manages the Watchdog restart signal protocol.

All process data comes from psutil — no shell commands needed for listing.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import TypedDict

import psutil
import structlog

log = structlog.get_logger()

_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent.resolve()
_SIGNAL_FILE  = Path(os.environ.get("TEMP", "/tmp")) / "coos_restart_signal.json"


# ── Types ─────────────────────────────────────────────────────────────────────

class ProcessInfo(TypedDict):
    name:      str
    pid:       int | None
    status:    str        # "running" | "stopped" | "crashed" | "unknown"
    cpu_pct:   float
    ram_mb:    float
    uptime_s:  float | None
    cmd:       str


# ── Managed process detection ─────────────────────────────────────────────────
#
# We identify managed processes by scanning all running processes for
# patterns in their command lines — not by tracking PIDs ourselves.

_MANAGED = [
    {
        "name": "backend",
        "label": "FastAPI Backend",
        "patterns": ["uvicorn", "main:app", "main.py"],
    },
    {
        "name": "frontend",
        "label": "Next.js Frontend",
        "patterns": ["next dev", "next start", "next-server"],
    },
    {
        "name": "redis",
        "label": "Redis",
        "patterns": ["redis-server"],
    },
    {
        "name": "postgres",
        "label": "PostgreSQL",
        "patterns": ["postgres", "postgresql"],
    },
    {
        "name": "watchdog",
        "label": "COOS Watchdog",
        "patterns": ["watchdog.py"],
    },
]


def _cmd_matches(proc_cmd: list[str] | str, patterns: list[str]) -> bool:
    if isinstance(proc_cmd, list):
        full = " ".join(proc_cmd).lower()
    else:
        full = str(proc_cmd).lower()
    return any(p.lower() in full for p in patterns)


def _find_proc(patterns: list[str]) -> psutil.Process | None:
    try:
        for proc in psutil.process_iter(["pid", "name", "cmdline", "status"]):
            try:
                cmdline = proc.info.get("cmdline") or []
                name    = proc.info.get("name", "")
                if _cmd_matches(cmdline, patterns) or _cmd_matches(name, patterns):
                    return proc
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    except Exception:
        pass
    return None


def _resource_usage(proc: psutil.Process) -> tuple[float, float]:
    """Return (cpu_pct, ram_mb) — does a 0.1s interval CPU sample."""
    try:
        cpu = proc.cpu_percent(interval=0.1)
        ram = proc.memory_info().rss / (1024 * 1024)
        return round(cpu, 1), round(ram, 1)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return 0.0, 0.0


def _uptime_s(proc: psutil.Process) -> float | None:
    try:
        return round(time.time() - proc.create_time(), 1)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return None


def _proc_cmd_str(proc: psutil.Process) -> str:
    try:
        return " ".join(proc.cmdline())[:200]
    except Exception:
        return ""


# ── Public API ────────────────────────────────────────────────────────────────

def list_processes() -> list[ProcessInfo]:
    """Return health snapshot for all managed processes."""
    results: list[ProcessInfo] = []
    for managed in _MANAGED:
        proc = _find_proc(managed["patterns"])
        if proc:
            cpu, ram = _resource_usage(proc)
            info: ProcessInfo = {
                "name":     managed["name"],
                "pid":      proc.pid,
                "status":   "running",
                "cpu_pct":  cpu,
                "ram_mb":   ram,
                "uptime_s": _uptime_s(proc),
                "cmd":      _proc_cmd_str(proc),
            }
        else:
            info = {
                "name":     managed["name"],
                "pid":      None,
                "status":   "stopped",
                "cpu_pct":  0.0,
                "ram_mb":   0.0,
                "uptime_s": None,
                "cmd":      "",
            }
        results.append(info)
    return results


def get_system_resources() -> dict:
    """Return host-level CPU/RAM/disk snapshot."""
    try:
        cpu    = psutil.cpu_percent(interval=0.2)
        mem    = psutil.virtual_memory()
        disk   = psutil.disk_usage(str(_PROJECT_ROOT))
        return {
            "cpu_pct":      round(cpu, 1),
            "ram_used_gb":  round(mem.used  / (1024 ** 3), 2),
            "ram_total_gb": round(mem.total / (1024 ** 3), 2),
            "ram_pct":      mem.percent,
            "disk_used_gb": round(disk.used  / (1024 ** 3), 2),
            "disk_total_gb":round(disk.total / (1024 ** 3), 2),
            "disk_pct":     round(disk.percent, 1),
        }
    except Exception as exc:
        log.warning("ProcessManager: resource snapshot failed", error=str(exc))
        return {}


def signal_watchdog(target: str, reason: str) -> bool:
    """
    Write the Watchdog restart signal file.
    Watchdog (external process) reads this and restarts the target.

    Args:
      target: "backend" | "frontend" | "all"
      reason: human-readable reason string
    """
    payload = {
        "target":    target,
        "reason":    reason,
        "timestamp": time.time(),
    }
    try:
        _SIGNAL_FILE.write_text(json.dumps(payload), encoding="utf-8")
        log.info("ProcessManager: watchdog signal written",
                 target=target, reason=reason)
        return True
    except Exception as exc:
        log.error("ProcessManager: failed to write watchdog signal", error=str(exc))
        return False


def clear_watchdog_signal() -> None:
    """Called by Watchdog after it has read and acted on the signal."""
    try:
        if _SIGNAL_FILE.exists():
            _SIGNAL_FILE.unlink()
    except Exception:
        pass
