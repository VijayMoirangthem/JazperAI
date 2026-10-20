"""Memory v2 (patterns: mem0 add/update/delete/none reconciliation, letta-style consolidation + forgetting).

After a conversation turn a light model extracts durable facts about the user; each fact is sanitised (PII/secrets removed BEFORE
embedding), compared with the most similar stored facts, and reconciled: ADD a new fact, UPDATE (the old one is superseded, never silently
overwritten), DELETE a contradicted one, or do nothing. Recall boosts a memory's usage; `sweep` forgets memories whose score decays
below a threshold (important memories are pinned). Everything runs under the tenant's RLS role.
"""
import asyncio
import json
import math
import re
from uuid import UUID

import structlog

from core import finops
from core.llm.types import LLMRequest
from memory.db import aio
from memory.sanitizer import sanitize

log = structlog.get_logger()
TENANT = "create_origins"
NS = "fact"
DUPLICATE_SIM = 0.88  # above: same fact, no LLM needed
RELATED_SIM = 0.55    # below: unrelated to anything stored, plain ADD without asking the model
PIN_IMPORTANCE = 0.9

EXTRACT_SYSTEM = ('Extract durable facts about the USER from this exchange (preferences, identity, projects, constraints, decisions). '
                  'Ignore small talk, questions and anything about the assistant. Reply with JSON only: '
                  '[{"fact": "short third-person statement", "importance": 0.0-1.0}] or [] if there is nothing durable.')
BOT_EXTRACT_SYSTEM = ('Extract durable LESSONS this bot learned about doing its job well from this exchange (what worked, a pitfall, a founder preference about how the work should be done, '
                      'a stable fact about a tool or service). Ignore anything one-off. Never include secrets. Reply with JSON only: '
                      '[{"fact": "short lesson", "importance": 0.0-1.0}] or [] if nothing durable.')
RECONCILE_SYSTEM = ('You manage a memory store. Given a NEW fact and similar EXISTING memories (with ids), choose exactly one: '
                    'ADD (new information), UPDATE (the new fact refines or replaces one existing memory: give its id), '
                    'DELETE (the new fact contradicts an existing memory that is now false: give its id), NONE (already known). '
                    'Reply with JSON only: {"action": "ADD|UPDATE|DELETE|NONE", "id": "<existing id or null>"}.')


