"""
Atlas Scheduled Worker — two modes, both driven by the same worker class.

  mode = "daily_digest"  (default — runs every day at 8 AM IST)
    - Summarises job application activity from the last 24 hours
    - Highlights status changes, new interviews, rejections
    - Creates a single notification with the full digest

  mode = "weekly_report"  (runs every Monday at 8 AM IST)
    - Full weekly summary: total apps, response rate, interview rate, top companies
    - Uses AI to generate a plain-English career progress narrative
    - Creates a detailed notification the user can read and act on
"""
import json
import asyncio
import structlog
from datetime import datetime, timezone, timedelta
from agents.workers.base_worker import BaseWorker
from memory.db.legacy_pg import _pg

log = structlog.get_logger()


def _create_notification(title: str, body: str, ntype: str = "info") -> None:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO notifications (title, body, type) VALUES (%s,%s,%s)",
                    (title, body, ntype),
                )
            conn.commit()
    except Exception as e:
        log.warning("Failed to create notification", error=str(e))


def _get_daily_stats() -> dict:
    """Applications and status changes in the last 24 hours."""
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                since = datetime.now(timezone.utc) - timedelta(hours=24)

                cur.execute(
                    "SELECT COUNT(*) FROM job_applications WHERE applied_at > %s", (since,)
                )
                new_apps = cur.fetchone()[0]

                cur.execute(
                    "SELECT status, COUNT(*) FROM job_applications WHERE applied_at > %s GROUP BY status",
                    (since,),
                )
                new_by_status = {r[0]: r[1] for r in cur.fetchall()}

                # Applications that changed status (interview/rejection/response) today
                cur.execute(
                    """SELECT company, title, status FROM job_applications
                       WHERE updated_at > %s AND status IN ('interview', 'rejected', 'response', 'offer')
                       ORDER BY updated_at DESC LIMIT 10""",
                    (since,),
                )
                status_changes = [
                    {"company": r[0], "title": r[1], "status": r[2]}
                    for r in cur.fetchall()
                ]

                cur.execute(
                    "SELECT COUNT(*) FROM job_applications WHERE status = 'interview'"
                )
                active_interviews = cur.fetchone()[0]

        return {
            "new_apps": new_apps,
            "new_by_status": new_by_status,
            "status_changes": status_changes,
            "active_interviews": active_interviews,
        }
    except Exception as e:
        return {"error": str(e)}


def _get_weekly_stats() -> dict:
    """Comprehensive stats for the last 7 days."""
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                since = datetime.now(timezone.utc) - timedelta(days=7)

                cur.execute("SELECT COUNT(*) FROM job_applications WHERE applied_at > %s", (since,))
                total_week = cur.fetchone()[0]

                cur.execute("SELECT COUNT(*) FROM job_applications")
                total_all = cur.fetchone()[0]

                cur.execute(
                    "SELECT status, COUNT(*) FROM job_applications GROUP BY status ORDER BY COUNT(*) DESC"
                )
                all_by_status = {r[0]: r[1] for r in cur.fetchall()}

                cur.execute(
                    "SELECT company, COUNT(*) as c FROM job_applications WHERE applied_at > %s GROUP BY company ORDER BY c DESC LIMIT 5",
                    (since,),
                )
                top_companies = [{"company": r[0], "count": r[1]} for r in cur.fetchall()]

                cur.execute(
                    "SELECT COUNT(*) FROM job_applications WHERE status = 'interview' AND applied_at > %s",
                    (since,),
                )
                interviews_week = cur.fetchone()[0]

                cur.execute(
                    "SELECT COUNT(*) FROM job_applications WHERE status = 'rejected' AND applied_at > %s",
                    (since,),
                )
                rejections_week = cur.fetchone()[0]

                response_rate = round(
                    ((interviews_week + rejections_week) / total_week * 100) if total_week > 0 else 0, 1
                )
                interview_rate = round(
                    (interviews_week / total_week * 100) if total_week > 0 else 0, 1
                )

        return {
            "total_week": total_week,
            "total_all": total_all,
            "all_by_status": all_by_status,
            "top_companies": top_companies,
            "interviews_week": interviews_week,
            "rejections_week": rejections_week,
            "response_rate": response_rate,
            "interview_rate": interview_rate,
        }
    except Exception as e:
        return {"error": str(e)}


async def _generate_digest_narrative(stats: dict, mode: str) -> str:
    """Use AI to turn raw stats into a readable notification body."""
    from core.providers.ai_provider import ai_provider

    if "error" in stats:
        return f"Could not generate digest: {stats['error']}"

    if mode == "daily_digest":
        prompt = (
            f"Write a 3-5 sentence daily job hunt update based on these stats. "
            f"Be direct and practical. No preamble.\n\nStats: {json.dumps(stats)}"
        )
    else:
        prompt = (
            f"Write a concise weekly job hunt progress report (5-7 sentences). "
            f"Include response rate, what's working, and one actionable suggestion. "
            f"Be honest — if numbers are low, say so constructively.\n\nStats: {json.dumps(stats)}"
        )

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.4,
            max_tokens=300,
        )
        return result.content.strip()
    except Exception as e:
        # Fall back to plain stats if AI fails
        if mode == "daily_digest":
            s = stats
            changes = s.get("status_changes", [])
            parts = [f"New applications today: {s.get('new_apps', 0)}"]
            if s.get("active_interviews", 0):
                parts.append(f"Active interviews: {s['active_interviews']}")
            if changes:
                parts.append("Status updates: " + ", ".join(
                    f"{c['company']} → {c['status']}" for c in changes[:3]
                ))
            return "\n".join(parts)
        return f"Weekly stats: {json.dumps(stats, default=str)}"


class AtlasScheduledWorker(BaseWorker):
    name = "atlas_scheduled"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        loop = asyncio.get_event_loop()
        mode = config.get("mode", "daily_digest")  # "daily_digest" | "weekly_report"

        if mode == "weekly_report":
            stats = await loop.run_in_executor(None, _get_weekly_stats)
            if "error" in stats:
                return {"error": stats["error"]}

            narrative = await _generate_digest_narrative(stats, mode)
            title = f"Weekly job hunt report — {stats.get('total_week', 0)} applications this week"
            ntype = "success" if stats.get("interviews_week", 0) > 0 else "info"

        else:  # daily_digest
            stats = await loop.run_in_executor(None, _get_daily_stats)
            if "error" in stats:
                return {"error": stats["error"]}

            if stats.get("new_apps", 0) == 0 and not stats.get("status_changes"):
                return {"skipped": True, "reason": "No activity today"}

            narrative = await _generate_digest_narrative(stats, mode)
            title = f"Daily digest — {stats.get('new_apps', 0)} new applications"
            ntype = "info"
            if stats.get("status_changes"):
                interview_changes = [c for c in stats["status_changes"] if c["status"] == "interview"]
                if interview_changes:
                    ntype = "success"
                    title = f"Interview invite! + {stats.get('new_apps', 0)} applications today"

        if not dry_run:
            await loop.run_in_executor(
                None, lambda: _create_notification(title, narrative, ntype)
            )
            log.info("Atlas digest sent", mode=mode, title=title)

        return {"mode": mode, "stats": stats, "notification_sent": not dry_run}
