"""Bounded dev-loop graph (spec §10): plan -> implement -> verify -> repair (max 3 attempts) -> rollback -> escalate.

Verification runs the test command in the patch worktree. With sandbox=True it runs in an ephemeral hardened Docker container (no network,
read-only copy of the tree); otherwise it is a plain subprocess, flagged `isolated: false` in the result.
"""
import asyncio
import subprocess
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph

from core import audit, gitops
from core.eventbus import announce, bus
from core.telemetry import span

MAX_ATTEMPTS = 3
Implement = Callable[[Path, int, str], Awaitable[None]]  # (worktree, attempt, feedback) -> edits files in the worktree


class DevState(TypedDict, total=False):
    repo: str
    worktrees: str
    task: str
    test_cmd: list[str]
    workdir: str
    sandbox: bool
    branch: str
    worktree: str
    base: str
    attempt: int
    feedback: str
    passed: bool
    commit: str
    status: str  # verified | rolled_back_escalated
    history: list


def _run_tests(cmd: list[str], cwd: str, timeout: float) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env={**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1"})
        return p.returncode, (p.stdout + p.stderr)[-1500:]
    except subprocess.TimeoutExpired:
        return 124, "test run timed out"


def build_devloop(implement: Implement, agent: str = "forge", model: str = "unknown", test_timeout: float = 120):
    async def plan(s: DevState):
        branch, wt, base = await gitops.create_patch_branch(Path(s["repo"]), s["task"], Path(s["worktrees"]))
        announce(agent, "planning", bubble=s["task"][:100])
        return {"branch": branch, "worktree": str(wt), "base": base, "attempt": 0, "feedback": "", "history": []}

    async def do_implement(s: DevState):
        attempt = s["attempt"] + 1
        announce(agent, "working" if attempt == 1 else "repairing", bubble=f"attempt {attempt}/{MAX_ATTEMPTS}")
        with span("devloop.implement", attempt=attempt):
            await implement(Path(s["worktree"]), attempt, s["feedback"])
        return {"attempt": attempt}

    async def verify(s: DevState):
        announce(agent, "testing", bubble=f"attempt {s['attempt']}")
        isolated = bool(s.get("sandbox"))
        with span("devloop.verify", attempt=s["attempt"], isolated=isolated):
            cwd = Path(s["worktree"]) / s.get("workdir", "")
            if isolated:
                from hub import sandbox
                r = await sandbox.run(s["test_cmd"], cwd, timeout_s=test_timeout, network="none")
                code, out = (124 if r.timed_out else r.exit_code), r.output[-1500:]
            else:
                code, out = await asyncio.to_thread(_run_tests, s["test_cmd"], str(cwd), test_timeout)
        hist = s["history"] + [{"attempt": s["attempt"], "exit": code, "isolated": isolated}]
        if code == 0:
            sha = await gitops.commit(Path(s["worktree"]), f"agent-patch: {s['task'][:60]}", agent, model, s["task"])
            return {"passed": True, "commit": sha, "history": hist}
        return {"passed": False, "feedback": out, "history": hist}

    async def rollback(s: DevState):
        await gitops.rollback(Path(s["worktree"]), s["base"])
        return {"status": "rolled_back_escalated"}

    async def escalate(s: DevState):
        announce(agent, "escalated", reason=f"{MAX_ATTEMPTS} failed attempts for: {s['task'][:80]}")
        bus.publish({"topic": "human-intervention-request", "request_id": str(uuid4()), "tier": 3, "action": "devloop.escalation",
                     "summary": f"Dev loop gave up on '{s['task'][:200]}' after {MAX_ATTEMPTS} attempts; branch {s['branch']} rolled back."})
        await audit.write("create_origins", "devloop-postmortem", {"task": s["task"], "branch": s["branch"], "attempts": s["history"], "last_output": s["feedback"][-500:]})
        return {}

    def after_verify(s: DevState) -> str:
        if s["passed"]:
            return "done"
        return "repair" if s["attempt"] < MAX_ATTEMPTS else "rollback"

    g = StateGraph(DevState)
    for n, f in [("plan", plan), ("implement", do_implement), ("verify", verify), ("rollback", rollback), ("escalate", escalate)]:
        g.add_node(n, f)
    g.add_edge(START, "plan")
    g.add_edge("plan", "implement")
    g.add_edge("implement", "verify")
    g.add_conditional_edges("verify", after_verify, {"done": END, "repair": "implement", "rollback": "rollback"})
    g.add_edge("rollback", "escalate")
    g.add_edge("escalate", END)
    return g.compile()


async def run_devloop(repo: Path, worktrees: Path, task: str, test_cmd: list[str], implement: Implement, workdir: str = "", sandbox: bool = False, **kw) -> DevState:
    graph = build_devloop(implement, **kw)
    # recursion_limit is a second, framework-level guard: 3 attempts * 2 nodes + plan/rollback/escalate fits in 14 steps
    out = await graph.ainvoke({"repo": str(repo), "worktrees": str(worktrees), "task": task, "test_cmd": test_cmd, "workdir": workdir, "sandbox": sandbox, "status": "verified"},
                              {"recursion_limit": 14})
    out["isolated"] = sandbox
    return out
