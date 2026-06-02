"""Job Application Agent — searches and applies to jobs on the user's behalf."""
import asyncio
import json
import structlog
from app.workers.base_worker import BaseWorker
from app.services.memory_service import _pg
from app.services.credentials_service import load_credential

log = structlog.get_logger()


def _load_user_profile() -> dict | None:
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT full_name, email, phone, resume_text, skills, preferences FROM user_profile LIMIT 1")
        row = cur.fetchone()
        cur.close()
        if not row:
            return None
        return {
            "full_name": row[0],
            "email": row[1],
            "phone": row[2],
            "resume_text": row[3],
            "skills": row[4] or [],
            "preferences": row[5] or {},
        }
    finally:
        conn.close()


def _get_applied_urls() -> set[str]:
    """Return set of job URLs already applied to (from previous successful runs)."""
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT jsonb_array_elements(result->'applied_urls')::text
            FROM job_runs
            WHERE status = 'success'
            """
        )
        rows = cur.fetchall()
        cur.close()
        return {r[0].strip('"') for r in rows}
    except Exception:
        return set()
    finally:
        conn.close()


class JobApplyWorker(BaseWorker):
    name = "job_apply"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        """
        Config keys:
          mode: "AUTO" | "PROPOSE"
          title: str
          location: str
          remote: bool
          salary_min: int
          blacklist: list[str]  — company names to skip
          limit: int            — max applications per run (default 5)
        """
        mode = config.get("mode", "PROPOSE")
        title = config.get("title", "Software Engineer")
        location = config.get("location", "")
        remote = config.get("remote", True)
        limit = config.get("limit", 5)
        blacklist = {c.lower() for c in config.get("blacklist", [])}

        loop = asyncio.get_event_loop()

        # Load profile and credentials in executor (sync DB calls)
        profile = await loop.run_in_executor(None, _load_user_profile)
        if not profile:
            return {"error": "No user profile found — please fill in the Profile tab first"}

        li_creds = await loop.run_in_executor(None, load_credential, "linkedin")
        if not li_creds:
            return {"error": "No LinkedIn credentials found — please add cookies in the Credentials tab"}

        already_applied = await loop.run_in_executor(None, _get_applied_urls)

        from app.tools.browser_tool import BrowserTool
        from app.tools.linkedin_tool import LinkedInTool

        cookies = li_creds.get("cookies", [])
        user_agent = li_creds.get("user_agent")
        linkedin = LinkedInTool(cookies=cookies, user_agent=user_agent)

        summary = {"applied": 0, "skipped": 0, "failed": 0, "matches": [], "applied_urls": []}

        async with BrowserTool(headless=True, user_agent=user_agent) as browser:
            jobs = await linkedin.search_jobs(browser, title=title, location=location, remote=remote, limit=30)
            log.info("LinkedIn search complete", found=len(jobs), title=title)

            for job in jobs:
                if summary["applied"] >= limit:
                    break

                url = job.get("url", "")
                company = job.get("company", "").lower()

                if not url or url in already_applied:
                    summary["skipped"] += 1
                    continue

                if company in blacklist:
                    log.info("Skipping blacklisted company", company=company)
                    summary["skipped"] += 1
                    continue

                summary["matches"].append(job)

                if dry_run or mode == "PROPOSE":
                    # Don't apply — surface for user approval
                    continue

                # AUTO mode — apply now
                result = await linkedin.easy_apply(browser, job_url=url, profile=profile)
                if result["success"]:
                    summary["applied"] += 1
                    summary["applied_urls"].append(url)
                    log.info("Applied to job", title=job["title"], company=job["company"])
                else:
                    summary["failed"] += 1
                    log.warning("Failed to apply", title=job["title"], reason=result["message"])

        if mode == "PROPOSE":
            summary["note"] = f"PROPOSE mode — {len(summary['matches'])} matches ready for approval"

        return summary
