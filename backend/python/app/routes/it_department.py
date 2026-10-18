"""
IT Department routes.

  GET  /api/it/tickets              — list all IT tickets
  GET  /api/it/tickets/{id}         — get one ticket (full detail)
  POST /api/it/repair               — manually trigger Darwin repair for an error_id
  POST /api/it/create               — trigger Self-Create workflow
  GET  /api/it/errors               — current in-memory errors from error_store
  POST /api/it/errors/{id}/resolve  — manually mark an error resolved
"""

import asyncio
import json
import queue as _queue
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.agents.darwin_agent import DarwinAgent

router = APIRouter()


def _connect():
    import psycopg2
    from app.core.config import settings as s
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


def _row_to_ticket(r) -> dict:
    return {
        "id":               str(r[0]),
        "ticket_id":        str(r[1]),
        "type":             r[2],
        "status":           r[3],
        "trigger_text":     r[4],
        "traceback":        r[5],
        "affected_files":   r[6] or [],
        "diagnosis":        r[7] or {},
        "proposed_changes": r[8] or [],
        "new_files":        r[9] or [],
        "test_results":     r[10] or {},
        "user_approved":    r[11],
        "applied":          r[12],
        "resolution_note":  r[13],
        "created_at":       r[14].isoformat() if r[14] else None,
        "resolved_at":      r[15].isoformat() if r[15] else None,
    }


@router.get("/tickets")
async def list_tickets(status: str | None = None, limit: int = 50):
    try:
        conn = _connect(); cur = conn.cursor()
        if status:
            cur.execute(
                """SELECT id,ticket_id,type,status,trigger_text,traceback,
                          affected_files,diagnosis,proposed_changes,new_files,
                          test_results,user_approved,applied,resolution_note,
                          created_at,resolved_at
                   FROM it_department_log WHERE status=%s ORDER BY created_at DESC LIMIT %s""",
                (status, limit),
            )
        else:
            cur.execute(
                """SELECT id,ticket_id,type,status,trigger_text,traceback,
                          affected_files,diagnosis,proposed_changes,new_files,
                          test_results,user_approved,applied,resolution_note,
                          created_at,resolved_at
                   FROM it_department_log ORDER BY created_at DESC LIMIT %s""",
                (limit,),
            )
        rows = cur.fetchall()
        cur.close(); conn.close()
        return {"tickets": [_row_to_ticket(r) for r in rows]}
    except Exception as e:
        return {"error": str(e), "tickets": []}


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str):
    try:
        conn = _connect(); cur = conn.cursor()
        cur.execute(
            """SELECT id,ticket_id,type,status,trigger_text,traceback,
                      affected_files,diagnosis,proposed_changes,new_files,
                      test_results,user_approved,applied,resolution_note,
                      created_at,resolved_at
               FROM it_department_log WHERE ticket_id=%s OR id::text=%s LIMIT 1""",
            (ticket_id, ticket_id),
        )
        row = cur.fetchone()
        cur.close(); conn.close()
        if not row:
            return {"error": "Ticket not found"}
        return _row_to_ticket(row)
    except Exception as e:
        return {"error": str(e)}


class RepairRequest(BaseModel):
    error_id: str


class CreateRequest(BaseModel):
    description: str
    requester:   str = "user"


@router.post("/repair")
async def trigger_repair(req: RepairRequest):
    """Manually trigger Darwin to repair a specific error_id."""
    from app.agents.darwin_agent import DarwinAgent
    asyncio.create_task(DarwinAgent.handle_repair(req.error_id))
    return {"ok": True, "message": f"Darwin started on error {req.error_id}"}


@router.post("/create")
async def trigger_create(req: CreateRequest):
    """Trigger Self-Create workflow for a new feature description."""
    from app.agents.darwin_agent import DarwinAgent
    asyncio.create_task(DarwinAgent.handle_create(req.description, req.requester))
    return {"ok": True, "message": "Darwin + Scroll started on feature request"}


@router.get("/errors")
async def get_errors(limit: int = 50, agent: str | None = None):
    """Current in-memory error store contents."""
    from app.services.error_store import error_store
    errors = error_store.get_recent(limit=limit, agent=agent)
    return {
        "errors": [e.to_dict() for e in errors],
        "consecutive": {
            a: error_store.consecutive_failures(a)
            for a in set(e.agent for e in errors)
        },
    }


