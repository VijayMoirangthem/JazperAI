"""
Job-apply routes — profile, screening answers, cover letters, applications, run control.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor

import psycopg2.extras
import structlog
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.services import linkedin_service as li
from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()
_executor = ThreadPoolExecutor(max_workers=2)


def _run(fn):
    return asyncio.get_event_loop().run_in_executor(_executor, fn)


# ── Profile ───────────────────────────────────────────────────────────────────

class ProfileUpdate(BaseModel):
    target_roles: list[str] | None = None
    work_modes: list[str] | None = None
    locations: list[str] | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    experience_years: int | None = None
    skills: list[str] | None = None
    blacklist_companies: list[str] | None = None
    resume_path: str | None = None
    daily_limit: int | None = None
    auto_apply_enabled: bool | None = None
    auto_apply_hour: int | None = None
    linkedin_email: str | None = None
    chrome_profile_path: str | None = None


@router.get("/profile")
async def get_profile():
    return await _run(li.get_profile)


@router.put("/profile")
async def update_profile(body: ProfileUpdate):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    return await _run(lambda: li.save_profile(data))


# ── Screening answers ─────────────────────────────────────────────────────────

class ScreeningAnswer(BaseModel):
    question: str
    answer: str
    category: str = "general"


@router.get("/screening")
async def list_screening():
    return await _run(li.get_screening_answers)


@router.put("/screening")
async def upsert_screening(body: ScreeningAnswer):
    return await _run(lambda: li.upsert_screening_answer(body.question, body.answer, body.category))


@router.delete("/screening/{answer_id}")
async def delete_screening(answer_id: int):
    await _run(lambda: li.delete_screening_answer(answer_id))
    return {"ok": True}


@router.post("/screening/seed")
async def seed_screening():
    await _run(li.seed_default_screening_answers)
    return await _run(li.get_screening_answers)


# ── Cover letters ─────────────────────────────────────────────────────────────

class CoverLetterBody(BaseModel):
    name: str
    content: str
    is_default: bool = False
    id: int | None = None


@router.get("/cover-letters")
async def list_cover_letters():
    return await _run(li.get_cover_letters)


@router.post("/cover-letters")
async def save_cover_letter(body: CoverLetterBody):
    return await _run(lambda: li.save_cover_letter(body.name, body.content, body.is_default, body.id))


@router.delete("/cover-letters/{letter_id}")
async def delete_cover_letter(letter_id: int):
    await _run(lambda: li.delete_cover_letter(letter_id))
    return {"ok": True}


# ── Funnel analytics ─────────────────────────────────────────────────────────

_STATUS_ORDER = ["applied", "viewed", "response", "interview", "offer", "rejected"]


@router.get("/funnel")
async def get_funnel():
    """Application funnel grouped by status with conversion rates."""
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, COUNT(*) FROM job_applications GROUP BY status"
            )
            rows = cur.fetchall()
            # avg days from applied_at to now for apps that progressed past 'applied'
            cur.execute("""
                SELECT AVG(
                    EXTRACT(EPOCH FROM (NOW() - applied_at)) / 86400.0
                )
                FROM job_applications
                WHERE status IN ('response', 'interview', 'offer', 'rejected')
                  AND applied_at IS NOT NULL
            """)
            avg_row = cur.fetchone()

    counts: dict[str, int] = {r[0]: int(r[1]) for r in rows}
    total = sum(counts.values())

    stages = [
        {"status": s, "count": counts.get(s, 0),
         "pct": round(counts.get(s, 0) / total * 100, 1) if total else 0.0}
        for s in _STATUS_ORDER
    ]
    # include any status not in the fixed order
    for s, c in counts.items():
        if s not in _STATUS_ORDER:
            stages.append({"status": s, "count": c,
                           "pct": round(c / total * 100, 1) if total else 0.0})

    applied   = counts.get("applied", 0)
    response  = counts.get("response", 0)
    interview = counts.get("interview", 0)
    offer     = counts.get("offer", 0)

    conversion = {
        "applied_to_response":   round(response  / applied   * 100, 1) if applied   else 0.0,
        "response_to_interview": round(interview / response  * 100, 1) if response  else 0.0,
        "interview_to_offer":    round(offer     / interview * 100, 1) if interview else 0.0,
    }

    avg_days = round(float(avg_row[0]), 1) if avg_row and avg_row[0] is not None else None

    return {"total": total, "stages": stages, "conversion": conversion,
            "avg_days_to_response": avg_days}


@router.get("/salary")
async def get_salary():
    """Salary range data from job applications."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT company, title, salary_min, salary_max
                    FROM job_applications
                    WHERE salary_min IS NOT NULL
                    ORDER BY applied_at DESC
                """)
                entries = [dict(r) for r in cur.fetchall()]
                cur.execute("""
                    SELECT AVG(salary_min) AS avg_min, AVG(salary_max) AS avg_max
                    FROM job_applications
                    WHERE salary_min IS NOT NULL
                """)
                agg = dict(cur.fetchone())
    except Exception as exc:
        msg = str(exc).lower()
        if "column" in msg and "salary" in msg:
            return {"entries": [], "avg_min": None, "avg_max": None,
                    "note": "no salary data yet"}
        raise HTTPException(status_code=500, detail=str(exc))

    if not entries:
        return {"entries": [], "avg_min": None, "avg_max": None,
                "note": "no salary data yet"}

    return {
        "entries": entries,
        "avg_min": float(agg["avg_min"]) if agg.get("avg_min") is not None else None,
        "avg_max": float(agg["avg_max"]) if agg.get("avg_max") is not None else None,
    }


# ── Applications ──────────────────────────────────────────────────────────────

@router.get("/applications")
async def list_applications(status: str | None = None, limit: int = 50):
    return await _run(lambda: li.get_applications(status, limit))


class StatusUpdate(BaseModel):
    status: str
    notes: str = ""


@router.patch("/applications/{job_id}")
async def update_status(job_id: str, body: StatusUpdate):
    await _run(lambda: li.update_application_status(job_id, body.status, body.notes))
    return {"ok": True}


# ── Runs ──────────────────────────────────────────────────────────────────────

@router.get("/runs")
async def list_runs(limit: int = 20):
    return await _run(lambda: li.get_apply_runs(limit))


@router.post("/run")
async def trigger_run(limit: int | None = None):
    """Start a job-apply run and stream live log lines back to the client.
    Pass ?limit=1 for a single-job test run."""
    log_lines: list[str] = []

    async def _stream():
        loop = asyncio.get_event_loop()
        label = f"limit={limit}" if limit else "full run"
        yield f"data: Starting LinkedIn job-apply run ({label})…\n\n"

        # Run in thread so Playwright (sync) doesn't block the event loop
        future = loop.run_in_executor(_executor, lambda: li.run_job_apply(log_lines, limit=limit))

        # Stream log lines as they appear while waiting for completion
        last_sent = 0
        while not future.done():
            await asyncio.sleep(1)
            while last_sent < len(log_lines):
                yield f"data: {log_lines[last_sent]}\n\n"
                last_sent += 1

        result = await future
        # Flush any remaining log lines
        while last_sent < len(log_lines):
            yield f"data: {log_lines[last_sent]}\n\n"
            last_sent += 1

        import json
        yield f"data: [DONE]{json.dumps(result)}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
