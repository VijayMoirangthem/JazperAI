"""
SentryWorker — Stage 0 of the IT Department.

Runs every 30 seconds via APScheduler.
Monitors error_store for consecutive failures per agent.
When an agent hits the threshold, wakes Darwin to start the repair workflow.

Cooldown: Once Darwin is triggered for an agent, Sentry won't trigger again
for that agent for COOLDOWN_SECONDS (default 1 hour), preventing spam.
"""

import asyncio
import datetime
import structlog

log = structlog.get_logger()

# Number of consecutive failures before waking Darwin
FAILURE_THRESHOLD = 3

# Minimum seconds between Darwin triggers per agent
COOLDOWN_SECONDS = 3600  # 1 hour

# Track last Darwin trigger time per agent (in-memory, resets on restart)
_last_triggered: dict[str, datetime.datetime] = {}


async def sentry_check() -> None:
    """Called by APScheduler every 30 seconds."""
    from app.services.error_store import error_store
    from app.agents.darwin_agent  import DarwinAgent

    agents_to_check = set()

    # Collect all agents with recorded errors
    recent = error_store.get_recent(limit=200)
    for err in recent:
        agents_to_check.add(err.agent)

    for agent in agents_to_check:
        consecutive = error_store.consecutive_failures(agent)
        if consecutive < FAILURE_THRESHOLD:
            continue

        # Check cooldown
        last = _last_triggered.get(agent)
        if last:
            elapsed = (datetime.datetime.utcnow() - last).total_seconds()
            if elapsed < COOLDOWN_SECONDS:
                log.debug("Sentry: Darwin cooldown active",
                          agent=agent, elapsed=int(elapsed))
                continue

        # Get the most recent unresolved error for this agent
        agent_errors = error_store.get_recent(limit=1, agent=agent)
        if not agent_errors:
            continue

        latest_error = agent_errors[0]
        if latest_error.resolved:
            continue

        log.warning(
            "Sentry: threshold hit — waking Darwin",
            agent=agent,
            consecutive=consecutive,
            error_id=latest_error.error_id,
        )

        _last_triggered[agent] = datetime.datetime.utcnow()

        # Fire Darwin as a background task (non-blocking)
        asyncio.create_task(
            _trigger_darwin(latest_error.error_id, agent)
        )


async def _trigger_darwin(error_id: str, agent: str) -> None:
    """Background coroutine: run Darwin repair and push a notification on completion."""
    from app.agents.darwin_agent import DarwinAgent

    try:
        result = await DarwinAgent.handle_repair(error_id)

        # Push a notification so the user knows what happened
        status   = "resolved" if result.get("ok") else result.get("reason", "failed")
        title    = f"IT Dept: {agent} repair {'complete' if result['ok'] else 'failed'}"
        body     = (
            f"Ticket {result.get('ticket_id', '')[:8]}… — "
            f"{'Fixed autonomously' if result.get('autonomous') else 'Applied after approval'}."
            if result.get("ok")
            else f"Could not repair: {result.get('reason', 'unknown')}"
        )

        await _push_notification(title, body, "it_dept")

    except Exception as e:
        log.error("Sentry: Darwin task crashed", error=str(e))


async def _push_notification(title: str, body: str, notif_type: str) -> None:
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD,
            dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO notifications (title, body, type) VALUES (%s, %s, %s)",
            (title, body, notif_type),
        )
        conn.commit()
        cur.close(); conn.close()
    except Exception as e:
        log.warning("Sentry: notification push failed", error=str(e))
