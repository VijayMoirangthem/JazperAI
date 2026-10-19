"""CRUD for cron jobs, run history, credentials, user profile, and notifications."""
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from memory.db.legacy_pg import _pg as _pg_raw

def _pg():
    try:
        return _pg_raw()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {e}")
from core.services.credentials_service import (
    save_credential, load_credential, delete_credential, list_portals,
)

router = APIRouter()
log = structlog.get_logger()
_executor = ThreadPoolExecutor(max_workers=4)


def _run_sync(fn):
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_executor, fn)


# ── Pydantic models ───────────────────────────────────────────────────────────

class CronJobCreate(BaseModel):
    name: str
    worker_type: str
    schedule: str           # cron expression e.g. "0 9 * * 1-5"
    enabled: bool = True
    config: dict = {}


class CronJobUpdate(BaseModel):
    name: str | None = None
    schedule: str | None = None
    enabled: bool | None = None
    config: dict | None = None


class CredentialSave(BaseModel):
    portal: str
    token_data: dict        # {"cookies": [...], "user_agent": "..."}


class UserProfileSave(BaseModel):
    full_name: str = ""
    email: str = ""
    phone: str = ""
    resume_text: str = ""
    skills: list[str] = []
    preferences: dict = {}


class ApproveMatches(BaseModel):
    approved_urls: list[str]


# ── Cron Jobs ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_jobs():
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT j.id, j.name, j.worker_type, j.schedule, j.enabled, j.config,
                       j.created_at, j.updated_at,
                       r.status AS last_status, r.finished_at AS last_run_at
                FROM cron_jobs j
                LEFT JOIN LATERAL (
                    SELECT status, finished_at FROM job_runs
                    WHERE cron_job_id = j.id ORDER BY started_at DESC LIMIT 1
                ) r ON TRUE
                ORDER BY j.created_at DESC
                """
            )
            rows = cur.fetchall()
            cur.close()
            return [
                {
                    "id": str(r[0]), "name": r[1], "worker_type": r[2],
                    "schedule": r[3], "enabled": r[4], "config": r[5] or {},
                    "created_at": r[6].isoformat() if r[6] else None,
                    "updated_at": r[7].isoformat() if r[7] else None,
                    "last_status": r[8],
                    "last_run_at": r[9].isoformat() if r[9] else None,
                }
                for r in rows
            ]
        finally:
            conn.close()

    return {"jobs": await _run_sync(_fn)}


@router.post("/")
async def create_job(body: CronJobCreate):
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO cron_jobs (name, worker_type, schedule, enabled, config)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
                """,
                (body.name, body.worker_type, body.schedule, body.enabled, json.dumps(body.config)),
            )
            job_id = str(cur.fetchone()[0])
            conn.commit()
            cur.close()
            return job_id
        finally:
            conn.close()

    job_id = await _run_sync(_fn)
    from core.scheduler.scheduler import sync_jobs
    await _run_sync(sync_jobs)
    log.info("Cron job created", job_id=job_id, name=body.name)
    return {"id": job_id}


@router.put("/{job_id}")
async def update_job(job_id: str, body: CronJobUpdate):
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            fields = []
            values = []
            if body.name is not None:
                fields.append("name = %s"); values.append(body.name)
            if body.schedule is not None:
                fields.append("schedule = %s"); values.append(body.schedule)
            if body.enabled is not None:
                fields.append("enabled = %s"); values.append(body.enabled)
            if body.config is not None:
                fields.append("config = %s"); values.append(json.dumps(body.config))
            if not fields:
                return False
            fields.append("updated_at = NOW()")
            values.append(job_id)
            cur.execute(
                f"UPDATE cron_jobs SET {', '.join(fields)} WHERE id = %s RETURNING id",
                values,
            )
            updated = cur.fetchone() is not None
            conn.commit()
            cur.close()
            return updated
        finally:
            conn.close()

    updated = await _run_sync(_fn)
    if not updated:
        raise HTTPException(404, "Job not found")
    from core.scheduler.scheduler import sync_jobs
    await _run_sync(sync_jobs)
    return {"ok": True}