def _json(text: str, opener: str):
    m = re.search(r"\[.*\]" if opener == "[" else r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else None


async def _embed(text: str) -> list[float] | None:
    from core.services.embedding_service import embed_memory
    return await asyncio.get_running_loop().run_in_executor(None, embed_memory, text)


def _vec(v: list[float]) -> str:
    return "[" + ",".join(str(x) for x in v) + "]"


async def extract_facts(router, user_text: str, assistant_text: str, bot: bool = False) -> list[dict]:
    with finops.attribute("memory"):
        res = await router.complete(LLMRequest(system=BOT_EXTRACT_SYSTEM if bot else EXTRACT_SYSTEM, tier="light", max_tokens=400,
                                               messages=[{"role": "user", "content": f"USER: {user_text[:1500]}\nASSISTANT: {assistant_text[:1500]}"}]))
    try:
        items = _json(res.text, "[") or []
    except ValueError:
        return []
    out = []
    for it in items[:5]:
        fact = str(it.get("fact", "")).strip() if isinstance(it, dict) else ""
        if fact:
            out.append({"fact": fact, "importance": min(1.0, max(0.0, float(it.get("importance", 0.5) or 0.5)))})
    return out


async def similar(vec: list[float], k: int = 4, ns: str | None = None) -> list[dict]:
    ns = ns or NS
    async with aio.tx("memory", (TENANT,)) as c:
        rows = await c.fetch(
            "SELECT id::text AS id, content, importance, 1 - (embedding <=> $1::vector) AS sim FROM shared.memory_chunks "
            "WHERE tenant=$2 AND namespace=$3 AND superseded_by IS NULL AND embedding IS NOT NULL AND (expires_at IS NULL OR expires_at > now()) "
            "ORDER BY embedding <=> $1::vector LIMIT $4", _vec(vec), TENANT, ns, k)
    return [dict(r) for r in rows]


async def reconcile(router, fact: str, candidates: list[dict]) -> dict:
    best = candidates[0] if candidates else None
    if best is None or best["sim"] < RELATED_SIM:
        return {"action": "ADD", "id": None}
    if best["sim"] >= DUPLICATE_SIM:
        return {"action": "NONE", "id": best["id"]}
    listing = "\n".join(f'- id={c["id"]}: {c["content"]}' for c in candidates if c["sim"] >= RELATED_SIM)
    with finops.attribute("memory"):
        res = await router.complete(LLMRequest(system=RECONCILE_SYSTEM, tier="light", max_tokens=80,
                                               messages=[{"role": "user", "content": f"NEW: {fact}\nEXISTING:\n{listing}"}]))
    try:
        d = _json(res.text, "{") or {}
        action, mid = str(d.get("action", "ADD")).upper(), d.get("id")
    except ValueError:
        return {"action": "ADD", "id": None}
    valid = {c["id"] for c in candidates}
    if action in ("UPDATE", "DELETE") and mid not in valid:  # the model must point at a real candidate
        return {"action": "ADD", "id": None}
    return {"action": action if action in ("ADD", "UPDATE", "DELETE", "NONE") else "ADD", "id": mid}


async def _insert(clean: str, vec: list[float], importance: float, ns: str | None = None) -> str:
    ns = ns or NS
    async with aio.tx("memory", (TENANT,)) as c:
        return str(await c.fetchval("INSERT INTO shared.memory_chunks (tenant, namespace, content, pii_redacted, embedding, importance) "
                                    "VALUES ($1,$2,$3,true,$4::vector,$5) RETURNING id", TENANT, ns, clean, _vec(vec), importance))


async def _supersede(old_id: str, new_id: str | None) -> None:
    async with aio.tx("memory", (TENANT,)) as c:
        await c.execute("UPDATE shared.memory_chunks SET superseded_by=$2::uuid, expires_at=now() WHERE id=$1::uuid AND tenant=$3",
                        old_id, new_id or old_id, TENANT)  # superseded rows are kept (audit) but never recalled


async def learn(router, fact: str, importance: float = 0.5, ns: str | None = None) -> dict:
    """Store one fact through the sanitiser and the reconciler. Returns {"action", "id", "fact"}."""
    ns = ns or NS
    clean, _found = await asyncio.get_running_loop().run_in_executor(None, sanitize, fact)
    vec = await _embed(clean)
    if vec is None:
        return {"action": "SKIPPED", "id": None, "fact": clean}
    decision = await reconcile(router, clean, await similar(vec, ns=ns))
    action, old = decision["action"], decision["id"]
    new_id = None
    if action in ("ADD", "UPDATE"):
        new_id = await _insert(clean, vec, importance, ns)
    if action == "UPDATE":
        await _supersede(old, new_id)
    elif action == "DELETE":
        await _supersede(old, None)
    return {"action": action, "id": new_id or old, "fact": clean}


async def consolidate_turn(router, user_text: str, assistant_text: str, ns: str | None = None, bot: bool = False, extra_ns: tuple = ()) -> list[dict]:
    """ns 'fact' = unified memory about the founder (shared by every bot); ns 'bot.<slug>' = that bot's own lessons (separate)."""
    ns = ns or NS
    try:
        facts = await extract_facts(router, user_text, assistant_text, bot)
        out = [await learn(router, f["fact"], f["importance"], ns) for f in facts]
        for x in extra_ns:  # e.g. also keep the lesson in the bot's group memory
            out += [await learn(router, f["fact"], f["importance"], x) for f in facts]
        return out
    except Exception as e:  # memory must never break a conversation
        log.warning("memory consolidation failed", error=str(e)[:160])
        return []


async def recall_multi(query: str, spec: dict[str, int], min_sim: float = 0.5) -> dict[str, list[str]]:
    """Embed the query once and recall from several namespaces: {ns: k}. Returns {ns: [facts]} (empty lists when nothing matches)."""
    clean, _ = await asyncio.get_running_loop().run_in_executor(None, sanitize, query)
    vec = await _embed(clean)
    out: dict[str, list[str]] = {n: [] for n in spec}
    if vec is None:
        return out
    ids: list[str] = []
    for n, k in spec.items():
        hits = [h for h in await similar(vec, k, n) if h["sim"] >= min_sim]
        out[n] = [h["content"] for h in hits]
        ids += [h["id"] for h in hits]
    if ids:
        async with aio.tx("memory", (TENANT,)) as c:
            await c.execute("UPDATE shared.memory_chunks SET hits = hits + 1, last_used_at = now() WHERE id = ANY($1::uuid[])", ids)
    return out


async def recall(query: str, k: int = 4, min_sim: float = 0.5, ns: str | None = None) -> list[str]:
    ns = ns or NS
    clean, _ = await asyncio.get_running_loop().run_in_executor(None, sanitize, query)
    vec = await _embed(clean)
    if vec is None:
        return []
    hits = [h for h in await similar(vec, k, ns) if h["sim"] >= min_sim]
    if hits:
        async with aio.tx("memory", (TENANT,)) as c:
            await c.execute("UPDATE shared.memory_chunks SET hits = hits + 1, last_used_at = now() WHERE id = ANY($1::uuid[])", [h["id"] for h in hits])
    return [h["content"] for h in hits]


def score(importance: float, age_days: float, hits: int, half_life_days: float = 30.0) -> float:
    """Retention score: importance decays with age, repeated use keeps a memory alive."""
    return importance * math.exp(-math.log(2) * age_days / half_life_days) + 0.1 * math.log1p(hits)


async def sweep(half_life_days: float = 30.0, threshold: float = 0.05) -> int:
    """Forget (expire) fact memories whose score fell below the threshold; pinned (very important) ones are never forgotten."""
    async with aio.tx("memory", (TENANT,)) as c:
        rows = await c.fetch("SELECT id, importance, hits, EXTRACT(EPOCH FROM (now() - COALESCE(last_used_at, created_at)))/86400 AS age "
                             "FROM shared.memory_chunks WHERE tenant=$1 AND namespace=$2 AND superseded_by IS NULL AND (expires_at IS NULL OR expires_at > now())", TENANT, NS)
        dead = [r["id"] for r in rows if r["importance"] < PIN_IMPORTANCE and score(r["importance"], float(r["age"]), r["hits"], half_life_days) < threshold]
        if dead:
            await c.execute("UPDATE shared.memory_chunks SET expires_at = now() WHERE id = ANY($1::uuid[])", dead)
    return len(dead)


async def list_facts(include_inactive: bool = False, ns: str | None = None) -> list[dict]:
    ns = ns or NS
    where = "" if include_inactive else " AND superseded_by IS NULL AND (expires_at IS NULL OR expires_at > now())"
    async with aio.tx("memory", (TENANT,)) as c:
        rows = await c.fetch(f"SELECT id::text AS id, content, importance, hits, created_at, last_used_at, superseded_by::text AS superseded_by, expires_at "
                             f"FROM shared.memory_chunks WHERE tenant=$1 AND namespace=$2{where} ORDER BY created_at DESC LIMIT 200", TENANT, ns)
    return [dict(r) for r in rows]


async def forget(memory_id: str) -> bool:
    async with aio.tx("memory", (TENANT,)) as c:
        n = await c.execute("UPDATE shared.memory_chunks SET expires_at = now() WHERE id=$1::uuid AND tenant=$2 AND namespace=$3", memory_id, TENANT, NS)
    return not n.endswith(" 0")
