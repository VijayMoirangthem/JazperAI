import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import MemorySaver

from agents.supervisor import build_graph, new_state


async def stub_delegate(slug, text):
    return f"{slug} handled: {text}"


async def test_delegation_to_stub_exec_and_node_order():
    out = await build_graph(MemorySaver(), stub_delegate).ainvoke(
        new_state("search the web for pgvector news"), {"configurable": {"thread_id": "t1"}})
    assert out["log"] == ["classify", "plan", "delegate", "await", "synthesize", "report"]
    assert out["status"] == "complete" and out["answer"].endswith("pgvector news")
    assert set(out["results"]) == set(out["agents"])


@pytest.mark.db
async def test_resume_after_simulated_restart_with_postgres_checkpointer():
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool
    from urllib.parse import quote_plus
    from core.config import settings
    dsn = (f"postgresql://{settings.POSTGRES_USER}:{quote_plus(settings.POSTGRES_PASSWORD)}@{settings.POSTGRES_HOST}:"
           f"{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}")
    kw = {"autocommit": True, "prepare_threshold": 0}
    cfg = {"configurable": {"thread_id": f"resume-test-{uuid4().hex[:8]}"}}
    try:
        async with AsyncConnectionPool(dsn, kwargs=kw, open=False) as pool:
            await pool.open()
            saver = AsyncPostgresSaver(pool)
            await saver.setup()
            # "process 1": runs until just before delegation, then dies
            g1 = build_graph(saver, stub_delegate, interrupt_before=["delegate"])
            part = await g1.ainvoke(new_state("search the web for jobs"), cfg)
            assert "delegate" not in part["log"]
    except OSError:
        pytest.skip("postgres unavailable")
    # "process 2": brand-new pool, saver and graph objects resume from the checkpoint
    async with AsyncConnectionPool(dsn, kwargs=kw, open=False) as pool2:
        await pool2.open()
        g2 = build_graph(AsyncPostgresSaver(pool2), stub_delegate)
        out = await g2.ainvoke(None, cfg)
        assert out["log"][-1] == "report" and out["answer"]


def test_directive_endpoint(monkeypatch):
    from core import vault
    from core.config import settings
    monkeypatch.setattr(vault, "get", lambda n: None)
    monkeypatch.setattr(settings, "CLAUDE_API_KEY", "")
    monkeypatch.setattr(settings, "AI_API_KEY", "")
    from core.llm.registry import invalidate
    invalidate()
    from main import app
    r = TestClient(app, base_url="http://localhost").post("/api/v1/directive/", json={"text": "hello there"})
    assert r.status_code == 200 and r.json()["status"] == "complete"


@pytest.mark.db
async def test_get_checkpointer_is_postgres_backed():
    from core import durable
    await durable.close_checkpointer()
    saver = await durable.get_checkpointer()
    assert type(saver).__name__ == "AsyncPostgresSaver"
    await durable.close_checkpointer()
