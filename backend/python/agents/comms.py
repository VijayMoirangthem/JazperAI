"""Visible bot-to-bot communication: every delegation, reply and tool call is stored so the founder can open any pair and see
who talked to whom and what they did. Threads are named by the sorted pair ("connector|jasper"); tool calls use to_slug "tool:<name>".
Writes never raise (observability must not break a conversation)."""
from core import cache
from memory.db import aio

TEXT_MAX = 4000


def thread_of(a: str, b: str) -> str:
    return "|".join(sorted((a, b)))


async def log(frm: str, to: str, kind: str, text: str, meta: dict | None = None) -> None:
    """kind: ask | reply | tool | result | event. For tool calls `to` is 'tool:<name>' and the thread is the bot's own tool log."""
    import json
    try:
        thread = f"{frm}|tools" if to.startswith("tool:") else to if to.startswith("meeting:") else thread_of(frm, to)
        rows = await aio.fetch("INSERT INTO shared.bot_messages(thread, from_slug, to_slug, kind, text, meta) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id, ts",
                               thread, frm, to, kind, (text or "")[:TEXT_MAX], json.dumps(meta or {}, default=str))
        await cache.stream_add({"id": rows[0]["id"], "ts": rows[0]["ts"].isoformat(), "thread": thread, "from_slug": frm, "to_slug": to, "kind": kind, "text": (text or "")[:200]})
    except Exception:
        pass


async def threads(limit: int = 50) -> list[dict]:
    """Bot-to-bot pairs (excluding tool logs) with their latest message, newest first."""
    rows = await aio.fetch(
        """SELECT DISTINCT ON (thread) thread, from_slug, to_slug, kind, left(text, 140) AS preview, ts,
                  (SELECT count(*) FROM shared.bot_messages m2 WHERE m2.thread = m.thread) AS n
           FROM shared.bot_messages m WHERE thread NOT LIKE '%|tools' ORDER BY thread, id DESC""")
    out = [dict(r) for r in rows]
    out.sort(key=lambda r: r["ts"], reverse=True)
    return out[:limit]


async def messages(thread: str, since_id: int = 0, limit: int = 200) -> list[dict]:
    rows = await aio.fetch("SELECT id, ts, from_slug, to_slug, kind, text, meta FROM shared.bot_messages WHERE thread=$1 AND id>$2 ORDER BY id LIMIT $3",
                           thread, since_id, limit)
    return [dict(r) for r in rows]


async def recent(since_id: int = 0, limit: int = 100) -> list[dict]:
    """Live feed: served from the Redis stream (fast, capped); falls back to Postgres when Redis is down or has nothing newer."""
    live = await cache.stream_since("0", 500)
    if live:
        fresh = [{k: v for k, v in e.items() if k != "sid"} for e in live if e["id"] > since_id]
        if fresh or since_id:
            return fresh[-limit:]
    rows = await aio.fetch("SELECT id, ts, thread, from_slug, to_slug, kind, left(text, 200) AS text FROM shared.bot_messages WHERE id>$1 ORDER BY id DESC LIMIT $2",
                           since_id, limit)
    return [dict(r) for r in reversed(rows)]
