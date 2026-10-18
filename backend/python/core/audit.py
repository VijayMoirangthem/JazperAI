"""Hash-chained audit writer + verifier (spec §11/§17). The chain itself is computed by the DB trigger
shared.audit_chain(): entry_hash = sha256(prev_hash || ts::text || tenant || topic || payload::text), so
application code cannot skip or forge links. PII/secrets are redacted before the write."""
import hashlib
import json
from typing import Any

from memory.db import aio
from memory.sanitizer import sanitize


def _redact(v: Any) -> Any:
    if isinstance(v, str):
        return sanitize(v)[0]
    if isinstance(v, dict):
        return {k: _redact(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_redact(x) for x in v]
    return v


async def write(tenant: str, topic: str, payload: dict, trace_id: str | None = None,
                principal_id: str | None = None, conn=None) -> None:
    body = json.dumps(_redact(payload), default=str)
    sql = ("INSERT INTO shared.audit_log (tenant, topic, payload, trace_id, principal_id) "
           "VALUES ($1, $2, $3::jsonb, $4::uuid, $5::uuid)")
    args = (tenant, topic, body, trace_id, principal_id)
    if conn is not None:
        await conn.execute(sql, *args)
    else:
        async with aio.tx(principal_id or "audit", (tenant,)) as c:
            await c.execute(sql, *args)


async def tap_bus(tenant: str, topic: str) -> None:
    """Subscribe to a bus topic and audit every envelope. Run as a background task per topic."""
    from memory.redis import layer
    async for env in layer.subscribe(tenant, topic):
        await write(env.tenant, env.topic, env.payload, trace_id=None)


async def verify(conn) -> tuple[bool, int | None]:
    """Recompute the whole chain with a privileged connection. Returns (ok, first_bad_seq)."""
    prev = None
    for r in await conn.fetch("SELECT seq, ts::text AS ts, tenant, coalesce(topic,'') AS topic, "
                               "coalesce(payload::text,'') AS payload, prev_hash, entry_hash FROM shared.audit_log ORDER BY seq"):
        want = hashlib.sha256((prev or b"") + (r["ts"] + r["tenant"] + r["topic"] + r["payload"]).encode()).digest()
        if (r["prev_hash"] or None) != prev or bytes(r["entry_hash"]) != want:
            return False, r["seq"]
        prev = bytes(r["entry_hash"])
    return True, None
