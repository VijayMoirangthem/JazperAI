"""Dev-loop runs (aliased /api/v1/devloop): the model edits files on an agent-patch/* branch in a worktree, tests verify, and a merge
into the current branch happens only after you approve a Tier-3 request. Test commands are presets, never free-form shell."""
import asyncio
import shutil
import sys
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.devloop import run_devloop
from agents.devloop_llm import make_implementer
from api.routes.edit import ROOT, safe_path
from core import gitops, hitl
from core.llm.registry import get_router

router = APIRouter()
RUNS: dict[str, dict] = {}
WORKTREES = ROOT / "storage" / "worktrees"
PRESETS = {  # name -> (command, workdir inside the worktree)
    "pytest-backend": ([sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "--ignore=tests/test_probe_pulse.py"], "backend/python"),
    "pytest-sandbox": (["python", "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider"], "", True),  # isolated in Docker; for self-contained test suites
    "none": ([sys.executable, "-c", "pass"], ""),
}


class RunIn(BaseModel):
    task: str = Field(min_length=5, max_length=2000)
    files: list[str] = Field(min_length=1, max_length=8)
    test: str = "pytest-backend"


def _public(r: dict) -> dict:
    return {k: v for k, v in r.items() if k not in ("task_handle", "merge_handle", "worktree_path")}


async def _execute(run: dict) -> None:
    try:
        router_ = await get_router()
        env = ROOT / "backend" / "python" / ".env"
        impl = make_implementer(run["task"], run["files"], router_)

        async def implement(wt: Path, attempt: int, feedback: str):
            if attempt == 1 and env.exists() and run["workdir"]:  # settings need .env; it is git-ignored so it never gets committed
                shutil.copy(env, wt / "backend" / "python" / ".env")
            run["attempt"] = attempt
            await impl(wt, attempt, feedback)

        cmd, workdir, *rest = PRESETS[run["test"]]
        sandboxed = bool(rest and rest[0])
        out = await run_devloop(ROOT, WORKTREES, run["task"], cmd, implement, workdir=workdir, sandbox=sandboxed)
        passed = out.get("passed") is True
        diff = (await gitops.diff(Path(out["worktree"]), out["base"]))[:60000] if passed else ""
        run.update(branch=out["branch"], base=out["base"], history=out["history"], worktree_path=out["worktree"], isolated=bool(out.get("isolated")), diff=diff,
                   commit=out.get("commit"), status="verified" if passed else out.get("status", "rolled_back_escalated"))  # status last: readers see a complete run
    except Exception as e:
        run.update(status="error", error=str(e)[:300])


@router.post("/runs")
async def start(body: RunIn):
    if body.test not in PRESETS:
        raise HTTPException(422, f"test must be one of {list(PRESETS)}")
    for f in body.files:
        safe_path(f)  # blocks secrets, VCS data, dependencies, paths outside the project
    rid = uuid4().hex[:10]
    run = {"id": rid, "task": body.task, "files": body.files, "test": body.test, "workdir": PRESETS[body.test][1], "status": "running", "attempt": 0}
    RUNS[rid] = run
    run["task_handle"] = asyncio.create_task(_execute(run))
    return _public(run)


@router.get("/runs")
async def runs():
    return {"runs": [_public(r) for r in reversed(list(RUNS.values()))]}


@router.get("/runs/{rid}")
async def get_run(rid: str):
    if rid not in RUNS:
        raise HTTPException(404, "unknown run")
    return _public(RUNS[rid])


async def _merge_flow(run: dict) -> None:
    run["merge"] = "awaiting-approval"
    try:
        ok = await hitl.gate("git.merge_main", f"Merge {run['branch']} into the current branch: {run['task'][:200]}", "forge", ttl_s=900)
        rid = hitl.last_request_id()
        if not ok:
            run["merge"] = "denied"
            return
        run["merge_sha"] = await gitops.merge_to_main(ROOT, run["branch"], str(rid))
        run["merge"] = "merged"
    except Exception as e:
        run.update(merge="error", error=str(e)[:300])


@router.post("/runs/{rid}/merge")
async def merge(rid: str):
    run = RUNS.get(rid)
    if not run:
        raise HTTPException(404, "unknown run")
    if run.get("status") != "verified" or run.get("merge") in ("awaiting-approval", "merged"):
        raise HTTPException(409, "only a verified, not-yet-merged run can be merged")
    run["merge_handle"] = asyncio.create_task(_merge_flow(run))
    return {"id": rid, "merge": "awaiting-approval"}


@router.delete("/runs/{rid}")
async def discard(rid: str):
    run = RUNS.pop(rid, None)
    if not run:
        raise HTTPException(404, "unknown run")
    if run.get("branch"):
        await gitops.remove(ROOT, Path(run["worktree_path"]), run["branch"])
    return {"discarded": rid}
