"""
/api/stream — unified SSE event bus for the Observatory Mission Control.

Merges five real-time sources into one tagged stream:
  log     → every structlog event (info/warning/error)
  agent   → IDE bus events (agent reading/writing files, diagnosing)
  error   → new entries in the error_store
  sched   → scheduler job transitions (running/done)
  notify  → new notifications from the notifications table
"""

import asyncio
import json
import queue as _queue
import datetime

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()


def _now() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


def _sse(event_type: str, payload: dict) -> str:
    payload["_type"] = event_type
    payload["_ts"]   = _now()
    return f"data: {json.dumps(payload)}\n\n"


@router.get("/stream")
async def unified_stream():
    """
    SSE — all COOS events in one stream.
    Each event has _type and _ts fields plus type-specific fields.
    """
    from main import log_buffer, log_subscribers

    # Subscribe to the log ring buffer
    log_q: _queue.Queue = _queue.Queue(maxsize=500)
    log_subscribers.append(log_q)

    # Subscribe to the IDE bus (agent file-read/write events)
    try:
        from core.services.ide_bus import ide_bus
        ide_q = ide_bus.subscribe()   # returns asyncio.Queue[str] (pre-serialised JSON)
    except Exception:
        ide_q = None

    async def _generate():
        # ── Backfill: last 60 log entries ──────────────────────────────────
        for entry in list(log_buffer)[-60:]:
            yield _sse("log", dict(entry))

        last_error_count = 0

        try:
            while True:
                await asyncio.sleep(0.2)

                # ── Log events ──────────────────────────────────────────────
                while not log_q.empty():
                    try:
                        entry = log_q.get_nowait()
                        yield _sse("log", dict(entry))
                    except _queue.Empty:
                        break

                # ── Agent / IDE bus events ──────────────────────────────────
                if ide_q is not None:
                    while not ide_q.empty():
                        try:
                            raw = ide_q.get_nowait()   # already a JSON string
                            event = json.loads(raw)
                            yield _sse("agent", event)
                        except Exception:
                            break

                # ── Error store: new errors ─────────────────────────────────
                try:
                    from core.services.error_store import error_store
                    recent = error_store.get_recent(limit=5)
                    current_count = len(error_store._errors)
                    if current_count > last_error_count:
                        new_ones = recent[: current_count - last_error_count]
                        for e in new_ones:
                            yield _sse("error", {
                                "error_id":    e.error_id,
                                "agent":       e.agent,
                                "message":     e.error_message[:300],
                                "resolved":    e.resolved,
                            })
                        last_error_count = current_count
                except Exception:
                    pass

        finally:
            try:
                log_subscribers.remove(log_q)
            except ValueError:
                pass
            if ide_q is not None:
                try:
                    from core.services.ide_bus import ide_bus
                    ide_bus.unsubscribe(ide_q)
                except Exception:
                    pass

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.get("/status")
async def system_status():
    """Snapshot of current COOS system health — polled every few seconds by Observatory."""
    result: dict = {}

    # ── Scheduler ──────────────────────────────────────────────────────────────
    try:
        from core.scheduler.scheduler import get_scheduler_jobs
        result["scheduler"] = get_scheduler_jobs()
    except Exception as e:
        result["scheduler"] = {"error": str(e)}

    # ── Error store ────────────────────────────────────────────────────────────
    try:
        from core.services.error_store import error_store
        recent = error_store.get_recent(limit=10)
        result["errors"] = {
            "total":    len(error_store._errors),
            "unresolved": sum(1 for e in error_store._errors if not e.resolved),
            "recent":   [{"agent": e.agent, "message": e.error_message[:100],
                          "ts": e.timestamp, "resolved": e.resolved}
                         for e in recent[:5]],
        }
    except Exception as e:
        result["errors"] = {"error": str(e)}

    # ── IT tickets ─────────────────────────────────────────────────────────────
    try:
        import psycopg2
        from core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("SELECT status, COUNT(*) FROM it_department_log GROUP BY status")
        by_status = {row[0]: row[1] for row in cur.fetchall()}
        cur.execute("""SELECT trigger_text, status, created_at
                       FROM it_department_log ORDER BY created_at DESC LIMIT 5""")
        recent_tickets = [{"text": r[0][:80], "status": r[1], "ts": r[2].isoformat()}
                          for r in cur.fetchall()]
        cur.close(); conn.close()
        result["tickets"] = {"by_status": by_status, "recent": recent_tickets}
    except Exception as e:
        result["tickets"] = {"error": str(e)}

    # ── AI provider health ─────────────────────────────────────────────────────
    try:
        from core.providers.ai_provider import get_fallback_status
        result["ai"] = get_fallback_status()
    except Exception as e:
        result["ai"] = {"error": str(e)}

    # ── Job apply status ───────────────────────────────────────────────────────
    try:
        from core.services.linkedin_service import get_apply_runs
        runs = get_apply_runs(limit=3)
        result["job_apply"] = {
            "recent_runs": [{"status": r.get("status"), "applied": r.get("jobs_applied", 0),
                             "ts": r.get("started_at")} for r in runs]
        }
    except Exception as e:
        result["job_apply"] = {"error": str(e)}

    return result
