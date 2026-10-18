"""
ErrorStore unit tests — ring buffer behaviour, sync recording, and the
capture_current_exception convenience function.

All DB calls are mocked so these tests run fully offline.
"""
import pytest
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_error_store():
    """Clear the in-memory ring buffer before each test."""
    from core.services.error_store import error_store
    error_store._errors.clear()
    error_store._consecutive.clear()
    yield


@pytest.fixture
def mock_db():
    """Silence DB calls so tests never need Postgres."""
    with patch("psycopg2.connect") as m:
        cursor = MagicMock()
        conn = MagicMock()
        conn.cursor.return_value.__enter__ = lambda s: cursor
        conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        conn.__enter__ = lambda s: conn
        conn.__exit__ = MagicMock(return_value=False)
        m.return_value = conn
        yield m


# ── record_sync ───────────────────────────────────────────────────────────────

class TestRecordSync:

    def test_adds_to_buffer(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="Scout", error="test error", context={})
        assert len(error_store._errors) == 1

    def test_stores_correct_agent(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="Hermes", error="timeout", context={})
        assert error_store._errors[0].agent == "Hermes"

    def test_stores_correct_message(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="Atlas", error="DB connection failed", context={})
        assert error_store._errors[0].error_message == "DB connection failed"

    def test_stores_context(self, mock_db):
        from core.services.error_store import error_store
        ctx = {"job_run_id": "abc-123", "step": 2}
        error_store.record_sync(agent="Scout", error="oops", context=ctx)
        assert error_store._errors[0].context == ctx

    def test_returns_agent_error_instance(self, mock_db):
        from core.services.error_store import error_store, AgentError
        result = error_store.record_sync(agent="Sage", error="memory fail", context={})
        assert isinstance(result, AgentError)

    def test_result_has_error_id(self, mock_db):
        from core.services.error_store import error_store
        result = error_store.record_sync(agent="Scout", error="e", context={})
        assert result.error_id and len(result.error_id) == 36  # UUID format

    def test_result_has_timestamp(self, mock_db):
        from core.services.error_store import error_store
        result = error_store.record_sync(agent="Scout", error="e", context={})
        assert result.timestamp.endswith("Z")

    def test_increments_consecutive_counter(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="Hermes", error="e1", context={})
        error_store.record_sync(agent="Hermes", error="e2", context={})
        assert error_store.consecutive_failures("Hermes") == 2

    def test_consecutive_counter_per_agent(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="Scout", error="e", context={})
        error_store.record_sync(agent="Hermes", error="e", context={})
        error_store.record_sync(agent="Hermes", error="e", context={})
        assert error_store.consecutive_failures("Scout") == 1
        assert error_store.consecutive_failures("Hermes") == 2

    def test_clear_consecutive_resets_counter(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="Atlas", error="e", context={})
        error_store.record_sync(agent="Atlas", error="e", context={})
        error_store.clear_consecutive("Atlas")
        assert error_store.consecutive_failures("Atlas") == 0


# ── Ring buffer ───────────────────────────────────────────────────────────────

class TestRingBuffer:

    def test_caps_at_200(self, mock_db):
        from core.services.error_store import error_store
        for i in range(210):
            error_store.record_sync(agent="Test", error=f"error {i}", context={})
        assert len(error_store._errors) <= 200

    def test_drops_oldest_when_full(self, mock_db):
        from core.services.error_store import error_store, _ERROR_BUFFER_SIZE
        for i in range(_ERROR_BUFFER_SIZE + 5):
            error_store.record_sync(agent="Test", error=f"error {i}", context={})
        # The first few errors should be gone; the last should be newest
        messages = [e.error_message for e in error_store._errors]
        assert "error 0" not in messages
        assert f"error {_ERROR_BUFFER_SIZE + 4}" in messages


# ── get_recent ────────────────────────────────────────────────────────────────

class TestGetRecent:

    def test_returns_newest_first(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="A", error="first", context={})
        error_store.record_sync(agent="A", error="last", context={})
        recent = error_store.get_recent(limit=2)
        assert recent[0].error_message == "last"
        assert recent[1].error_message == "first"

    def test_respects_limit(self, mock_db):
        from core.services.error_store import error_store
        for i in range(10):
            error_store.record_sync(agent="Test", error=f"e{i}", context={})
        assert len(error_store.get_recent(limit=5)) == 5

    def test_filters_by_agent(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="Scout", error="scout error", context={})
        error_store.record_sync(agent="Hermes", error="hermes error", context={})
        scout_errors = error_store.get_recent(agent="Scout")
        assert all(e.agent == "Scout" for e in scout_errors)
        assert len(scout_errors) == 1

    def test_no_agent_filter_returns_all(self, mock_db):
        from core.services.error_store import error_store
        error_store.record_sync(agent="Scout", error="e", context={})
        error_store.record_sync(agent="Hermes", error="e", context={})
        assert len(error_store.get_recent()) == 2


# ── get_by_id ─────────────────────────────────────────────────────────────────

class TestGetById:

    def test_finds_existing_error(self, mock_db):
        from core.services.error_store import error_store
        entry = error_store.record_sync(agent="Sage", error="test", context={})
        found = error_store.get_by_id(entry.error_id)
        assert found is not None
        assert found.error_id == entry.error_id

    def test_returns_none_for_unknown_id(self):
        from core.services.error_store import error_store
        assert error_store.get_by_id("nonexistent-id-xyz") is None


# ── capture_current_exception ─────────────────────────────────────────────────

class TestCaptureCurrentException:

    def test_records_inside_except_block(self, mock_db):
        from core.services.error_store import capture_current_exception, error_store
        try:
            raise ValueError("simulated worker failure")
        except ValueError:
            capture_current_exception(agent="Hermes", context={"job_run_id": "test-123"})

        assert len(error_store._errors) == 1
        entry = error_store._errors[0]
        assert entry.agent == "Hermes"
        assert entry.context.get("job_run_id") == "test-123"

    def test_traceback_is_captured(self, mock_db):
        from core.services.error_store import capture_current_exception, error_store
        try:
            raise RuntimeError("disk full")
        except RuntimeError:
            capture_current_exception(agent="Atlas", context={})

        assert "RuntimeError" in error_store._errors[0].traceback_str

    def test_does_not_raise_outside_except(self, mock_db):
        from core.services.error_store import capture_current_exception
        try:
            capture_current_exception(agent="Test", context={})
        except Exception as e:
            pytest.fail(f"capture_current_exception raised unexpectedly: {e}")
