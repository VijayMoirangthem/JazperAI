import asyncio

import httpx2 as httpx  # the Anthropic SDK uses httpx2, so respx cannot intercept it
import pytest
from fastapi.testclient import TestClient

from core.llm.providers import AnthropicProvider, Provider, StubProvider
from core.llm.router import LLMRouter
from core.llm.types import LLMRequest, LLMResult, ProviderError, Usage

URL = "https://api.anthropic.com/v1/messages"
OK = {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5", "stop_reason": "end_turn",
      "content": [{"type": "text", "text": "hi"}],
      "usage": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 7, "cache_creation_input_tokens": 3}}
REQ = LLMRequest(messages=[{"role": "user", "content": "yo"}], system="static system prompt")


class Calls:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def handler(self, request):
        self.calls.append(request)
        r = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        if isinstance(r, Exception):
            raise r
        return r


def mk(*responses):
    c = Calls(responses)
    prov = AnthropicProvider("k", http_client=httpx.AsyncClient(transport=httpx.MockTransport(c.handler)))
    return prov, c


async def _nosleep(_):
    return None


async def test_usage_extraction_and_cache_marker():
    prov, c = mk(httpx.Response(200, json=OK))
    res = await LLMRouter([prov], sleep=_nosleep).complete(REQ)
    assert res.text == "hi"
    u = res.usage
    assert (u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens) == (10, 5, 7, 3)
    assert b'"cache_control"' in c.calls[0].content


async def test_429_then_success_retries_same_provider():
    prov, c = mk(httpx.Response(429, json={"type": "error", "error": {"type": "rate_limit_error", "message": "x"}}),
                                      httpx.Response(200, json=OK))
    res = await LLMRouter([prov], sleep=_nosleep).complete(REQ)
    assert res.text == "hi" and res.fallback_from == []


async def test_persistent_429_and_529_fall_back_within_one_call():
    prov, c = mk(httpx.Response(529, json={"type": "error", "error": {"type": "overloaded_error", "message": "x"}}))
    res = await LLMRouter([prov, StubProvider("fallback ok")], sleep=_nosleep).complete(REQ)
    assert res.text == "fallback ok" and res.fallback_from == ["anthropic"]


async def test_timeout_falls_back():
    prov, c = mk(httpx.ConnectTimeout("t"))
    res = await LLMRouter([prov, StubProvider("fb")], sleep=_nosleep).complete(REQ)
    assert res.fallback_from == ["anthropic"]


async def test_non_retryable_400_does_not_retry():
    prov, r = mk(httpx.Response(400, json={"type": "error", "error": {"type": "invalid_request_error", "message": "x"}}))
    res = await LLMRouter([prov, StubProvider("fb")], sleep=_nosleep).complete(REQ)
    assert len(r.calls) == 1 and res.text == "fb"


class Down(Provider):
    name = "down"
    calls = 0

    async def complete(self, req):
        Down.calls += 1
        raise ProviderError("boom")


async def test_circuit_breaker_skips_down_provider():
    Down.calls = 0
    r = LLMRouter([Down(), StubProvider()], attempts=1, breaker_threshold=2, sleep=_nosleep)
    for _ in range(4):
        await r.complete(REQ)
    assert Down.calls == 2  # opened after 2 failures, skipped afterwards


class Slow(Provider):
    name = "slow"
    closed = False

    async def stream(self, req):
        try:
            for i in range(1000):
                yield f"t{i} "
                await asyncio.sleep(0.001)
        finally:
            Slow.closed = True


async def test_streaming_cancellation_closes_provider_stream():
    gen = LLMRouter([Slow()]).stream(REQ)
    got = [await gen.__anext__() for _ in range(3)]
    await gen.aclose()
    await asyncio.sleep(0)
    assert len(got) == 3 and Slow.closed


async def test_stream_stub_ends_with_usage():
    items = [i async for i in LLMRouter([StubProvider("a b")]).stream(REQ)]
    assert isinstance(items[-1], Usage) and "".join(items[:-1]).strip() == "a b"


def test_default_router_without_key_uses_stub_and_endpoint_works(monkeypatch):
    from core import vault
    from core.config import settings
    monkeypatch.setattr(vault, "get", lambda n: None)
    monkeypatch.setattr(settings, "CLAUDE_API_KEY", "")
    monkeypatch.setattr(settings, "AI_API_KEY", "")
    from core.llm.registry import invalidate
    invalidate()
    from main import app
    r = TestClient(app, base_url="http://localhost").post("/api/v1/llm/complete", json={"prompt": "hello"})
    assert r.status_code == 200 and r.json()["usage"]["provider"] == "stub"


async def test_cli_provider_runs_command_and_reports_errors():
    import sys
    from core.llm.cli_engine import CliProvider
    from core.llm.types import ProviderError
    ok = CliProvider("cli-t", f'"{sys.executable}" -c "import sys; print(sys.stdin.read().upper())"')
    res = await ok.complete(REQ)
    assert "YO" in res.text and res.usage.provider == "cli-t"
    with pytest.raises(ProviderError):
        await CliProvider("cli-bad", f'"{sys.executable}" -c "import sys; sys.exit(3)"').complete(REQ)
    with pytest.raises(ProviderError):
        await CliProvider("cli-missing", "definitely-not-a-real-binary-xyz").complete(REQ)
