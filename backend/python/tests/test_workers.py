"""
Worker smoke tests.

Covers: HermesMonitorWorker, ScoutMonitorWorker, AtlasScheduledWorker, SageConsolidationWorker.

Strategy:
  - All tests use dry_run=True so no DB writes happen.
  - External I/O (Gmail, Redis, DB, AI provider, search) is fully mocked.
  - Tests verify: run() returns a dict with the expected keys, doesn't crash,
    and applies the correct skip/notify logic.
"""
import pytest
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────────────────

def _chat_result(text: str):
    """Build a minimal ChatResult-alike for mocking ai_provider.chat()."""
    m = MagicMock()
    m.content = text
    return m


# ─────────────────────────────────────────────────────────────────────────────
# HermesMonitorWorker
# ─────────────────────────────────────────────────────────────────────────────

class TestHermesMonitorWorker:

    @pytest.mark.asyncio
    async def test_skips_when_no_gmail_token(self):
        """Worker returns skipped=True when no Gmail account is connected."""
        from agents.workers.hermes_monitor_worker import HermesMonitorWorker
        worker = HermesMonitorWorker()
        with patch("agents.workers.hermes_monitor_worker.asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = AsyncMock(return_value=(None, None))
            result = await worker.run(config={}, dry_run=True)
        assert result.get("skipped") is True
        assert "reason" in result

    @pytest.mark.asyncio
    async def test_returns_scan_counts_on_success(self):
        """Worker processes emails and returns scanned/notified/skipped counts.
        Mocks _classify_email directly to avoid the prompt .format() path."""
        from agents.workers.hermes_monitor_worker import HermesMonitorWorker

        worker = HermesMonitorWorker()

        fake_emails = [
            {"from": "hr@company.com", "subject": "Interview invite", "snippet": "We'd like to schedule a call"},
            {"from": "noreply@newsletter.com", "subject": "Weekly digest", "snippet": "This week's top picks"},
        ]

        # First email → interview_invite (notified), second → newsletter (skipped)
        classify_results = [
            {"category": "interview_invite", "importance": "high",
             "summary": "Interview scheduled", "sender_name": "Company HR", "action": "Reply to confirm"},
            {"category": "newsletter", "importance": "low",
             "summary": "", "sender_name": "Newsletter", "action": ""},
        ]
        call_count = [0]
        async def fake_classify(email):
            idx = min(call_count[0], len(classify_results) - 1)
            call_count[0] += 1
            return classify_results[idx]

        call_num = [0]
        async def fake_run_in_executor(exc, fn):
            call_num[0] += 1
            if call_num[0] == 1:
                return ("test@example.com", {"token": "abc"})
            return {"emails": fake_emails}

        with patch("agents.workers.hermes_monitor_worker._classify_email", side_effect=fake_classify), \
             patch("agents.workers.hermes_monitor_worker.asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = fake_run_in_executor
            result = await worker.run(config={"max_emails": 10}, dry_run=True)

        assert "scanned"  in result
        assert "notified" in result
        assert "skipped"  in result
        assert result["scanned"] <= 2

    @pytest.mark.asyncio
    async def test_handles_empty_inbox(self):
        """Worker returns cleanly when no unread emails found."""
        from agents.workers.hermes_monitor_worker import HermesMonitorWorker
        worker = HermesMonitorWorker()

        call_num = [0]
        async def fake_executor(exc, fn):
            call_num[0] += 1
            if call_num[0] == 1:
                return ("test@example.com", {"token": "abc"})
            return {"emails": []}

        with patch("agents.workers.hermes_monitor_worker.asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = fake_executor
            result = await worker.run(config={}, dry_run=True)

        assert result.get("scanned") == 0
        assert result.get("notified") == 0

    @pytest.mark.asyncio
    async def test_handles_list_emails_exception(self):
        """Worker returns error dict when Gmail throws."""
        from agents.workers.hermes_monitor_worker import HermesMonitorWorker
        worker = HermesMonitorWorker()

        call_num = [0]
        async def fake_executor(exc, fn):
            call_num[0] += 1
            if call_num[0] == 1:
                return ("test@example.com", {"token": "abc"})
            raise Exception("Gmail API error")

        with patch("agents.workers.hermes_monitor_worker.asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = fake_executor
            result = await worker.run(config={}, dry_run=True)

        assert "error" in result

    def test_worker_name(self):
        from agents.workers.hermes_monitor_worker import HermesMonitorWorker
        assert HermesMonitorWorker.name == "hermes_monitor"


# ─────────────────────────────────────────────────────────────────────────────
# ScoutMonitorWorker
# ─────────────────────────────────────────────────────────────────────────────

class TestScoutMonitorWorker:

    @pytest.mark.asyncio
    async def test_skips_when_no_topics(self):
        """Worker returns skipped=True when no topics are being monitored."""
        from agents.workers.scout_monitor_worker import ScoutMonitorWorker
        worker = ScoutMonitorWorker()
        with patch("agents.workers.scout_monitor_worker._get_topics", return_value=[]):
            with patch("agents.workers.scout_monitor_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = AsyncMock(return_value=[])
                result = await worker.run(config={}, dry_run=True)
        assert result.get("skipped") is True

    @pytest.mark.asyncio
    async def test_checks_topics_and_returns_counts(self, mock_ai):
        """Worker checks each topic and returns topics_checked and notified."""
        from agents.workers.scout_monitor_worker import ScoutMonitorWorker
        import json

        worker = ScoutMonitorWorker()
        topics = [{"topic": "AI regulation", "query": "AI regulation latest news"}]

        relevance_response = json.dumps({"relevant": True, "summary": "New AI regulation bill passed."})

        async def fake_chat(messages, **kwargs):
            return _chat_result(relevance_response)

        async def fake_executor(exc, fn):
            return fn()

        with patch("agents.workers.scout_monitor_worker._get_topics",         return_value=topics), \
             patch("agents.workers.scout_monitor_worker._was_seen",            return_value=False), \
             patch("agents.workers.scout_monitor_worker._mark_seen"), \
             patch("core.services.search_service.run_search",               return_value="AI regulation news results"), \
             patch("core.providers.ai_provider.ai_provider.chat",           side_effect=fake_chat):

            with patch("agents.workers.scout_monitor_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = fake_executor
                result = await worker.run(config={}, dry_run=True)

        assert "topics_checked" in result
        assert "notified"       in result
        assert result["total_topics"] == 1

    @pytest.mark.asyncio
    async def test_deduplicates_already_seen_content(self):
        """Worker skips topics whose content hash was already notified."""
        from agents.workers.scout_monitor_worker import ScoutMonitorWorker

        worker = ScoutMonitorWorker()
        topics = [{"topic": "Python news", "query": "Python news latest"}]

        async def fake_executor(exc, fn):
            return fn()

        with patch("agents.workers.scout_monitor_worker._get_topics",  return_value=topics), \
             patch("agents.workers.scout_monitor_worker._was_seen",     return_value=True), \
             patch("core.services.search_service.run_search",         return_value="some results"):

            with patch("agents.workers.scout_monitor_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = fake_executor
                result = await worker.run(config={}, dry_run=True)

        assert result["notified"] == 0
        assert result["topics_checked"] == 1

    @pytest.mark.asyncio
    async def test_handles_search_failure_gracefully(self):
        """Worker continues to next topic when search raises."""
        from agents.workers.scout_monitor_worker import ScoutMonitorWorker

        worker = ScoutMonitorWorker()
        topics = [{"topic": "Broken topic", "query": "broken"}]

        # Patch topics loaded via executor, raise on the search executor call
        call_num = [0]
        async def fake_executor(exc, fn):
            call_num[0] += 1
            if call_num[0] == 1:
                return topics                # _get_topics
            raise Exception("Search timeout")  # run_search

        with patch("agents.workers.scout_monitor_worker.asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = fake_executor
            result = await worker.run(config={}, dry_run=True)

        # Should not raise; topics_checked reflects the attempt
        assert "topics_checked" in result

    def test_worker_name(self):
        from agents.workers.scout_monitor_worker import ScoutMonitorWorker
        assert ScoutMonitorWorker.name == "scout_monitor"


# ─────────────────────────────────────────────────────────────────────────────
# AtlasScheduledWorker
# ─────────────────────────────────────────────────────────────────────────────

class TestAtlasScheduledWorker:

    @pytest.mark.asyncio
    async def test_daily_digest_no_activity_skips(self, mock_ai):
        """Worker skips notification when there is no activity today."""
        from agents.workers.atlas_scheduled_worker import AtlasScheduledWorker

        worker = AtlasScheduledWorker()
        empty_stats = {"new_apps": 0, "new_by_status": {}, "status_changes": [], "active_interviews": 0}

        with patch("agents.workers.atlas_scheduled_worker._get_daily_stats",  return_value=empty_stats), \
             patch("agents.workers.atlas_scheduled_worker.asyncio.get_event_loop") as mock_loop:
            mock_loop.return_value.run_in_executor = AsyncMock(return_value=empty_stats)
            result = await worker.run(config={"mode": "daily_digest"}, dry_run=True)

        assert result.get("skipped") is True

    @pytest.mark.asyncio
    async def test_daily_digest_with_activity(self, mock_ai):
        """Worker generates narrative and returns mode/stats when there IS activity."""
        from agents.workers.atlas_scheduled_worker import AtlasScheduledWorker

        worker = AtlasScheduledWorker()
        stats = {"new_apps": 3, "new_by_status": {"applied": 3}, "status_changes": [], "active_interviews": 1}

        async def fake_chat(messages, **kwargs):
            return _chat_result("Applied to 3 jobs today. 1 active interview.")

        with patch("agents.workers.atlas_scheduled_worker._get_daily_stats", return_value=stats), \
             patch("core.providers.ai_provider.ai_provider.chat", side_effect=fake_chat):

            with patch("agents.workers.atlas_scheduled_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = AsyncMock(return_value=stats)
                result = await worker.run(config={"mode": "daily_digest"}, dry_run=True)

        assert result.get("mode") == "daily_digest"
        assert "stats" in result
        assert result.get("notification_sent") is False  # dry_run=True

    @pytest.mark.asyncio
    async def test_weekly_report_mode(self, mock_ai):
        """Worker runs weekly report mode with correct stats structure."""
        from agents.workers.atlas_scheduled_worker import AtlasScheduledWorker

        worker = AtlasScheduledWorker()
        stats = {
            "total_week": 10, "total_all": 50, "all_by_status": {"applied": 45, "interview": 5},
            "top_companies": [{"company": "Acme", "count": 3}],
            "interviews_week": 2, "rejections_week": 1,
            "response_rate": 30.0, "interview_rate": 20.0,
        }

        async def fake_chat(messages, **kwargs):
            return _chat_result("Good week. 10 apps, 2 interviews, 30% response rate.")

        with patch("agents.workers.atlas_scheduled_worker._get_weekly_stats", return_value=stats), \
             patch("core.providers.ai_provider.ai_provider.chat", side_effect=fake_chat):

            with patch("agents.workers.atlas_scheduled_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = AsyncMock(return_value=stats)
                result = await worker.run(config={"mode": "weekly_report"}, dry_run=True)

        assert result.get("mode") == "weekly_report"
        assert result["stats"]["total_week"] == 10

    @pytest.mark.asyncio
    async def test_handles_db_error_gracefully(self):
        """Worker returns error dict when DB query fails."""
        from agents.workers.atlas_scheduled_worker import AtlasScheduledWorker

        worker = AtlasScheduledWorker()

        with patch("agents.workers.atlas_scheduled_worker._get_daily_stats",
                   return_value={"error": "connection refused"}):

            with patch("agents.workers.atlas_scheduled_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = AsyncMock(
                    return_value={"error": "connection refused"}
                )
                result = await worker.run(config={"mode": "daily_digest"}, dry_run=True)

        assert "error" in result

    def test_worker_name(self):
        from agents.workers.atlas_scheduled_worker import AtlasScheduledWorker
        assert AtlasScheduledWorker.name == "atlas_scheduled"


# ─────────────────────────────────────────────────────────────────────────────
# SageConsolidationWorker
# ─────────────────────────────────────────────────────────────────────────────

class TestSageConsolidationWorker:

    @pytest.mark.asyncio
    async def test_skips_when_no_memories(self):
        """Worker skips when memory store is empty."""
        from agents.workers.sage_consolidation_worker import SageConsolidationWorker
        worker = SageConsolidationWorker()
        with patch("agents.workers.sage_consolidation_worker._get_all_memories", return_value=[]):
            with patch("agents.workers.sage_consolidation_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = AsyncMock(return_value=[])
                result = await worker.run(config={}, dry_run=True)
        assert result.get("skipped") is True

    @pytest.mark.asyncio
    async def test_skips_when_too_few_memories(self):
        """Worker skips when fewer than 5 memories exist (not worth consolidating)."""
        from agents.workers.sage_consolidation_worker import SageConsolidationWorker
        worker = SageConsolidationWorker()
        memories = [{"id": str(i), "content": f"Memory fact {i}", "created_at": "2026-01-01"} for i in range(3)]
        with patch("agents.workers.sage_consolidation_worker._get_all_memories", return_value=memories):
            with patch("agents.workers.sage_consolidation_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = AsyncMock(return_value=memories)
                result = await worker.run(config={}, dry_run=True)
        assert result.get("skipped") is True

    @pytest.mark.asyncio
    async def test_removes_low_quality_memories(self, mock_ai):
        """Worker identifies and removes short/low-quality memory fragments."""
        from agents.workers.sage_consolidation_worker import SageConsolidationWorker
        import json

        worker = SageConsolidationWorker()
        memories = [
            {"id": "1", "content": "ok",            "created_at": "2026-01-01"},  # too short
            {"id": "2", "content": "The ",          "created_at": "2026-01-01"},  # fragment
            {"id": "3", "content": "User prefers remote work and Python jobs", "created_at": "2026-01-01"},
            {"id": "4", "content": "Notice period is 30 days", "created_at": "2026-01-01"},
            {"id": "5", "content": "Located in Bangalore, India", "created_at": "2026-01-01"},
            {"id": "6", "content": "Interested in AI startups", "created_at": "2026-01-01"},
        ]

        async def fake_chat(messages, **kwargs):
            return _chat_result(json.dumps({"delete_ids": [], "merges": []}))

        with patch("agents.workers.sage_consolidation_worker._get_all_memories", return_value=memories), \
             patch("agents.workers.sage_consolidation_worker._delete_memories",   return_value=2), \
             patch("agents.workers.sage_consolidation_worker._remove_low_quality", return_value=["1", "2"]), \
             patch("core.providers.ai_provider.ai_provider.chat", side_effect=fake_chat):

            with patch("agents.workers.sage_consolidation_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = AsyncMock(side_effect=lambda exc, fn: fn())
                result = await worker.run(config={}, dry_run=True)

        assert "total_before" in result
        assert "deleted"       in result
        assert "merged"        in result
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_deduplicates_via_ai(self, mock_ai):
        """Worker calls AI and applies dedup deletions."""
        from agents.workers.sage_consolidation_worker import SageConsolidationWorker
        import json

        worker = SageConsolidationWorker()
        memories = [
            {"id": str(i), "content": f"I prefer remote work because of {'x'*20} {i}", "created_at": "2026-01-01"}
            for i in range(6)
        ]

        # AI says delete id "1" (duplicate of "0")
        async def fake_chat(messages, **kwargs):
            return _chat_result(json.dumps({"delete_ids": ["1"], "merges": []}))

        with patch("agents.workers.sage_consolidation_worker._get_all_memories",  return_value=memories), \
             patch("agents.workers.sage_consolidation_worker._delete_memories",    return_value=1), \
             patch("agents.workers.sage_consolidation_worker._remove_low_quality", return_value=[]), \
             patch("core.providers.ai_provider.ai_provider.chat", side_effect=fake_chat):

            with patch("agents.workers.sage_consolidation_worker.asyncio.get_event_loop") as mock_loop:
                mock_loop.return_value.run_in_executor = AsyncMock(side_effect=lambda exc, fn: fn())
                result = await worker.run(config={}, dry_run=True)

        assert "deleted" in result

    def test_worker_name(self):
        from agents.workers.sage_consolidation_worker import SageConsolidationWorker
        assert SageConsolidationWorker.name == "sage_consolidation"
