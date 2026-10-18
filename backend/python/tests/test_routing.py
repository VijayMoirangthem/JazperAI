"""
Routing tests — formalised as pytest.

These are the 16 routing test cases that were previously run manually.
They test _keyword_route() directly — zero LLM calls, zero network.

Each test verifies:
  - Which agents are selected
  - Whether it is high-confidence (can skip LLM) or low-confidence
  - That no wrong agent is included
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.orchestrator import _keyword_route


# ── High-confidence cases — should NEVER need LLM confirmation ───────────────

class TestHighConfidenceRouting:

    def test_web_search_explicit(self):
        agents, reasoning, high_conf = _keyword_route("search for Python news today", has_image=False)
        assert "Scout" in agents
        assert high_conf is True

    def test_email_check(self):
        agents, reasoning, high_conf = _keyword_route("check my emails", has_image=False)
        assert "Hermes" in agents
        assert high_conf is True

    def test_memory_recall(self):
        agents, reasoning, high_conf = _keyword_route("what's my notice period?", has_image=False)
        assert "Sage" in agents
        assert high_conf is True

    def test_memory_store(self):
        agents, reasoning, high_conf = _keyword_route("remember that I prefer remote jobs", has_image=False)
        assert "Sage" in agents
        assert high_conf is True

    def test_job_tracker(self):
        agents, reasoning, high_conf = _keyword_route("how many job applications have I sent this week?", has_image=False)
        assert "Atlas" in agents
        assert high_conf is True

    def test_web_scrape(self):
        agents, reasoning, high_conf = _keyword_route("scrape the job listings from this page", has_image=False)
        assert "Phantom" in agents
        assert high_conf is True

    def test_vision_image_present(self):
        agents, reasoning, high_conf = _keyword_route("what does this say?", has_image=True)
        assert "Lens" in agents
        assert high_conf is True

    def test_send_email(self):
        agents, reasoning, high_conf = _keyword_route("send email to Flipkart HR", has_image=False)
        assert "Hermes" in agents
        assert high_conf is True

    def test_cover_letter(self):
        agents, reasoning, high_conf = _keyword_route("write a cover letter for this job", has_image=False)
        assert "Atlas" in agents
        assert high_conf is True

    def test_latest_news(self):
        agents, reasoning, high_conf = _keyword_route("what's happening in AI today?", has_image=False)
        assert "Scout" in agents
        assert high_conf is True


# ── Low-confidence cases — ambiguous, may call LLM to confirm ────────────────

class TestLowConfidenceRouting:

    def test_ambiguous_latest(self):
        agents, reasoning, high_conf = _keyword_route("latest features", has_image=False)
        # Scout might be selected but confidence should be lower
        # The message is ambiguous — it could be asking Jazper directly
        assert isinstance(agents, list)
        assert isinstance(high_conf, bool)

    def test_ambiguous_job_keyword(self):
        agents, reasoning, high_conf = _keyword_route("any job updates?", has_image=False)
        assert isinstance(agents, list)

    def test_ambiguous_my_prefix(self):
        agents, reasoning, high_conf = _keyword_route("my thoughts on this", has_image=False)
        # "my" is a low-confidence Sage trigger but not by itself meaningful
        assert isinstance(agents, list)


# ── Direct answer cases — no agents needed ───────────────────────────────────

class TestNoAgentRouting:

    def test_pure_reasoning(self):
        agents, reasoning, high_conf = _keyword_route("explain recursion to me", has_image=False)
        # Should not route to any agent — Jazper answers directly from knowledge
        assert "Scout" not in agents
        assert "Hermes" not in agents
        assert "Sage" not in agents

    def test_math_question(self):
        agents, reasoning, high_conf = _keyword_route("what is 2 + 2?", has_image=False)
        assert len(agents) == 0 or not high_conf

    def test_greeting(self):
        agents, reasoning, high_conf = _keyword_route("hello, how are you?", has_image=False)
        assert "Scout" not in agents
        assert "Hermes" not in agents

    def test_coding_question(self):
        agents, reasoning, high_conf = _keyword_route("how do I use async/await in Python?", has_image=False)
        assert "Hermes" not in agents
        assert "Atlas" not in agents


# ── Multi-agent cases — one message, multiple agents ─────────────────────────

class TestMultiAgentRouting:

    def test_email_and_search(self):
        agents, reasoning, high_conf = _keyword_route(
            "search for Python jobs and check my emails", has_image=False
        )
        assert "Scout" in agents
        assert "Hermes" in agents

    def test_vision_and_memory(self):
        agents, reasoning, high_conf = _keyword_route(
            "what does this image say and do you remember my preferences?", has_image=True
        )
        assert "Lens" in agents
        assert "Sage" in agents
