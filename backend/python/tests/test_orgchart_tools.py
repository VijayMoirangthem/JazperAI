"""Org overlay scoring/placement and Jasper's tool loop (no network, no DB)."""
from agents import jasper_tools, orgchart
from core.llm.types import Usage


def test_score_needs_three_turns():
    assert orgchart.score_of(None)["grade"] == "new"
    assert orgchart.score_of({"calls": 2})["score"] is None


def test_score_combines_reliability_and_thumbs():
    perfect = orgchart.score_of({"calls": 10, "errors": 0, "thumbs_up": 8, "thumbs_down": 0})
    flaky = orgchart.score_of({"calls": 10, "errors": 6, "thumbs_up": 0, "thumbs_down": 4})
    assert perfect["score"] > 90 and perfect["grade"] == "good"
    assert flaky["score"] < 60 and flaky["grade"] == "needs-attention"


def test_home_for_rules():
    assert orgchart.home_for("jasper", "l1", "builtin") == ("chief", "")
    assert orgchart.home_for("herald", "personal", "dynamic")[0] == "jazper_team"
    assert orgchart.home_for("mobile-dev-bot", "baeit", "dynamic")[0] == "baeit"
    assert orgchart.home_for("aria", "unmapped", "builtin")[0] == "legacy"


class _Router:
    """Fake LLM: first reply is a tool call, second a plain answer using the tool result."""

    def __init__(self, replies):
        self.replies, self.seen = list(replies), []

    async def stream(self, req):
        self.seen.append(req.messages[-1]["content"])
        for chunk in self.replies.pop(0):
            yield chunk
        yield Usage(provider="fake", model="fake")


async def _collect(router):
    return [ev async for ev in jasper_tools.stream_with_tools(router, "sys", [{"role": "user", "content": "hi"}], "standard")]


async def test_tool_round_then_answer_streams_only_the_answer():
    r = _Router([['<tool>{"name":"slo",', '"args":{}}</tool>'], ["All ", "good."]])
    evs = await _collect(r)
    assert [e["tool"]["status"] for e in evs if "tool" in e] == ["running", "ok"]
    assert "".join(e["delta"] for e in evs if "delta" in e) == "All good."  # the tool-call text itself is never shown
    assert "<tool_result" in r.seen[1] and "availability" in r.seen[1]
    assert any("usage" in e for e in evs)


async def test_plain_answer_has_no_tool_events():
    evs = await _collect(_Router([["Hello there, founder."]]))
    assert not any("tool" in e for e in evs)
    assert "".join(e["delta"] for e in evs if "delta" in e) == "Hello there, founder."


async def test_unknown_tool_reports_error_and_continues():
    r = _Router([['<tool>{"name":"nope","args":{}}</tool>'], ["Could not."]])
    evs = await _collect(r)
    assert [e["tool"]["status"] for e in evs if "tool" in e] == ["running", "error"]
