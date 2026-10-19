import asyncio
import subprocess
import sys
from uuid import UUID

import httpx
import pytest

import api.routes.devloop as dl
import core.llm.registry as reg
from core import hitl
from core.llm.providers import Provider
from core.llm.router import LLMRouter
from core.llm.types import LLMResult, Usage
from memory.db import aio

pytestmark = pytest.mark.db


class Fixed(Provider):
    name = "fixed"

    async def complete(self, req):
        return LLMResult(text="```python\ndef add(a, b):\n    return a + b\n```", usage=Usage(provider="fixed", model="fixed"))


def sh(cwd, *a):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture
async def env(tmp_path, monkeypatch):
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(repo, "git", "init", "-q", "-b", "main")
    sh(repo, "git", "config", "user.email", "t@t"); sh(repo, "git", "config", "user.name", "t")
    (repo / "calc.py").write_text("def add(a, b):\n    return a - b\n")
    (repo / "test_calc.py").write_text("from calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-qm", "init")
    stub = reg.TieredRouter({t: LLMRouter([Fixed()]) for t in reg.TIERS})

    async def fake_router():
        return stub
    monkeypatch.setattr(dl, "ROOT", repo)
    monkeypatch.setattr(dl, "WORKTREES", tmp_path / "wt")
    monkeypatch.setattr(dl, "get_router", fake_router)
    monkeypatch.setattr(dl, "safe_path", lambda p: repo / p)
    monkeypatch.setitem(dl.PRESETS, "tmp-pytest", ([sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider"], ""))
    dl.RUNS.clear()
    from main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield repo, c
    await aio.execute("DELETE FROM shared.hitl_requests WHERE requester='forge' AND summary LIKE 'Merge agent-patch/%'")
    await aio.close_pool()


async def wait_for(c, rid, key, value, secs=60):
    for _ in range(secs * 5):
        r = (await c.get(f"/api/v1/devloop/runs/{rid}")).json()
        if r.get(key) == value:
            return r
        await asyncio.sleep(0.2)
    raise AssertionError(f"timeout waiting for {key}={value}: {r}")


async def test_llm_edit_verify_then_merge_only_after_approval(env):
    repo, c = env
    bad = await c.post("/api/v1/devloop/runs", json={"task": "fix add", "files": ["calc.py"], "test": "rm -rf"})
    assert bad.status_code == 422  # no free-form commands
    start = await c.post("/api/v1/devloop/runs", json={"task": "Fix the add function", "files": ["calc.py"], "test": "tmp-pytest"})
    rid = start.json()["id"]
    run = await wait_for(c, rid, "status", "verified")
    assert run["isolated"] is False and "+    return a + b" in run["diff"] and run["branch"].startswith("agent-patch/")
    assert "a - b" in (repo / "calc.py").read_text()  # main checkout untouched until approval
    m = await c.post(f"/api/v1/devloop/runs/{rid}/merge")
    assert m.status_code == 200
    await wait_for(c, rid, "merge", "awaiting-approval")
    assert "a - b" in (repo / "calc.py").read_text()
    rows = await aio.fetch("SELECT request_id FROM shared.hitl_requests WHERE status='pending' AND requester='forge' AND action='git.merge_main'")
    assert rows
    await hitl.respond(UUID(str(rows[0]["request_id"])), True, "founder")
    done = await wait_for(c, rid, "merge", "merged")
    assert done["merge_sha"] and "a + b" in (repo / "calc.py").read_text()
    assert (await c.post(f"/api/v1/devloop/runs/{rid}/merge")).status_code == 409


def test_strip_fences():
    from agents.devloop_llm import strip_fences
    assert strip_fences("```py\nx = 1\n```") == "x = 1\n" and strip_fences("plain") == "plain"


async def test_logs_endpoint_whitelist_and_redaction(tmp_path, monkeypatch):
    import api.routes.system as sysr
    (tmp_path / "storage" / "logs").mkdir(parents=True)
    (tmp_path / "storage" / "logs" / "launcher.log").write_text("ok line\nkey sk-abcdefghijklmnopqrstuvwxyz leaked\n")
    monkeypatch.setattr(sysr, "ROOT", tmp_path)
    from main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/v1/system/logs", params={"name": "launcher"})
        assert r.status_code == 200 and "<redacted>" in r.text and "sk-abcdef" not in r.text
        assert (await c.get("/api/v1/system/logs", params={"name": "../../etc/passwd"})).status_code == 404
