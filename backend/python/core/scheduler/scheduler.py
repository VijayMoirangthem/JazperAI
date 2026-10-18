"""APScheduler instance — loads cron jobs from DB, dispatches to workers."""
import asyncio
import json
import uuid

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from memory.db.legacy_pg import _pg

log = structlog.get_logger()

scheduler = AsyncIOScheduler(timezone="UTC")

WORKER_REGISTRY: dict[str, type] = {}


def register_worker(cls):
    WORKER_REGISTRY[cls.name] = cls
    return cls


def _import_workers():
    from agents.workers.job_apply_worker import JobApplyWorker
    from agents.workers.email_sync_worker import EmailSyncWorker
    from agents.workers.gmail_reply_monitor_worker import GmailReplyMonitorWorker
    from agents.workers.hermes_monitor_worker import HermesMonitorWorker
    from agents.workers.atlas_scheduled_worker import AtlasScheduledWorker
    from agents.workers.scout_monitor_worker import ScoutMonitorWorker
    from agents.workers.sage_consolidation_worker import SageConsolidationWorker
    register_worker(JobApplyWorker)
    register_worker(EmailSyncWorker)
    register_worker(GmailReplyMonitorWorker)
    register_worker(HermesMonitorWorker)
    register_worker(AtlasScheduledWorker)
    register_worker(ScoutMonitorWorker)
    register_worker(SageConsolidationWorker)


def _load_jobs_from_db() -> list[dict]:
    try:
        with _pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, name, worker_type, schedule, config FROM cron_jobs WHERE enabled = TRUE"
            )
            rows = cur.fetchall()
            cur.close()
            return [
                {"id": str(r[0]), "name": r[1], "worker_type": r[2], "schedule": r[3], "config": r[4] or {}}
                for r in rows
            ]
    except Exception as e:
        log.warning("Failed to load cron jobs", error=str(e))
        return []


def _create_run_record(cron_job_id: str) -> str:
    run_id = str(uuid.uuid4())
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO job_runs (id, cron_job_id, status, started_at) VALUES (%s, %s, 'pending', NOW()) RETURNING id",
            (run_id, cron_job_id),
        )
        conn.commit()
        cur.close()
    return run_id


