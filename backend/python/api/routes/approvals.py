"""
Approval routes.

  GET  /api/approvals/pending      — list all pending approval requests
  GET  /api/approvals/stream       — SSE stream of approval events
  POST /api/approvals/{id}/approve — user approves
  POST /api/approvals/{id}/deny    — user denies
  GET  /api/approvals/history      — recent resolved approvals from DB
"""

import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from core.services import approval_service

router = APIRouter()


@router.get("/pending")
async def get_pending():
    return {"approvals": approval_service.get_pending()}


@router.post("/{approval_id}/approve")
async def approve(approval_id: str):
    ok = approval_service.resolve(approval_id, approved=True)
    return {"ok": ok, "id": approval_id, "approved": True}


@router.post("/{approval_id}/deny")
async def deny(approval_id: str):
    ok = approval_service.resolve(approval_id, approved=False)
    return {"ok": ok, "id": approval_id, "approved": False}


@router.get("/stream")
async def approval_stream():
    """
    SSE stream — frontend subscribes once and receives all approval events:
      approval_requested  — new action needs approval
      approval_resolved   — user approved/denied
      approval_auto_approved — auto-approved (for notification only)
      ping                — keepalive every 25s
    """
    queue: asyncio.Queue = asyncio.Queue()
    approval_service.add_subscriber(queue)

    # Flush any currently pending requests to the new subscriber immediately
    for req in approval_service.get_pending():
        await queue.put({"type": "approval_requested", **req})

    async def generate():
        try:
            yield 'data: {"type":"connected"}\n\n'
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield 'data: {"type":"ping"}\n\n'
        finally:
            approval_service.remove_subscriber(queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/history")
async def approval_history(limit: int = 50):
    """Recent resolved approvals from DB."""
    try:
        import psycopg2
        from core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            """SELECT id, agent, action_type, description, status, created_at, resolved_at
               FROM approval_requests
               ORDER BY created_at DESC LIMIT %s""",
            (limit,),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {
            "history": [
                {
                    "id": str(r[0]), "agent": r[1], "action_type": r[2],
                    "description": r[3], "status": r[4],
                    "created_at":  r[5].isoformat() if r[5] else None,
                    "resolved_at": r[6].isoformat() if r[6] else None,
                }
                for r in rows
            ]
        }
    except Exception as e:
        return {"error": str(e), "history": []}