@router.post("/errors/{error_id}/resolve")
async def resolve_error(error_id: str):
    from app.services.error_store import error_store
    await error_store.mark_resolved(error_id)
    return {"ok": True, "resolved": error_id}


@router.post("/errors/{error_id}/repair")
async def repair_error(error_id: str):
    """Trigger Darwin to auto-repair a specific error."""
    asyncio.create_task(DarwinAgent.handle_repair(error_id))
    return {"ok": True, "message": f"Darwin dispatched for error {error_id}"}


class ManualErrorBody(BaseModel):
    agent: str = "System"
    error: str
    traceback: str = ""


@router.post("/errors/ingest")
async def ingest_error(body: ManualErrorBody):
    """Record an error manually and trigger Darwin."""
    from app.services.error_store import error_store
    entry = await error_store.record(
        agent=body.agent,
        error=body.error,
        traceback_str=body.traceback,
    )
    asyncio.create_task(DarwinAgent.handle_repair(entry.error_id))
    return {"ok": True, "error_id": entry.error_id}


@router.get("/logs/stream")
async def stream_logs():
    """SSE — live backend log stream for the IT Department panel.
    Sends last 80 buffered lines as backfill, then streams new events."""
    from main import log_buffer, log_subscribers

    q: _queue.Queue = _queue.Queue(maxsize=300)
    log_subscribers.append(q)

    async def _generate():
        # Backfill last 80 entries so the panel isn't blank on connect
        for entry in list(log_buffer)[-80:]:
            yield f"data: {json.dumps(entry)}\n\n"

        try:
            while True:
                try:
                    entry = q.get_nowait()
                    yield f"data: {json.dumps(entry)}\n\n"
                except _queue.Empty:
                    await asyncio.sleep(0.25)
        finally:
            try:
                log_subscribers.remove(q)
            except ValueError:
                pass

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


# ── Phase 19: QA sweep, performance, test generation ──────────────────────

@router.post("/qa-sweep")
async def run_qa_sweep():
    """Trigger Aria's full audit (Probe + Pulse) immediately. Awaits and returns result."""
    from app.agents.aria_agent import AriaAgent
    try:
        result = await AriaAgent.nightly_audit()
        return {"ok": True, "result": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/performance")
async def get_agent_performance(weeks: int = 4):
    """Per-agent weekly performance from agent_performance_snapshots."""
    try:
        conn = _connect(); cur = conn.cursor()
        cur.execute(
            """SELECT agent_id, week_start, tasks_completed, tasks_failed,
                      avg_duration_ms, health_score
               FROM agent_performance_snapshots
               WHERE week_start >= CURRENT_DATE - (%s * 7)
               ORDER BY week_start DESC, health_score DESC""",
            (weeks,),
        )
        rows = cur.fetchall()
        cur.close(); conn.close()

        # Group by agent_id, latest week first
        agents: dict[str, dict] = {}
        for r in rows:
            aid = r[0]
            if aid not in agents:
                agents[aid] = {
                    "agent_id": aid,
                    "latest_health": r[5],
                    "total_completed": 0,
                    "total_failed": 0,
                    "weeks": [],
                }
            agents[aid]["total_completed"] += r[2]
            agents[aid]["total_failed"]    += r[3]
            agents[aid]["weeks"].append({
                "week_start": r[1].isoformat() if r[1] else None,
                "tasks_completed": r[2],
                "tasks_failed":    r[3],
                "avg_duration_ms": r[4],
                "health_score":    r[5],
            })
        return {"agents": list(agents.values()), "weeks_back": weeks}
    except Exception as e:
        return {"agents": [], "error": str(e)}


class GenerateTestsRequest(BaseModel):
    file_path: str

@router.post("/generate-tests")
async def generate_tests(req: GenerateTestsRequest):
    """Trigger Scribe to generate tests for a given backend file path."""
    import os
    full_path = os.path.join(
        os.path.dirname(__file__), "..", "..", req.file_path.lstrip("/")
    )
    full_path = os.path.normpath(full_path)
    try:
        content = open(full_path).read()
    except Exception as e:
        return {"ok": False, "error": f"Cannot read file: {e}"}
    from app.agents.scribe_agent import ScribeAgent
    result = await ScribeAgent.generate_tests(req.file_path, content)
    return result
