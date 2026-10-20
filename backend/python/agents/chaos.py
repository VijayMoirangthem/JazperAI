"""ChaosBot (Plan V2 G4): fault-injection experiments that run ONLY against disposable targets.

Safety rules (enforced by construction, not by flag):
  - LLM experiments use in-memory fake providers; they never call a real provider or touch the live router.
  - Process/resource experiments run inside the Docker sandbox (no network, hard memory/pids/cpu limits).
  - The connector experiment uses a private Hub() instance with the bundled demo server, never the live hub.
  - There is no parameter that selects a target, so nothing can be pointed at production.
Each experiment returns {name, passed, detail, ms}. Hypothesis is stated up front so a failure is a finding, not a surprise.
"""
import asyncio
import sys
import tempfile
import time
from pathlib import Path

from core.llm.providers import Provider
from core.llm.router import LLMRouter
from core.llm.types import LLMRequest, LLMResult, ProviderError, Usage

RESULTS: list[dict] = []  # newest last, capped


class _Fake(Provider):
    def __init__(self, name: str, fail: bool):
        self.name, self.fail, self.calls = name, fail, 0

    async def complete(self, req: LLMRequest) -> LLMResult:
        self.calls += 1
        if self.fail:
            raise ProviderError(f"{self.name} injected failure", retryable=True)
        return LLMResult(text="ok", usage=Usage(provider=self.name, model="fake"))


async def _no_sleep(_s: float) -> None:
    return None


async def provider_failover() -> tuple[bool, str]:
    """Hypothesis: when the primary provider fails, the router answers from the fallback and opens the breaker on the primary."""
    bad, good = _Fake("primary", True), _Fake("fallback", False)
    r = LLMRouter([bad, good], attempts=2, breaker_threshold=2, sleep=_no_sleep)
    req = LLMRequest(messages=[{"role": "user", "content": "ping"}])
    res = [await r.complete(req) for _ in range(3)]
    ok = all(x.text == "ok" for x in res) and res[0].fallback_from == ["primary"] and r._down(bad)
    return ok, f"answers from fallback: {all(x.text == 'ok' for x in res)}; breaker open on primary: {r._down(bad)}; primary calls: {bad.calls}"


async def provider_total_outage() -> tuple[bool, str]:
    """Hypothesis: with every provider down the router fails fast with a clear error instead of hanging."""
    r = LLMRouter([_Fake("a", True), _Fake("b", True)], attempts=2, sleep=_no_sleep)
    t0 = time.monotonic()
    try:
        await asyncio.wait_for(r.complete(LLMRequest(messages=[{"role": "user", "content": "ping"}])), 5)
    except ProviderError as e:
        return time.monotonic() - t0 < 2, f"failed fast with: {str(e)[:80]}"
    return False, "no error raised"


async def _sandboxed(script: str, **limits) -> "object":
    from hub import sandbox
    if not sandbox.available():
        raise RuntimeError("docker sandbox unavailable")
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "boom.py").write_text(script)
        return await sandbox.run(["python", "boom.py"], Path(d), network="none", timeout_s=40, **limits)


async def sandbox_memory_bomb() -> tuple[bool, str]:
    """Hypothesis: a runaway allocation is killed by the container's memory limit and the host is unaffected."""
    res = await _sandboxed("x = bytearray(900 * 1024 * 1024)\nprint('survived')\n", mem="64m")
    return res.exit_code != 0 and "survived" not in res.output, f"exit={res.exit_code} (137 = OOM-killed), {res.duration_ms} ms"


async def sandbox_fork_bomb() -> tuple[bool, str]:
    """Hypothesis: a process-spawning loop is capped by the pids limit and the run still ends within its timeout."""
    script = ("import os, sys\nn = 0\nfor _ in range(500):\n    try:\n        if os.fork() == 0:\n            import time; time.sleep(5); sys.exit(0)\n        n += 1\n"
              "    except OSError:\n        break\nprint('forked', n)\n")
    res = await _sandboxed(script, pids=32)
    forked = int(res.output.rsplit("forked", 1)[1].split()[0]) if "forked" in res.output else -1
    return 0 <= forked < 100 and not res.timed_out, f"forks before the cap: {forked} (limit 32 pids), timed_out={res.timed_out}"


async def connector_crash_recovery() -> tuple[bool, str]:
    """Hypothesis: a crashing MCP connector is reported DEGRADED without taking the hub down, and the next call restarts it."""
    from hub.hub import Hub, ToolError
    from memory.db import aio
    h = Hub()
    await h.upsert("chaos-demo", "Chaos demo", [sys.executable, "-m", "hub.servers.demo_server"], rate_per_min=1000)
    try:
        first = await h.use_tool("chaos-demo.echo", {"text": "a"}, agent="chaos")
        try:
            await h.use_tool("chaos-demo.crash", {}, agent="chaos")
            degraded = False
        except ToolError as e:
            degraded = "DEGRADED" in str(e)
        again = await h.use_tool("chaos-demo.echo", {"text": "b"}, agent="chaos")
        return (not first["blocked"]) and degraded and (not again["blocked"]), f"degraded reported: {degraded}; recovered on next call: {not again['blocked']}"
    finally:
        await h.remove("chaos-demo")
        await h.shutdown()
        try:
            await aio.execute("DELETE FROM shared.hitl_requests WHERE requester='chaos'")
        except Exception:
            pass


EXPERIMENTS = {f.__name__: f for f in (provider_failover, provider_total_outage, sandbox_memory_bomb, sandbox_fork_bomb, connector_crash_recovery)}


async def run(name: str) -> dict:
    if name not in EXPERIMENTS:
        raise KeyError(name)
    t0 = time.monotonic()
    try:
        passed, detail = await EXPERIMENTS[name]()
    except Exception as e:
        passed, detail = False, f"experiment error: {str(e)[:200]}"
    out = {"name": name, "hypothesis": (EXPERIMENTS[name].__doc__ or "").strip(), "passed": passed, "detail": detail,
           "ms": int((time.monotonic() - t0) * 1000), "at": time.time()}
    RESULTS.append(out)
    del RESULTS[:-20]
    return out


async def run_all() -> list[dict]:
    return [await run(n) for n in EXPERIMENTS]
