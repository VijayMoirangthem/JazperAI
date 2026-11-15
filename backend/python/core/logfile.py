"""Rotating log file written by the backend itself: storage/logs/jasper.log (5 MB x 6 files).

Why: when the backend is started hidden (the sign-in task) its console is nowhere, so problems left no trace and every investigation
started from nothing. This tees structlog (and warnings from uvicorn and libraries) into a file, with timestamps, and can summarise
recent problems for the Settings screens and the phone.
"""
from __future__ import annotations

import logging
import logging.handlers
import re
import sys
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOG_DIR = ROOT / "storage" / "logs"
LOG_FILE = LOG_DIR / "jasper.log"
MAX_BYTES, BACKUPS = 5_000_000, 5

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_STARTS_WITH_DATE = re.compile(r"^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d")
_SECRET = re.compile(r"(sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})")
_PROBLEM = re.compile(r"^(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)\S*\s+\[(error|critical|exception|warning)\s*\]\s+(.*)$", re.I)

_handler: logging.handlers.RotatingFileHandler | None = None


def redact(text: str) -> str:
    """Never let anything that looks like a key reach a file or an API answer."""
    return _SECRET.sub("<redacted>", text)


def handler(path: Path | None = None) -> logging.handlers.RotatingFileHandler:
    global _handler
    if _handler is None or path is not None:
        p = path or LOG_FILE
        p.parent.mkdir(parents=True, exist_ok=True)
        h = logging.handlers.RotatingFileHandler(p, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8", delay=True)
        h.setFormatter(logging.Formatter("%(message)s"))
        if path is None:
            _handler = h
        return h
    return _handler


class Tee:
    """File-like object for structlog's PrintLogger: writes to the console (when there is one) and to the rotating file."""

    def __init__(self, console=None, file_handler: logging.Handler | None = None):
        self.console = console if console is not None else sys.stdout
        self._h = file_handler

    def write(self, s: str) -> int:
        try:
            if self.console is not None:
                self.console.write(s)
        except Exception:
            pass
        text = _ANSI.sub("", s).rstrip("\r\n")
        if text.strip():
            write_line(text, self._h)
        return len(s)

    def flush(self) -> None:
        try:
            if self.console is not None:
                self.console.flush()
        except Exception:
            pass


def write_line(text: str, file_handler: logging.Handler | None = None) -> None:
    """One line into the rotating file: timestamped if it has no date, redacted, thread-safe (handle() takes the handler lock)."""
    if not _STARTS_WITH_DATE.match(text):
        text = f"{datetime.now():%Y-%m-%d %H:%M:%S} {text}"
    try:
        (file_handler or handler()).handle(logging.LogRecord("jasper", logging.INFO, "", 0, redact(text), None, None))
    except Exception:
        pass  # logging must never break the app


class _StdlibBridge(logging.Handler):
    """Warnings and errors from uvicorn and libraries, written in the same line format as structlog so they are found as problems too."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            line = f"[{record.levelname.lower():<9}] {record.name}: {record.getMessage()}"
            if record.exc_info:
                line += " | " + logging.Formatter().formatException(record.exc_info).replace("\n", " / ")[-600:]
            write_line(line)
        except Exception:
            pass


def attach_stdlib(level: int = logging.WARNING) -> None:
    """Warnings and errors from uvicorn and the libraries (not the noisy access log) also go to the file."""
    bridge = _StdlibBridge(level)
    for name in ("", "uvicorn", "uvicorn.error"):
        lg = logging.getLogger(name)
        if not any(isinstance(h, _StdlibBridge) for h in lg.handlers):
            lg.addHandler(bridge)


def _tail(path: Path, max_bytes: int) -> list[str]:
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - max_bytes))
            data = f.read().decode("utf-8", errors="replace")
    except OSError:
        return []
    lines = data.splitlines()
    return lines[1:] if size > max_bytes else lines  # the first line of a mid-file read is cut off


def recent_problems(limit: int = 100, min_level: str = "warning", log_file: Path | None = None, max_bytes: int = 1_500_000) -> list[dict]:
    """Warnings/errors from the newest lines of the log (and the previous file), repeats merged: [{time, level, message, count}], newest first."""
    path = log_file or LOG_FILE
    rank = {"warning": 1, "error": 2, "exception": 2, "critical": 3}
    floor = rank.get(min_level, 1)
    lines = _tail(Path(str(path) + ".1"), max_bytes // 2) + _tail(path, max_bytes)
    groups: "OrderedDict[tuple[str, str], dict]" = OrderedDict()
    for ln in lines:
        m = _PROBLEM.match(ln)
        if not m:
            continue
        ts, level, msg = m.group(1), m.group(2).lower(), redact(m.group(3).strip())
        if rank.get(level, 1) < floor:
            continue
        key = (level, re.sub(r"\d+", "#", msg)[:120])         # the same message with different numbers is one problem
        g = groups.get(key)
        if g is None:
            groups[key] = {"time": ts, "level": "error" if level in ("exception", "critical") else level, "message": msg[:300], "count": 1}
        else:
            g.update(time=ts, message=msg[:300])
            g["count"] += 1
            groups.move_to_end(key)
    return list(reversed(list(groups.values())))[:max(1, min(limit, 500))]
