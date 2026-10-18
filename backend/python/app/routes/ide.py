"""Phase 8A — IDE Core API.

Endpoints:
  GET  /api/ide/tree              → project file tree as JSON
  GET  /api/ide/file?path=...     → read file content
  PUT  /api/ide/file?path=...     → write file content
  GET  /api/ide/git/status        → git status
  GET  /api/ide/git/diff          → git diff (staged + unstaged)
  GET  /api/ide/git/log?n=20      → recent commits
  POST /api/ide/index/build       → build/refresh semantic code index (Phase 2)
  GET  /api/ide/index/status      → index stats for current workspace
  POST /api/ide/context/search    → semantic search over indexed code chunks
  GET  /api/ide/context/grep      → plain keyword search across workspace files
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, AsyncGenerator

import structlog
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import PlainTextResponse, StreamingResponse

log = structlog.get_logger()
router = APIRouter()

# Project root: ide.py → routes → app → python → backend → SirJazper
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent.resolve()
_CURRENT_WORKSPACE = _PROJECT_ROOT

_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".next", ".venv", "venv",
    "dist", "build", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    "uploads", ".turbo", ".cache",
}

_BLOCKED_FILES = {".env", ".env.local", ".env.production", ".env.development"}

_MAX_DEPTH = 6
_MAX_FILE_BYTES = 1_000_000  # 1 MB


# ── Workspaces ────────────────────────────────────────────────────────────────

@router.get("/projects")
def list_projects():
    """List available project workspaces in parent directory."""
    parent = _PROJECT_ROOT.parent
    projects = []
    if parent.exists() and parent.is_dir():
        for item in parent.iterdir():
            if item.is_dir() and not item.name.startswith("."):
                projects.append({
                    "name": item.name,
                    "path": str(item.resolve()),
                    "is_current": item.resolve() == _CURRENT_WORKSPACE.resolve(),
                })
    if not any(p["is_current"] for p in projects):
        projects.insert(0, {
            "name": _CURRENT_WORKSPACE.name,
            "path": str(_CURRENT_WORKSPACE.resolve()),
            "is_current": True,
        })
    return {"projects": projects, "current": str(_CURRENT_WORKSPACE.resolve())}


@router.post("/project/select")
def select_project(body: dict = Body(...)):
    """Set active IDE project workspace path."""
    global _CURRENT_WORKSPACE
    target_path = body.get("path")
    if not target_path:
        raise HTTPException(400, "Project path is required")
    target = Path(target_path).resolve()
    if not target.exists() or not target.is_dir():
        raise HTTPException(404, f"Project directory not found: {target_path}")
    _CURRENT_WORKSPACE = target
    log.info("ide.workspace_changed", path=str(_CURRENT_WORKSPACE))
    return {"ok": True, "name": _CURRENT_WORKSPACE.name, "path": str(_CURRENT_WORKSPACE.resolve())}



# ── File tree ─────────────────────────────────────────────────────────────────

def _build_tree(abs_path: Path, rel: Path, depth: int = 0) -> dict[str, Any]:
    node: dict[str, Any] = {
        "name": abs_path.name or _CURRENT_WORKSPACE.name,
        "path": rel.as_posix(),
        "type": "dir" if abs_path.is_dir() else "file",
    }
    if abs_path.is_dir() and depth < _MAX_DEPTH:
        children: list[dict[str, Any]] = []
        try:
            # dirs first, then files; each group sorted alphabetically
            entries = sorted(
                abs_path.iterdir(),
                key=lambda p: (p.is_file(), p.name.lower()),
            )
        except PermissionError:
            entries = []
        for entry in entries:
            if entry.name in _SKIP_DIRS:
                continue
            if entry.is_dir() and entry.name.startswith("."):
                continue  # skip hidden dirs not already in _SKIP_DIRS
            children.append(_build_tree(entry, rel / entry.name, depth + 1))
        node["children"] = children
        if depth + 1 >= _MAX_DEPTH:
            node["truncated"] = True
    return node


# ── Path safety ───────────────────────────────────────────────────────────────

def _safe_resolve(rel_path: str) -> Path:
    clean = rel_path.replace("\\", "/").lstrip("/")
    parts = clean.split("/")
    if ".." in parts:
        raise HTTPException(400, "Path traversal not allowed")
    resolved = (_CURRENT_WORKSPACE / clean).resolve()
    if not resolved.is_relative_to(_CURRENT_WORKSPACE):
        raise HTTPException(400, "Path outside project workspace")
    if resolved.name in _BLOCKED_FILES:
        raise HTTPException(403, "Access to this file is restricted")
    return resolved


# ── GET /api/ide/tree ─────────────────────────────────────────────────────────

@router.get("/tree")
def get_tree():
    """Return the full project file tree."""
    tree = _build_tree(_CURRENT_WORKSPACE, Path(""), 0)
    tree["name"] = _CURRENT_WORKSPACE.name
    return tree


# ── GET /api/ide/file ─────────────────────────────────────────────────────────

@router.get("/file")
def read_file(path: str = Query(..., description="Relative path from project root")):
    abs_path = _safe_resolve(path)
    if not abs_path.exists():
        raise HTTPException(404, "File not found")
    if abs_path.is_dir():
        raise HTTPException(400, "Path is a directory")
    size = abs_path.stat().st_size
    if size > _MAX_FILE_BYTES:
        raise HTTPException(413, f"File too large ({size} bytes). Max 1 MB.")
    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
    return {"path": path, "content": content, "size": size}


# ── PUT /api/ide/file ─────────────────────────────────────────────────────────

@router.put("/file")
def write_file(
    path: str = Query(..., description="Relative path from project root"),
    body: dict = Body(...),
):
    abs_path = _safe_resolve(path)
    content: str = body.get("content", "")
    try:
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
    log.info("ide.write_file", path=path, bytes=len(content.encode()))
    return {"path": path, "size": len(content.encode("utf-8")), "ok": True}


# ── File management (create / rename / delete) ───────────────────────────────

@router.post("/file/create")
def create_file(body: dict = Body(...)):
    path   = body.get("path", "")
    is_dir = bool(body.get("is_dir", False))
    if not path:
        raise HTTPException(400, "path is required")
    abs_path = _safe_resolve(path)
    if abs_path.exists():
        raise HTTPException(409, "Already exists")
    try:
        if is_dir:
            abs_path.mkdir(parents=True, exist_ok=False)
        else:
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_text("", encoding="utf-8")
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
    log.info("ide.create", path=path, is_dir=is_dir)
    return {"ok": True, "path": path, "is_dir": is_dir}


@router.post("/file/rename")
def rename_file(body: dict = Body(...)):
    old_path = body.get("old_path", "")
    new_path = body.get("new_path", "")
    if not old_path or not new_path:
        raise HTTPException(400, "old_path and new_path are required")
    src = _safe_resolve(old_path)
    dst = _safe_resolve(new_path)
    if not src.exists():
        raise HTTPException(404, "Source not found")
    if dst.exists():
        raise HTTPException(409, "Destination already exists")
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
    log.info("ide.rename", old_path=old_path, new_path=new_path)
    return {"ok": True, "old_path": old_path, "new_path": new_path}


@router.delete("/file")
def delete_file(path: str = Query(..., description="Relative path from project root")):
    if not path.strip():
        raise HTTPException(400, "path is required — refusing to delete the workspace root")
    abs_path = _safe_resolve(path)
    if abs_path == _CURRENT_WORKSPACE:
        raise HTTPException(400, "Refusing to delete the workspace root")
    if not abs_path.exists():
        raise HTTPException(404, "Not found")
    try:
        if abs_path.is_dir():
            shutil.rmtree(abs_path)
        else:
            abs_path.unlink()
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
    log.info("ide.delete", path=path)
    return {"ok": True, "path": path}


# ── Git helpers ───────────────────────────────────────────────────────────────

def _git(*args: str) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            cwd=str(_CURRENT_WORKSPACE),
            timeout=10,
        )
        return result.stdout or result.stderr or ""
    except Exception as exc:
        return str(exc)


@router.get("/git/status")
def git_status():
    return PlainTextResponse(_git("status", "--short"))


@router.get("/git/diff")
def git_diff():
    return PlainTextResponse(_git("diff"))


@router.get("/git/log")
def git_log(n: int = Query(20, ge=1, le=100)):
    return PlainTextResponse(_git("log", "--oneline", f"-{n}"))


# ── Git branch management ────────────────────────────────────────────────────

@router.get("/git/branches")
def git_branches():
    raw = _git("branch", "--list")
    if raw.strip().lower().startswith(("fatal:", "error:")):
        return {"branches": [], "error": raw.strip()}
    branches = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        is_current = line.startswith("*")
        name = line.lstrip("*+ ").strip()
        if name:
            branches.append({"name": name, "current": is_current})
    return {"branches": branches}


@router.post("/git/branch/create")
def git_branch_create(body: dict = Body(...)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    checkout = body.get("checkout", True)
    output = _git("checkout", "-b", name) if checkout else _git("branch", name)
    return {"ok": "fatal" not in output.lower() and "error" not in output.lower(), "output": output.strip()}


@router.post("/git/branch/switch")
def git_branch_switch(body: dict = Body(...)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    output = _git("checkout", name)
    return {"ok": "fatal" not in output.lower() and "error" not in output.lower(), "output": output.strip()}


@router.post("/git/branch/merge")
def git_branch_merge(body: dict = Body(...)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    output = _git("merge", name, "--no-edit")
    ok = "CONFLICT" not in output and "fatal" not in output.lower()
    return {"ok": ok, "output": output.strip()}


@router.post("/git/branch/delete")
def git_branch_delete(body: dict = Body(...)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    output = _git("branch", "-d", name)
    return {"ok": "error" not in output.lower() and "fatal" not in output.lower(), "output": output.strip()}


# ── GET /api/ide/events (SSE — Phase 8B) ─────────────────────────────────────

@router.get("/events")
async def ide_events():
    """
    SSE stream of agent file-activity events from the IDE bus.
    Used by the ActivityFeed component in COOS Studio.
    """
    from app.services.ide_bus import ide_bus

    q = ide_bus.subscribe()

    async def generate() -> AsyncGenerator[str, None]:
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield 'data: {"heartbeat":true}\n\n'
        except asyncio.CancelledError:
            pass
        finally:
            ide_bus.unsubscribe(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ── GET /api/ide/active-files (Phase 8B) ─────────────────────────────────────

@router.get("/active-files")
def active_files():
    """Return {path: agent} for files currently being touched by an agent."""
    from app.services.ide_bus import ide_bus
    return {"active": ide_bus.get_active_files()}


# ── POST /api/ide/apply-patch (Phase 8C) ─────────────────────────────────────

@router.post("/apply-patch")
def apply_patch(body: dict = Body(...)):
    """
    Apply a string-replace patch to a file.

    Body: {"file": "relative/path", "old_string": "...", "new_string": "..."}

    Used by ApprovalsPanel "Apply Mine" flow — user edits the proposed diff
    in Monaco DiffEditor, then applies their own version directly without
    going through Darwin's Forge agent.
    """
    rel  = body.get("file", "")
    old  = body.get("old_string", "")
    new  = body.get("new_string", "")

    if not rel:
        raise HTTPException(400, "file is required")

    abs_path = _safe_resolve(rel)
    if not abs_path.exists():
        raise HTTPException(404, "File not found")

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(500, f"Could not read file: {exc}") from exc

    if old and old not in content:
        raise HTTPException(409, "old_string not found in file — file may have changed")

    patched = content.replace(old, new, 1) if old else new
    try:
        abs_path.write_text(patched, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(500, f"Could not write file: {exc}") from exc

    log.info("ide.apply_patch", path=rel, bytes=len(patched.encode()))
    return {"ok": True, "path": rel, "size": len(patched.encode("utf-8"))}


# ── POST /api/ide/git/commit (Phase 8D) ──────────────────────────────────────

# ── Codebase Context & RAG (Phase 2) ─────────────────────────────────────────

@router.post("/index/build")
def build_index():
    """Re-index the current workspace for semantic code search."""
    from app.services import code_index_service
    try:
        return code_index_service.build_index(_CURRENT_WORKSPACE)
    except Exception as exc:
        raise HTTPException(500, f"Indexing failed: {exc}") from exc


@router.get("/index/status")
def get_index_status():
    from app.services import code_index_service
    return code_index_service.index_status(_CURRENT_WORKSPACE)


@router.post("/context/search")
def context_search(body: dict = Body(...)):
    """Semantic search over indexed code chunks in the current workspace."""
    from app.services import code_index_service
    query = (body.get("query") or "").strip()
    top_k = int(body.get("top_k") or 8)
    if not query:
        raise HTTPException(400, "query is required")
    return {"results": code_index_service.semantic_search(_CURRENT_WORKSPACE, query, top_k)}


@router.get("/context/grep")
def context_grep(
    query: str = Query(..., description="Keyword to search for"),
    max_results: int = Query(50, ge=1, le=200),
):
    """Plain keyword search across the current workspace's indexable files."""
    from app.services import code_index_service
    return {"results": code_index_service.grep_search(_CURRENT_WORKSPACE, query, max_results)}


