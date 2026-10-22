"""CLI engine provider: drives a local agent CLI (e.g. `claude -p`, `codex exec`) as an LLM. The registry row's base_url
holds the command line; the prompt is sent on stdin and stdout is the reply. Uses the CLI's own login/subscription.
Runs subprocess.run in a worker thread: asyncio subprocesses are unavailable on the selector loop the API uses on Windows."""
import asyncio
import re
import shlex
import os
import subprocess
import tempfile
import time
from collections.abc import AsyncIterator

from core.llm.providers import Provider
from core.llm.types import LLMRequest, LLMResult, ProviderError, Usage


_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
_HEADER = re.compile(r"^\s*>\s*\w+\s*[\u00b7.]\s*\S+\s*$")  # opencode prints "> build · model" before the answer


def _clean(out: str) -> str:
    """Drop terminal colour codes and the CLI's banner line, keep the model's reply."""
    lines = [ln.rstrip("\r") for ln in _ANSI.sub("", out).splitlines()]
    return "\n".join(ln for ln in lines if not _HEADER.match(ln)).strip()


def _kill_tree(proc) -> None:
    """Kill a CLI call and its children (opencode.cmd spawns node processes; Popen.kill alone leaves them running)."""
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=10)
        else:
            proc.kill()
    except Exception:
        pass


class CliProvider(Provider):
    def __init__(self, slug: str, command: str, model: str = "", timeout_s: float = 300):
        # {model} in the command line is replaced by the selected model id, so one provider row can serve many models
        self.name, self.cmd, self.model, self.timeout = slug, [t.strip('"').replace("{model}", model) for t in shlex.split(command, posix=False)], model, timeout_s

    def _prompt(self, req: LLMRequest) -> str:
        turns = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in req.messages)
        return (f"{req.system}\n\n" if req.system else "") + turns

    async def complete(self, req: LLMRequest) -> LLMResult:
        if not self.cmd:
            raise ProviderError("no command configured", retryable=False)
        t0 = time.perf_counter()
        try:
            with tempfile.TemporaryDirectory(prefix="jasper-cli-") as empty:  # an empty working folder: the CLI agent has nothing to read or change
                proc = subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=empty)
                try:
                    out, err = await asyncio.to_thread(proc.communicate, self._prompt(req).encode(), self.timeout)
                except asyncio.CancelledError:  # the founder pressed Stop: kill the whole process tree now instead of letting it run to its timeout
                    _kill_tree(proc)
                    raise
                except subprocess.TimeoutExpired:
                    _kill_tree(proc)
                    raise
                p = subprocess.CompletedProcess(self.cmd, proc.returncode, out, err)
        except FileNotFoundError as e:
            raise ProviderError("cli not found", retryable=False) from e
        except subprocess.TimeoutExpired as e:
            raise ProviderError("cli timeout", retryable=True) from e
        if p.returncode != 0:
            raise ProviderError(f"cli exit {p.returncode}: {p.stderr.decode(errors='ignore')[:120]}", retryable=False)
        return LLMResult(text=_clean(p.stdout.decode(errors="ignore")), stop_reason="cli",
                         usage=Usage(provider=self.name, model=self.model or "cli", latency_ms=int((time.perf_counter() - t0) * 1000)))

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | Usage]:
        res = await self.complete(req)
        yield res.text
        yield res.usage

    async def count_tokens(self, req: LLMRequest) -> int:
        return len(self._prompt(req)) // 4
