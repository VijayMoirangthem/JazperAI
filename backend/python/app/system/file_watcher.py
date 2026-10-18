"""
COOS FileWatcher — Phase 7D

Background filesystem monitor for the Sir Jazper OS project directory.

Runs in a daemon thread (started at FastAPI startup). Bridges watchdog
OS events into the asyncio world via a thread-safe queue.

Responsibilities:
  - requirements.txt changed → Commander runs pip install -r requirements.txt
  - package.json changed     → Commander runs npm install  (in frontend/)
  - Any .py file changed     → emit to IDE bus (Sentry already watches errors)
  - Any .tsx/.ts file changed → emit to IDE bus
  - File deleted             → emit high-severity alert to IDE bus
  - File created             → emit to IDE bus (agent or human added a file)

What it does NOT do:
  - Re-run tests on every save (Sentry/Darwin handle that via error logs)
  - Watch __pycache__, node_modules, .next, .git (all ignored)
  - Block the FastAPI event loop (all watchdog callbacks run in a thread)
"""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from typing import Any

import structlog

log = structlog.get_logger()

_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent.resolve()
_BACKEND_DIR  = _PROJECT_ROOT / "backend" / "python"
_FRONTEND_DIR = _PROJECT_ROOT / "frontend"
_PLUGINS_DIR  = _FRONTEND_DIR / "src" / "plugins"
_MANIFEST_JSON = _PLUGINS_DIR / "_manifest.json"
_LOADER_TS     = _PLUGINS_DIR / "_loader.ts"

# Directories to skip
_IGNORE_DIRS = {
    "__pycache__", "node_modules", ".next", ".git", ".venv", "venv",
    "dist", "build", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    "uploads", ".turbo", ".cache", "browser-profiles",
}

# Key dependency files that trigger auto-install
_REQUIREMENTS_TXT = _BACKEND_DIR / "requirements.txt"
_PACKAGE_JSON     = _FRONTEND_DIR / "package.json"

# Debounce: don't re-trigger the same file within this window (seconds)
_DEBOUNCE_S = 5.0

# Track last-triggered time per path to debounce
_last_triggered: dict[str, float] = {}
_trigger_lock   = threading.Lock()

# The asyncio event loop — set when FileWatcher starts
_loop: asyncio.AbstractEventLoop | None = None


def _is_ignored(path_str: str) -> bool:
    parts = Path(path_str).parts
    return any(p in _IGNORE_DIRS for p in parts)


def _debounced(path: str) -> bool:
    """Return True if this path should be processed (not debounced)."""
    now = time.monotonic()
    with _trigger_lock:
        last = _last_triggered.get(path, 0.0)
        if now - last < _DEBOUNCE_S:
            return False
        _last_triggered[path] = now
    return True


def _emit_to_bus(event: dict[str, Any]) -> None:
    """Thread-safe bridge: push event to IDE bus from watchdog thread."""
    if _loop is None or _loop.is_closed():
        return
    try:
        _loop.call_soon_threadsafe(_do_emit, event)
    except RuntimeError:
        pass


def _do_emit(event: dict[str, Any]) -> None:
    """Called in the asyncio thread — safe to call ide_bus.emit()."""
    try:
        from app.services.ide_bus import ide_bus
        ide_bus.emit(event)
    except Exception as exc:
        log.warning("FileWatcher: ide_bus emit failed", error=str(exc))


def _run_commander(command: str, cwd: str, reason: str) -> None:
    """Thread-safe bridge: schedule a Commander.run() coroutine."""
    if _loop is None or _loop.is_closed():
        return
    try:
        _loop.call_soon_threadsafe(
            lambda: asyncio.ensure_future(_commander_task(command, cwd, reason), loop=_loop)
        )
    except RuntimeError:
        pass


async def _commander_task(command: str, cwd: str, reason: str) -> None:
    """Async: actually run the Commander."""
    try:
        from app.agents.commander_agent import CommanderAgent
        await CommanderAgent.run(
            command=command,
            cwd=cwd,
            caller="FileWatcher",
            reason=reason,
            timeout=300,
        )
    except Exception as exc:
        log.warning("FileWatcher: Commander task failed", command=command, error=str(exc))


