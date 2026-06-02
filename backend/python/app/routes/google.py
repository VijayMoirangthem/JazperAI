"""
Google OAuth 2.0 flow + Gmail API routes.

Flow:
  GET  /api/google/oauth/authorize          → redirect user to Google consent screen
  GET  /api/google/oauth/callback           → exchange code for tokens, save, redirect to frontend
  GET  /api/google/oauth/status             → list connected accounts
  DELETE /api/google/oauth/{email}          → disconnect an account

Gmail:
  GET  /api/google/gmail/inbox              → list inbox emails
  GET  /api/google/gmail/email/{id}         → get full email (marks as read)
  POST /api/google/gmail/send               → send an email
  GET  /api/google/gmail/search             → search emails
  GET  /api/google/gmail/profile            → connected account info
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor

import structlog
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter()
log = structlog.get_logger()
_executor = ThreadPoolExecutor(max_workers=4)


def _run(fn):
    return asyncio.get_event_loop().run_in_executor(_executor, fn)


# ── Shared OAuth client config ────────────────────────────────────────────────

_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

def _client_config():
    return {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
        }
    }


# ── OAuth flow ────────────────────────────────────────────────────────────────

@router.get("/oauth/authorize")
async def authorize():
    """Redirect the user to Google's OAuth consent screen."""
    import os, requests as req_lib
    from google_auth_oauthlib.flow import Flow

    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(500, "GOOGLE_CLIENT_ID not configured in .env")

    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

    flow = Flow.from_client_config(
        _client_config(), scopes=_OAUTH_SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )

    # Persist the code_verifier (if PKCE was used) and state in Redis
    # so the callback can reconstruct the same flow
    import redis as redis_lib
    r = redis_lib.Redis(
        host=settings.REDIS_HOST, port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD, decode_responses=True,
    )
    verifier = getattr(flow, "code_verifier", None) or ""
    r.setex(f"oauth_state:{state}", 600, verifier)   # expires in 10 min
    r.close()

    return RedirectResponse(auth_url)


@router.get("/oauth/callback")
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(None),
    error: str = Query(None),
):
    """Google redirects here after user grants consent."""
    import os
    from google_auth_oauthlib.flow import Flow
    from googleapiclient.discovery import build

    if error:
        log.warning("Google OAuth error", error=error)
        return RedirectResponse(f"{settings.FRONTEND_URL}?gmail_error={error}")

    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

    # Retrieve the code_verifier stored during /authorize
    code_verifier = None
    if state:
        import redis as redis_lib
        r = redis_lib.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD, decode_responses=True,
        )
        code_verifier = r.get(f"oauth_state:{state}") or None
        r.delete(f"oauth_state:{state}")
        r.close()

    def _exchange():
        flow = Flow.from_client_config(
            _client_config(), scopes=_OAUTH_SCOPES,
            redirect_uri=settings.GOOGLE_REDIRECT_URI,
            state=state,
        )
        if code_verifier:
            flow.code_verifier = code_verifier

        flow.fetch_token(code=code)
        creds = flow.credentials

        svc = build("oauth2", "v2", credentials=creds)
        user_info = svc.userinfo().get().execute()
        email = user_info.get("email", "unknown")

        token_data = {
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "expiry": creds.expiry.isoformat() if creds.expiry else None,
            "email": email,
        }
        from app.services.gmail_service import save_token
        save_token(email, token_data)
        log.info("Gmail connected", email=email)
        return email

    try:
        email = await _run(_exchange)
        return RedirectResponse(f"{settings.FRONTEND_URL}?gmail_connected={email}&view=gmail")
    except Exception as e:
        log.error("OAuth callback failed", error=str(e))
        return RedirectResponse(f"{settings.FRONTEND_URL}?gmail_error=callback_failed")


@router.get("/oauth/status")
async def oauth_status():
    from app.services.gmail_service import list_connected_accounts
    accounts = await _run(list_connected_accounts)
    return {"connected": accounts}


@router.delete("/oauth/{email}")
async def disconnect_account(email: str):
    from app.services.gmail_service import delete_token
    deleted = await _run(lambda: delete_token(email))
    if not deleted:
        raise HTTPException(404, "Account not found")
    return {"ok": True}


# ── Gmail endpoints ───────────────────────────────────────────────────────────

