"""Warden — HR Department, L3 Agent (AGT-0027).

Runs weekly (Sunday 02:00 UTC) to:
  1. Compute a fresh health score for every agent from their lifetime stats
  2. Write a weekly performance snapshot to agent_performance_snapshots
  3. Flag agents with health_score < 60 and push a notification
  4. Emit a summary notification to VJ

Health score formula (simplified, matching the design doc):
  health_score = clamp(
      tasks_completed / (tasks_completed + tasks_failed) * 100,
      0, 100
  )
  Agents with 0 runs get score 100 (not yet tested, assume healthy).
"""

from __future__ import annotations

import datetime
import structlog

from app.workers.base_worker import BaseWorker

log = structlog.get_logger()

_CRITICAL_THRESHOLD = 60.0
_DEGRADED_THRESHOLD = 75.0


def _conn():
    import psycopg2
    from app.core.config import settings as s
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


class WardenWorker(BaseWorker):
    name = "Warden"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        log.info("Warden: starting weekly health scan", dry_run=dry_run)

        conn = _conn()
        cur  = conn.cursor()

        # Fetch all agents with run stats
        cur.execute("""
            SELECT agent_id, name, tasks_completed, tasks_failed, health_score
            FROM agent_registry
            WHERE status NOT IN ('retired', 'deprecated')
            ORDER BY level, name
        """)
        agents = cur.fetchall()

        week_start = datetime.date.today() - datetime.timedelta(
            days=datetime.date.today().weekday()  # this Monday
        )

        updated:  list[str] = []
        critical: list[str] = []
        degraded: list[str] = []
        snapshots = 0

        for agent_id, name, tasks_done, tasks_fail, old_score in agents:
            total = (tasks_done or 0) + (tasks_fail or 0)
            if total == 0:
                new_score = 100.0  # never tested — assume healthy
            else:
                new_score = round((tasks_done or 0) / total * 100, 1)

            if not dry_run:
                # Update health_score in registry
                cur.execute(
                    "UPDATE agent_registry SET health_score = %s, updated_at = NOW() WHERE agent_id = %s",
                    (new_score, agent_id),
                )

                # Upsert weekly snapshot
                cur.execute("""
                    INSERT INTO agent_performance_snapshots
                        (agent_id, week_start, tasks_completed, tasks_failed, health_score)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (agent_id, week_start) DO UPDATE SET
                        tasks_completed = EXCLUDED.tasks_completed,
                        tasks_failed    = EXCLUDED.tasks_failed,
                        health_score    = EXCLUDED.health_score
                """, (agent_id, week_start, tasks_done or 0, tasks_fail or 0, new_score))
                snapshots += 1

            updated.append(name)
            if new_score < _CRITICAL_THRESHOLD:
                critical.append(f"{name} ({new_score:.0f}%)")
                log.warning("Warden: critical agent", name=name, score=new_score)
            elif new_score < _DEGRADED_THRESHOLD:
                degraded.append(f"{name} ({new_score:.0f}%)")
                log.info("Warden: degraded agent", name=name, score=new_score)

        if not dry_run:
            conn.commit()

            # Push notification if any critical agents found
            if critical or degraded:
                try:
                    from app.services.notification_service import push_notification
                    lines = []
                    if critical:
                        lines.append(f"🔴 Critical: {', '.join(critical)}")
                    if degraded:
                        lines.append(f"🟡 Degraded: {', '.join(degraded)}")
                    await push_notification(
                        title="Warden: Weekly Health Report",
                        body="\n".join(lines),
                        category="agent_health",
                        priority="high" if critical else "normal",
                    )
                except Exception as exc:
                    log.warning("Warden: notification failed", error=str(exc))

        cur.close()
        conn.close()

        summary = {
            "agents_scanned":     len(agents),
            "snapshots_written":  snapshots,
            "critical":           critical,
            "degraded":           degraded,
            "week_start":         str(week_start),
            "dry_run":            dry_run,
        }
        log.info("Warden: health scan complete", **summary)
        return summary
