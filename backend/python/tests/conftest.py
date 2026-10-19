"""
Shared pytest fixtures for Sir Jazper OS test suite.

All agent tests use:
  - null_emit: a no-op emit callable (agents call emit() during run)
  - mock_ai:   patches ai_provider so tests never hit real Groq/LM Studio
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _null_emit(event_type: str, payload: dict):
    """Drop all SSE events — agents must emit, tests don't care what they emit."""
    pass


@pytest.fixture
def null_emit():
    return _null_emit


@pytest.fixture
def basic_context():
    return {
        "session_id": "test-session",
        "user_profile": {},
        "core_memories": [],
    }


@pytest.fixture
def mock_ai():
    """
    Patch ai_provider so no real API calls are made.
    Returns a short stub response for any chat/stream call.
    """
    stub_text = "This is a test response from the mocked AI provider."

    # chat() must return a ChatResult dataclass — agents access .content / .prompt_tokens etc.
    async def _fake_chat(messages, **kwargs):
        from core.providers.ai_provider import ChatResult
        return ChatResult(
            content=stub_text,
            model="mock-model",
            prompt_tokens=10,
            completion_tokens=20,
            total_tokens=30,
            duration_ms=1,
        )

    # stream() is an async generator — yield tokens one by one
    async def _fake_stream(messages, **kwargs):
        for word in stub_text.split():
            yield word + " "

    # stream_with_tools() is also an async generator — yield plain text (no tool_call dict)
    # so agents treat it as a final answer without ever dispatching a real tool
    async def _fake_stream_with_tools(messages, tools, **kwargs):
        yield stub_text

    mock = MagicMock()
    mock.chat                = AsyncMock(side_effect=_fake_chat)
    mock.stream              = _fake_stream
    mock.stream_with_tools   = _fake_stream_with_tools

    with patch("core.providers.ai_provider.ai_provider", mock):
        yield mock


@pytest.fixture
def mock_search():
    """Stub web search so Scout tests don't hit Tavily."""
    with patch("core.services.search_service.run_search", return_value="Mocked search result."):
        yield


@pytest.fixture
def mock_gmail():
    """Stub Gmail so Hermes tests don't need real OAuth.
    gmail_service uses standalone functions (no GmailService class).
    With mock_ai in place, stream_with_tools never calls tools so these
    stubs are a safety net rather than primary mocks."""
    with patch("core.services.gmail_service.list_emails", return_value=[]), \
         patch("core.services.gmail_service.get_email",   return_value={}), \
         patch("core.services.gmail_service.send_email",  return_value={"id": "mock"}):
        yield


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def event_loop_policy():
    """psycopg3 async (LangGraph Postgres saver) needs the selector loop on Windows."""
    import sys
    return asyncio.WindowsSelectorEventLoopPolicy() if sys.platform == "win32" else asyncio.DefaultEventLoopPolicy()
