"""
Daily Planner — generates a structured plan for today.

GET /api/planner/today   — returns cached plan (30-min TTL) or generates fresh
GET /api/planner/today?force=true — forces regeneration
"""
from __future__ import annotations
import time
import structlog
from fastapi import APIRouter
from memory.db.legacy_pg import _pg
from core.providers.ai_provider import ai_provider

router = APIRouter()
log = structlog.get_logger()

_cache: dict = {"ts": 0.0, "plan": "", "context": {}}
_TTL = 1800  # 30 minutes


async def _collect_context() -> dict:
    ctx: dict = {
        "tasks_due_today": [],
        "tasks_overdue": [],
        "tasks_upcoming": [],
        "applications_active": 0,
        "unread_notifications": 0,
        "profile_name": "VJ",
        "profile_headline": "",
    }
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                # Tasks due today
                cur.execute("""
                    SELECT title, priority, due_at
                    FROM tasks
                    WHERE status != 'done'
                      AND due_at::date = CURRENT_DATE
                    ORDER BY priority DESC, due_at
                    LIMIT 10
                """)
                ctx["tasks_due_today"] = [
                    {"title": r[0], "priority": r[1]}
                    for r in cur.fetchall()
                ]

                # Overdue tasks
                cur.execute("""
                    SELECT title, priority, due_at
                    FROM tasks
                    WHERE status != 'done'
                      AND due_at < NOW()
                      AND due_at::date != CURRENT_DATE
                    ORDER BY due_at
                    LIMIT 5
                """)
                ctx["tasks_overdue"] = [
                    {"title": r[0], "priority": r[1]}
                    for r in cur.fetchall()
                ]

                # Upcoming tasks (next 3 days, no due date today)
                cur.execute("""
                    SELECT title, priority, due_at
                    FROM tasks
                    WHERE status != 'done'
                      AND due_at > NOW()
                      AND due_at < NOW() + INTERVAL '3 days'
                      AND due_at::date != CURRENT_DATE
                    ORDER BY due_at
                    LIMIT 5
                """)
                ctx["tasks_upcoming"] = [
                    {"title": r[0], "priority": r[1]}
                    for r in cur.fetchall()
                ]

                # Active job applications
                cur.execute(
                    "SELECT COUNT(*) FROM job_applications WHERE status IN ('applied','viewed','interview')"
                )
                r = cur.fetchone()
                ctx["applications_active"] = r[0] if r else 0

                # Unread notifications
                cur.execute("SELECT COUNT(*) FROM notifications WHERE read = FALSE")
                r = cur.fetchone()
                ctx["unread_notifications"] = r[0] if r else 0

                # User profile
                cur.execute("SELECT full_name, headline, skills FROM user_profile WHERE id = 1")
                r = cur.fetchone()
                if r:
                    ctx["profile_name"] = r[0] or "VJ"
                    ctx["profile_headline"] = r[1] or ""
    except Exception as e:
        log.warning("planner context collection failed", error=str(e))
    return ctx


