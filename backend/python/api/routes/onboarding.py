"""Onboarding status — checks which setup steps are complete."""
from fastapi import APIRouter
import structlog

from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()


@router.get("/status")
def onboarding_status():
    steps = [
        {"id": "gmail",   "label": "Connect Gmail",            "done": False, "panel": "gmail",    "description": "So Jazper can monitor your inbox"},
        {"id": "profile", "label": "Fill your profile",        "done": False, "panel": "settings", "description": "Name, headline, skills, resume"},
        {"id": "habit",   "label": "Add your first habit",     "done": False, "panel": "habits",   "description": "Build a daily routine"},
        {"id": "task",    "label": "Create your first task",   "done": False, "panel": "tasks",    "description": "Track what you need to do"},
        {"id": "job",     "label": "Track a job application",  "done": False, "panel": "jobapply", "description": "See your pipeline at a glance"},
    ]

    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                # Gmail: check google_tokens table
                try:
                    cur.execute("SELECT COUNT(*) FROM google_tokens")
                    steps[0]["done"] = (cur.fetchone() or [0])[0] > 0
                except Exception:
                    steps[0]["done"] = False

                # Profile: check user_profile has name
                cur.execute("SELECT full_name, resume_text, skills FROM user_profile WHERE id = 1")
                row = cur.fetchone()
                if row:
                    name_ok = bool(row[0] and row[0].strip())
                    resume_ok = bool(row[1] and row[1].strip())
                    skills_ok = bool(row[2])
                    steps[1]["done"] = name_ok and (resume_ok or skills_ok)

                # Habit
                cur.execute("SELECT COUNT(*) FROM habits")
                steps[2]["done"] = (cur.fetchone() or [0])[0] > 0

                # Task
                cur.execute("SELECT COUNT(*) FROM tasks")
                steps[3]["done"] = (cur.fetchone() or [0])[0] > 0

                # Job application
                cur.execute("SELECT COUNT(*) FROM job_applications")
                steps[4]["done"] = (cur.fetchone() or [0])[0] > 0

    except Exception as e:
        log.warning("Onboarding status check failed", error=str(e))

    complete = all(s["done"] for s in steps)
    done_count = sum(1 for s in steps if s["done"])
    return {"complete": complete, "done": done_count, "total": len(steps), "steps": steps}
