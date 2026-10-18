"""
Job Apply Worker — wraps linkedin_service.run_job_apply for the APScheduler pipeline.

This is the worker that Atlas (Operations L2) dispatches.  It delegates all
Playwright automation to linkedin_service so there is a single source of truth.
"""

import asyncio
import structlog
from app.workers.base_worker import BaseWorker

log = structlog.get_logger()


class JobApplyWorker(BaseWorker):
    name = "job_apply"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        """
        Config keys (all optional — fall back to job_apply_profile table):
          limit: int   — override daily_limit for this run
          dry_run: bool — scan + score but do not submit

        Returns:
          {run_id, status, jobs_found, jobs_applied, jobs_skipped, error?}
        """
        from app.services.linkedin_service import get_profile, run_job_apply

        loop = asyncio.get_event_loop()

        # Honour dry_run flag from config or argument
        if config.get("dry_run") or dry_run:
            log.info("JobApplyWorker dry_run — skipping Playwright")
            profile = await loop.run_in_executor(None, get_profile)
            return {
                "status": "dry_run",
                "jobs_found": 0,
                "jobs_applied": 0,
                "jobs_skipped": 0,
                "note": f"Profile: {profile.get('target_roles', [])}",
            }

        log_lines: list[str] = []

        result = await loop.run_in_executor(
            None,
            lambda: run_job_apply(log_lines),
        )

        log.info(
            "JobApplyWorker finished",
            status=result.get("status"),
            applied=result.get("jobs_applied", 0),
            found=result.get("jobs_found", 0),
        )
        return result

    async def on_success(self, result: dict, job_run_id: str) -> None:
        applied = result.get("jobs_applied", 0)
        found   = result.get("jobs_found", 0)
        skipped = result.get("jobs_skipped", 0)
        log.info(
            "Job apply run succeeded",
            run_id=job_run_id,
            applied=applied,
            found=found,
            skipped=skipped,
        )

    async def on_failure(self, error: Exception, job_run_id: str) -> None:
        log.error("Job apply run failed", run_id=job_run_id, error=str(error))
