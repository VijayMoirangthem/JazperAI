"""
Agent bus — lightweight pub/sub for inter-agent messaging.

Usage:
  # In Hermes (sender):
  await agent_bus.publish("Hermes", "Atlas", "recruiter_replied", {
      "thread_id": "...", "company": "Google", "subject": "Your application"
  })

  # In Atlas (receiver, inside an async task):
  queue = agent_bus.subscribe("Atlas")
  try:
      msg = await asyncio.wait_for(queue.get(), timeout=60)
      # handle msg
  finally:
      agent_bus.unsubscribe("Atlas", queue)
"""

import asyncio
import datetime
import structlog

log = structlog.get_logger()

# agent_name -> list[Queue]
_mailboxes: dict[str, list[asyncio.Queue]] = {}


def subscribe(agent_name: str) -> asyncio.Queue:
    """Return a new Queue that will receive messages addressed to agent_name."""
    q: asyncio.Queue = asyncio.Queue()
    _mailboxes.setdefault(agent_name, []).append(q)
    return q


def unsubscribe(agent_name: str, queue: asyncio.Queue) -> None:
    try:
        _mailboxes.get(agent_name, []).remove(queue)
    except ValueError:
        pass


async def publish(
    from_agent: str,
    to_agent:   str,
    subject:    str,
    payload:    dict = {},
) -> int:
    """Deliver a message to all queues subscribed by to_agent. Returns delivery count."""
    msg = {
        "from":      from_agent,
        "to":        to_agent,
        "subject":   subject,
        "payload":   payload,
        "timestamp": datetime.datetime.utcnow().isoformat(),
    }
    delivered = 0
    for q in list(_mailboxes.get(to_agent, [])):
        try:
            q.put_nowait(msg)
            delivered += 1
        except Exception:
            pass
    log.info("AgentBus: published", from_=from_agent, to=to_agent,
             subject=subject, delivered=delivered)
    # Fire-and-forget persistence for comm arcs in Command Center
    asyncio.get_event_loop().run_in_executor(None, _persist_comm,
                                             from_agent, to_agent, subject, payload)
    return delivered


def _persist_comm(from_agent: str, to_agent: str, subject: str, payload: dict) -> None:
    """Write a comm record to agent_communications (background thread, no await)."""
    import json
    try:
        import psycopg2
        from core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO agent_communications (from_agent, to_agent, subject, payload)
               VALUES (%s, %s, %s, %s::jsonb)""",
            (from_agent, to_agent or None, subject, json.dumps(payload)),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass  # never crash the caller


async def broadcast(from_agent: str, subject: str, payload: dict = {}) -> None:
    """Send to all subscribed agents."""
    for name in list(_mailboxes.keys()):
        await publish(from_agent, name, subject, payload)


def pending_count(agent_name: str) -> int:
    total = 0
    for q in _mailboxes.get(agent_name, []):
        total += q.qsize()
    return total


# Module-level singleton so agents import `from core.services.agent_bus import agent_bus`
class _AgentBus:
    subscribe    = staticmethod(subscribe)
    unsubscribe  = staticmethod(unsubscribe)
    publish      = staticmethod(publish)
    broadcast    = staticmethod(broadcast)
    pending_count = staticmethod(pending_count)


agent_bus = _AgentBus()
