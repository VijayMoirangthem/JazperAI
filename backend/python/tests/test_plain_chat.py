"""Plain conversation takes the short, tool-free, low-reasoning path; anything else (or a model that needs a tool) uses the full tool loop."""
import json

import pytest

from agents import fastpaths, jasper_tools, orgchart
from api.routes import chat2
from core import finops
from core.llm.types import Usage
from memory import consolidate


class FakeRouter:
    def __init__(self, script):
        self.script, self.requests = script, []

    async def stream(self, req):
        self.requests.append(req)
        step = self.script.pop(0) if self.script else ["ok"]
        if isinstance(step, Exception):
            raise step
        for piece in step:
            yield piece
        yield Usage(provider="fake", model="m", input_tokens=10, output_tokens=5)


@pytest.fixture
def env(monkeypatch):
    calls = {"loop": 0, "only": "unset"}

    async def over_cap(slug):
        return False

    async def record_call(*a, **k):
        return None

    async def no_recall(*a, **k):
        return {}

    async def loop(r, system, msgs, tier, agent="jasper", only=None):
        calls["loop"] += 1
        calls["only"] = only
        calls["system"] = system
        yield {"delta": "from the tool loop"}
        yield {"usage": Usage(provider="loop", model="m")}

    monkeypatch.setattr(orgchart, "over_cap", over_cap)
    monkeypatch.setattr(orgchart, "record_call", record_call)
    monkeypatch.setattr(consolidate, "recall_multi", no_recall)
    monkeypatch.setattr(consolidate, "consolidate_turn", lambda *a, **k: _noop())
    monkeypatch.setattr(jasper_tools, "stream_with_tools", loop)
    monkeypatch.setattr(jasper_tools, "has_tools", lambda slug: True)
    monkeypatch.setattr(chat2, "announce", lambda *a, **k: None)
    monkeypatch.setattr(chat2.registry, "routable", lambda slug: None)
    monkeypatch.setattr(finops, "attribute", lambda *a, **k: _Ctx())
    return calls


async def _noop():
    return None


class _Ctx:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


async def _run(router, text, atts=None):
    out = []
    async for line in chat2._speak(router, "jasper", [], text, atts or []):
        out.append(json.loads(line))
    return out


def _text(events):
    return "".join(e.get("text", "") for e in events if e["t"] == "delta")


async def test_plain_message_uses_the_short_fast_path(env):
    r = FakeRouter([["Doing ", "great, thanks."]])
    ev = await _run(r, "how are you doing today")
    assert _text(ev) == "Doing great, thanks." and env["loop"] == 0
    req = r.requests[0]
    assert req.tier == "light" and req.reasoning == "low" and "<tool>" not in req.system and len(req.system) < 900
    assert any(e["t"] == "done" for e in ev)


async def test_model_that_needs_a_tool_falls_back_to_the_tool_loop(env):
    for reply in (["TOOLS"], ['<tool>{"name":"x","args":{}}</tool>'], ['{"name": "x"}']):
        env["loop"] = 0
        ev = await _run(FakeRouter([reply]), "explain recursion in two lines")
        assert _text(ev) == "from the tool loop" and env["loop"] == 1                # nothing from the plain attempt leaked to the user


async def test_provider_error_before_any_text_falls_back_instead_of_failing(env):
    ev = await _run(FakeRouter([RuntimeError("provider down")]), "tell me a joke please")
    assert _text(ev) == "from the tool loop" and not any(e["t"] == "error" for e in ev)


async def test_empty_plain_answer_falls_back(env):
    ev = await _run(FakeRouter([[""]]), "tell me a joke please")
    assert _text(ev) == "from the tool loop"


async def test_messages_that_may_act_skip_the_plain_path(env):
    r = FakeRouter([])
    ev = await _run(r, "delegate this to the team lead please")
    assert env["loop"] == 1 and r.requests == [] and _text(ev) == "from the tool loop"


async def test_attachments_skip_the_plain_path(env):
    from api.routes.chat2 import Attachment
    r = FakeRouter([])
    await _run(r, "hi", [Attachment(name="a.txt", text="x")])
    assert env["loop"] == 1 and r.requests == []


async def test_tool_loop_gets_a_small_tool_list_for_a_clear_area(env):
    await _run(FakeRouter([]), "remember that I like tea with milk")
    only = env["only"]
    assert only is not None and "remember" in only and len(only) < len(jasper_tools.tools_for("jasper")) // 2


async def test_fast_paths_are_untouched(env, monkeypatch):
    async def gen():
        yield {"delta": "deterministic"}

    monkeypatch.setattr(fastpaths, "match", lambda *a, **k: (lambda: gen()))
    r = FakeRouter([])
    ev = await _run(r, "anything")
    assert _text(ev) == "deterministic" and r.requests == [] and env["loop"] == 0


def test_reasoning_effort_is_only_sent_to_models_that_accept_it():
    from core.llm.providers import _reasoning_kwargs
    from core.llm.types import LLMRequest
    req = LLMRequest(messages=[{"role": "user", "content": "hi"}], reasoning="low")
    assert _reasoning_kwargs("openai/gpt-oss-20b", req) == {"extra_body": {"reasoning_effort": "low"}}
    assert _reasoning_kwargs("qwen/qwen3.8-27b", req) == {}                       # other models would reject the unknown field
    assert _reasoning_kwargs("openai/gpt-oss-20b", LLMRequest(messages=[])) == {}  # off unless asked for
