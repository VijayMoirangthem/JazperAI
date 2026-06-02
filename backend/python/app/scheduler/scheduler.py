"""APScheduler instance — loads cron jobs from DB, dispatches to workers."""
import asyncio
import json
import uuid
from datetime import datetime, timezone

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services.memory_service import _pg

log = structlog.get_logger()

scheduler = AsyncIOScheduler(timezone="UTC")

WORKER_REGISTRY: dict[str, type] = {}


def register_worker(cls):
    WORKER_REGISTRY[cls.name] = cls
    return cls


def _import_workers():
    from app.workers.job_apply_worker import JobApplyWorker
    from app.workers.email_sync_worker import EmailSyncWorker
    from app.workers.gmail_reply_monitor_worker import GmailReplyMonitorWorker
    register_worker(JobApplyWorker)
    register_worker(EmailSyncWorker)
    register_worker(GmailReplyMonitorWorker)


def _load_jobs_from_db() -> list[dict]:
    conn = _pg()
    try:
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
    finally:
        conn.close()


def _create_run_record(cron_job_id: str) -> str:
    run_id = str(uuid.uuid4())
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO job_runs (id, cron_job_id, status, started_at) VALUES (%s, %s, 'pending', NOW()) RETURNING id",
            (run_id, cron_job_id),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()
    return run_id


def _update_run_record(run_id: str, status: str, result: dict | None, log_text: str = "") -> None:
    conn = _pg()
    try:
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
    finally:
        conn.close()


def _create_notification(title: str, body: str, ntype: str, job_run_id: str | None = None) -> None:
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO notifications (title, body, type, job_run_id) VALUES (%s, %s, %s, %s)",
            (title, body, ntype, job_run_id),
        )
        conn.commit()
        cur.close()
    except Exception as e:
        log.warning("Failed to create notification", error=str(e))
    finally:
        conn.close()


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
    log_lines: list[str] = []

    # Patch structlog to capture lines for this run
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: _update_run_record.__self__ if False else None  # noqa
        )
        # Mark as running
        conn = _pg()
        cur = conn.cursor()
        cur.execute("UPDATE job_runs SET status = 'running' WHERE id = %s", (run_id,))
        conn.commit()
        cur.close()
        conn.close()

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
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name, worker_type, config FROM cron_jobs WHERE id = %s",
            (cron_job_id,),
        )
        row = cur.fetchone()
        cur.close()
    finally:
        conn.close()

    if not row:
        raise ValueError(f"Cron job {cron_job_id} not found")

    name, worker_type, config = row
    run_id = _create_run_record(cron_job_id)
    asyncio.create_task(_run_job(cron_job_id, worker_type, config or {}, name))
    return run_id


def _schedule_builtin_jobs() -> None:
    """Internal jobs that always run — not stored in cron_jobs table."""
    from app.workers.email_sync_worker import EmailSyncWorker
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
    from app.workers.gmail_reply_monitor_worker import GmailReplyMonitorWorker
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


def _schedule_linkedin_apply() -> None:
    """Daily LinkedIn auto-apply — only runs if auto_apply_enabled=True in job_apply_profile."""
    from apscheduler.triggers.cron import CronTrigger as _CT

    async def _linkedin_apply_task():
        try:
            from app.services.linkedin_service import get_profile, run_job_apply
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

            conn = _pg()
            try:
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO notifications (title, body, type) VALUES (%s,%s,%s)",
                    (f"Daily apply {status} — {applied} applications sent", notif_body, notif_type),
                )
                conn.commit()
                cur.close()
            finally:
                conn.close()

            log.info("Daily LinkedIn auto-apply done", **result)

        except Exception as e:
            log.error("Daily LinkedIn auto-apply failed", error=str(e))

    # Read preferred hour from profile (default 9 UTC = 2:30 PM IST)
    run_hour = 9
    try:
        from app.services.linkedin_service import get_profile as _get_jap
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
            conn = _pg()
            cur = conn.cursor()
            cur.execute("DELETE FROM chat_sessions WHERE expires_at IS NOT NULL AND expires_at < NOW()")
            deleted = cur.rowcount
            conn.commit()
            cur.close()
            conn.close()
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


def start_scheduler() -> None:
    _import_workers()
    sync_jobs()
    _schedule_builtin_jobs()
    _schedule_linkedin_apply()
    _schedule_expiry_purge()
    scheduler.start()
    log.info("APScheduler started")


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
    log.info("APScheduler stopped")
