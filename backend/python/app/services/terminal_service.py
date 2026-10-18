"""Phase 4 — IDE Execution Engine.

In-memory multi-session command terminals (one foreground command per session
at a time, like a real shell tab) with live output streaming, plus port
inspection/kill/next-free helpers for "smart" dev-server startup.

Not a full PTY (no arrow-key history, no interactive stdin prompts) — each
"terminal" is a subprocess whose stdout/stderr is line-streamed to the UI in
real time. Good enough for running builds, tests, and dev servers and reading
their live output, which covers the actual use case.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

import psutil
import structlog

log = structlog.get_logger()


@dataclass
class TerminalSession:
    id: str
    cwd: str
    label: str = "Terminal"
    lines: list[dict] = field(default_factory=list)
    running: bool = False
    proc: asyncio.subprocess.Process | None = None
    queues: list[asyncio.Queue] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

    def broadcast(self, payload: dict):
        self.lines.append(payload)
        if len(self.lines) > 2000:
            self.lines = self.lines[-2000:]
        for q in list(self.queues):
            q.put_nowait(payload)


_sessions: dict[str, TerminalSession] = {}


def create_session(cwd: str, label: str = "Terminal") -> TerminalSession:
    sid = uuid.uuid4().hex[:10]
    session = TerminalSession(id=sid, cwd=cwd, label=label)
    _sessions[sid] = session
    return session


def get_session(session_id: str) -> TerminalSession | None:
    return _sessions.get(session_id)


def list_sessions() -> list[dict]:
    return [
        {"id": s.id, "label": s.label, "cwd": s.cwd, "running": s.running, "created_at": s.created_at}
        for s in _sessions.values()
    ]


def close_session(session_id: str) -> bool:
    s = _sessions.pop(session_id, None)
    if s and s.proc and s.running:
        try:
            s.proc.kill()
        except ProcessLookupError:
            pass
    return s is not None


async def _pump_stream(session: TerminalSession, stream: asyncio.StreamReader, kind: str):
    while True:
        line = await stream.readline()
        if not line:
            break
        text = line.decode(errors="replace").rstrip("\n")
        session.broadcast({"kind": kind, "text": text, "ts": time.time()})


async def run_command(session_id: str, command: str) -> None:
    session = get_session(session_id)
    if session is None:
        raise ValueError("Unknown terminal session")
    if session.running:
        raise RuntimeError("A command is already running in this terminal")

    session.broadcast({"kind": "cmd", "text": f"$ {command}", "ts": time.time()})
    session.running = True
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=session.cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        session.proc = proc

        await asyncio.gather(
            _pump_stream(session, proc.stdout, "stdout"),
            _pump_stream(session, proc.stderr, "stderr"),
        )
        code = await proc.wait()
        session.broadcast({"kind": "exit", "text": f"[process exited with code {code}]", "ts": time.time()})
    except Exception as exc:
        session.broadcast({"kind": "error", "text": str(exc), "ts": time.time()})
    finally:
        session.running = False
        session.proc = None


def kill_command(session_id: str) -> bool:
    session = get_session(session_id)
    if session is None or not session.proc or not session.running:
        return False
    try:
        session.proc.kill()
        session.broadcast({"kind": "system", "text": "[killed by user]", "ts": time.time()})
        return True
    except ProcessLookupError:
        return False


# ── Smart port management ────────────────────────────────────────────────────

def find_process_on_port(port: int) -> dict | None:
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            for conn in proc.net_connections(kind="inet"):
                if conn.laddr and conn.laddr.port == port and conn.status == psutil.CONN_LISTEN:
                    return {"pid": proc.pid, "name": proc.name()}
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
    return None


def kill_port(port: int) -> dict:
    hit = find_process_on_port(port)
    if not hit:
        return {"ok": False, "message": f"Nothing listening on port {port}"}
    try:
        psutil.Process(hit["pid"]).kill()
        return {"ok": True, "message": f"Killed {hit['name']} (pid {hit['pid']}) on port {port}"}
    except (psutil.NoSuchProcess, psutil.AccessDenied) as exc:
        return {"ok": False, "message": str(exc)}


def next_free_port(start: int, end: int = 65535) -> int:
    used = set()
    for proc in psutil.process_iter():
        try:
            for conn in proc.net_connections(kind="inet"):
                if conn.laddr and conn.status == psutil.CONN_LISTEN:
                    used.add(conn.laddr.port)
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
    port = start
    while port in used and port <= end:
        port += 1
    return port