# ── Plugin hot-loading ────────────────────────────────────────────────────────

def _handle_new_plugin(path: Path) -> None:
    """
    Parse pluginMeta from a newly created .tsx plugin file and update:
      1. _manifest.json  — plugin metadata for the backend API
      2. _loader.ts      — Next.js dynamic import (triggers HMR on frontend)
    """
    import re, json as _json

    try:
        content = path.read_text(encoding="utf-8")

        # Extract pluginMeta = { ... } — simple single-level object
        match = re.search(
            r'export\s+const\s+pluginMeta\s*=\s*\{([^}]+)\}',
            content,
            re.DOTALL,
        )
        if not match:
            log.warning("FileWatcher: new plugin has no pluginMeta export — skipping", path=str(path))
            return

        raw = match.group(1)
        meta: dict[str, str] = {}
        for m in re.finditer(r'(\w+)\s*:\s*(?:["\'])([^"\']+)["\']', raw):
            meta[m.group(1)] = m.group(2)

        plugin_id    = meta.get("id", path.stem.lower())
        plugin_label = meta.get("label", path.stem)
        plugin_group = meta.get("group", "main")
        plugin_icon  = meta.get("icon", "Puzzle")
        plugin_desc  = meta.get("description", "")
        comp_name    = path.stem  # e.g. "MyPlugin"

        # ── manifest ──────────────────────────────────────────────────────────
        manifest: list[dict] = []
        if _MANIFEST_JSON.exists():
            try:
                manifest = _json.loads(_MANIFEST_JSON.read_text(encoding="utf-8"))
            except Exception:
                manifest = []

        if not any(p["id"] == plugin_id for p in manifest):
            manifest.append({
                "id":          plugin_id,
                "label":       plugin_label,
                "group":       plugin_group,
                "icon":        plugin_icon,
                "description": plugin_desc,
            })
            _MANIFEST_JSON.write_text(_json.dumps(manifest, indent=2), encoding="utf-8")
            log.info("FileWatcher: plugin manifest updated", id=plugin_id)

        # ── _loader.ts ────────────────────────────────────────────────────────
        if _LOADER_TS.exists():
            loader = _LOADER_TS.read_text(encoding="utf-8")
            if plugin_id not in loader:
                new_line = f'  {plugin_id}: dynamic(() => import("./{comp_name}"), {{ ssr: false }}),\n'
                loader = loader.replace(
                    "  // [PLUGIN_LOADER_ENTRIES]\n",
                    new_line + "  // [PLUGIN_LOADER_ENTRIES]\n",
                )
                _LOADER_TS.write_text(loader, encoding="utf-8")
                log.info("FileWatcher: _loader.ts updated", id=plugin_id)

        _emit_to_bus({
            "agent":   "FileWatcher",
            "action":  "creating",
            "file":    path.relative_to(_PROJECT_ROOT).as_posix(),
            "reason":  f"New plugin registered: {plugin_label} (id={plugin_id})",
        })
        log.info("FileWatcher: plugin hot-loaded", id=plugin_id, label=plugin_label)

    except Exception as exc:
        log.warning("FileWatcher: failed to register plugin", path=str(path), error=str(exc))


# ── Watchdog handler ──────────────────────────────────────────────────────────