# ── Execution Engine — multi-terminal + smart ports (Phase 4) ───────────────

@router.post("/terminal/create")
def terminal_create(body: dict = Body(default={})):
    from app.services import terminal_service
    label = (body or {}).get("label") or "Terminal"
    session = terminal_service.create_session(str(_CURRENT_WORKSPACE), label)
    return {"id": session.id, "label": session.label, "cwd": session.cwd}


@router.get("/terminal/list")
def terminal_list():
    from app.services import terminal_service
    return {"sessions": terminal_service.list_sessions()}


@router.post("/terminal/{session_id}/run")
async def terminal_run(session_id: str, body: dict = Body(...)):
    from app.services import terminal_service
    command = (body.get("command") or "").strip()
    if not command:
        raise HTTPException(400, "command is required")
    if terminal_service.get_session(session_id) is None:
        raise HTTPException(404, "Unknown terminal session")
    try:
        asyncio.create_task(terminal_service.run_command(session_id, command))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True}


@router.post("/terminal/{session_id}/kill")
def terminal_kill(session_id: str):
    from app.services import terminal_service
    ok = terminal_service.kill_command(session_id)
    return {"ok": ok}


@router.delete("/terminal/{session_id}")
def terminal_close(session_id: str):
    from app.services import terminal_service
    ok = terminal_service.close_session(session_id)
    return {"ok": ok}


