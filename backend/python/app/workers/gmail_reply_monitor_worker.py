"""
Gmail Reply Monitor Worker — runs every 15 minutes.

For every company in job_applications with status='applied' or 'viewed',
searches Gmail for emails from that company's domain. Detects interview
invites, rejections, and general responses, then:
  - Updates job_applications.status
  - Stores the thread_id on the application
  - Creates a Jazper notification
"""

import re
import structlog
from app.workers.base_worker import BaseWorker
from app.services.memory_service import _pg

log = structlog.get_logger()

# ── Signal keyword maps ───────────────────────────────────────────────────────

_INTERVIEW_KW = [
    "interview", "schedule a call", "schedule a meeting", "we'd like to speak",
    "next steps", "move forward", "move you forward", "pleased to invite",
    "happy to invite", "we're excited", "shortlisted", "selected you",
]

_REJECTION_KW = [
    "unfortunately", "we regret", "not moving forward", "will not be moving",
    "decided to pursue other", "other candidates", "not selected", "not a match",
    "position has been filled", "we have decided", "won't be proceeding",
    "we're unable to offer", "not progress your application",
]

_RESPONSE_KW = [
    "received your application", "thank you for applying", "application is under review",
    "we have received", "application is being reviewed", "reviewing your application",
    "we are reviewing",
]


def _classify_email(subject: str, snippet: str) -> str | None:
    """Return new status string or None if not job-related."""
    text = (subject + " " + snippet).lower()
    if any(kw in text for kw in _INTERVIEW_KW):
        return "interview"
    if any(kw in text for kw in _REJECTION_KW):
        return "rejected"
    if any(kw in text for kw in _RESPONSE_KW):
        return "response"
    return None


def _domain_from_company(company: str) -> str:
    """Best-effort: 'Google LLC' → 'google', 'Meta Platforms' → 'meta'."""
    # Strip common suffixes
    cleaned = re.sub(r"\b(inc|llc|ltd|corp|co|group|technologies|tech|solutions|software|systems|services)\b", "", company, flags=re.I)
    cleaned = re.sub(r"[^a-z0-9 ]", "", cleaned.lower()).strip()
    # Take the first meaningful word
    words = [w for w in cleaned.split() if len(w) > 2]
    return words[0] if words else company.lower().replace(" ", "")


def _get_active_applications() -> list[dict]:
    """Return applied/viewed applications that don't yet have an email thread."""
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, company, title, email_thread_id
                   FROM job_applications
                   WHERE status IN ('applied', 'viewed')
                   ORDER BY applied_at DESC
                   LIMIT 100""",
            )
            rows = cur.fetchall()
    return [
        {"id": r[0], "company": r[1], "title": r[2], "email_thread_id": r[3]}
        for r in rows
    ]


def _update_application(job_id: str, status: str, thread_id: str, note: str) -> None:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE job_applications
                   SET status=%s, email_thread_id=%s,
                       notes=COALESCE(notes,'')||%s
                   WHERE id=%s""",
                (status, thread_id, f"\n[Auto] {note}", job_id),
            )
        conn.commit()


def _create_notification(title: str, body: str, ntype: str) -> None:
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


class GmailReplyMonitorWorker(BaseWorker):
    name = "gmail_reply_monitor"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        import asyncio
        from app.services import gmail_service as gs

        # Check Gmail is connected
        email_addr, token = await asyncio.get_event_loop().run_in_executor(
            None, gs.load_any_token
        )
        if not token:
            return {"skipped": True, "reason": "No Gmail account connected"}

        applications = await asyncio.get_event_loop().run_in_executor(
            None, _get_active_applications
        )
        if not applications:
            return {"checked": 0, "updated": 0}

        updated = 0
        checked = 0

        for app in applications:
            company = app["company"]
            job_id = app["id"]
            title = app["title"]
            domain = _domain_from_company(company)

            # Search Gmail for emails from this company's domain
            query = f"from:{domain} newer_than:30d"
            try:
                result = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda q=query: gs.search_emails(q, max_results=5),
                )
            except Exception as e:
                log.warning("Gmail search failed", company=company, error=str(e))
                continue

            emails = result.get("emails", [])
            checked += 1

            for email in emails:
                subject = email.get("subject", "")
                snippet = email.get("snippet", "")
                thread_id = email.get("thread_id", "")

                # Skip if we already tracked this thread
                if app.get("email_thread_id") == thread_id:
                    continue

                new_status = _classify_email(subject, snippet)
                if not new_status:
                    continue

                if not dry_run:
                    note = f"Gmail: {subject[:80]}"
                    await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda jid=job_id, s=new_status, tid=thread_id, n=note:
                            _update_application(jid, s, tid, n),
                    )

                    # Notification style per status
                    notif_map = {
                        "interview": ("info", f"Interview invite — {company}"),
                        "rejected":  ("warning", f"Rejection from {company}"),
                        "response":  ("info", f"Response from {company}"),
                    }
                    ntype, notif_title = notif_map.get(new_status, ("info", company))
                    await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda t=notif_title, b=f"{title}\n{subject[:120]}", nt=ntype:
                            _create_notification(t, b, nt),
                    )

                    log.info(
                        "Job application status updated",
                        company=company, title=title,
                        old_status="applied", new_status=new_status,
                    )

                updated += 1
                break  # One status change per application per run

        return {"checked": checked, "updated": updated, "total_apps": len(applications)}
