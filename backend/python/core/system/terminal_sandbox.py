"""Phase 7A — Terminal Sandbox.

The ONLY place in COOS that runs shell commands.
All commands are classified by risk tier BEFORE execution.
Risk tiers are hardcoded — NOT decided by an LLM.

Risk tiers:
  safe    → always run, no approval needed
  low     → always run, no approval needed
  medium  → run automatically OR require approval (controlled by autonomy settings)
  high    → always require user approval via the Approvals panel
  blocked → never allowed, raise hard error

Usage:
  result = await TerminalSandbox.run("pytest tests/ -q", cwd="backend/python", risk="safe")
  result = await TerminalSandbox.run("rm old_file.py", cwd="backend/python", risk="high")
  # high → raises ApprovalRequired; Commander catches and creates approval request
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import structlog

log = structlog.get_logger()

# ── Types ─────────────────────────────────────────────────────────────────────

RiskTier = Literal["safe", "low", "medium", "high", "blocked"]


@dataclass
class CommandResult:
    command:     str
    cwd:         str
    risk:        RiskTier
    exit_code:   int
    stdout:      str
    stderr:      str
    duration_s:  float
    ok:          bool
    error:       str | None = None


class ApprovalRequired(Exception):
    """Raised when a high-risk command needs user approval before running."""
    def __init__(self, command: str, risk: RiskTier, reason: str = ""):
        self.command = command
        self.risk    = risk
        self.reason  = reason
        super().__init__(f"Approval required for {risk!r} command: {command!r}")


class BlockedCommand(Exception):
    """Raised when a command matches the blocked tier — never allowed."""
    def __init__(self, command: str, matched_pattern: str):
        self.command         = command
        self.matched_pattern = matched_pattern
        super().__init__(f"Blocked command: {command!r} matches pattern {matched_pattern!r}")


# ── Risk classification ────────────────────────────────────────────────────────
# Patterns are matched against the FULL command string (case-insensitive).
# Order matters — blocked is checked first.

_BLOCKED_PATTERNS = [
    r"\bformat\b",         # disk format
    r"\bshutdown\b",
    r"\brestart-computer\b",
    r"\bregedit\b",
    r"\bschtasks\b.*\/delete",
    r"\bnetsh\b.*firewall",
    r"\bdiskpart\b",
    r"rm\s+-rf\s+/",       # rm -rf root
    r"del\s+/[sq].*\*",   # Windows del with wildcards
]

_HIGH_PATTERNS = [
    r"\brm\b",
    r"\bdel\b",
    r"\brmdir\b",
    r"\bgit\s+reset\s+--hard",
    r"\bgit\s+push\s+--force",
    r"\bgit\s+clean\s+-f",
    r"\bDROP\s+TABLE\b",
    r"\bDROP\s+DATABASE\b",
    r"\bTRUNCATE\b",
    r"\bformat-volume\b",
    r"\bremove-item\b.*-recurse.*-force",
]

_MEDIUM_PATTERNS = [
    r"\buvicorn\b",
    r"\bnpm\s+run\s+dev\b",
    r"\bpython\s+main\.py\b",
    r"\brestart\b",
    r"\bnpm\s+run\s+build\b",
    r"\bnpm\s+run\s+start\b",
]

# Anything not matched above falls through to safe/low based on recognisable prefixes
_LOW_PREFIXES = (
    "npm install", "npm i ", "npm ci",
    "pip install", "pip3 install",
    "git pull", "git fetch", "git clone",
    "npm run lint", "npm run test",
)

# Hard protection list — Commander cannot touch these regardless of risk tier
_PROTECTED_FILES = {
    "main.py",
    "watchdog.py",
    "init.py",   # db/init.py
    ".env",
    ".env.local",
    ".env.production",
}

_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent.resolve()


# ── Classifier ────────────────────────────────────────────────────────────────

def classify_risk(command: str) -> RiskTier:
    """Classify a shell command string into a risk tier. Hardcoded — no LLM."""
    cmd = command.strip()
    cmd_lower = cmd.lower()

    for pattern in _BLOCKED_PATTERNS:
        if re.search(pattern, cmd_lower, re.IGNORECASE):
            return "blocked"

    for pattern in _HIGH_PATTERNS:
        if re.search(pattern, cmd_lower, re.IGNORECASE):
            return "high"

    for pattern in _MEDIUM_PATTERNS:
        if re.search(pattern, cmd_lower, re.IGNORECASE):
            return "medium"

    for prefix in _LOW_PREFIXES:
        if cmd_lower.startswith(prefix):
            return "low"

    return "safe"


def _touches_protected_file(command: str) -> str | None:
    """Return the protected file name if the command references it, else None."""
    cmd_lower = command.lower()
    for protected in _PROTECTED_FILES:
        if protected in cmd_lower:
            return protected
    return None


# ── TerminalSandbox ───────────────────────────────────────────────────────────

class TerminalSandbox:
    """
    Controlled subprocess executor.
    Classifies risk, enforces approval gates, logs every command.
    """

    @staticmethod
    async def run(
        command:    str,
        cwd:        str = ".",
        risk:       RiskTier | None = None,
        timeout:    int = 60,
        auto_approve_medium: bool = False,
        allow_external_cwd: bool = False,
    ) -> CommandResult:
        """
        Execute a shell command.

        Args:
          command:              The shell command string.
          cwd:                  Working directory. Relative paths are resolved
                                against project root. Absolute paths are allowed
                                only when allow_external_cwd=True (used by
                                Commander when building external projects).
          risk:                 Caller-supplied tier (if None, auto-classifies).
          timeout:              Max seconds before killing.
          auto_approve_medium:  If True, medium-risk runs without approval.
          allow_external_cwd:   If True, absolute cwd paths outside project root
                                are permitted (e.g. v:\\Projects\\TodoApp\\backend).

        Raises:
          BlockedCommand:    If risk == "blocked".
          ApprovalRequired:  If risk == "high", or "medium" and not auto_approved.
        """
        # ── 1. Resolve cwd ───────────────────────────────────────────────────
        cwd_path = Path(cwd)
        if cwd_path.is_absolute():
            abs_cwd = cwd_path.resolve()
            if not allow_external_cwd and not abs_cwd.is_relative_to(_PROJECT_ROOT):
                raise ValueError(
                    f"Absolute cwd {cwd!r} is outside project root. "
                    "Pass allow_external_cwd=True to allow external project paths."
                )
        else:
            abs_cwd = (_PROJECT_ROOT / cwd).resolve()
            if not abs_cwd.is_relative_to(_PROJECT_ROOT):
                raise ValueError(f"cwd {cwd!r} escapes project root")
        if not abs_cwd.exists():
            abs_cwd.mkdir(parents=True, exist_ok=True)

        # ── 2. Classify risk ──────────────────────────────────────────────────
        effective_risk: RiskTier = risk if risk is not None else classify_risk(command)

        log.info("TerminalSandbox.run",
                 command=command, cwd=str(abs_cwd), risk=effective_risk)

        # ── 3. Protected-file guard ───────────────────────────────────────────
        protected = _touches_protected_file(command)
        if protected and effective_risk in ("high", "medium"):
            raise BlockedCommand(command, f"protected file: {protected}")

        # ── 4. Tier gates ─────────────────────────────────────────────────────
        if effective_risk == "blocked":
            raise BlockedCommand(command, matched_pattern="blocked tier")

        if effective_risk == "high":
            raise ApprovalRequired(command, effective_risk,
                                   reason="High-risk commands always require approval.")

        if effective_risk == "medium" and not auto_approve_medium:
            raise ApprovalRequired(command, effective_risk,
                                   reason="Medium-risk command requires approval unless auto-approved.")

        # ── 5. Execute ────────────────────────────────────────────────────────
        t0 = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(abs_cwd),
                env={**os.environ},
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return CommandResult(
                    command=command, cwd=str(abs_cwd), risk=effective_risk,
                    exit_code=-1, stdout="", stderr="",
                    duration_s=timeout, ok=False,
                    error=f"Command timed out after {timeout}s",
                )

            duration_s = round(time.monotonic() - t0, 2)
            stdout = stdout_b.decode(errors="replace")
            stderr = stderr_b.decode(errors="replace")
            exit_code = proc.returncode or 0

            result = CommandResult(
                command=command, cwd=str(abs_cwd), risk=effective_risk,
                exit_code=exit_code, stdout=stdout[-8000:], stderr=stderr[-2000:],
                duration_s=duration_s, ok=(exit_code == 0),
            )
            log.info("TerminalSandbox: done",
                     command=command, exit_code=exit_code, duration_s=duration_s)

            # Fire-and-forget audit log
            _audit(result)
            return result

        except (BlockedCommand, ApprovalRequired):
            raise
        except Exception as exc:
            duration_s = round(time.monotonic() - t0, 2)
            log.error("TerminalSandbox: exec error", command=command, error=str(exc))
            return CommandResult(
                command=command, cwd=str(abs_cwd), risk=effective_risk,
                exit_code=-1, stdout="", stderr=str(exc),
                duration_s=duration_s, ok=False, error=str(exc),
            )


# ── Audit log ─────────────────────────────────────────────────────────────────

_audit_log: list[dict] = []   # in-memory ring buffer, last 500 entries
_MAX_AUDIT = 500


def _audit(result: CommandResult) -> None:
    import datetime
    entry = {
        "ts":        datetime.datetime.utcnow().isoformat() + "Z",
        "command":   result.command,
        "cwd":       result.cwd,
        "risk":      result.risk,
        "exit_code": result.exit_code,
        "duration_s": result.duration_s,
        "ok":        result.ok,
        "error":     result.error,
    }
    _audit_log.append(entry)
    if len(_audit_log) > _MAX_AUDIT:
        del _audit_log[:-_MAX_AUDIT]


def get_audit_log(limit: int = 100) -> list[dict]:
    return list(reversed(_audit_log[-limit:]))
