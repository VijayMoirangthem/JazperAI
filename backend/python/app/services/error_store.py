"""
Structured error store — prerequisite for Sentry (Phase 5).

Every agent/worker failure gets recorded here with full context.
Sentry reads from this store to decide when to wake Darwin.

Usage:
    from app.services.error_store import error_store
    await error_store.record(
        agent="Hermes",
        error="TimeoutError: Gmail API call exceeded 10s",
        traceback_str=traceback.format_exc(),
        context={"task": "...", "session_id": "..."},
    )
"""

import asyncio
import traceback as tb_module
import datetime
import structlog
from dataclasses import dataclass, field, asdict

log = structlog.get_logger()

# In-memory ring buffer (last 200 errors) — fast for Sentry to read
_ERROR_BUFFER_SIZE = 200


@dataclass
class AgentError:
    error_id: str
    agent: str
    error_message: str
    traceback_str: str
    context: dict
    timestamp: str
    resolved: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


class ErrorStore:
    """
    Thread-safe in-memory error store with optional DB persistence.
    Sentry reads get_recent() to decide whether to trigger Darwin.
    """

    def __init__(self):
        self._errors: list[AgentError] = []
        self._lock = asyncio.Lock()
        # Consecutive failure counter per agent — Sentry uses this
        self._consecutive: dict[str, int] = {}

    async def record(
        self,
        agent: str,
        error: str,
        traceback_str: str = "",
        context: dict | None = None,
    ) -> AgentError:
        import uuid
        entry = AgentError(
            error_id=str(uuid.uuid4()),
            agent=agent,
            error_message=error,
            traceback_str=traceback_str or "",
            context=context or {},
            timestamp=datetime.datetime.utcnow().isoformat() + "Z",
        )

        async with self._lock:
            self._errors.append(entry)
            # Keep ring buffer bounded
            if len(self._errors) > _ERROR_BUFFER_SIZE:
                self._errors = self._errors[-_ERROR_BUFFER_SIZE:]
            # Track consecutive failures per agent
            self._consecutive[agent] = self._consecutive.get(agent, 0) + 1

        log.error(
            "Agent error recorded",
            agent=agent,
            error=error[:200],
            consecutive=self._consecutive[agent],
        )

        # Persist to DB asynchronously (don't block the caller)
        asyncio.create_task(self._persist(entry))

        return entry

    def record_sync(
        self,
        agent: str,
        error: str,
        traceback_str: str = "",
        context: dict | None = None,
    ) -> AgentError:
        """Synchronous version for use in non-async workers."""
        import uuid
        entry = AgentError(
            error_id=str(uuid.uuid4()),
            agent=agent,
            error_message=error,
            traceback_str=traceback_str or "",
            context=context or {},
            timestamp=datetime.datetime.utcnow().isoformat() + "Z",
        )
        self._errors.append(entry)
        if len(self._errors) > _ERROR_BUFFER_SIZE:
            self._errors = self._errors[-_ERROR_BUFFER_SIZE:]
        self._consecutive[agent] = self._consecutive.get(agent, 0) + 1
        log.error("Agent error recorded (sync)", agent=agent, error=error[:200])
        self._persist_sync(entry)
        return entry

    def clear_consecutive(self, agent: str):
        """Call after a successful run to reset the failure counter."""
        self._consecutive[agent] = 0

    def consecutive_failures(self, agent: str) -> int:
        return self._consecutive.get(agent, 0)

    def get_recent(self, limit: int = 50, agent: str | None = None) -> list[AgentError]:
        errors = self._errors if agent is None else [e for e in self._errors if e.agent == agent]
        return list(reversed(errors))[:limit]

    def get_by_id(self, error_id: str) -> AgentError | None:
        for e in self._errors:
            if e.error_id == error_id:
                return e
        return None

    async def mark_resolved(self, error_id: str):
        async with self._lock:
            for e in self._errors:
                if e.error_id == error_id:
                    e.resolved = True
                    break

    async def _persist(self, entry: AgentError):
        """Write error to agent_errors table for Sentry's long-term analysis."""
        try:
            import psycopg2
            from app.core.config import settings as s
            from concurrent.futures import ThreadPoolExecutor
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: self._persist_sync(entry))
        except Exception as exc:
            log.warning("Could not persist agent error to DB", error=str(exc))

    def _persist_sync(self, entry: AgentError):
        try:
            import psycopg2
            import json
            from app.core.config import settings as s
            conn = psycopg2.connect(
                host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
                user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD,
                dbname=s.POSTGRES_DB,
            )
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO agent_errors
                   (error_id, agent, error_message, traceback, context, timestamp)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (error_id) DO NOTHING""",
                (
                    entry.error_id,
                    entry.agent,
                    entry.error_message,
                    entry.traceback_str,
                    json.dumps(entry.context),
                    entry.timestamp,
                ),
            )
            conn.commit()
            cur.close()
            conn.close()
        except Exception as exc:
            log.warning("DB persist failed for agent error", error=str(exc))


# Singleton — import this everywhere
error_store = ErrorStore()


def capture_current_exception(agent: str, context: dict | None = None) -> AgentError:
    """
    Convenience: call inside an except block to record the current exception.

    Usage:
        except Exception:
            capture_current_exception("Hermes", context={"task": task})
    """
    import asyncio
    error_str = str(tb_module.format_exc())
    exc_info = tb_module.format_exc()
    entry = error_store.record_sync(
        agent=agent,
        error=error_str.splitlines()[-1] if error_str else "Unknown error",
        traceback_str=exc_info,
        context=context or {},
    )
    return entry
