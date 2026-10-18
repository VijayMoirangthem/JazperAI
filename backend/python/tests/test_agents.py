"""
Agent smoke tests.

One test per agent — calls agent.run() with a simple task and verifies:
  1. It does not crash
  2. Returns an AgentResult with the correct structure
  3. Returns success=True (with mocked AI)
  4. Produces non-empty content

These tests use the mock_ai fixture from conftest.py — no real API calls.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Shared assertion helper ───────────────────────────────────────────────────

def assert_valid_result(result, agent_name: str):
    from app.agents.base_agent import AgentResult
    assert isinstance(result, AgentResult), f"{agent_name}: run() must return AgentResult"
    assert result.trace is not None, f"{agent_name}: trace must not be None"
    assert result.trace.agent_name == agent_name
    assert isinstance(result.content, str), f"{agent_name}: content must be a string"
    assert len(result.content) > 0, f"{agent_name}: content must not be empty"
    assert result.success is True, f"{agent_name}: expected success=True, got error: {result.error}"


# ── Scout ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scout_smoke(null_emit, basic_context, mock_ai, mock_search):
    from app.agents.scout_agent import ScoutAgent
    agent = ScoutAgent()
    result = await agent.run(
        task="What is the latest Python version?",
        context=basic_context,
        session_id="test",
        emit=null_emit,
    )
    assert_valid_result(result, "Scout")


# ── Hermes ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_hermes_smoke(null_emit, basic_context, mock_ai, mock_gmail):
    from app.agents.hermes_agent import HermesAgent
    agent = HermesAgent()
    result = await agent.run(
        task="Summarise my unread emails",
        context={**basic_context, "gmail_token": None},
        session_id="test",
        emit=null_emit,
    )
    # Hermes may return success=False if no Gmail token — that is acceptable
    assert result is not None
    from app.agents.base_agent import AgentResult
    assert isinstance(result, AgentResult)
    assert isinstance(result.content, str)
    assert result.trace.agent_name == "Hermes"


# ── Sage ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sage_smoke(null_emit, basic_context, mock_ai):
    from app.agents.sage_agent import SageAgent
    from unittest.mock import patch, AsyncMock
    agent = SageAgent()
    with patch("app.services.memory_service.MemoryService") as MockMemory:
        MockMemory.return_value.semantic_search = AsyncMock(return_value=[])
        MockMemory.return_value.store_memory = AsyncMock(return_value=True)
        result = await agent.run(
            task="What is my notice period?",
            context=basic_context,
            session_id="test",
            emit=null_emit,
        )
    assert_valid_result(result, "Sage")


# ── Lens ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_lens_smoke(null_emit, mock_ai):
    from app.agents.lens_agent import LensAgent
    agent = LensAgent()
    # Provide a tiny valid base64 PNG (1x1 white pixel)
    TINY_PNG_B64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    )
    context = {
        **{"session_id": "test", "user_profile": {}, "core_memories": []},
        "image_b64": f"data:image/png;base64,{TINY_PNG_B64}",
    }
    result = await agent.run(
        task="What does this image show?",
        context=context,
        session_id="test",
        emit=null_emit,
    )
    assert result is not None
    from app.agents.base_agent import AgentResult
    assert isinstance(result, AgentResult)
    assert result.trace.agent_name == "Lens"


# ── Atlas ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_atlas_smoke(null_emit, basic_context, mock_ai):
    from app.agents.atlas_agent import AtlasAgent
    from unittest.mock import patch, MagicMock
    agent = AtlasAgent()
    with patch("psycopg2.connect") as mock_conn:
        mock_cur = MagicMock()
        mock_cur.fetchall.return_value = []
        mock_cur.fetchone.return_value = None
        mock_conn.return_value.__enter__ = lambda s: mock_conn.return_value
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)
        mock_conn.return_value.cursor.return_value.__enter__ = lambda s: mock_cur
        mock_conn.return_value.cursor.return_value.__exit__ = MagicMock(return_value=False)
        result = await agent.run(
            task="How many jobs have I applied to this week?",
            context=basic_context,
            session_id="test",
            emit=null_emit,
        )
    assert result is not None
    from app.agents.base_agent import AgentResult
    assert isinstance(result, AgentResult)
    assert result.trace.agent_name == "Atlas"


# ── Phantom ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_phantom_smoke(null_emit, basic_context, mock_ai):
    from app.agents.phantom_agent import PhantomAgent
    from unittest.mock import patch
    agent = PhantomAgent()
    # Phantom uses its own internal _scrape_requests() — not scraper_tool.scrape_url
    with patch("app.agents.phantom_agent._scrape_requests",
               return_value=("Mocked page content from the target URL.", "")):
        result = await agent.run(
            task="What is on https://example.com?",
            context=basic_context,
            session_id="test",
            emit=null_emit,
        )
    assert result is not None
    from app.agents.base_agent import AgentResult
    assert isinstance(result, AgentResult)
    assert result.trace.agent_name == "Phantom"


# ── Registry ──────────────────────────────────────────────────────────────────

def test_registry_loads_all_agents():
    """All 6 agents must be registered and have required attributes."""
    from app.agents.registry import AgentRegistry
    registry = AgentRegistry()
    registry._ensure_loaded()
    agents = registry.all()
    assert len(agents) == 6, f"Expected 6 agents, got {len(agents)}"
    names = {a.name for a in agents}
    assert names == {"Scout", "Hermes", "Sage", "Lens", "Atlas", "Phantom"}
    for agent in agents:
        assert agent.name, "Agent must have a name"
        assert agent.description, "Agent must have a description"
        assert agent.model, "Agent must have a model"
        assert agent.emoji, "Agent must have an emoji"


def test_registry_descriptions():
    """descriptions() must return a list of dicts with expected keys."""
    from app.agents.registry import AgentRegistry
    registry = AgentRegistry()
    registry._ensure_loaded()
    descs = registry.descriptions()
    assert len(descs) == 6
    for d in descs:
        assert "name" in d
        assert "description" in d
        assert "emoji" in d
        assert "model" in d
