"""
Sage Consolidation Worker — runs every Sunday at 2 AM UTC.

Cleans up the semantic memory store to keep it accurate and lean:

  1. Remove duplicate memories (same fact stored multiple times)
  2. Remove stale memories (contradicted by newer ones)
  3. Merge near-duplicate memories into single consolidated facts
  4. Remove very short / low-quality memories (< 10 chars, just fragments)
  5. Log a summary notification with what was cleaned

Without this, the memory store grows unboundedly and the same fact gets
retrieved multiple times per query, wasting context window space.
"""
import json
import asyncio
import structlog
from agents.workers.base_worker import BaseWorker
from memory.db.legacy_pg import _pg

log = structlog.get_logger()

_DEDUP_PROMPT = """You are reviewing a list of personal memory facts about a user.
Identify which facts are duplicates, contradictions, or should be merged.

Facts (each has an ID):
{facts}

Reply with JSON only:
{{
  "delete_ids": [list of IDs that are duplicates or stale],
  "merges": [
    {{"keep_id": <id>, "delete_ids": [<ids to remove>], "merged_fact": "the single best combined fact"}}
  ]
}}

Be conservative — only flag clear duplicates or direct contradictions.
If unsure, keep both. Return empty lists if everything looks fine."""


def _create_notification(title: str, body: str, ntype: str = "info") -> None:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO notifications (title, body, type) VALUES (%s,%s,%s)",
                    (title, body, ntype),
                )
            conn.commit()
    except Exception as e:
        log.warning("Failed to create notification", error=str(e))


def _get_all_memories() -> list[dict]:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, content, created_at FROM semantic_memories ORDER BY created_at DESC"
                )
                return [
                    {"id": str(r[0]), "content": r[1], "created_at": str(r[2])}
                    for r in cur.fetchall()
                ]
    except Exception as e:
        log.warning("Failed to fetch memories", error=str(e))
        return []


def _delete_memories(ids: list[str]) -> int:
    if not ids:
        return 0
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM semantic_memories WHERE id = ANY(%s)",
                    (ids,),
                )
                deleted = cur.rowcount
            conn.commit()
        return deleted
    except Exception as e:
        log.warning("Failed to delete memories", error=str(e))
        return 0


def _update_memory_content(memory_id: str, content: str) -> None:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE semantic_memories SET content = %s WHERE id = %s",
                    (content, memory_id),
                )
            conn.commit()
    except Exception as e:
        log.warning("Failed to update memory", error=str(e))


def _remove_low_quality(memories: list[dict]) -> list[str]:
    """Return IDs of memories that are too short or clearly not useful."""
    bad_ids = []
    for m in memories:
        content = m["content"].strip()
        if len(content) < 10:
            bad_ids.append(m["id"])
            continue
        # Pure fragments with no subject (just verb/adjective)
        if content.lower().startswith(("the ", "a ", "an ")) and len(content) < 30:
            bad_ids.append(m["id"])
    return bad_ids


class SageConsolidationWorker(BaseWorker):
    name = "sage_consolidation"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        from core.providers.ai_provider import ai_provider
        from core.services.embedding_service import is_available as embeddings_available

        loop = asyncio.get_event_loop()

        memories = await loop.run_in_executor(None, _get_all_memories)
        if not memories:
            return {"skipped": True, "reason": "No memories to consolidate"}

        if len(memories) < 5:
            return {"skipped": True, "reason": f"Only {len(memories)} memories — nothing to consolidate yet"}

        deleted_total = 0
        merged_total = 0
        actions: list[str] = []

        # ── Step 1: Remove low-quality entries ────────────────────────────
        low_quality_ids = await loop.run_in_executor(None, lambda: _remove_low_quality(memories))
        if low_quality_ids and not dry_run:
            deleted = await loop.run_in_executor(None, lambda: _delete_memories(low_quality_ids))
            deleted_total += deleted
            if deleted:
                actions.append(f"Removed {deleted} low-quality memory fragments")
        # Filter them out before AI step
        memories = [m for m in memories if m["id"] not in low_quality_ids]

        # ── Step 2: AI dedup in batches of 30 ────────────────────────────
        batch_size = 30
        for i in range(0, len(memories), batch_size):
            batch = memories[i:i + batch_size]
            facts_text = "\n".join(f"ID:{m['id']} | {m['content']}" for m in batch)

            prompt = _DEDUP_PROMPT.format(facts=facts_text)
            try:
                result = await ai_provider.chat(
                    messages=[{"role": "user", "content": prompt}],
                    model="llama-3.1-8b-instant",
                    temperature=0.0,
                    max_tokens=500,
                )
                raw = result.content.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
                data = json.loads(raw)
            except Exception as e:
                log.warning("Sage consolidation AI call failed", batch=i, error=str(e))
                continue

            # Delete pure duplicates
            delete_ids = data.get("delete_ids", [])
            if delete_ids and not dry_run:
                deleted = await loop.run_in_executor(None, lambda ids=delete_ids: _delete_memories(ids))
                deleted_total += deleted
                if deleted:
                    actions.append(f"Deduplicated {deleted} memories")

            # Apply merges
            for merge in data.get("merges", []):
                keep_id = merge.get("keep_id")
                del_ids = merge.get("delete_ids", [])
                merged_fact = merge.get("merged_fact", "")
                if not keep_id or not merged_fact:
                    continue
                if not dry_run:
                    await loop.run_in_executor(None, lambda kid=keep_id, mf=merged_fact: _update_memory_content(kid, mf))
                    if del_ids:
                        await loop.run_in_executor(None, lambda ids=del_ids: _delete_memories(ids))
                        deleted_total += len(del_ids)
                merged_total += 1

            await asyncio.sleep(0.5)  # Rate limit between AI calls

        # ── Step 3: Notify ────────────────────────────────────────────────
        remaining = len(memories) - deleted_total
        summary = (
            f"Memory store consolidated: {deleted_total} removed, {merged_total} merged. "
            f"{remaining} memories remaining."
        )
        if actions:
            summary += "\n" + "\n".join(f"• {a}" for a in actions)

        if not dry_run and (deleted_total > 0 or merged_total > 0):
            await loop.run_in_executor(
                None,
                lambda: _create_notification("🧠 Memory consolidated", summary, "info"),
            )
            log.info("Sage consolidation complete", deleted=deleted_total, merged=merged_total)

        return {
            "total_before": len(memories) + deleted_total,
            "deleted": deleted_total,
            "merged": merged_total,
            "remaining": remaining,
            "dry_run": dry_run,
        }
