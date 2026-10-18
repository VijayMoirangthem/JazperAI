"""
Approval service — agents request human confirmation before irreversible actions.

Flow:
  1. Agent calls request_approval(...)   → creates DB record, pushes SSE event
  2. Agent calls wait_for_approval(id)   → awaits asyncio.Event (up to timeout)
  3. User clicks Approve/Deny in UI      → resolve(id, approved) sets the event
  4. Agent resumes with True/False

Auto-approve:
  If auto_approve_all=True or action_type is in auto_approve_types,
  the approval is granted immediately without any wait.

Settings are fetched fresh per request so the user can change them live.
"""

import asyncio
import uuid
import datetime
import json
import structlog

log = structlog.get_logger()

# ── In-memory state ────────────────────────────────────────────────────────────

_events:   dict[str, asyncio.Event] = {}   # approval_id -> Event
_results:  dict[str, bool]          = {}   # approval_id -> approved bool
_requests: dict[str, dict]          = {}   # approval_id -> request dict
_subs:     list                     = []   # SSE queues


# ── Public API ─────────────────────────────────────────────────────────────────

async def request_approval(
    agent:        str,
    action_type:  str,
    description:  str,
    payload:      dict = {},
    *,
    auto_approve_all:   bool      = False,
    auto_approve_types: list[str] = [],
) -> tuple[str, bool]:
    """
    Create an approval request.
    Returns (approval_id, was_auto_approved).
    If auto-approved, the caller can skip wait_for_approval.
    """
    approval_id = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat()

    req = {
        "id":          approval_id,
        "agent":       agent,
        "action_type": action_type,
        "description": description,
        "payload":     payload,
        "status":      "pending",
        "created_at":  now,
    }

    # ── Auto-approve check ────────────────────────────────────────────────────
    if auto_approve_all or action_type in auto_approve_types:
        req["status"] = "auto_approved"
        _results[approval_id] = True
        log.info("Approval auto-approved", agent=agent, action=action_type)
        await _persist(req)
        _push({"type": "approval_auto_approved", **req})
        return approval_id, True

    # ── Normal approval path ──────────────────────────────────────────────────
    _requests[approval_id] = req
    _events[approval_id]   = asyncio.Event()

    await _persist(req)
    _push({"type": "approval_requested", **req})
    log.info("Approval requested", id=approval_id, agent=agent, action=action_type)
    return approval_id, False


async def wait_for_approval(approval_id: str, timeout: float = 300.0) -> bool:
    """Block the calling coroutine until the user approves/denies or timeout."""
    # Already resolved (auto-approve path)
    if approval_id in _results and approval_id not in _events:
        return _results[approval_id]

    event = _events.get(approval_id)
    if not event:
        return False

    try:
        await asyncio.wait_for(event.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        log.warning("Approval timed out", id=approval_id)
        _cleanup(approval_id, "timed_out")
        return False

    return _results.get(approval_id, False)


def resolve(approval_id: str, approved: bool) -> bool:
    """Called by the HTTP route when user clicks Approve or Deny."""
    req = _requests.get(approval_id)
    if not req:
        return False

    req["status"]      = "approved" if approved else "denied"
    req["resolved_at"] = datetime.datetime.utcnow().isoformat()
    _results[approval_id] = approved

    event = _events.pop(approval_id, None)
    if event:
        event.set()

    _push({"type": "approval_resolved", "id": approval_id, "approved": approved})
    log.info("Approval resolved", id=approval_id, approved=approved)

    # Async persist update — fire and forget
    asyncio.create_task(_persist_update(approval_id, req["status"]))
    return True


def get_pending() -> list[dict]:
    return [r for r in _requests.values() if r["status"] == "pending"]


def get_all() -> list[dict]:
    return list(_requests.values())


# ── SSE ───────────────────────────────────────────────────────────────────────

def add_subscriber(queue) -> None:
    _subs.append(queue)


def remove_subscriber(queue) -> None:
    try:
        _subs.remove(queue)
    except ValueError:
        pass


def _push(event: dict) -> None:
    dead = []
    for q in _subs:
        try:
            q.put_nowait(event)
        except Exception:
            dead.append(q)
    for q in dead:
        try:
            _subs.remove(q)
        except ValueError:
            pass


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cleanup(approval_id: str, status: str) -> None:
    _events.pop(approval_id, None)
    _results.pop(approval_id, None)
    req = _requests.get(approval_id)
    if req:
        req["status"] = status


async def _persist(req: dict) -> None:
    try:
        import psycopg2
        from core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO approval_requests
               (id, agent, action_type, description, payload, status)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (req["id"], req["agent"], req["action_type"],
             req["description"], json.dumps(req["payload"]), req["status"]),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        log.warning("approval_service: persist failed", error=str(e))


async def _persist_update(approval_id: str, status: str) -> None:
    try:
        import psycopg2
        from core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            "UPDATE approval_requests SET status=%s, resolved_at=NOW() WHERE id=%s",
            (status, approval_id),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        log.warning("approval_service: update failed", error=str(e))
