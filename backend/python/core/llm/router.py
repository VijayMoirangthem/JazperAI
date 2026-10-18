"""Retry (exponential backoff + jitter), circuit breaker (provider-down detection) and fallback chain."""
import asyncio
from contextlib import aclosing
import random
import time
from collections.abc import AsyncIterator

import structlog

from core.llm.providers import AnthropicProvider, OpenAICompatProvider, Provider, StubProvider
from core.llm.types import LLMRequest, LLMResult, ProviderError, Usage

log = structlog.get_logger()


class LLMRouter:
    def __init__(self, chain: list[Provider], attempts: int = 3, base_delay: float = 0.5, breaker_threshold: int = 3,
                 breaker_cooldown: float = 30.0, sleep=asyncio.sleep):
        self.chain, self.attempts, self.base_delay = chain, attempts, base_delay
        self.threshold, self.cooldown, self._sleep = breaker_threshold, breaker_cooldown, sleep
        self._fails: dict[str, int] = {}
        self._open_until: dict[str, float] = {}

    def _down(self, p: Provider) -> bool:
        return self._open_until.get(p.name, 0) > time.monotonic()

    def _record(self, p: Provider, ok: bool) -> None:
        if ok:
            self._fails[p.name] = 0
            return
        self._fails[p.name] = self._fails.get(p.name, 0) + 1
        if self._fails[p.name] >= self.threshold:
            self._open_until[p.name] = time.monotonic() + self.cooldown
            log.warning("llm provider marked down", provider=p.name, cooldown_s=self.cooldown)

    async def _with_retries(self, p: Provider, fn):
        for i in range(self.attempts):
            try:
                return await fn()
            except ProviderError as e:
                if not e.retryable or i == self.attempts - 1:
                    raise
                await self._sleep(self.base_delay * (2 ** i) * (0.5 + random.random()))

    async def complete(self, req: LLMRequest) -> LLMResult:
        failed: list[str] = []
        for p in self.chain:
            if self._down(p):
                failed.append(f"{p.name}(down)")
                continue
            try:
                res = await self._with_retries(p, lambda p=p: p.complete(req))
                self._record(p, True)
                res.fallback_from = failed
                return res
            except ProviderError as e:
                self._record(p, False)
                failed.append(p.name)
                log.warning("llm provider failed", provider=p.name, error=str(e))
        raise ProviderError(f"all providers failed: {failed}", retryable=False)

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | Usage]:
        """Falls back only before the first token is emitted (mid-stream failures surface to the caller)."""
        failed: list[str] = []
        for p in self.chain:
            if self._down(p):
                continue
            started = False
            try:
                async with aclosing(p.stream(req)) as it:  # closing the outer stream closes the provider stream
                    async for item in it:
                        started = True
                        yield item
                self._record(p, True)
                return
            except ProviderError as e:
                self._record(p, False)
                if started:
                    raise
                failed.append(p.name)
        raise ProviderError(f"all providers failed: {failed}", retryable=False)

    async def count_tokens(self, req: LLMRequest) -> int:
        for p in self.chain:
            try:
                return await p.count_tokens(req)
            except ProviderError:
                continue
        return 0


def default_router() -> LLMRouter:
    """Anthropic primary (key from vault, then CLAUDE_API_KEY setting) -> OpenAI-compatible fallback ->
    local only when EDGE_MODE. Without any key: StubProvider (C-1 blocked)."""
    from core import vault
    from core.config import settings

    chain: list[Provider] = []
    try:
        key = vault.get("ANTHROPIC_API_KEY") or settings.CLAUDE_API_KEY
    except vault.VaultUnavailable:
        key = settings.CLAUDE_API_KEY
    if key:
        chain.append(AnthropicProvider(key))
    local = "localhost" in settings.AI_BASE_URL or "127.0.0.1" in settings.AI_BASE_URL
    if settings.AI_API_KEY and (not local or settings.EDGE_MODE):
        models = {"light": settings.LIGHT_MODEL, "standard": settings.AI_MODEL, "frontier": settings.AI_MODEL}
        chain.append(OpenAICompatProvider(settings.AI_BASE_URL, settings.AI_API_KEY, models, local=local))
    if settings.EDGE_MODE and settings.LOCAL_FALLBACK_ENABLED:
        m = settings.LOCAL_FALLBACK_MODEL
        chain.append(OpenAICompatProvider(settings.LOCAL_FALLBACK_URL, "lm-studio", {"light": m, "standard": m, "frontier": m},
                                          name="local", local=True))
    return LLMRouter(chain or [StubProvider()])