def _update_run_record(run_id: str, status: str, result: dict | None, log_text: str = "") -> None:
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE job_runs
            SET status = %s, finished_at = NOW(), result = %s, log = %s
            WHERE id = %s
            """,
            (status, json.dumps(result or {}), log_text, run_id),
        )
        conn.commit()
        cur.close()


def _create_notification(title: str, body: str, ntype: str, job_run_id: str | None = None) -> None:
    try:
        with _pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO notifications (title, body, type, job_run_id) VALUES (%s, %s, %s, %s)",
                (title, body, ntype, job_run_id),
            )
            conn.commit()
            cur.close()
    except Exception as e:
        log.warning("Failed to create notification", error=str(e))


async def _run_job(cron_job_id: str, worker_type: str, config: dict, job_name: str) -> None:
    run_id = await asyncio.get_event_loop().run_in_executor(
        None, _create_run_record, cron_job_id
    )
    log.info("Cron job starting", job=job_name, run_id=run_id)

    WorkerClass = WORKER_REGISTRY.get(worker_type)
    if not WorkerClass:
        msg = f"Unknown worker_type: {worker_type}"
        log.error(msg)
        await asyncio.get_event_loop().run_in_executor(
            None, _update_run_record, run_id, "failed", {"error": msg}, msg
        )
        return

    worker = WorkerClass()
    # Run the worker
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: _update_run_record.__self__ if False else None  # noqa
        )
        # Mark as running
        with _pg() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE job_runs SET status = 'running' WHERE id = %s", (run_id,))
            conn.commit()
            cur.close()

        result = await worker.run(config)
        await worker.on_success(result, run_id)

        await asyncio.get_event_loop().run_in_executor(
            None, _update_run_record, run_id, "success", result, ""
        )
        await asyncio.get_event_loop().run_in_executor(
            None,
            _create_notification,
            f"{job_name} completed",
            f"Applied: {result.get('applied', 0)}, Skipped: {result.get('skipped', 0)}, Failed: {result.get('failed', 0)}",
            "success",
            run_id,
        )
        log.info("Cron job succeeded", job=job_name, run_id=run_id)

    except Exception as exc:
        await worker.on_failure(exc, run_id)
        await asyncio.get_event_loop().run_in_executor(
            None, _update_run_record, run_id, "failed", {"error": str(exc)}, str(exc)
        )
        await asyncio.get_event_loop().run_in_executor(
            None,
            _create_notification,
            f"{job_name} failed",
            str(exc),
            "error",
            run_id,
        )
        log.error("Cron job failed", job=job_name, run_id=run_id, error=str(exc))


def sync_jobs() -> None:
    """Remove all scheduled jobs and reload from DB."""
    for job in scheduler.get_jobs():
        job.remove()

    try:
        jobs = _load_jobs_from_db()
    except Exception as e:
        log.warning("Could not load jobs from DB (DB may be offline)", error=str(e))
        return
    for j in jobs:
        cron_parts = j["schedule"].split()
        if len(cron_parts) != 5:
            log.warning("Invalid cron schedule", job=j["name"], schedule=j["schedule"])
            continue
        minute, hour, day, month, day_of_week = cron_parts
        trigger = CronTrigger(
            minute=minute, hour=hour, day=day, month=month, day_of_week=day_of_week
        )
        scheduler.add_job(
            _run_job,
            trigger=trigger,
            args=[j["id"], j["worker_type"], j["config"], j["name"]],
            id=j["id"],
            name=j["name"],
            replace_existing=True,
        )
        log.info("Cron job scheduled", job=j["name"], schedule=j["schedule"])

    log.info("Scheduler synced", total=len(jobs))


async def trigger_job_now(cron_job_id: str) -> str:
    """Run a cron job immediately, outside of its schedule. Returns run_id."""
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT name, worker_type, config FROM cron_jobs WHERE id = %s",
            (cron_job_id,),
        )
        row = cur.fetchone()
        cur.close()

    if not row:
        raise ValueError(f"Cron job {cron_job_id} not found")

    name, worker_type, config = row
    run_id = _create_run_record(cron_job_id)
    asyncio.create_task(_run_job(cron_job_id, worker_type, config or {}, name))
    return run_id


def _schedule_builtin_jobs() -> None:
    """Internal jobs that always run — not stored in cron_jobs table."""
    from agents.workers.email_sync_worker import EmailSyncWorker
    from apscheduler.triggers.interval import IntervalTrigger

    worker = EmailSyncWorker()

    async def _email_sync_task():
        try:
            await worker.run({})
        except Exception as e:
            log.warning("Email sync task error", error=str(e))

    scheduler.add_job(
        _email_sync_task,
        trigger=IntervalTrigger(minutes=5),
        id="__email_sync__",
        name="Gmail incremental sync",
        replace_existing=True,
        misfire_grace_time=60,
    )
    log.info("Gmail sync scheduled", interval="5 min")

    # ── Gmail reply monitor — checks for recruiter replies every 15 min ──────
    from agents.workers.gmail_reply_monitor_worker import GmailReplyMonitorWorker
    reply_worker = GmailReplyMonitorWorker()

    async def _reply_monitor_task():
        try:
            result = await reply_worker.run({})
            if result.get("updated", 0):
                log.info("Reply monitor updated applications", **result)
        except Exception as e:
            log.warning("Reply monitor error", error=str(e))

    scheduler.add_job(
        _reply_monitor_task,
        trigger=IntervalTrigger(minutes=15),
        id="__reply_monitor__",
        name="Gmail reply monitor",
        replace_existing=True,
        misfire_grace_time=120,
    )
    log.info("Gmail reply monitor scheduled", interval="15 min")

    # ── Proactive nudge — pings Telegram if inactive + unread items exist ──────
    async def _proactive_nudge_task():
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    # Last chat session activity
                    cur.execute("SELECT MAX(updated_at) FROM chat_sessions")
                    row = cur.fetchone()
                    last_chat = row[0] if row and row[0] else None

                    import datetime as _dt
                    now_utc = _dt.datetime.utcnow().replace(tzinfo=_dt.timezone.utc)
                    if last_chat and last_chat.tzinfo is None:
                        last_chat = last_chat.replace(tzinfo=_dt.timezone.utc)
                    hours_inactive = ((now_utc - last_chat).total_seconds() / 3600) if last_chat else 999

                    if hours_inactive < 24:
                        return  # Active recently — don't nudge

                    # Count actionable items
                    cur.execute("SELECT COUNT(*) FROM notifications WHERE read = FALSE")
                    unread = (cur.fetchone() or [0])[0]

                    cur.execute("SELECT COUNT(*) FROM tasks WHERE status != 'done' AND due_at < NOW()")
                    overdue = (cur.fetchone() or [0])[0]

                    cur.execute("SELECT COUNT(*) FROM job_applications WHERE status IN ('applied','viewed')")
                    pending_apps = (cur.fetchone() or [0])[0]

                    if not (unread or overdue or pending_apps):
                        return  # Nothing to ping about

            # Build message
            parts = []
            if overdue:
                parts.append(f"⚠️ {overdue} overdue task{'s' if overdue > 1 else ''}")
            if unread:
                parts.append(f"🔔 {unread} unread notification{'s' if unread > 1 else ''}")
            if pending_apps:
                parts.append(f"💼 {pending_apps} open application{'s' if pending_apps > 1 else ''} to follow up")

            msg = "Hey VJ, just checking in — here's what needs your attention:\n" + "\n".join(f"• {p}" for p in parts)

            from core.services.telegram_service import send_message
            await send_message(msg)
            log.info("Proactive nudge sent", overdue=overdue, unread=unread)
        except Exception as e:
            log.warning("Proactive nudge task error", error=str(e))

    scheduler.add_job(
        _proactive_nudge_task,
        trigger=IntervalTrigger(hours=4),
        id="__proactive_nudge__",
        name="Jazper proactive nudge",
        replace_existing=True,
        misfire_grace_time=300,
    )
    log.info("Proactive nudge scheduled", interval="4h")

    # ── Job Radar Daily Scan ──────────────────────────────────────────────────
    async def _radar_scan_task():
        try:
            from api.routes.job_radar import _run_radar_scan
            from core.services.telegram_service import send_telegram
            count = await _run_radar_scan()
            if count > 0:
                await send_telegram(f"📡 Job Radar: found {count} new matching jobs. Check the radar panel!")
            log.info("Radar scan complete", new_hits=count)
        except Exception as e:
            log.warning("Radar scan task failed", error=str(e))

    scheduler.add_job(
        _radar_scan_task, IntervalTrigger(hours=24),
        id="job_radar_scan", replace_existing=True,
        next_run_time=None,
    )
    log.info("Job Radar scan scheduled", interval="24h")

    # ── Reminder Fire Check ──────────────────────────────────────────────────
    async def _reminder_check_task():
        try:
            from memory.db.legacy_pg import _pg
            from core.services.telegram_service import send_telegram
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT id, title, body FROM reminders
                        WHERE status = 'pending' AND remind_at <= NOW()
                    """)
                    due = cur.fetchall()
                    for (rid, title, body) in due:
                        msg = f"⏰ Reminder: {title}"
                        if body: msg += f"\n{body}"
                        await send_telegram(msg)
                        cur.execute("UPDATE reminders SET status = 'fired' WHERE id = %s", (rid,))
            if due:
                log.info("Reminders fired", count=len(due))
        except Exception as e:
            log.warning("Reminder check failed", error=str(e))

    scheduler.add_job(
        _reminder_check_task, IntervalTrigger(minutes=5),
        id="reminder_check", replace_existing=True,
    )


