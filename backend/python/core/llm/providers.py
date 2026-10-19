"""Provider implementations: Anthropic (primary), OpenAI-compatible (fallback / edge-local), Stub (no key / tests)."""
import sys
import time
from collections.abc import AsyncIterator

import structlog
from openai import AsyncOpenAI

from core.llm.types import LLMRequest, LLMResult, ProviderError, Usage

log = structlog.get_logger()

# D-6 model tiers
ANTHROPIC_TIERS = {"light": "claude-haiku-5-5", "standard": "claude-sonnet-5-5", "frontier": "claude-opus-5-5"}


class Provider:
    name = "base"

    async def complete(self, req: LLMRequest) -> LLMResult: ...
    def stream(self, req: LLMRequest) -> AsyncIterator[str | Usage]: ...
    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise ProviderError(f"{self.name} has no embedding endpoint", retryable=False)
    async def count_tokens(self, req: LLMRequest) -> int: ...


def _classify(e: Exception) -> ProviderError:
    anthropic = sys.modules.get("anthropic")  # imported lazily (slow); if it was never imported the error cannot be one of its own
    if anthropic is None:
        return ProviderError(type(e).__name__, retryable=False)
    """429 / 529 / 5xx / timeouts / connection drops are retryable; other 4xx are not."""
    if isinstance(e, anthropic.APIStatusError):
        return ProviderError(f"{e.status_code}", retryable=e.status_code in (408, 429, 529) or e.status_code >= 500)
    if isinstance(e, (anthropic.APITimeoutError, anthropic.APIConnectionError)):
        return ProviderError(type(e).__name__, retryable=True)
    return ProviderError(type(e).__name__, retryable=False)


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, api_key: str, base_url: str | None = None, http_client=None, models: dict[str, str] | None = None):
        import anthropic  # lazy: the SDK costs ~8 s to import and is only needed when this provider is used
        self.models = models or ANTHROPIC_TIERS
        self.client = anthropic.AsyncAnthropic(api_key=api_key, base_url=base_url, max_retries=0, timeout=60,
                                            **({"http_client": http_client} if http_client else {}))

    def _kwargs(self, req: LLMRequest) -> dict:
        kw: dict = dict(model=self.models[req.tier], max_tokens=req.max_tokens,  # no temperature: current Claude models reject sampling params
                        messages=req.messages)
        if req.system:
            block = {"type": "text", "text": req.system}
            if req.cache_system:
                block["cache_control"] = {"type": "ephemeral"}
            kw["system"] = [block]
        return kw

    @staticmethod
    def _usage(model: str, u, t0: float) -> Usage:
        g = lambda k: getattr(u, k, 0) or 0  # noqa: E731
        return Usage(provider="anthropic", model=model, input_tokens=g("input_tokens"), output_tokens=g("output_tokens"),
                     cache_read_tokens=g("cache_read_input_tokens"), cache_write_tokens=g("cache_creation_input_tokens"),
                     latency_ms=int((time.perf_counter() - t0) * 1000))

    async def complete(self, req: LLMRequest) -> LLMResult:
        t0, kw = time.perf_counter(), self._kwargs(req)
        try:
            r = await self.client.messages.create(**kw)
        except Exception as e:
            raise _classify(e) from e
        text = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
        return LLMResult(text=text, usage=self._usage(kw["model"], r.usage, t0), stop_reason=r.stop_reason)

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | Usage]:
        """Yields text deltas, then a final Usage. Cancelling the consumer closes the HTTP stream."""
        t0, kw = time.perf_counter(), self._kwargs(req)
        try:
            async with self.client.messages.stream(**kw) as s:
                async for delta in s.text_stream:
                    yield delta
                final = await s.get_final_message()
            yield self._usage(kw["model"], final.usage, t0)
        except Exception as e:
            if isinstance(e, GeneratorExit):
                raise
            raise _classify(e) from e

    async def count_tokens(self, req: LLMRequest) -> int:
        kw = self._kwargs(req)
        kw.pop("max_tokens")
        try:
            return (await self.client.messages.count_tokens(**kw)).input_tokens
        except Exception as e:
            raise _classify(e) from e


class OpenAICompatProvider(Provider):
    """Groq / any OpenAI-compatible endpoint. `local=True` marks LM Studio-style edge endpoints (EDGE_MODE only)."""

    def __init__(self, base_url: str, api_key: str, models: dict[str, str], name: str = "openai_compat", local: bool = False):
        self.name, self.local, self.models = name, local, models
        self.client = AsyncOpenAI(base_url=base_url, api_key=api_key or "none", max_retries=0, timeout=60)

    def _msgs(self, req: LLMRequest) -> list[dict]:
        return ([{"role": "system", "content": req.system}] if req.system else []) + req.messages

    async def complete(self, req: LLMRequest) -> LLMResult:
        t0, model = time.perf_counter(), self.models[req.tier]
        try:
            r = await self.client.chat.completions.create(model=model, messages=self._msgs(req), max_tokens=req.max_tokens,
                                                          temperature=req.temperature)
        except Exception as e:
            status = getattr(e, "status_code", None)
            ra = None
            try:
                ra = float(e.response.headers.get("retry-after")) if getattr(e, "response", None) is not None else None
            except (TypeError, ValueError):
                ra = None
            raise ProviderError(type(e).__name__, retryable=status in (408, 429, 529) or (status or 0) >= 500
                                or type(e).__name__ in ("APITimeoutError", "APIConnectionError"), retry_after=ra) from e
        u = r.usage
        return LLMResult(text=r.choices[0].message.content or "", stop_reason=r.choices[0].finish_reason,
                         usage=Usage(provider=self.name, model=model, input_tokens=getattr(u, "prompt_tokens", 0) or 0,
                                     output_tokens=getattr(u, "completion_tokens", 0) or 0,
                                     latency_ms=int((time.perf_counter() - t0) * 1000)))

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | Usage]:
        t0, model, u = time.perf_counter(), self.models[req.tier], None
        try:
            s = await self.client.chat.completions.create(model=model, messages=self._msgs(req), max_tokens=req.max_tokens,
                                                          temperature=req.temperature, stream=True,
                                                          stream_options={"include_usage": True})
            async for chunk in s:
                if getattr(chunk, "usage", None):
                    u = chunk.usage
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise ProviderError(type(e).__name__, retryable=True) from e
        yield Usage(provider=self.name, model=model, input_tokens=getattr(u, "prompt_tokens", 0) or 0,
                    output_tokens=getattr(u, "completion_tokens", 0) or 0, latency_ms=int((time.perf_counter() - t0) * 1000))

    async def count_tokens(self, req: LLMRequest) -> int:
        return sum(len(m.get("content", "")) for m in self._msgs(req)) // 4  # coarse estimate


class StubProvider(Provider):
    """Used when no key is configured (C-1 missing) and in tests. Deterministic, no network."""
    name = "stub"

    def __init__(self, reply: str = "[stub] no LLM provider configured (set ANTHROPIC_API_KEY in the vault)"):
        self.reply = reply

    async def complete(self, req: LLMRequest) -> LLMResult:
        return LLMResult(text=self.reply, stop_reason="stub", usage=Usage(provider="stub", model="stub"))

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | Usage]:
        for w in self.reply.split(" "):
            yield w + " "
        yield Usage(provider="stub", model="stub")

    async def count_tokens(self, req: LLMRequest) -> int:
        return len(req.system + "".join(str(m.get("content", "")) for m in req.messages)) // 4
