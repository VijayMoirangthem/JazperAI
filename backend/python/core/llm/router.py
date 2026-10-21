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
    def __init__(self, chain: list[Provider], attempts: int = 4, base_delay: float = 0.5, breaker_threshold: int = 3,
                 breaker_cooldown: float = 30.0, sleep=asyncio.sleep):
        self.chain, self.attempts, self.base_delay = chain, attempts, base_delay
        self.threshold, self.cooldown, self._sleep = breaker_threshold, breaker_cooldown, sleep
        self._fails: dict[str, int] = {}
        self._open_until: dict[str, float] = {}

    def reset_breakers(self) -> None:
        self._fails.clear()
        self._open_until.clear()

    def _usable(self) -> list[Provider]:
        """Providers not in breaker cooldown; if EVERY provider is cooling down, try them all anyway (never fail with an empty attempt list)."""
        live = [p for p in self.chain if not self._down(p)]
        return live or list(self.chain)

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
                if e.retry_after and p is not self.chain[-1]:
                    raise  # rate limited with another model still available: fail over now instead of waiting
                wait = self.base_delay * (2 ** i) * (0.5 + random.random())
                if e.retry_after:  # honour the server's Retry-After on 429 (capped so a request never hangs for minutes)
                    wait = max(wait, min(e.retry_after, 20.0))
                await self._sleep(wait)

    async def complete(self, req: LLMRequest) -> LLMResult:
        failed: list[str] = []
        for p in self._usable():
            try:
                res = await self._with_retries(p, lambda p=p: p.complete(req))
                self._record(p, True)
                res.fallback_from = failed
                return res
            except ProviderError as e:
                self._record(p, False)
                failed.append(f"{p.name}: {str(e)[:70]}")
                log.warning("llm provider failed", provider=p.name, error=str(e))
        raise ProviderError(f"all providers failed: {failed}", retryable=False)

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | Usage]:
        """Falls back only before the first token is emitted (mid-stream failures surface to the caller)."""
        failed: list[str] = []
        for p in self._usable():
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
                failed.append(f"{p.name}: {str(e)[:70]}")
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