@router.delete("/{job_id}")
async def delete_job(job_id: str):
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM cron_jobs WHERE id = %s RETURNING id", (job_id,))
            deleted = cur.fetchone() is not None
            conn.commit()
            cur.close()
            return deleted
        finally:
            conn.close()

    deleted = await _run_sync(_fn)
    if not deleted:
        raise HTTPException(404, "Job not found")
    from core.scheduler.scheduler import sync_jobs
    await _run_sync(sync_jobs)
    return {"ok": True}


@router.post("/{job_id}/run")
async def run_job_now(job_id: str):
    from core.scheduler.scheduler import trigger_job_now
    try:
        run_id = await trigger_job_now(job_id)
        return {"run_id": run_id}
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/{job_id}/runs")
async def get_job_runs(job_id: str, limit: int = 50):
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, status, started_at, finished_at, result, log
                FROM job_runs WHERE cron_job_id = %s
                ORDER BY started_at DESC LIMIT %s
                """,
                (job_id, limit),
            )
            rows = cur.fetchall()
            cur.close()
            return [
                {
                    "id": str(r[0]), "status": r[1],
                    "started_at": r[2].isoformat() if r[2] else None,
                    "finished_at": r[3].isoformat() if r[3] else None,
                    "result": r[4] or {},
                    "log": r[5] or "",
                }
                for r in rows
            ]
        finally:
            conn.close()

    return {"runs": await _run_sync(_fn)}


@router.get("/runs/all")
async def get_all_runs(limit: int = 100):
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT r.id, r.cron_job_id, j.name AS job_name, r.status,
                       r.started_at, r.finished_at, r.result, r.log
                FROM job_runs r
                JOIN cron_jobs j ON j.id = r.cron_job_id
                ORDER BY r.started_at DESC LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
            cur.close()
            return [
                {
                    "id": str(r[0]), "cron_job_id": str(r[1]), "job_name": r[2],
                    "status": r[3],
                    "started_at": r[4].isoformat() if r[4] else None,
                    "finished_at": r[5].isoformat() if r[5] else None,
                    "result": r[6] or {},
                    "log": r[7] or "",
                }
                for r in rows
            ]
        finally:
            conn.close()

    return {"runs": await _run_sync(_fn)}


@router.post("/{job_id}/approve/{run_id}")
async def approve_matches(job_id: str, run_id: str, body: ApproveMatches):
    """Apply approved matches from a PROPOSE-mode run."""
    def _get_run():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT r.result, j.worker_type, j.config FROM job_runs r JOIN cron_jobs j ON j.id = r.cron_job_id WHERE r.id = %s",
                (run_id,),
            )
            return cur.fetchone()
        finally:
            conn.close()

    row = await _run_sync(_get_run)
    if not row:
        raise HTTPException(404, "Run not found")

    result, worker_type, config = row
    approved_jobs = [m for m in (result or {}).get("matches", []) if m.get("url") in body.approved_urls]

    if not approved_jobs:
        return {"applied": 0, "note": "No matching URLs found"}

    # Launch the worker in AUTO mode for approved jobs only
    from agents.workers.job_apply_worker import JobApplyWorker
    from hub.tools.browser_tool import BrowserTool
    from hub.tools.linkedin_tool import LinkedInTool
    from core.services.credentials_service import load_credential

    li_creds = await _run_sync(lambda: load_credential("linkedin"))
    if not li_creds:
        raise HTTPException(400, "No LinkedIn credentials configured")

    cookies = li_creds.get("cookies", [])
    user_agent = li_creds.get("user_agent")
    linkedin = LinkedInTool(cookies=cookies, user_agent=user_agent)

    applied = 0
    async with BrowserTool(headless=True, user_agent=user_agent) as browser:
        for job in approved_jobs:
            res = await linkedin.easy_apply(browser, job_url=job["url"], profile={})
            if res["success"]:
                applied += 1
                log.info("Approved job applied", title=job.get("title"), company=job.get("company"))

    return {"applied": applied, "total": len(approved_jobs)}


# ── Credentials ───────────────────────────────────────────────────────────────

@router.get("/credentials/")
async def list_credentials():
    portals = await _run_sync(list_portals)
    return {"portals": portals}


@router.post("/credentials/")
async def save_credentials(body: CredentialSave):
    await _run_sync(lambda: save_credential(body.portal, body.token_data))
    return {"ok": True}


@router.delete("/credentials/{portal}")
async def delete_credentials(portal: str):
    deleted = await _run_sync(lambda: delete_credential(portal))
    if not deleted:
        raise HTTPException(404, "Portal not found")
    return {"ok": True}


@router.post("/credentials/test/{portal}")
async def test_credential(portal: str):
    """Test if stored session cookies are still valid."""
    if portal != "linkedin":
        raise HTTPException(400, f"Connection test not yet supported for portal: {portal}")

    li_creds = await _run_sync(lambda: load_credential(portal))
    if not li_creds:
        raise HTTPException(404, "No credentials found for this portal")

    from hub.tools.browser_tool import BrowserTool
    from hub.tools.linkedin_tool import LinkedInTool

    cookies = li_creds.get("cookies", [])
    user_agent = li_creds.get("user_agent")
    linkedin = LinkedInTool(cookies=cookies, user_agent=user_agent)

    async with BrowserTool(headless=True, user_agent=user_agent) as browser:
        result = await linkedin.test_session(browser)

    return result


# ── User Profile ──────────────────────────────────────────────────────────────

@router.get("/profile/")
async def get_profile():
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, full_name, email, phone, resume_text, skills, preferences FROM user_profile LIMIT 1"
            )
            row = cur.fetchone()
            cur.close()
            if not row:
                return None
            return {
                "id": str(row[0]), "full_name": row[1], "email": row[2],
                "phone": row[3], "resume_text": row[4],
                "skills": row[5] or [], "preferences": row[6] or {},
            }
        finally:
            conn.close()

    profile = await _run_sync(_fn)
    return {"profile": profile}


@router.post("/profile/")
async def save_profile(body: UserProfileSave):
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO user_profile (full_name, email, phone, resume_text, skills, preferences)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    full_name = EXCLUDED.full_name, email = EXCLUDED.email,
                    phone = EXCLUDED.phone, resume_text = EXCLUDED.resume_text,
                    skills = EXCLUDED.skills, preferences = EXCLUDED.preferences,
                    updated_at = NOW()
                """,
                (body.full_name, body.email, body.phone, body.resume_text,
                 body.skills, json.dumps(body.preferences)),
            )
            conn.commit()
            cur.close()
        finally:
            conn.close()

    await _run_sync(_fn)
    return {"ok": True}


