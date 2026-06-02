"""
Job-apply routes — profile, screening answers, cover letters, applications, run control.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor

import structlog
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services import linkedin_service as li

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
async def trigger_run():
    """Start a job-apply run and stream live log lines back to the client."""
    log_lines: list[str] = []

    async def _stream():
        loop = asyncio.get_event_loop()
        yield "data: Starting LinkedIn job-apply run…\n\n"

        # Run in thread so Playwright (sync) doesn't block the event loop
        future = loop.run_in_executor(_executor, lambda: li.run_job_apply(log_lines))

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
