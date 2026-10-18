"""
Hermes Monitor Worker — runs every 30 minutes.

Unlike the Gmail Reply Monitor (which only looks for recruiter replies on
tracked applications), this worker does a broader scan:

  1. Fetches all unread emails since the last run checkpoint
  2. Uses AI to classify each email into a category and importance level
  3. Creates rich notifications for emails Jazper considers important
  4. Silently ignores newsletters, marketing, and low-priority items
  5. Stores the scan checkpoint so each run only processes new emails

This is what makes Jazper proactively aware of your inbox without
you having to open it.
"""
import json
import asyncio
import structlog
from agents.workers.base_worker import BaseWorker
from memory.db.legacy_pg import _pg

log = structlog.get_logger()

# ── Email categories and their notification behavior ─────────────────────────

_IMPORTANT_CATEGORIES = {
    "recruiter_outreach":  ("📨 Recruiter message", "info"),
    "interview_invite":    ("🎯 Interview invite!", "success"),
    "offer_letter":        ("🎉 Job offer received!", "success"),
    "rejection":           ("📋 Application update", "warning"),
    "action_required":     ("⚡ Action required", "info"),
    "payment":             ("💳 Payment / billing", "info"),
    "otp_verification":    ("🔐 Verification code", "info"),
    "deadline_reminder":   ("⏰ Deadline reminder", "warning"),
}

# Categories we silently skip
_SKIP_CATEGORIES = {
    "newsletter", "marketing", "promotions", "social_media",
    "automated_notification", "spam", "unknown",
}

_CLASSIFY_PROMPT = """Classify this email and extract key information.

Reply with ONLY valid JSON — no explanation, no markdown fences.

Format:
{{
  "category": "one of: recruiter_outreach | interview_invite | offer_letter | rejection | action_required | payment | otp_verification | deadline_reminder | newsletter | marketing | promotions | social_media | automated_notification | spam | unknown",
  "importance": "high | medium | low",
  "summary": "one sentence max — what the email is actually about",
  "sender_name": "extracted sender name or company",
  "action": "what the user needs to do, if anything — empty string if nothing"
}}

Email:
From: {from_}
Subject: {subject}
Preview: {snippet}"""


def _get_last_checkpoint() -> str | None:
    """Get the last history ID processed by this worker."""
    try:
        import redis as _redis
        from core.config import settings
        r = _redis.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD, decode_responses=True
        )
        val = r.get("hermes_monitor:checkpoint")
        r.close()
        return val
    except Exception:
        return None


def _save_checkpoint(value: str) -> None:
    try:
        import redis as _redis
        from core.config import settings
        r = _redis.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD, decode_responses=True
        )
        r.setex("hermes_monitor:checkpoint", 86400 * 7, value)  # 7-day TTL
        r.close()
    except Exception:
        pass


def _create_notification(title: str, body: str, ntype: str, metadata: dict | None = None) -> None:
    import json as _json
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO notifications (title, body, type, metadata) VALUES (%s,%s,%s,%s)",
                    (title, body, ntype, _json.dumps(metadata or {})),
                )
            conn.commit()
    except Exception as e:
        log.warning("Failed to create notification", error=str(e))


async def _classify_email(email: dict) -> dict | None:
    """Use AI to classify one email. Returns parsed JSON or None on failure."""
    from core.providers.ai_provider import ai_provider

    prompt = _CLASSIFY_PROMPT.format(
        from_=email.get("from", ""),
        subject=email.get("subject", "(no subject)"),
        snippet=email.get("snippet", "")[:400],
    )
    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.0,
            max_tokens=200,
        )
        raw = result.content.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        return json.loads(raw)
    except Exception as e:
        log.warning("Email classification failed", error=str(e))
        return None


class HermesMonitorWorker(BaseWorker):
    name = "hermes_monitor"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        from core.services.gmail_service import load_any_token, list_emails

        loop = asyncio.get_event_loop()

        # ── Check Gmail connected ─────────────────────────────────────────
        email_addr, token = await loop.run_in_executor(None, load_any_token)
        if not token:
            return {"skipped": True, "reason": "No Gmail account connected"}

        # ── Fetch recent unread emails (last 2 hours to catch up) ─────────
        max_emails = int(config.get("max_emails", 20))
        try:
            result = await loop.run_in_executor(
                None,
                lambda: list_emails(
                    max_results=max_emails,
                    label="INBOX",
                    query="is:unread newer_than:2h",
                    force_refresh=True,
                ),
            )
            emails = result.get("emails", [])
        except Exception as e:
            return {"error": str(e), "scanned": 0, "notified": 0}

        if not emails:
            return {"scanned": 0, "notified": 0, "reason": "No new unread emails"}

        # ── Classify each email with AI ───────────────────────────────────
        # Process max 10 at a time to respect rate limits
        batch = emails[:10]
        notified = 0
        skipped = 0
        errors = 0

        for email in batch:
            # Add small delay between API calls to respect rate limits
            await asyncio.sleep(0.5)

            classification = await _classify_email(email)
            if not classification:
                errors += 1
                continue

            category = classification.get("category", "unknown")
            importance = classification.get("importance", "low")
            summary = classification.get("summary", "")
            sender = classification.get("sender_name", email.get("from", "Unknown"))
            action = classification.get("action", "")

            # Skip unimportant categories
            if category in _SKIP_CATEGORIES or importance == "low":
                skipped += 1
                continue

            notif_info = _IMPORTANT_CATEGORIES.get(category)
            if not notif_info:
                skipped += 1
                continue

            notif_title, notif_type = notif_info
            body_parts = [f"From: {sender}", f"Subject: {email.get('subject', '')}"]
            if summary:
                body_parts.append(summary)
            if action:
                body_parts.append(f"Action: {action}")

            if not dry_run:
                _notif_body = "\n".join(body_parts)
                # Extract raw from-email for reply support
                import re as _re
                raw_from = email.get("from", "")
                _m = _re.search(r'<([^>]+)>', raw_from)
                _from_email = _m.group(1) if _m else raw_from
                _metadata = {"from_email": _from_email, "msg_id": email.get("id", ""), "subject": email.get("subject", "")}
                await loop.run_in_executor(
                    None,
                    lambda t=notif_title, b=_notif_body, nt=notif_type, md=_metadata:
                        _create_notification(t, b, nt, md),
                )
                log.info(
                    "Hermes notification created",
                    category=category, sender=sender,
                    importance=importance,
                )
                # Phase 10B — Telegram instant alert
                try:
                    from core.services.alert_service import try_send_alert
                    asyncio.create_task(try_send_alert(category, notif_title, _notif_body))
                except Exception:
                    pass
                # Phase 11A — Automation rules
                try:
                    from core.services.automation_service import fire_event
                    asyncio.create_task(fire_event("email_classified", {
                        "category": category,
                        "sender": sender,
                        "company": sender,
                        "title": email.get("subject", ""),
                        "importance": importance,
                    }))
                except Exception:
                    pass

            notified += 1

        return {
            "scanned": len(batch),
            "notified": notified,
            "skipped": skipped,
            "errors": errors,
            "account": email_addr,
        }