def _schedule_linkedin_apply() -> None:
    """Daily LinkedIn auto-apply — only runs if auto_apply_enabled=True in job_apply_profile."""
    from apscheduler.triggers.cron import CronTrigger as _CT

    async def _linkedin_apply_task():
        try:
            from core.services.linkedin_service import get_profile, run_job_apply
            profile = await asyncio.get_event_loop().run_in_executor(None, get_profile)
            if not profile.get("auto_apply_enabled"):
                return  # Disabled — skip silently

            log.info("Daily LinkedIn auto-apply starting")
            log_lines: list[str] = []
            result = await asyncio.get_event_loop().run_in_executor(
                None, lambda: run_job_apply(log_lines)
            )

            status = result.get("status", "unknown")
            applied = result.get("jobs_applied", 0)
            found = result.get("jobs_found", 0)
            skipped = result.get("jobs_skipped", 0)

            notif_type = "success" if status == "completed" else "error"
            notif_body = f"Found {found} jobs · Applied {applied} · Skipped {skipped}"
            if result.get("error"):
                notif_body += f"\nError: {result['error']}"

            with _pg() as conn:
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO notifications (title, body, type) VALUES (%s,%s,%s)",
                    (f"Daily apply {status} — {applied} applications sent", notif_body, notif_type),
                )
                conn.commit()
                cur.close()

            log.info("Daily LinkedIn auto-apply done", **result)

        except Exception as e:
            log.error("Daily LinkedIn auto-apply failed", error=str(e))

    # Read preferred hour from profile (default 9 UTC = 2:30 PM IST)
    run_hour = 9
    try:
        from core.services.linkedin_service import get_profile as _get_jap
        _prof = _get_jap()
        run_hour = int(_prof.get("auto_apply_hour") or 9)
    except Exception:
        pass

    scheduler.add_job(
        _linkedin_apply_task,
        trigger=_CT(hour=run_hour, minute=0),
        id="__linkedin_daily_apply__",
        name="Daily LinkedIn auto-apply",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info("Daily LinkedIn auto-apply scheduled", hour_utc=run_hour)


def _schedule_expiry_purge() -> None:
    """Delete chat sessions whose expires_at has passed."""
    def _purge():
        try:
            with _pg() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM chat_sessions WHERE expires_at IS NOT NULL AND expires_at < NOW()")
                deleted = cur.rowcount
                conn.commit()
                cur.close()
            if deleted:
                log.info("Purged expired chat sessions", count=deleted)
        except Exception as e:
            log.warning("Expiry purge failed", error=str(e))

    from apscheduler.triggers.cron import CronTrigger as _CT
    scheduler.add_job(
        _purge,
        trigger=_CT(hour=3, minute=0),  # 3 AM UTC daily
        id="__expiry_purge__",
        name="Purge expired chat sessions",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info("Expiry purge scheduled", time="03:00 UTC daily")


def _schedule_phase3_workers() -> None:
    """Phase 3 background intelligence workers — all built-in, always active."""
    from apscheduler.triggers.interval import IntervalTrigger
    from apscheduler.triggers.cron import CronTrigger as _CT

    # ── Hermes inbox monitor — every 30 minutes ───────────────────────────────
    from agents.workers.hermes_monitor_worker import HermesMonitorWorker
    _hermes = HermesMonitorWorker()

    async def _hermes_task():
        try:
            result = await _hermes.run({})
            if result.get("notified", 0):
                log.info("Hermes monitor sent notifications", **result)
        except Exception as e:
            log.warning("Hermes monitor error", error=str(e))

    scheduler.add_job(
        _hermes_task,
        trigger=IntervalTrigger(minutes=30),
        id="__hermes_monitor__",
        name="Hermes inbox monitor",
        replace_existing=True,
        misfire_grace_time=300,
    )
    log.info("Hermes inbox monitor scheduled", interval="30 min")

    # ── Atlas daily digest — 8:30 AM IST (3:00 AM UTC) ───────────────────────
    from agents.workers.atlas_scheduled_worker import AtlasScheduledWorker
    _atlas = AtlasScheduledWorker()

    async def _atlas_daily_task():
        try:
            result = await _atlas.run({"mode": "daily_digest"})
            if result.get("notification_sent"):
                log.info("Atlas daily digest sent")
        except Exception as e:
            log.warning("Atlas daily digest error", error=str(e))

    async def _atlas_weekly_task():
        try:
            result = await _atlas.run({"mode": "weekly_report"})
            if result.get("notification_sent"):
                log.info("Atlas weekly report sent")
        except Exception as e:
            log.warning("Atlas weekly report error", error=str(e))

    scheduler.add_job(
        _atlas_daily_task,
        trigger=_CT(hour=3, minute=0),           # 3:00 AM UTC = 8:30 AM IST
        id="__atlas_daily__",
        name="Atlas daily job digest",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _atlas_weekly_task,
        trigger=_CT(day_of_week="mon", hour=3, minute=30),  # Monday 9:00 AM IST
        id="__atlas_weekly__",
        name="Atlas weekly job report",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info("Atlas scheduled jobs registered", daily="03:00 UTC", weekly="Mon 03:30 UTC")

    # ── Scout topic monitor — every 6 hours ───────────────────────────────────
    from agents.workers.scout_monitor_worker import ScoutMonitorWorker
    _scout = ScoutMonitorWorker()

    async def _scout_monitor_task():
        try:
            result = await _scout.run({})
            if result.get("notified", 0):
                log.info("Scout monitor sent notifications", **result)
        except Exception as e:
            log.warning("Scout monitor error", error=str(e))

    scheduler.add_job(
        _scout_monitor_task,
        trigger=IntervalTrigger(hours=6),
        id="__scout_monitor__",
        name="Scout topic monitor",
        replace_existing=True,
        misfire_grace_time=1800,
    )
    log.info("Scout topic monitor scheduled", interval="6 hours")

    # ── Sage memory consolidation — every Sunday 2:00 AM UTC ─────────────────
    from agents.workers.sage_consolidation_worker import SageConsolidationWorker
    _sage = SageConsolidationWorker()

    async def _sage_consolidation_task():
        try:
            result = await _sage.run({})
            log.info("Sage consolidation complete", **{k: v for k, v in result.items() if k != "dry_run"})
        except Exception as e:
            log.warning("Sage consolidation error", error=str(e))

    scheduler.add_job(
        _sage_consolidation_task,
        trigger=_CT(day_of_week="sun", hour=2, minute=0),
        id="__sage_consolidation__",
        name="Sage memory consolidation",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info("Sage consolidation scheduled", time="Sunday 02:00 UTC")


def _schedule_sentry() -> None:
    """Stage 0: Sentry polls error_store every 30s and wakes Darwin when needed."""
    from apscheduler.triggers.interval import IntervalTrigger
    from agents.workers.sentry_worker import sentry_check

    scheduler.add_job(
        sentry_check,
        trigger=IntervalTrigger(seconds=30),
        id="__sentry__",
        name="IT Sentry — error monitor",
        replace_existing=True,
        misfire_grace_time=15,
    )
    log.info("IT Sentry scheduled", interval="30s")


def _schedule_qa_jobs() -> None:
    """Phase 6 QA jobs — Pulse smoke-tests every 15 min."""
    from apscheduler.triggers.interval import IntervalTrigger
    from agents.roster.pulse_agent import PulseAgent

    async def _pulse_task():
        try:
            result = await PulseAgent.check_all()
            if not result["ok"]:
                log.warning("Pulse: endpoints unhealthy",
                            failed=result["failed"], checked=result["checked"])
            else:
                log.info("Pulse: all endpoints healthy", checked=result["checked"])
        except Exception as e:
            log.warning("Pulse smoke check error", error=str(e))

    scheduler.add_job(
        _pulse_task,
        trigger=IntervalTrigger(minutes=15),
        id="__pulse_smoke__",
        name="Pulse endpoint smoke test",
        replace_existing=True,
        misfire_grace_time=120,
    )
    log.info("Pulse smoke test scheduled", interval="15 min")

    # ── Aria nightly audit — 1:00 AM UTC (6:30 AM IST) ───────────────────────
    from apscheduler.triggers.cron import CronTrigger as _CT
    from agents.roster.aria_agent import AriaAgent

    async def _aria_nightly_task():
        try:
            await AriaAgent.nightly_audit()
        except Exception as e:
            log.warning("Aria nightly audit error", error=str(e))

    scheduler.add_job(
        _aria_nightly_task,
        trigger=_CT(hour=1, minute=0),
        id="__aria_nightly__",
        name="Aria nightly QA audit",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info("Aria nightly audit scheduled", time="01:00 UTC")


def _schedule_briefings() -> None:
    """Phase 10A — Morning and evening briefings, times read from DB config."""
    from apscheduler.triggers.cron import CronTrigger as _CT
    from core.services.briefing_service import get_briefing_config, generate_and_send_briefing

    cfg = get_briefing_config()

    # Remove any existing briefing jobs first (clean re-schedule)
    for jid in ("__morning_briefing__", "__evening_briefing__"):
        try:
            scheduler.remove_job(jid)
        except Exception:
            pass

    if cfg.get("morning_enabled"):
        h, m = cfg.get("morning_hour", 2), cfg.get("morning_minute", 0)

        async def _morning_task():
            try:
                result = await generate_and_send_briefing("morning")
                log.info("Morning briefing sent", **{k: v for k, v in result.items() if k != "message"})
            except Exception as e:
                log.warning("Morning briefing failed", error=str(e))

        scheduler.add_job(
            _morning_task,
            trigger=_CT(hour=h, minute=m),
            id="__morning_briefing__",
            name=f"Morning briefing ({h:02d}:{m:02d} UTC)",
            replace_existing=True,
            misfire_grace_time=1800,
        )
        log.info("Morning briefing scheduled", hour_utc=h, minute=m)

    if cfg.get("evening_enabled"):
        h, m = cfg.get("evening_hour", 15), cfg.get("evening_minute", 30)

        async def _evening_task():
            try:
                result = await generate_and_send_briefing("evening")
                log.info("Evening briefing sent", **{k: v for k, v in result.items() if k != "message"})
            except Exception as e:
                log.warning("Evening briefing failed", error=str(e))

        scheduler.add_job(
            _evening_task,
            trigger=_CT(hour=h, minute=m),
            id="__evening_briefing__",
            name=f"Evening briefing ({h:02d}:{m:02d} UTC)",
            replace_existing=True,
            misfire_grace_time=1800,
        )
        log.info("Evening briefing scheduled", hour_utc=h, minute=m)


def sync_briefings() -> None:
    """Re-read config and update briefing schedule. Called after config changes."""
    _schedule_briefings()


def _schedule_goal_checker() -> None:
    """Phase 9D — Daily LLM check of all active agent goals."""
    from apscheduler.triggers.cron import CronTrigger as _CT

    async def _check_goals():
        try:
            with _pg() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT id, agent_codename, goal, condition FROM agent_goals WHERE status = 'active'"
                )
                goals = cur.fetchall()
                cur.close()

            if not goals:
                return

            from core.providers.ai_provider import ai_provider

            for goal_id, codename, goal, condition in goals:
                try:
                    prompt = (
                        f"Goal: {goal}\n"
                        f"Condition that means goal is achieved: {condition}\n\n"
                        f"Based on what you know as an AI assistant for Sir Jazper OS, "
                        f"reply with only YES if the condition is clearly met, or NO if it is not yet met. "
                        f"Do not explain — just YES or NO."
                    )
                    result = await ai_provider.chat(
                        messages=[{"role": "user", "content": prompt}],
                        model="llama-3.1-8b-instant",
                        max_tokens=5,
                        temperature=0.0,
                        enable_thinking=False,
                    )
                    answer = (result.content or "").strip().upper()
                    achieved = answer.startswith("YES")

                    with _pg() as conn:
                        cur = conn.cursor()
                        if achieved:
                            cur.execute(
                                """UPDATE agent_goals
                                   SET status = 'completed', last_triggered = NOW(),
                                       trigger_count = trigger_count + 1
                                   WHERE id = %s""",
                                (goal_id,),
                            )
                            cur.execute(
                                "INSERT INTO notifications (title, body, type) VALUES (%s, %s, 'success')",
                                (
                                    f"Goal achieved: {goal[:80]}",
                                    f"Agent {codename} has reached their goal.\nCondition: {condition}",
                                ),
                            )
                        else:
                            cur.execute(
                                "UPDATE agent_goals SET last_triggered = NOW(), trigger_count = trigger_count + 1 WHERE id = %s",
                                (goal_id,),
                            )
                        conn.commit()
                        cur.close()

                except Exception as exc:
                    log.warning("goal_check: individual goal failed", goal_id=str(goal_id), error=str(exc))

            log.info("Goal checker complete", checked=len(goals))
        except Exception as exc:
            log.warning("Goal checker failed", error=str(exc))

    scheduler.add_job(
        _check_goals,
        trigger=_CT(hour=6, minute=0),  # 6 AM UTC = 11:30 AM IST
        id="__goal_checker__",
        name="Daily agent goal checker",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info("Goal checker scheduled", time="06:00 UTC daily")


def _schedule_warden() -> None:
    """Phase 6C — Warden weekly health scan, every Sunday 02:00 UTC."""
    from apscheduler.triggers.cron import CronTrigger as _CT
    from agents.workers.warden_worker import WardenWorker
    _warden = WardenWorker()

    async def _warden_task():
        try:
            result = await _warden.run({})
            log.info("Warden health scan complete", **{k: v for k, v in result.items()
                                                       if k not in ("dry_run",)})
        except Exception as e:
            log.warning("Warden health scan error", error=str(e))

    scheduler.add_job(
        _warden_task,
        trigger=_CT(day_of_week="sun", hour=2, minute=30),  # 30 min after Sage
        id="__warden_health__",
        name="Warden weekly health scan",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info("Warden health scan scheduled", time="Sunday 02:30 UTC")


def start_scheduler() -> None:
    _import_workers()
    sync_jobs()
    _schedule_builtin_jobs()
    _schedule_linkedin_apply()
    _schedule_expiry_purge()
    _schedule_phase3_workers()
    _schedule_sentry()
    _schedule_qa_jobs()
    _schedule_warden()
    _schedule_goal_checker()
    _schedule_briefings()
    scheduler.start()
    log.info("APScheduler started")


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
    log.info("APScheduler stopped")


def get_scheduler_jobs() -> list[dict]:
    """Return current scheduled jobs for Observatory status panel."""
    jobs = []
    for job in scheduler.get_jobs():
        next_run = job.next_run_time
        jobs.append({
            "id":       job.id,
            "name":     job.name or job.id,
            "next_run": next_run.isoformat() if next_run else None,
            "trigger":  str(job.trigger),
        })
    return jobs