def _build_prompt(ctx: dict) -> str:
    lines = [
        f"Create a focused, actionable daily plan for {ctx['profile_name']}.",
        f"Role/focus: {ctx['profile_headline']}" if ctx["profile_headline"] else "",
        "",
    ]

    if ctx["tasks_overdue"]:
        lines.append(f"⚠️  OVERDUE ({len(ctx['tasks_overdue'])} tasks):")
        for t in ctx["tasks_overdue"]:
            lines.append(f"  - {t['title']} [{t['priority']}]")
        lines.append("")

    if ctx["tasks_due_today"]:
        lines.append(f"📅 DUE TODAY ({len(ctx['tasks_due_today'])} tasks):")
        for t in ctx["tasks_due_today"]:
            lines.append(f"  - {t['title']} [{t['priority']}]")
        lines.append("")

    if ctx["tasks_upcoming"]:
        lines.append("🔜 Coming up (next 3 days):")
        for t in ctx["tasks_upcoming"]:
            lines.append(f"  - {t['title']}")
        lines.append("")

    if ctx["applications_active"]:
        lines.append(f"💼 {ctx['applications_active']} active job application(s) — consider following up")
        lines.append("")

    if ctx["unread_notifications"]:
        lines.append(f"🔔 {ctx['unread_notifications']} unread notification(s) to review")
        lines.append("")

    lines += [
        "Format the plan as:",
        "## 🎯 Today's Focus",
        "One sentence headline for the day.",
        "",
        "## ⚡ Top 3 Priorities",
        "Numbered list of the 3 most important things to accomplish today.",
        "",
        "## 📋 Task Rundown",
        "Brief structured list: overdue → due today → quick wins.",
        "",
        "## ⏱️ Suggested Time Blocks",
        "3-4 time blocks (e.g. 9-11am: deep work on X, 11-12pm: emails & follow-ups).",
        "",
        "## 🚨 Watch-outs",
        "1-2 risks or things that need attention today.",
        "",
        "Keep it tight — no fluff. Plain text, use markdown headers and lists.",
    ]

    return "\n".join(l for l in lines if l is not None)


@router.get("/today")
async def get_daily_plan(force: bool = False):
    now = time.time()
    if not force and now - _cache["ts"] < _TTL and _cache["plan"]:
        return {
            "plan": _cache["plan"],
            "context": _cache["context"],
            "cached": True,
            "generated_at": _cache.get("generated_at", ""),
        }

    ctx = await _collect_context()
    prompt = _build_prompt(ctx)

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            temperature=0.4,
            max_tokens=700,
        )
        plan = result.content.strip()
    except Exception as e:
        log.warning("planner LLM failed", error=str(e))
        # Deterministic fallback
        due = len(ctx["tasks_due_today"])
        over = len(ctx["tasks_overdue"])
        focus = "Address overdue tasks first, then focus on today." if over else "Work through today's tasks."
        plan = (
            f"## 🎯 Today's Focus\n"
            f"{focus}\n\n"
            f"## ⚡ Top 3 Priorities\n"
        )
        all_tasks = ctx["tasks_overdue"] + ctx["tasks_due_today"]
        for i, t in enumerate(all_tasks[:3], 1):
            plan += f"{i}. {t['title']}\n"
        if ctx["unread_notifications"]:
            plan += f"\n## 🚨 Watch-outs\n- {ctx['unread_notifications']} unread notifications to review\n"

    import datetime
    generated_at = datetime.datetime.utcnow().isoformat() + "Z"
    _cache["ts"] = now
    _cache["plan"] = plan
    _cache["context"] = ctx
    _cache["generated_at"] = generated_at

    return {"plan": plan, "context": ctx, "cached": False, "generated_at": generated_at}


# ── Weekly review cache ───────────────────────────────────────────────────────
_week_cache: dict = {"ts": 0.0, "review": "", "generated_at": ""}
_WEEK_TTL = 3600  # 1 hour


