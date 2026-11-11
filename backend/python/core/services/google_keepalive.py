"""Keep the Google login alive without the founder having to remember it.

Every 30 minutes (and shortly after start-up) every stored Google account is checked with Google. A working login is refreshed so it
never goes stale. When Google rejects it (invalid_grant: revoked, or expired - apps left in "Testing" status expire logins after
7 days), the founder is told in the notification centre and the sign-in page is opened in the default browser, pre-filled with the
account. Google only needs one "Continue" click there (it cannot be automated: the account owner must consent), and the page then
closes itself. The page is opened at most once every 12 hours so it can never nag.

Turn the auto-open off with GOOGLE_AUTO_RECONNECT=0 (the notification and the Connections card remain).
"""
from __future__ import annotations

import asyncio
import os
import time
import webbrowser
from urllib.parse import quote

import structlog

from core.config import settings

log = structlog.get_logger()
REOPEN_EVERY_S = 12 * 3600
_last_opened = 0.0


def authorize_url(email: str | None = None) -> str:
    base = settings.GOOGLE_REDIRECT_URI.rsplit("/oauth/callback", 1)[0] + "/oauth/authorize"
    return base + (f"?email={quote(email)}" if email else "")


def _notify(title: str, body: str) -> None:
    try:
        from core.scheduler.scheduler import _create_notification
        _create_notification(title, body, "warning")
    except Exception as e:  # never let a notification problem hide the real status
        log.debug("keepalive notification skipped", error=str(e)[:100])


async def run() -> dict:
    """One check. Returns {'healthy': n, 'expired': [emails], 'opened': bool}. Never raises."""
    global _last_opened
    out = {"healthy": 0, "expired": [], "opened": False}
    try:
        from core.services.gmail_service import accounts_with_health
        accounts = await asyncio.to_thread(accounts_with_health, True)
    except Exception as e:
        log.warning("google keep-alive check failed", error=str(e)[:120])
        return out
    out["healthy"] = sum(1 for a in accounts if a["healthy"])
    out["expired"] = [a["email"] for a in accounts if not a["healthy"]]
    if not out["expired"]:
        return out
    now = time.monotonic()
    if _last_opened and now - _last_opened < REOPEN_EVERY_S:
        return out
    _last_opened = now
    email = out["expired"][0]
    _notify("Google sign-in expired", f"Jazper can't reach Gmail/Drive for {email}. A sign-in page was opened - click Continue once.")
    if os.getenv("GOOGLE_AUTO_RECONNECT", "1") != "0":
        try:
            out["opened"] = bool(await asyncio.to_thread(webbrowser.open, authorize_url(email)))
        except Exception as e:
            log.warning("could not open the browser for Google sign-in", error=str(e)[:100])
    log.info("google login expired", email=email, browser_opened=out["opened"])
    return out
