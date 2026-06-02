import redis.asyncio as aioredis
import psycopg2
import psycopg2.extras
import json
import structlog
from contextlib import contextmanager
from app.core.config import settings

log = structlog.get_logger()


@contextmanager
def _pg():
    conn = psycopg2.connect(
        host=settings.POSTGRES_HOST,
        port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASSWORD,
        dbname=settings.POSTGRES_DB,
    )
    try:
        yield conn
    finally:
        conn.close()


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

    def get_core_memories_sync(self) -> list[str]:
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT content FROM core_memories ORDER BY created_at ASC")
                    return [r[0] for r in cur.fetchall()]
        except Exception as e:
            log.warning("Failed to load core memories", error=str(e))
            return []

    # ── Semantic memory (pgvector, long-term conversation turns) ─────────

    def store_memory_sync(self, content: str, embedding: list[float] | None, metadata: dict | None = None):
        """Store a conversation turn with its vector embedding."""
        if embedding is None:
            return
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    vec = "[" + ",".join(str(x) for x in embedding) + "]"
                    cur.execute(
                        "INSERT INTO semantic_memories (content, embedding, metadata) VALUES (%s, %s::vector, %s)",
                        (content, vec, json.dumps(metadata or {})),
                    )
                conn.commit()
        except Exception as e:
            log.warning("Failed to store semantic memory", error=str(e))

    def search_memories_sync(self, embedding: list[float] | None, top_k: int = 4) -> list[str]:
        """Return top-k semantically relevant memories via cosine similarity."""
        if embedding is None:
            return []
        results: list[str] = []
        vec = "[" + ",".join(str(x) for x in embedding) + "]"
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    # Search semantic_memories (conversation turns)
                    cur.execute(
                        """
                        SELECT content, 1 - (embedding <=> %s::vector) AS sim
                        FROM semantic_memories
                        WHERE embedding IS NOT NULL
                        ORDER BY embedding <=> %s::vector
                        LIMIT %s
                        """,
                        (vec, vec, top_k),
                    )
                    rows = cur.fetchall()
                    results += [r[0] for r in rows if r[1] > 0.65]
        except Exception as e:
            log.warning("Failed to search semantic_memories", error=str(e))

        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    # Also search extracted facts with embeddings
                    cur.execute(
                        """
                        SELECT content, 1 - (embedding <=> %s::vector) AS sim
                        FROM extracted_memories
                        WHERE embedding IS NOT NULL
                        ORDER BY embedding <=> %s::vector
                        LIMIT %s
                        """,
                        (vec, vec, top_k),
                    )
                    rows = cur.fetchall()
                    results += [r[0] for r in rows if r[1] > 0.70]
        except Exception as e:
            log.warning("Failed to search extracted_memories", error=str(e))

        # Deduplicate while preserving order
        seen: set[str] = set()
        unique: list[str] = []
        for r in results:
            if r not in seen:
                seen.add(r)
                unique.append(r)
        return unique[:top_k]

    # ── Extracted memories (LLM-extracted facts per turn) ─────────────────

    def store_extracted_sync(self, content: str, session_id: str | None = None):
        """Store an extracted fact. Embed it if the model is available."""
        from app.services.embedding_service import embed as local_embed
        embedding = local_embed(content)
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    if embedding is not None:
                        vec = "[" + ",".join(str(x) for x in embedding) + "]"
                        cur.execute(
                            "INSERT INTO extracted_memories (content, session_id, embedding) VALUES (%s, %s, %s::vector)",
                            (content, session_id, vec),
                        )
                    else:
                        cur.execute(
                            "INSERT INTO extracted_memories (content, session_id) VALUES (%s, %s)",
                            (content, session_id),
                        )
                conn.commit()
        except Exception as e:
            log.warning("Failed to store extracted memory", error=str(e))


memory_service = MemoryService()
