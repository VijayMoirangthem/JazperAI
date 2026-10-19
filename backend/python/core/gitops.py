"""Branch manager (spec §10): agents only ever change code on `agent-patch/*` branches in git worktrees; merging into the
main branch requires an approved Tier-3 HITL record. Commits carry provenance trailers (agent, model, prompt hash)."""
import asyncio
import hashlib
import re
import subprocess
from pathlib import Path

from memory.db import aio

MERGE_ACTION = "git.merge_main"
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


class GitError(RuntimeError):
    pass


def _git(cwd: Path | str, *args: str, check: bool = True) -> str:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=120)
    if check and p.returncode != 0:
        raise GitError(f"git {' '.join(args[:2])} failed: {p.stderr.strip()[:200]}")
    return p.stdout.strip()


async def git(cwd: Path | str, *args: str, check: bool = True) -> str:
    return await asyncio.to_thread(_git, cwd, *args, check=check)


async def main_branch(repo: Path) -> str:
    return await git(repo, "rev-parse", "--abbrev-ref", "HEAD")


async def create_patch_branch(repo: Path, task: str, worktrees: Path) -> tuple[str, Path, str]:
    """Returns (branch, worktree path, base sha). The main checkout is never touched."""
    slug = _SAFE.sub("-", task).strip("-")[:40] or "task"
    base = await git(repo, "rev-parse", "HEAD")
    branch = f"agent-patch/{slug}-{base[:7]}"
    wt = worktrees / branch.replace("/", "__")
    await git(repo, "worktree", "add", "-b", branch, str(wt), base)
    return branch, wt, base


async def commit(worktree: Path, message: str, agent_id: str, model: str, prompt: str) -> str:
    await git(worktree, "add", "-A")
    if not await git(worktree, "status", "--porcelain"):
        raise GitError("nothing to commit")
    trailers = f"\n\nAgent-Id: {agent_id}\nModel: {model}\nPrompt-Hash: {hashlib.sha256(prompt.encode()).hexdigest()[:16]}"
    await git(worktree, "-c", "user.name=Sir Jasper AI", "-c", "user.email=jasper@localhost", "commit", "-q", "-m", message + trailers)
    return await git(worktree, "rev-parse", "HEAD")


async def diff(worktree: Path, base: str) -> str:
    return await git(worktree, "diff", base)


async def rollback(worktree: Path, base: str) -> None:
    await git(worktree, "reset", "--hard", base)
    await git(worktree, "clean", "-fd")


async def remove(repo: Path, worktree: Path, branch: str) -> None:
    await git(repo, "worktree", "remove", "--force", str(worktree), check=False)
    await git(repo, "branch", "-D", branch, check=False)


async def is_approved(request_id: str, action: str = MERGE_ACTION) -> bool:
    row = await aio.fetch("SELECT 1 FROM shared.hitl_requests WHERE request_id=$1::uuid AND action=$2 AND status='approved'", request_id, action)
    return bool(row)


async def merge_to_main(repo: Path, branch: str, approval_request_id: str | None) -> str:
    """Tier-3: refuses without an approved git.merge_main HITL record."""
    if not approval_request_id or not await is_approved(approval_request_id):
        raise GitError("merge to main requires an approved Tier-3 HITL request")
    if not branch.startswith("agent-patch/"):
        raise GitError("only agent-patch/* branches can be merged by agents")
    await git(repo, "-c", "user.name=Sir Jasper AI", "-c", "user.email=jasper@localhost", "merge", "--no-ff", "-m", f"Merge {branch} (approved {approval_request_id})", branch)
    return await git(repo, "rev-parse", "HEAD")
