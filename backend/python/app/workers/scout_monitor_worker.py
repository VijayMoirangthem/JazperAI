"""
Scout Monitor Worker — runs every 6 hours.

Lets the user save topics they want Jazper to watch. For each topic,
Scout searches the web for recent updates and creates a notification
only if there's genuinely new, relevant information.

Topics are stored in Redis with a TTL. The user manages them via chat:
  "Watch for news about AI regulation in India"
  "Stop watching OpenAI"
  "What topics are you monitoring?"

Jazper's Sage agent saves topics via memory; this worker retrieves and acts on them.
"""
import json
import asyncio
import hashlib
import structlog
from app.workers.base_worker import BaseWorker
from app.services.memory_service import _pg

log = structlog.get_logger()

_TOPIC_KEY = "scout_monitor:topics"
_SEEN_HASHES_PREFIX = "scout_monitor:seen:"


def _get_topics() -> list[dict]:
    """Load monitored topics from Redis."""
    try:
        import redis as _redis
        from app.core.config import settings
        r = _redis.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD, decode_responses=True
        )
        raw = r.get(_TOPIC_KEY)
        r.close()
        if raw:
            return json.loads(raw)
        return []
    except Exception:
        return []


def save_topics(topics: list[dict]) -> None:
    """Save monitored topics to Redis (30-day TTL)."""
    try:
        import redis as _redis
        from app.core.config import settings
        r = _redis.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD, decode_responses=True
        )
        r.setex(_TOPIC_KEY, 86400 * 30, json.dumps(topics))
        r.close()
    except Exception as e:
        log.warning("Failed to save topics", error=str(e))


def add_topic(topic: str, query: str | None = None) -> dict:
    """Add a topic to the watch list. Returns the topic dict."""
    topics = _get_topics()
    # Dedup by topic name
    if any(t["topic"].lower() == topic.lower() for t in topics):
        return {"status": "already_watching", "topic": topic}
    entry = {
        "topic": topic,
        "query": query or topic,
        "added_at": asyncio.get_event_loop().time(),
    }
    topics.append(entry)
    save_topics(topics)
    return {"status": "added", "topic": topic}


def remove_topic(topic: str) -> dict:
    """Remove a topic from the watch list."""
    topics = _get_topics()
    new_topics = [t for t in topics if t["topic"].lower() != topic.lower()]
    if len(new_topics) == len(topics):
        return {"status": "not_found", "topic": topic}
    save_topics(new_topics)
    return {"status": "removed", "topic": topic}


def list_topics() -> list[dict]:
    return _get_topics()


def _content_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()[:16]


def _was_seen(topic: str, content_hash: str) -> bool:
    """True if we already notified about this exact content."""
    try:
        import redis as _redis
        from app.core.config import settings
        r = _redis.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD, decode_responses=True
        )
        key = f"{_SEEN_HASHES_PREFIX}{topic}:{content_hash}"
        exists = r.exists(key)
        r.close()
        return bool(exists)
    except Exception:
        return False


def _mark_seen(topic: str, content_hash: str) -> None:
    try:
        import redis as _redis
        from app.core.config import settings
        r = _redis.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD, decode_responses=True
        )
        key = f"{_SEEN_HASHES_PREFIX}{topic}:{content_hash}"
        r.setex(key, 86400 * 7, "1")  # Remember for 7 days
        r.close()
    except Exception:
        pass


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


_RELEVANCE_PROMPT = """You are checking if a web search result contains genuinely new,
noteworthy information about a topic. Be strict — don't flag old news, generic articles,
or vague mentions.

Topic: {topic}
Search result: {result}

Reply with JSON only:
{{"relevant": true/false, "summary": "one sentence if relevant, empty if not"}}"""


class ScoutMonitorWorker(BaseWorker):
    name = "scout_monitor"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        from app.services.search_service import run_search
        from app.providers.ai_provider import ai_provider

        loop = asyncio.get_event_loop()
        topics = await loop.run_in_executor(None, _get_topics)

        if not topics:
            return {"skipped": True, "reason": "No topics being monitored"}

        notified = 0
        checked = 0

        for topic_entry in topics:
            topic = topic_entry["topic"]
            query = topic_entry.get("query", topic) + " latest news"

            # ── Search ────────────────────────────────────────────────────
            try:
                await asyncio.sleep(1.0)  # polite delay between searches
                results = await loop.run_in_executor(None, lambda q=query: run_search(q))
            except Exception as e:
                log.warning("Scout monitor search failed", topic=topic, error=str(e))
                continue

            if not results or "unavailable" in results.lower():
                checked += 1
                continue

            # ── Dedup check ───────────────────────────────────────────────
            content_hash = _content_hash(results[:500])
            seen = await loop.run_in_executor(None, lambda: _was_seen(topic, content_hash))
            if seen:
                checked += 1
                continue

            # ── Relevance check ───────────────────────────────────────────
            prompt = _RELEVANCE_PROMPT.format(topic=topic, result=results[:800])
            try:
                ai_result = await ai_provider.chat(
                    messages=[{"role": "user", "content": prompt}],
                    model="llama-3.1-8b-instant",
                    temperature=0.0,
                    max_tokens=100,
                )
                raw = ai_result.content.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
                parsed = json.loads(raw)
            except Exception:
                checked += 1
                continue

            checked += 1
            if not parsed.get("relevant"):
                continue

            summary = parsed.get("summary", results[:150])
            await loop.run_in_executor(None, lambda: _mark_seen(topic, content_hash))

            if not dry_run:
                await loop.run_in_executor(
                    None,
                    lambda t=topic, s=summary:
                        _create_notification(
                            f"📡 Scout update: {t}",
                            s,
                            "info",
                        ),
                )
                log.info("Scout monitor notification sent", topic=topic)

            notified += 1

        return {"topics_checked": checked, "notified": notified, "total_topics": len(topics)}