def _make_handler():
    """Build the watchdog FileSystemEventHandler (import inside function to defer)."""
    from watchdog.events import FileSystemEventHandler  # type: ignore

    class _Handler(FileSystemEventHandler):

        def on_modified(self, event):
            if event.is_directory:
                return
            src = event.src_path
            if _is_ignored(src) or not _debounced(src):
                return

            rel = Path(src).relative_to(_PROJECT_ROOT).as_posix()
            _emit_to_bus({"agent": "FileWatcher", "action": "reading", "file": rel, "reason": "file modified"})
            log.debug("FileWatcher: modified", path=rel)

            # requirements.txt → pip install
            if Path(src).resolve() == _REQUIREMENTS_TXT:
                log.info("FileWatcher: requirements.txt changed — running pip install")
                _emit_to_bus({"agent": "FileWatcher", "action": "running",
                              "command": "pip install -r requirements.txt",
                              "summary": "requirements.txt changed"})
                _run_commander(
                    f"python -m pip install -r {_REQUIREMENTS_TXT}",
                    cwd=str(_BACKEND_DIR),
                    reason="requirements.txt changed on disk",
                )

            # package.json → npm install
            elif Path(src).resolve() == _PACKAGE_JSON:
                log.info("FileWatcher: package.json changed — running npm install")
                _emit_to_bus({"agent": "FileWatcher", "action": "running",
                              "command": "npm install",
                              "summary": "package.json changed"})
                _run_commander(
                    "npm install",
                    cwd=str(_FRONTEND_DIR),
                    reason="package.json changed on disk",
                )

        def on_created(self, event):
            if event.is_directory or _is_ignored(event.src_path):
                return
            src = event.src_path
            rel = Path(src).relative_to(_PROJECT_ROOT).as_posix()
            _emit_to_bus({"agent": "FileWatcher", "action": "creating", "file": rel, "reason": "file created on disk"})
            log.debug("FileWatcher: created", path=rel)

            # Plugin hot-loading: new .tsx in the plugins directory
            src_path = Path(src).resolve()
            if (
                src_path.parent == _PLUGINS_DIR.resolve()
                and src.endswith(".tsx")
                and not src_path.name.startswith("_")
                and _debounced(src)
            ):
                _handle_new_plugin(src_path)

        def on_deleted(self, event):
            if event.is_directory or _is_ignored(event.src_path):
                return
            if not _debounced(event.src_path):
                return
            rel = Path(event.src_path).relative_to(_PROJECT_ROOT).as_posix()
            # High-severity: deletions are always surfaced
            _emit_to_bus({
                "agent":   "FileWatcher",
                "action":  "error",
                "file":    rel,
                "reason":  "FILE DELETED — may be accidental",
                "ok":      False,
            })
            log.warning("FileWatcher: file deleted", path=rel)

        def on_moved(self, event):
            if _is_ignored(event.src_path):
                return
            src = Path(event.src_path).relative_to(_PROJECT_ROOT).as_posix()
            dst = Path(event.dest_path).relative_to(_PROJECT_ROOT).as_posix()
            _emit_to_bus({"agent": "FileWatcher", "action": "editing", "file": src,
                          "reason": f"moved → {dst}"})
            log.debug("FileWatcher: moved", src=src, dst=dst)

            # Plugin hot-loading: editors write via atomic rename (tmp → .tsx)
            dest_path = Path(event.dest_path).resolve()
            if (
                dest_path.parent == _PLUGINS_DIR.resolve()
                and event.dest_path.endswith(".tsx")
                and not dest_path.name.startswith("_")
                and _debounced(event.dest_path)
            ):
                _handle_new_plugin(dest_path)

    return _Handler()


# ── Public start/stop ─────────────────────────────────────────────────────────

_observer_thread = None


def start(loop: asyncio.AbstractEventLoop) -> None:
    """
    Start the watchdog Observer in a daemon thread.
    Call this from the FastAPI lifespan startup with the running event loop.
    """
    global _loop, _observer_thread

    _loop = loop

    try:
        from watchdog.observers import Observer  # type: ignore
    except ImportError:
        log.warning("FileWatcher: watchdog not installed — pip install watchdog==4.0.1")
        return

    handler  = _make_handler()
    observer = Observer()
    observer.schedule(handler, str(_PROJECT_ROOT), recursive=True)

    def _run():
        log.info("FileWatcher: started", root=str(_PROJECT_ROOT))
        observer.start()
        try:
            while not getattr(observer, "_stopped", False):
                time.sleep(1)
        except Exception:
            pass
        finally:
            observer.stop()
            observer.join()

    t = threading.Thread(target=_run, daemon=True, name="file-watcher")
    t.start()
    _observer_thread = t
    log.info("FileWatcher: observer thread launched")


def stop() -> None:
    """Signal the observer to stop (called from lifespan shutdown)."""
    log.info("FileWatcher: stopping")
    # The observer stops automatically when the daemon thread dies on shutdown.
