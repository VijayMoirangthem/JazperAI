"""Phase 7A — Commander Agent (IT Department, L3 under Darwin).

Commander is the ONLY agent in COOS allowed to run shell commands.
No other agent calls subprocess directly — everything goes through Commander.

Commander:
  1. Receives a command + cwd + caller context from Darwin/Aria/other agents
  2. Routes through TerminalSandbox (risk classification + approval gate)
  3. If ApprovalRequired → creates an approval request and waits
  4. Executes when cleared, captures stdout/stderr
  5. Emits result to IDE bus (visible in Activity Feed)
  6. Logs everything to the IT audit trail

Usage (from Darwin or Aria):
  result = await CommanderAgent.run(
      command="pytest tests/ -q",
      cwd="backend/python",
      caller="Darwin",
      reason="Verifying test suite after Forge applied fix",
  )
"""

from __future__ import annotations

import structlog

from core.system.terminal_sandbox import (
    ApprovalRequired,
    BlockedCommand,
    CommandResult,
    TerminalSandbox,
    classify_risk,
)

log = structlog.get_logger()

# In-memory terminal output ring buffer for Control Tower live view
_terminal_log: list[dict] = []
_MAX_LOG = 500
_terminal_subscribers: list = []   # asyncio.Queue instances for SSE


def _push_terminal_event(entry: dict) -> None:
    _terminal_log.append(entry)
    if len(_terminal_log) > _MAX_LOG:
        del _terminal_log[:-_MAX_LOG]
    dead = []
    for q in _terminal_subscribers:
        try:
            q.put_nowait(entry)
        except Exception:
            dead.append(q)
    for q in dead:
        try:
            _terminal_subscribers.remove(q)
        except ValueError:
            pass


def subscribe_terminal() -> "asyncio.Queue[dict]":
    """Subscribe to Commander terminal output (for Control Tower SSE)."""
    import asyncio
    q: asyncio.Queue[dict] = asyncio.Queue(maxsize=200)
    _terminal_subscribers.append(q)
    return q


def unsubscribe_terminal(q: object) -> None:
    try:
        _terminal_subscribers.remove(q)
    except ValueError:
        pass


def get_terminal_log(limit: int = 100) -> list[dict]:
    return list(reversed(_terminal_log[-limit:]))


# ── Commander ─────────────────────────────────────────────────────────────────

