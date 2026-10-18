import asyncio
import redis.asyncio as aioredis
import json
import structlog
from memory.db import aio
from core.config import settings

log = structlog.get_logger()



class MemoryService:
    def __init__(self):
        self.redis = aioredis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD,
            decode_responses=True,
        )

    # ── Short-term (Redis) ────────────────────────────────────────────────

    async def store_short_term(self, key: str, value: str, ttl: int = 86400):
        await self.redis.setex(key, ttl, value)

    async def get_short_term(self, key: str) -> str | None:
        return await self.redis.get(key)

    async def delete_short_term(self, key: str):
        await self.redis.delete(key)

    # ── Core memories (declarative facts, always injected) ────────────────

    async def get_core_memories(self) -> list[str]:
        try:
            rows = await aio.fetch("SELECT content FROM core_memories ORDER BY created_at ASC")
            return [r["content"] for r in rows]
        except Exception as e:
            log.warning("Failed to load core memories", error=str(e))
            return []

    # ── Semantic memory (pgvector, long-term conversation turns) ─────────

    @staticmethod
    def _vec(embedding: list[float]) -> str:
        return "[" + ",".join(str(x) for x in embedding) + "]"

    _TENANT = "create_origins"

    async def _embed_clean(self, content: str) -> tuple[str, list[float] | None, list[str]]:
        """Sanitize (PII/secrets) BEFORE embedding; embedding runs off-loop."""
        from core.services.embedding_service import embed_memory
        from memory.sanitizer import sanitize
        loop = asyncio.get_running_loop()
        clean, found = await loop.run_in_executor(None, sanitize, content)
        return clean, await loop.run_in_executor(None, embed_memory, clean), found

    async def _store_chunk(self, namespace: str, clean: str, vec: list[float] | None, source_ref: str | None = None):
        async with aio.tx("memory_service", (self._TENANT,)) as c:
            await c.execute(
                "INSERT INTO shared.memory_chunks (tenant, namespace, content, pii_redacted, embedding, source_ref) "
                "VALUES ($1, $2, $3, true, $4::vector, $5) ON CONFLICT DO NOTHING",
                self._TENANT, namespace, clean, self._vec(vec) if vec else None, source_ref,
            )

    async def store_memory(self, content: str, embedding: list[float] | None = None, metadata: dict | None = None):
        """Store a conversation turn: sanitized text in semantic_memories (legacy API) + embedded chunk. `embedding` is legacy/ignored."""
        try:
            clean, vec, _ = await self._embed_clean(content)
            await aio.execute(
                "INSERT INTO semantic_memories (content, metadata) VALUES ($1, $2)", clean, json.dumps(metadata or {}))
            if vec:
                await self._store_chunk("conversation", clean, vec)
        except Exception as e:
            log.warning("Failed to store semantic memory", error=str(e))

    async def search_memories(self, query: "str | list[float] | None", top_k: int = 4) -> list[str]:
        """Top-k relevant memories by cosine similarity over shared.memory_chunks. Pass the query TEXT."""
        if not isinstance(query, str) or not query.strip():
            return []
        from core.services.embedding_service import embed_memory
        from memory.sanitizer import sanitize
        loop = asyncio.get_running_loop()
        clean = (await loop.run_in_executor(None, sanitize, query))[0]
        vec = await loop.run_in_executor(None, embed_memory, clean)
        if vec is None:
            return []
        try:
            async with aio.tx("memory_service", (self._TENANT,)) as c:
                rows = await c.fetch(
                    "SELECT content, namespace, 1 - (embedding <=> $1::vector) AS sim FROM shared.memory_chunks "
                    "WHERE embedding IS NOT NULL AND namespace IN ('conversation','extracted') "
                    "AND (expires_at IS NULL OR expires_at > now()) ORDER BY embedding <=> $1::vector LIMIT $2",
                    self._vec(vec), top_k,
                )
        except Exception as e:
            log.warning("Failed to search memory chunks", error=str(e))
            return []
        out: list[str] = []
        for r in rows:
            if r["sim"] > (0.65 if r["namespace"] == "conversation" else 0.70) and r["content"] not in out:
                out.append(r["content"])
        return out[:top_k]

    # ── Extracted memories (LLM-extracted facts per turn) ─────────────────

    async def store_extracted(self, content: str, session_id: str | None = None):
        """Store an extracted fact (sanitized) in extracted_memories (legacy API) + embedded chunk."""
        try:
            clean, vec, _ = await self._embed_clean(content)
            await aio.execute("INSERT INTO extracted_memories (content, session_id) VALUES ($1, $2)", clean, session_id)
            if vec:
                await self._store_chunk("extracted", clean, vec)
        except Exception as e:
            log.warning("Failed to store extracted memory", error=str(e))


memory_service = MemoryService()