# ── Notifications ─────────────────────────────────────────────────────────────

@router.get("/notifications/")
async def list_notifications(limit: int = 50):
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, title, body, type, read, created_at, job_run_id
                FROM notifications ORDER BY created_at DESC LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
            cur.close()
            return [
                {
                    "id": str(r[0]), "title": r[1], "body": r[2], "type": r[3],
                    "read": r[4],
                    "created_at": r[5].isoformat() if r[5] else None,
                    "job_run_id": str(r[6]) if r[6] else None,
                }
                for r in rows
            ]
        finally:
            conn.close()

    return {"notifications": await _run_sync(_fn)}


@router.get("/notifications/unread-count")
async def unread_count():
    def _fn():
        try:
            conn = _pg()
            try:
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM notifications WHERE read = FALSE")
                count = cur.fetchone()[0]
                cur.close()
                return count
            finally:
                conn.close()
        except Exception:
            return 0

    return {"count": await _run_sync(_fn)}


@router.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: str):
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE notifications SET read = TRUE WHERE id = %s RETURNING id",
                (notif_id,),
            )
            updated = cur.fetchone() is not None
            conn.commit()
            cur.close()
            return updated
        finally:
            conn.close()

    updated = await _run_sync(_fn)
    if not updated:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}


@router.post("/notifications/read-all")
async def mark_all_read():
    def _fn():
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute("UPDATE notifications SET read = TRUE WHERE read = FALSE")
            conn.commit()
            cur.close()
        finally:
            conn.close()

    await _run_sync(_fn)
    return {"ok": True}
