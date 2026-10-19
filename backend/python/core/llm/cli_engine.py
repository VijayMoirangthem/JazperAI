"""CLI engine provider: drives a local agent CLI (e.g. `claude -p`, `codex exec`) as an LLM. The registry row's base_url
holds the command line; the prompt is sent on stdin and stdout is the reply. Uses the CLI's own login/subscription."""
import asyncio
import shlex
import time
from collections.abc import AsyncIterator

from core.llm.providers import Provider
from core.llm.types import LLMRequest, LLMResult, ProviderError, Usage


class CliProvider(Provider):
    def __init__(self, slug: str, command: str, model: str = "", timeout_s: float = 300):
        self.name, self.cmd, self.model, self.timeout = slug, shlex.split(command, posix=False), model, timeout_s

    def _prompt(self, req: LLMRequest) -> str:
        turns = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in req.messages)
        return (f"{req.system}\n\n" if req.system else "") + turns

    async def complete(self, req: LLMRequest) -> LLMResult:
        if not self.cmd:
            raise ProviderError("no command configured", retryable=False)
        t0 = time.perf_counter()
        try:
            proc = await asyncio.create_subprocess_exec(*self.cmd, stdin=asyncio.subprocess.PIPE,
                                                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            out, err = await asyncio.wait_for(proc.communicate(self._prompt(req).encode()), self.timeout)
        except FileNotFoundError as e:
            raise ProviderError("cli not found", retryable=False) from e
        except asyncio.TimeoutError as e:
            proc.kill()
            raise ProviderError("cli timeout", retryable=True) from e
        if proc.returncode != 0:
            raise ProviderError(f"cli exit {proc.returncode}: {err.decode(errors='ignore')[:120]}", retryable=False)
        return LLMResult(text=out.decode(errors="ignore").strip(), stop_reason="cli",
                         usage=Usage(provider=self.name, model=self.model or "cli", latency_ms=int((time.perf_counter() - t0) * 1000)))

    async def stream(self, req: LLMRequest) -> AsyncIterator[str]:
        res = await self.complete(req)
        yield res.text
        yield res.usage

    async def count_tokens(self, req: LLMRequest) -> int:
        return len(self._prompt(req)) // 4