class CommanderAgent:
    """
    Gatekeeper between COOS agents and the OS terminal.
    Routes all shell commands through TerminalSandbox.
    """

    @classmethod
    async def run(
        cls,
        command:  str,
        cwd:      str = "backend/python",
        caller:   str = "system",
        reason:   str = "",
        timeout:  int = 120,
        allow_external_cwd: bool = False,
    ) -> dict:
        """
        Execute a command through the safety sandbox.

        Returns a dict:
          {"ok": True, "stdout": "...", "stderr": "...", "exit_code": 0,
           "duration_s": 1.2, "risk": "safe", "command": "..."}
          OR
          {"ok": False, "error": "...", "approval_required": True, ...}
        """
        import asyncio, datetime

        risk = classify_risk(command)

        # ── Emit "starting" event to IDE bus ──────────────────────────────────
        _emit_start(command, risk, caller, reason)

        ts = datetime.datetime.utcnow().isoformat() + "Z"
        log.info("Commander: running",
                 command=command, cwd=cwd, risk=risk, caller=caller)

        # ── Check for approval requirement ────────────────────────────────────
        auto_approve_medium = await cls._is_medium_auto_approved()

        try:
            result = await TerminalSandbox.run(
                command=command,
                cwd=cwd,
                timeout=timeout,
                auto_approve_medium=auto_approve_medium,
                allow_external_cwd=allow_external_cwd,
            )
        except BlockedCommand as bc:
            log.warning("Commander: blocked", command=command, reason=str(bc))
            entry = {
                "ts": ts, "command": command, "risk": "blocked",
                "caller": caller, "ok": False,
                "output": f"BLOCKED: {bc.matched_pattern}",
            }
            _push_terminal_event(entry)
            _emit_result(command, risk, caller, ok=False,
                         output=f"BLOCKED: {bc.matched_pattern}")
            return {
                "ok":    False,
                "error": f"Blocked command: {bc.matched_pattern}",
                "risk":  "blocked",
                "command": command,
                "approval_required": False,
            }

        except ApprovalRequired as ar:
            log.info("Commander: approval required",
                     command=command, risk=ar.risk)
            # Create approval request and wait
            approved = await cls._request_and_wait_approval(
                command=command, risk=ar.risk,
                reason=reason, caller=caller,
            )
            if not approved:
                _emit_result(command, risk, caller, ok=False,
                             output="Approval denied by user")
                return {
                    "ok": False,
                    "error": "User denied approval",
                    "risk":  ar.risk,
                    "command": command,
                    "approval_required": True,
                }
            # Re-run after approval (medium/high approved)
            try:
                result = await TerminalSandbox.run(
                    command=command, cwd=cwd, timeout=timeout,
                    auto_approve_medium=True,  # approval was granted
                    allow_external_cwd=allow_external_cwd,
                )
            except Exception as exc:
                return {
                    "ok": False, "error": str(exc),
                    "risk": risk, "command": command,
                }

        # ── Log to terminal ring buffer ───────────────────────────────────────
        output_combined = result.stdout + (
            f"\n[stderr] {result.stderr}" if result.stderr else ""
        )
        entry = {
            "ts":        ts,
            "command":   command,
            "risk":      result.risk,
            "caller":    caller,
            "reason":    reason,
            "ok":        result.ok,
            "exit_code": result.exit_code,
            "duration_s": result.duration_s,
            "output":    output_combined[-3000:],
        }
        _push_terminal_event(entry)
        _emit_result(command, result.risk, caller,
                     ok=result.ok, output=output_combined[:500])

        return {
            "ok":        result.ok,
            "stdout":    result.stdout,
            "stderr":    result.stderr,
            "exit_code": result.exit_code,
            "duration_s": result.duration_s,
            "risk":      result.risk,
            "command":   command,
            "approval_required": False,
        }

    # ── Approval helpers ──────────────────────────────────────────────────────

    @classmethod
    async def _is_medium_auto_approved(cls) -> bool:
        """Check if the user has auto-approved medium-risk commands in autonomy settings."""
        try:
            from core.services.approval_service import AUTONOMY_CACHE
            return bool(AUTONOMY_CACHE.get("shell_commands", False))
        except Exception:
            return False

    @classmethod
    async def _request_and_wait_approval(
        cls, command: str, risk: str,
        reason: str, caller: str,
    ) -> bool:
        try:
            from core.services import approval_service
            approval_id, auto_approved = await approval_service.request_approval(
                agent       = "Commander",
                action_type = "run_shell_command",
                description = f"[{risk.upper()}] {command[:120]}",
                payload = {
                    "command": command,
                    "risk":    risk,
                    "caller":  caller,
                    "reason":  reason,
                },
            )
            if auto_approved:
                return True
            return await approval_service.wait_for_approval(approval_id, timeout=3600)
        except Exception as exc:
            log.error("Commander: approval request failed", error=str(exc))
            return False


# ── IDE bus helpers ───────────────────────────────────────────────────────────

def _emit_start(command: str, risk: str, caller: str, reason: str) -> None:
    try:
        from core.services.ide_bus import ide_bus
        ide_bus.emit({
            "agent":   "Commander",
            "action":  "running",
            "command": command[:120],
            "risk":    risk,
            "caller":  caller,
            "reason":  reason,
        })
    except Exception:
        pass


def _emit_result(
    command: str, risk: str, caller: str,
    ok: bool, output: str,
) -> None:
    try:
        from core.services.ide_bus import ide_bus
        ide_bus.emit({
            "agent":   "Commander",
            "action":  "result",
            "command": command[:120],
            "risk":    risk,
            "caller":  caller,
            "ok":      ok,
            "output":  output[:300],
        })
    except Exception:
        pass
