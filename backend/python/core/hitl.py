"""Human-in-the-loop engine (spec §11/§13/§14).

Tier 1 autonomous, Tier 2 notification-gated (proceeds unless vetoed within the veto window),
Tier 3 explicit authorization (blocks until a human responds; timeout => DENIED). Unknown actions default to Tier 3.
Requests are persisted in shared.hitl_requests and announced on the `human-intervention-request` bus topic.
"""
import asyncio
import contextvars
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from core import directory
from core.eventbus import bus
from memory.db import aio

POLICY: dict[str, int] = {
    # Tier 1 - autonomous
    "file.read": 1, "memory.search": 1, "web.search": 1, "git.read": 1, "mcp.read": 1,
    # Tier 2 - notification gated
    "git.create_branch": 2, "git.commit_agent_branch": 2, "mcp.write": 2, "email.draft": 2, "calendar.create_event": 2,
    "bot.create": 2, "file.write": 2, "bot.edit": 2, "chaos.run": 2,
    # Tier 3 - explicit authorization
    "git.merge_main": 3, "deploy.production": 3, "payment.authorize": 3, "filing.submit": 3,
    "email.send_external": 3, "linkedin.apply": 3, "secrets.export": 3,
}
# who can approve which action classes (placeholders until real counterparts are entered, C-13)
APPROVER_OVERRIDES = {"filing.submit": ["compliance_officer_placeholder"], "payment.authorize": ["ca_placeholder"]}

DEFAULT_TTL_S = 15 * 60
VETO_WINDOW_S = 5.0
_pending: dict[UUID, asyncio.Future] = {}
_last_rid: contextvars.ContextVar[UUID | None] = contextvars.ContextVar("hitl_last_rid", default=None)


def last_request_id() -> UUID | None:
    """Id of the request opened by the most recent gate() call in this context (to hand to e.g. the merge step)."""
    return _last_rid.get()


def tier_of(action: str) -> int:
    return POLICY.get(action, 3)  # default-deny posture


def approvers_for(action: str) -> list[str]:
    return APPROVER_OVERRIDES.get(action) or [h.id for h in directory.humans() if h.authority_level >= 4]


async def _save(rid: UUID, tier: int, action: str, summary: str, requester: str, ttl: float, status: str = "pending"):
    await aio.execute(
        "INSERT INTO shared.hitl_requests (request_id, tier, action, summary, requester, approvers, status, expires_at) "
        "VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
        rid, tier, action, summary[:2000], requester, json.dumps(approvers_for(action)), status,
        datetime.now(timezone.utc) + timedelta(seconds=ttl),
    )


async def _decide(rid: UUID, status: str, by: str | None) -> None:
    await aio.execute("UPDATE shared.hitl_requests SET status=$2, decided_by=$3, decided_at=now() "
                      "WHERE request_id=$1 AND status='pending'", rid, status, by)


def _announce(rid: UUID, tier: int, action: str, summary: str) -> None:
    try:
        import asyncio

        from core import push
        asyncio.get_running_loop().create_task(push.send("Approval needed", f"Tier {tier} request", {"type": "approval", "id": str(rid)}))
    except Exception:
        pass
    bus.publish({"topic": "human-intervention-request", "request_id": str(rid), "tier": tier, "action": action,
                 "summary": summary[:2000]})


LEVELS = ("ask", "auto_edits", "approve_for_me", "full")


async def level_of(slug: str) -> str:
    row = await aio.fetch("SELECT level FROM shared.approval_levels WHERE slug=$1", slug)
    return row[0]["level"] if row else "ask"


async def set_level(slug: str, level: str) -> None:
    if level not in LEVELS:
        raise ValueError(level)
    await aio.execute("INSERT INTO shared.approval_levels (slug, level) VALUES ($1,$2) "
                      "ON CONFLICT (slug) DO UPDATE SET level=$2, updated_at=now()", slug, level)


async def gate(action: str, summary: str, requester: str, ttl_s: float = DEFAULT_TTL_S,
               veto_window_s: float | None = None, min_tier: int = 0) -> bool:
    """Returns True if the action may proceed. min_tier raises the tier (untrusted-content requests need explicit approval)."""
    tier, rid = max(tier_of(action), min_tier), uuid4()
    _last_rid.set(rid)
    if tier == 1:
        await _save(rid, 1, action, summary, requester, ttl_s, status="auto")
        return True
    if tier == 2 and await level_of(requester) != "ask":
        await _save(rid, 2, action, summary, requester, ttl_s, status="auto")  # Tier 3 always needs a human, whatever the level
        return True
    await _save(rid, tier, action, summary, requester, ttl_s)
    fut: asyncio.Future = asyncio.get_running_loop().create_future()
    _pending[rid] = fut
    _announce(rid, tier, action, summary)
    try:
        if tier == 2:
            try:
                ok = await asyncio.wait_for(asyncio.shield(fut), VETO_WINDOW_S if veto_window_s is None else veto_window_s)
            except asyncio.TimeoutError:
                await _decide(rid, "auto", "veto-window-elapsed")
                return True
            return ok
        try:
            return await asyncio.wait_for(fut, ttl_s)
        except asyncio.TimeoutError:
            await _decide(rid, "expired", None)
            return False  # default-deny on timeout
    finally:
        _pending.pop(rid, None)


async def respond(request_id: UUID, approve: bool, by: str) -> bool:
    """Resolve a pending request. Only listed approvers (or the founder) may respond. Returns False if unknown/closed."""
    fut = _pending.get(request_id)
    row = await aio.fetch("SELECT approvers, status FROM shared.hitl_requests WHERE request_id=$1", request_id)
    if not row or row[0]["status"] != "pending":
        return False
    if by not in json.loads(row[0]["approvers"]) and by != "founder":
        raise PermissionError(f"{by} is not an approver for this request")
    await _decide(request_id, "approved" if approve else "rejected", by)
    if fut and not fut.done():
        fut.set_result(approve)
    return True