@router.get("/terminal/{session_id}/stream")
async def terminal_stream(session_id: str):
    from app.services import terminal_service

    session = terminal_service.get_session(session_id)
    if session is None:
        raise HTTPException(404, "Unknown terminal session")

    q: asyncio.Queue = asyncio.Queue()
    session.queues.append(q)

    async def generate() -> AsyncGenerator[str, None]:
        try:
            for line in session.lines:
                yield f"data: {json.dumps(line)}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield 'data: {"heartbeat":true}\n\n'
        except asyncio.CancelledError:
            pass
        finally:
            if q in session.queues:
                session.queues.remove(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/port/check")
def port_check(port: int = Query(..., ge=1, le=65535)):
    from app.services import terminal_service
    hit = terminal_service.find_process_on_port(port)
    return {"port": port, "in_use": hit is not None, "process": hit}


@router.post("/port/free")
def port_free(body: dict = Body(...)):
    from app.services import terminal_service
    port = int(body.get("port"))
    return terminal_service.kill_port(port)


@router.get("/port/next-free")
def port_next_free(start: int = Query(3000, ge=1, le=65535)):
    from app.services import terminal_service
    return {"port": terminal_service.next_free_port(start)}


# ── Problems panel — lint/build/test check for the active workspace ─────────

@router.post("/problems/check")
def problems_check():
    from app.routes.agent_tools import _run_build_check
    return json.loads(_run_build_check())


@router.post("/problems/tests")
def problems_tests():
    from app.routes.agent_tools import _run_tests
    return json.loads(_run_tests())


@router.post("/git/commit")
def git_commit(body: dict = Body(...)):
    """
    Stage all changes and create a git commit.

    Body: {"message": "commit message", "files": ["path1", ...]}  (files optional — defaults to all staged)
    """
    message = (body.get("message") or "").strip()
    files   = body.get("files") or []  # empty = git add -A

    if not message:
        raise HTTPException(400, "commit message is required")

    # Stage
    if files:
        for f in files:
            _git("add", f)
    else:
        _git("add", "-A")

    # Commit
    result = subprocess.run(
        ["git", "commit", "-m", message],
        capture_output=True,
        text=True,
        cwd=str(_CURRENT_WORKSPACE),
        timeout=15,
    )
    ok     = result.returncode == 0
    output = (result.stdout or "") + (result.stderr or "")
    if not ok and "nothing to commit" in output:
        return {"ok": False, "message": "Nothing to commit — working tree clean.", "output": output}
    return {"ok": ok, "output": output.strip()}
