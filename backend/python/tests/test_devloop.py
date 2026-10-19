import subprocess
import sys
from uuid import uuid4

import pytest

from agents.devloop import MAX_ATTEMPTS, run_devloop
from core import gitops
from core.eventbus import bus
from memory.db import aio

pytestmark = pytest.mark.db


def sh(cwd, *a):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture
async def repo(tmp_path):
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    r = tmp_path / "repo"
    r.mkdir()
    sh(r, "git", "init", "-q", "-b", "main")
    sh(r, "git", "config", "user.email", "t@t"); sh(r, "git", "config", "user.name", "t")
    (r / "calc.py").write_text("def add(a, b):\n    return a - b\n")
    (r / "test_calc.py").write_text("from calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    sh(r, "git", "add", "-A"); sh(r, "git", "commit", "-qm", "init")
    yield r
    await aio.close_pool()


CMD = [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider"]


def fixer(succeed_on):
    calls = []

    async def implement(wt, attempt, feedback):
        calls.append((attempt, feedback[:30]))
        if attempt == succeed_on:
            (wt / "calc.py").write_text("def add(a, b):\n    return a + b\n")
        else:
            (wt / "calc.py").write_text(f"def add(a, b):\n    return a * {attempt}\n")  # still wrong
    implement.calls = calls
    return implement


@pytest.mark.parametrize("n", [1, 2, 3])
async def test_succeeds_within_limit_and_commits_with_provenance(repo, tmp_path, n):
    impl = fixer(n)
    out = await run_devloop(repo, tmp_path / "wt", "fix add", CMD, impl, agent="forge", model="m-test")
    assert out["passed"] and out["attempt"] == n and len(impl.calls) == n and out["isolated"] is False
    msg = sh(out["worktree"], "git", "log", "-1", "--format=%B")
    assert "Agent-Id: forge" in msg and "Model: m-test" in msg and "Prompt-Hash:" in msg
    assert sh(repo, "git", "log", "-1", "--format=%s") == "init" and "a - b" in (repo / "calc.py").read_text()  # main untouched


async def test_never_fixed_means_exactly_three_attempts_rollback_and_escalation(repo, tmp_path):
    impl = fixer(99)
    sub = bus.subscribe({"human-intervention-request", "agent-state-change"})
    out = await run_devloop(repo, tmp_path / "wt", "impossible task", CMD, impl)
    assert len(impl.calls) == MAX_ATTEMPTS and out["status"] == "rolled_back_escalated" and not out["passed"]
    assert "a - b" in (tmp_path / "wt" / out["branch"].replace("/", "__") / "calc.py").read_text()  # rolled back to base
    assert sh(out["worktree"], "git", "status", "--porcelain") == ""
    events = []
    while not sub.q.empty():
        events.append(sub.q.get_nowait())
    assert any(e.method == "human-intervention-request" and e.params["action"] == "devloop.escalation" for e in events)
    assert any(e.method == "agent-state-change" and e.params["to_state"] == "escalated" for e in events)
    assert (await aio.fetch("SELECT 1 FROM shared.audit_log WHERE topic='devloop-postmortem' LIMIT 1"))


async def test_merge_to_main_requires_approved_tier3_record(repo, tmp_path):
    out = await run_devloop(repo, tmp_path / "wt", "fix add 2", CMD, fixer(1))
    with pytest.raises(gitops.GitError):
        await gitops.merge_to_main(repo, out["branch"], None)
    rid = str(uuid4())
    await aio.execute("INSERT INTO shared.hitl_requests (request_id, tier, action, summary, requester, status, expires_at) "
                      "VALUES ($1::uuid, 3, 'git.merge_main', 's', 'test-dl', 'pending', now() + interval '1 hour')", rid)
    with pytest.raises(gitops.GitError):  # pending is not approved
        await gitops.merge_to_main(repo, out["branch"], rid)
    await aio.execute("UPDATE shared.hitl_requests SET status='approved' WHERE request_id=$1::uuid", rid)
    sha = await gitops.merge_to_main(repo, out["branch"], rid)
    assert sha and "a + b" in (repo / "calc.py").read_text()
    with pytest.raises(gitops.GitError):  # only agent-patch/* branches
        await gitops.merge_to_main(repo, "main", rid)
    await aio.execute("DELETE FROM shared.hitl_requests WHERE requester='test-dl'")


async def test_verification_can_run_inside_the_docker_sandbox(repo, tmp_path):
    from hub import sandbox
    if not sandbox.available():
        pytest.skip("docker not available")
    out = await run_devloop(repo, tmp_path / "wt", "fix add in sandbox", ["python", "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider"], fixer(2),
                            sandbox=True)
    assert out["passed"] and out["attempt"] == 2 and out["isolated"] is True
    assert all(h["isolated"] for h in out["history"])
