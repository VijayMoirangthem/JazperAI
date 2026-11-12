"""Start-up warm-up: do the slow one-time work right after the server starts, so the first real request is not the slow one.

Measured on this PC: the first email question after a restart took ~15 s (loading Google's libraries, refreshing the login, opening the
connection); every later one took ~2.8 s. Nothing here can fail the server: each step is best-effort.
"""
import structlog

log = structlog.get_logger()


def warm_gmail() -> None:
    try:
        from core.services import gmail_service
        email, _ = gmail_service.load_any_token()
        if email:
            gmail_service.get_profile()   # builds the client, refreshes the token if needed and opens the HTTPS connection
            log.info("warm-up: Gmail ready")
    except Exception as e:  # not connected / offline: the first real request will deal with it
        log.info("warm-up: Gmail skipped", reason=str(e)[:80])


def warm_all() -> None:
    warm_gmail()
