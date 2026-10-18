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

    async def store_memory(self, content: str, embedding: list[float] | None, metadata: dict | None = None):
        """Store a conversation turn with its vector embedding."""
        if embedding is None:
            return
        try:
            await aio.execute(
                "INSERT INTO semantic_memories (content, embedding, metadata) VALUES ($1, $2::vector, $3)",
                content, self._vec(embedding), json.dumps(metadata or {}),
            )
        except Exception as e:
            log.warning("Failed to store semantic memory", error=str(e))

    async def search_memories(self, embedding: list[float] | None, top_k: int = 4) -> list[str]:
        """Return top-k semantically relevant memories via cosine similarity."""
        if embedding is None:
            return []
        vec = self._vec(embedding)
        results: list[str] = []
        for table, threshold in (("semantic_memories", 0.65), ("extracted_memories", 0.70)):
            try:
                rows = await aio.fetch(
                    f"SELECT content, 1 - (embedding <=> $1::vector) AS sim FROM {table} "
                    f"WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2",
                    vec, top_k,
                )
                results += [r["content"] for r in rows if r["sim"] > threshold]
            except Exception as e:
                log.warning(f"Failed to search {table}", error=str(e))
        seen: set[str] = set()
        unique: list[str] = []
        for r in results:
            if r not in seen:
                seen.add(r)
                unique.append(r)
        return unique[:top_k]

    # ── Extracted memories (LLM-extracted facts per turn) ─────────────────

    async def store_extracted(self, content: str, session_id: str | None = None):
        """Store an extracted fact. Embed it if the model is available."""
        from core.services.embedding_service import embed as local_embed
        embedding = await asyncio.get_running_loop().run_in_executor(None, local_embed, content)
        try:
            if embedding is not None:
                await aio.execute(
                    "INSERT INTO extracted_memories (content, session_id, embedding) VALUES ($1, $2, $3::vector)",
                    content, session_id, self._vec(embedding),
                )
            else:
                await aio.execute(
                    "INSERT INTO extracted_memories (content, session_id) VALUES ($1, $2)", content, session_id,
                )
        except Exception as e:
            log.warning("Failed to store extracted memory", error=str(e))


memory_service = MemoryService()
