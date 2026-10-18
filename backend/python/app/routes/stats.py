"""Productivity stats — cross-feature score and breakdown."""
from fastapi import APIRouter
import structlog

from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


@router.get("/productivity")
def productivity_score():
    scores: dict = {}
    details: dict = {}

    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                # ── Habits (0-100): % completed today ─────────────────────────
                cur.execute("SELECT COUNT(*) FROM habits")
                total_habits = (cur.fetchone() or [0])[0]
                cur.execute("""
                    SELECT COUNT(*) FROM habit_completions
                    WHERE completed_date = CURRENT_DATE
                """)
                done_habits = (cur.fetchone() or [0])[0]
                if total_habits > 0:
                    scores["habits"] = round((done_habits / total_habits) * 100)
                    details["habits"] = f"{done_habits}/{total_habits} habits done today"
                else:
                    scores["habits"] = 50
                    details["habits"] = "No habits set up yet"

                # ── Tasks (0-100): done vs total, penalise overdue ─────────────
                cur.execute("SELECT COUNT(*) FROM tasks WHERE status = 'done' AND updated_at > NOW() - INTERVAL '7 days'")
                done_tasks = (cur.fetchone() or [0])[0]
                cur.execute("SELECT COUNT(*) FROM tasks WHERE status != 'done'")
                pending_tasks = (cur.fetchone() or [0])[0]
                cur.execute("SELECT COUNT(*) FROM tasks WHERE status != 'done' AND due_at < NOW()")
                overdue_tasks = (cur.fetchone() or [0])[0]
                task_base = min(100, done_tasks * 10) if done_tasks else 50
                task_penalty = min(50, overdue_tasks * 10)
                scores["tasks"] = max(0, task_base - task_penalty)
                details["tasks"] = f"{done_tasks} completed this week, {overdue_tasks} overdue"

                # ── Applications (0-100): active pipeline health ───────────────
                cur.execute("SELECT COUNT(*) FROM job_applications WHERE status = 'interview'")
                interviews = (cur.fetchone() or [0])[0]
                cur.execute("SELECT COUNT(*) FROM job_applications WHERE status IN ('applied','viewed','interview','offer')")
                active_apps = (cur.fetchone() or [0])[0]
                scores["applications"] = min(100, interviews * 25 + min(50, active_apps * 5))
                details["applications"] = f"{active_apps} active, {interviews} at interview stage"

                # ── Habit streak (0-100): best current streak ──────────────────
                cur.execute("""
                    SELECT h.id FROM habits h
                    INNER JOIN habit_completions hc ON hc.habit_id = h.id
                    WHERE hc.completed_date = CURRENT_DATE
                """)
                today_done_ids = [r[0] for r in cur.fetchall()]
                best_streak = 0
                for hid in today_done_ids:
                    from datetime import date, timedelta
                    check = date.today() - timedelta(days=1)
                    streak = 1
                    while True:
                        cur.execute(
                            "SELECT 1 FROM habit_completions WHERE habit_id = %s AND completed_date = %s",
                            (str(hid), check)
                        )
                        if cur.fetchone():
                            streak += 1
                            check -= timedelta(days=1)
                        else:
                            break
                    best_streak = max(best_streak, streak)
                scores["streak"] = min(100, best_streak * 14)
                details["streak"] = f"{best_streak} day best streak" if best_streak else "No active streaks"

    except Exception as e:
        log.warning("Productivity score failed", error=str(e))
        return {"score": 0, "breakdown": {}, "trend": "unknown", "error": str(e)}

    # Weighted average: habits 25%, tasks 30%, applications 25%, streak 20%
    weights = {"habits": 0.25, "tasks": 0.30, "applications": 0.25, "streak": 0.20}
    overall = round(sum(scores.get(k, 0) * w for k, w in weights.items()))

    return {
        "score": overall,
        "breakdown": {k: {"score": scores[k], "detail": details[k]} for k in scores},
        "trend": "up" if overall >= 60 else "neutral" if overall >= 40 else "down",
    }
