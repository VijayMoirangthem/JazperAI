"""
COOS Service Registry — Phase 7E

In-memory + JSON-persisted list of external projects / services that COOS can
manage: start, stop, health-check, and Voyager-test.

Each service entry:
  {
    "id":          str,          # UUID
    "name":        str,          # human label, e.g. "Portfolio API"
    "path":        str,          # absolute path to the project root (optional)
    "start_cmd":   str,          # command to start, e.g. "npm run dev"
    "stop_cmd":    str | None,   # command to stop (optional — Ctrl+C if None)
    "health_url":  str | None,   # URL to GET for health check
    "tags":        list[str],    # e.g. ["api", "node"]
    "status":      str,          # "unknown" | "running" | "stopped" | "error"
    "added_at":    str,          # ISO timestamp
    "last_checked": str | None,  # ISO timestamp of last health check
  }

Commander is used to start/stop services (goes through risk gate as normal).
"""

from __future__ import annotations

import datetime
import json
import uuid
from pathlib import Path

import structlog

log = structlog.get_logger()

_REGISTRY_FILE = Path(__file__).parent.parent.parent.parent.parent / "data" / "service_registry.json"

_registry: dict[str, dict] = {}   # id → entry


# ── Persistence ───────────────────────────────────────────────────────────────

def _load() -> None:
    global _registry
    if not _REGISTRY_FILE.exists():
        _registry = {}
        return
    try:
        _registry = json.loads(_REGISTRY_FILE.read_text(encoding="utf-8"))
        log.info("ServiceRegistry: loaded", count=len(_registry))
    except Exception as exc:
        log.warning("ServiceRegistry: load failed", error=str(exc))
        _registry = {}


def _save() -> None:
    try:
        _REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
        _REGISTRY_FILE.write_text(json.dumps(_registry, indent=2), encoding="utf-8")
    except Exception as exc:
        log.warning("ServiceRegistry: save failed", error=str(exc))


# ── Load on import ────────────────────────────────────────────────────────────

_load()


# ── Public API ────────────────────────────────────────────────────────────────

def list_services() -> list[dict]:
    return list(_registry.values())


def get_service(service_id: str) -> dict | None:
    return _registry.get(service_id)


def add_service(
    name:        str,
    start_cmd:   str,
    *,
    path:        str = "",
    stop_cmd:    str | None = None,
    health_url:  str | None = None,
    tags:        list[str] | None = None,
) -> dict:
    sid = str(uuid.uuid4())
    entry = {
        "id":           sid,
        "name":         name,
        "path":         path,
        "start_cmd":    start_cmd,
        "stop_cmd":     stop_cmd,
        "health_url":   health_url,
        "tags":         tags or [],
        "status":       "unknown",
        "added_at":     datetime.datetime.utcnow().isoformat() + "Z",
        "last_checked": None,
    }
    _registry[sid] = entry
    _save()
    log.info("ServiceRegistry: added", id=sid, name=name)
    return entry


def update_service(service_id: str, **kwargs) -> dict | None:
    entry = _registry.get(service_id)
    if not entry:
        return None
    allowed = {"name", "path", "start_cmd", "stop_cmd", "health_url", "tags", "status", "last_checked"}
    for k, v in kwargs.items():
        if k in allowed:
            entry[k] = v
    _save()
    return entry


def remove_service(service_id: str) -> bool:
    if service_id not in _registry:
        return False
    del _registry[service_id]
    _save()
    log.info("ServiceRegistry: removed", id=service_id)
    return True


async def check_health(service_id: str) -> dict:
    """HTTP GET the health_url and update status. Returns the entry."""
    import httpx

    entry = _registry.get(service_id)
    if not entry:
        return {"ok": False, "error": "Service not found"}

    health_url = entry.get("health_url")
    now = datetime.datetime.utcnow().isoformat() + "Z"

    if not health_url:
        entry["last_checked"] = now
        _save()
        return {"ok": None, "reason": "no health_url configured"}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(health_url)
        ok = r.status_code < 400
        entry["status"]       = "running" if ok else "error"
        entry["last_checked"] = now
        _save()
        return {"ok": ok, "status_code": r.status_code}
    except Exception as exc:
        entry["status"]       = "stopped"
        entry["last_checked"] = now
        _save()
        return {"ok": False, "error": str(exc)}


async def start_service(service_id: str) -> dict:
    """Run start_cmd via Commander."""
    entry = _registry.get(service_id)
    if not entry:
        return {"ok": False, "error": "Service not found"}

    from agents.roster.commander_agent import CommanderAgent
    cwd = entry.get("path") or "."
    result = await CommanderAgent.run(
        command=entry["start_cmd"],
        cwd=cwd,
        caller="ServiceRegistry",
        reason=f"Starting service: {entry['name']}",
        timeout=60,
    )
    if result.get("ok"):
        update_service(service_id, status="running")
    else:
        update_service(service_id, status="error")
    return result


async def stop_service(service_id: str) -> dict:
    """Run stop_cmd (or kill the process on the port) via Commander."""
    entry = _registry.get(service_id)
    if not entry:
        return {"ok": False, "error": "Service not found"}

    stop_cmd = entry.get("stop_cmd")
    if not stop_cmd:
        return {"ok": False, "error": "No stop_cmd configured — kill the process manually"}

    from agents.roster.commander_agent import CommanderAgent
    cwd = entry.get("path") or "."
    result = await CommanderAgent.run(
        command=stop_cmd,
        cwd=cwd,
        caller="ServiceRegistry",
        reason=f"Stopping service: {entry['name']}",
        timeout=30,
    )
    if result.get("ok"):
        update_service(service_id, status="stopped")
    return result
