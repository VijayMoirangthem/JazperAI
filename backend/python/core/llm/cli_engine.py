"""CLI engine provider: drives a local agent CLI (e.g. `claude -p`, `codex exec`) as an LLM. The registry row's base_url
holds the command line; the prompt is sent on stdin and stdout is the reply. Uses the CLI's own login/subscription.
Runs subprocess.run in a worker thread: asyncio subprocesses are unavailable on the selector loop the API uses on Windows."""
import asyncio
import shlex
import subprocess
import time
from collections.abc import AsyncIterator

from core.llm.providers import Provider
from core.llm.types import LLMRequest, LLMResult, ProviderError, Usage


class CliProvider(Provider):
    def __init__(self, slug: str, command: str, model: str = "", timeout_s: float = 300):
        self.name, self.cmd, self.model, self.timeout = slug, [t.strip('"') for t in shlex.split(command, posix=False)], model, timeout_s

    def _prompt(self, req: LLMRequest) -> str:
        turns = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in req.messages)
        return (f"{req.system}\n\n" if req.system else "") + turns

    async def complete(self, req: LLMRequest) -> LLMResult:
        if not self.cmd:
            raise ProviderError("no command configured", retryable=False)
        t0 = time.perf_counter()
        try:
            p = await asyncio.to_thread(subprocess.run, self.cmd, input=self._prompt(req).encode(), capture_output=True, timeout=self.timeout)
        except FileNotFoundError as e:
            raise ProviderError("cli not found", retryable=False) from e
        except subprocess.TimeoutExpired as e:
            raise ProviderError("cli timeout", retryable=True) from e
        if p.returncode != 0:
            raise ProviderError(f"cli exit {p.returncode}: {p.stderr.decode(errors='ignore')[:120]}", retryable=False)
        return LLMResult(text=p.stdout.decode(errors="ignore").strip(), stop_reason="cli",
                         usage=Usage(provider=self.name, model=self.model or "cli", latency_ms=int((time.perf_counter() - t0) * 1000)))

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | Usage]:
        res = await self.complete(req)
        yield res.text
        yield res.usage

    async def count_tokens(self, req: LLMRequest) -> int:
        return len(self._prompt(req)) // 4