@router.get("/gmail/profile")
async def gmail_profile():
    from app.services.gmail_service import get_profile
    try:
        return await _run(get_profile)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        log.error("gmail_profile failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/gmail/inbox")
async def gmail_inbox(
    limit: int = 30,
    label: str = "INBOX",
    q: str = "",
    page_token: str = "",
    force_refresh: bool = False,
):
    from app.services.gmail_service import list_emails
    try:
        result = await _run(lambda: list_emails(
            max_results=limit, label=label, query=q,
            page_token=page_token, force_refresh=force_refresh,
        ))
        return result
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        log.error("gmail_inbox failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/gmail/email/{msg_id}")
async def gmail_get_email(msg_id: str, mark_read: bool = True):
    from app.services.gmail_service import get_email
    try:
        return await _run(lambda: get_email(msg_id, mark_read=mark_read))
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        log.error("gmail_get_email failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/gmail/search")
async def gmail_search(q: str, limit: int = 20, page_token: str = ""):
    from app.services.gmail_service import search_emails
    try:
        return await _run(lambda: search_emails(query=q, max_results=limit))
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        log.error("gmail_search failed", error=str(e))
        raise HTTPException(500, str(e))


@router.post("/gmail/sync")
async def gmail_sync_now():
    """Trigger an incremental sync manually."""
    from app.services.gmail_service import incremental_sync
    try:
        result = await _run(incremental_sync)
        return result
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        log.error("gmail_sync failed", error=str(e))
        raise HTTPException(500, str(e))


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    reply_to_id: str | None = None


@router.post("/gmail/send")
async def gmail_send(body: SendEmailRequest):
    from app.services.gmail_service import send_email
    try:
        result = await _run(lambda: send_email(body.to, body.subject, body.body, body.reply_to_id))
        return result
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        log.error("Failed to send email", error=str(e))
        raise HTTPException(500, str(e))


@router.post("/gmail/email/{msg_id}/trash")
async def gmail_trash(msg_id: str):
    from app.services.gmail_service import trash_email
    try:
        await _run(lambda: trash_email(msg_id))
        return {"ok": True}
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/gmail/email/{msg_id}/archive")
async def gmail_archive(msg_id: str):
    from app.services.gmail_service import archive_email
    try:
        await _run(lambda: archive_email(msg_id))
        return {"ok": True}
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


class MarkEmailRequest(BaseModel):
    read: bool | None = None
    starred: bool | None = None
    important: bool | None = None


@router.post("/gmail/email/{msg_id}/mark")
async def gmail_mark(msg_id: str, body: MarkEmailRequest):
    from app.services.gmail_service import mark_email
    try:
        await _run(lambda: mark_email(msg_id, read=body.read, starred=body.starred, important=body.important))
        return {"ok": True}
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


class ForwardEmailRequest(BaseModel):
    to: str
    note: str = ""


@router.post("/gmail/email/{msg_id}/forward")
async def gmail_forward(msg_id: str, body: ForwardEmailRequest):
    from app.services.gmail_service import forward_email
    try:
        result = await _run(lambda: forward_email(msg_id, body.to, body.note))
        return result
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/gmail/labels")
async def gmail_labels():
    """Return all Gmail labels (Inbox, Sent, Job Applications, etc.)"""
    from app.services.gmail_service import _get_service
    try:
        def _fn():
            svc, _ = _get_service()
            result = svc.users().labels().list(userId="me").execute()
            return [
                {"id": l["id"], "name": l["name"], "type": l.get("type", "user"),
                 "unread": l.get("messagesUnread", 0)}
                for l in result.get("labels", [])
            ]
        labels = await _run(_fn)
        return {"labels": labels}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/gmail/counts")
async def gmail_counts():
    """Unread counts per category — single Labels API call, cached 2 min."""
    from app.services.gmail_service import get_category_counts
    try:
        return await _run(get_category_counts)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        log.error("gmail_counts failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/gmail/jazper-summary")
async def gmail_jazper_summary():
    """Natural-language summary of unread inbox for Jazper to read aloud."""
    from app.services.gmail_service import get_jazper_summary
    try:
        return await _run(get_jazper_summary)
    except RuntimeError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        log.error("jazper_summary failed", error=str(e))
        raise HTTPException(500, str(e))