async def _collect_week_context() -> dict:
    ctx: dict = {
        "tasks_completed": 0,
        "tasks_created": 0,
        "tasks_overdue": 0,
        "apps_active": 0,
        "apps_new_this_week": 0,
        "notifications_received": 0,
        "automation_fired": 0,
        "habits_summary": [],
        "profile_name": "VJ",
    }
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM tasks WHERE status = 'done' AND updated_at > NOW() - INTERVAL '7 days'")
                ctx["tasks_completed"] = (cur.fetchone() or [0])[0]

                cur.execute("SELECT COUNT(*) FROM tasks WHERE created_at > NOW() - INTERVAL '7 days'")
                ctx["tasks_created"] = (cur.fetchone() or [0])[0]

                cur.execute("SELECT COUNT(*) FROM tasks WHERE status != 'done' AND due_at < NOW()")
                ctx["tasks_overdue"] = (cur.fetchone() or [0])[0]

                cur.execute("SELECT COUNT(*) FROM job_applications WHERE status IN ('applied','viewed','interview')")
                ctx["apps_active"] = (cur.fetchone() or [0])[0]

                cur.execute("SELECT COUNT(*) FROM job_applications WHERE applied_at > NOW() - INTERVAL '7 days'")
                ctx["apps_new_this_week"] = (cur.fetchone() or [0])[0]

                cur.execute("SELECT COUNT(*) FROM notifications WHERE created_at > NOW() - INTERVAL '7 days'")
                ctx["notifications_received"] = (cur.fetchone() or [0])[0]

                cur.execute("SELECT COUNT(*) FROM automation_history WHERE fired_at > NOW() - INTERVAL '7 days'")
                ctx["automation_fired"] = (cur.fetchone() or [0])[0]

                cur.execute("SELECT full_name FROM user_profile WHERE id = 1")
                r = cur.fetchone()
                if r:
                    ctx["profile_name"] = r[0] or "VJ"

                # Habit summary: habits completed 5+ times this week
                cur.execute("""
                    SELECT h.title, COUNT(hc.id) AS days_done
                    FROM habits h
                    LEFT JOIN habit_completions hc ON hc.habit_id = h.id
                      AND hc.completed_date >= CURRENT_DATE - 6
                    GROUP BY h.id, h.title
                    ORDER BY days_done DESC
                    LIMIT 5
                """)
                ctx["habits_summary"] = [{"title": r[0], "days": r[1]} for r in cur.fetchall()]
    except Exception as e:
        log.warning("week context failed", error=str(e))
    return ctx


def _build_week_prompt(ctx: dict) -> str:
    lines = [
        f"Write a personal weekly review for {ctx['profile_name']}.",
        "",
        f"Stats this week:",
        f"- Tasks completed: {ctx['tasks_completed']}",
        f"- Tasks created: {ctx['tasks_created']}",
        f"- Tasks still overdue: {ctx['tasks_overdue']}",
        f"- Active job applications: {ctx['apps_active']}",
        f"- New applications this week: {ctx['apps_new_this_week']}",
        f"- Notifications received: {ctx['notifications_received']}",
        f"- Automation rules fired: {ctx['automation_fired']}",
    ]
    if ctx["habits_summary"]:
        lines.append("\nHabit tracking:")
        for h in ctx["habits_summary"]:
            lines.append(f"  - {h['title']}: {h['days']}/7 days")

    lines += [
        "",
        "Format as:",
        "## 🏆 Week in Review",
        "2-sentence summary of the week.",
        "",
        "## ✅ Wins",
        "2-3 bullets on what went well.",
        "",
        "## ⚠️ Watch-outs",
        "1-2 bullets on what needs attention next week.",
        "",
        "## 📋 Next Week Focus",
        "1-2 key priorities for next week.",
        "",
        "Keep it concise and personal. Plain text, use markdown headers and lists.",
    ]
    return "\n".join(lines)


@router.get("/week")
async def get_weekly_review(force: bool = False):
    import datetime as _dt
    now = _dt.datetime.utcnow().timestamp()
    if not force and now - _week_cache["ts"] < _WEEK_TTL and _week_cache["review"]:
        return {"review": _week_cache["review"], "cached": True, "generated_at": _week_cache["generated_at"]}

    ctx = await _collect_week_context()
    prompt = _build_week_prompt(ctx)

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            temperature=0.4,
            max_tokens=600,
        )
        review = result.content.strip()
    except Exception as e:
        log.warning("weekly review LLM failed", error=str(e))
        review = (
            f"## 🏆 Week in Review\n"
            f"Completed {ctx['tasks_completed']} tasks, {ctx['apps_new_this_week']} new job applications.\n\n"
            f"## ✅ Wins\n- Stayed active with {ctx['apps_active']} open applications.\n\n"
            f"## 📋 Next Week Focus\n- Clear overdue tasks ({ctx['tasks_overdue']} pending)."
        )

    import datetime as _dt2
    generated_at = _dt2.datetime.utcnow().isoformat() + "Z"
    _week_cache["ts"] = now
    _week_cache["review"] = review
    _week_cache["generated_at"] = generated_at

    return {"review": review, "cached": False, "generated_at": generated_at}
