"""
Google Calendar service — Phase 8B.

Reuses the OAuth token stored by gmail_service (same credentials table,
same token — calendar scope was added alongside Gmail scopes).

Public API:
    get_events(time_min, time_max, max_results)  → list[dict]
    get_today()                                  → list[dict]
    get_week(start_date)                         → list[dict]
    check_free_busy(start_iso, end_iso)          → {"free": bool, "conflicts": list[dict]}
    create_event(title, start_iso, end_iso, ...)  → dict
    format_events_for_context(events)            → str   (LLM-ready text)

All methods raise CalendarNotAuthorized when the stored token lacks calendar scope.
"""
from __future__ import annotations

import datetime
import structlog

log = structlog.get_logger()


class CalendarNotAuthorized(RuntimeError):
    """Raised when calendar scope is missing from the stored token."""


def _get_service():
    """Build an authenticated Google Calendar API service object."""
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from app.services.gmail_service import load_any_token, save_token
    from app.core.config import settings

    email_key, token_data = load_any_token()
    if not token_data:
        raise CalendarNotAuthorized(
            "No Google account connected. Authorise via /api/google/oauth/authorize"
        )

    creds = Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/calendar"],
    )

    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            token_data.update({
                "access_token": creds.token,
                "refresh_token": creds.refresh_token,
                "expiry": creds.expiry.isoformat() if creds.expiry else None,
            })
            save_token(email_key, token_data)
        except Exception as exc:
            raise CalendarNotAuthorized(
                f"Calendar token refresh failed — re-authenticate: {exc}"
            ) from exc

    try:
        return build("calendar", "v3", credentials=creds)
    except Exception as exc:
        # googleapiclient.errors.HttpError 403 = missing scope
        if "403" in str(exc) or "insufficient" in str(exc).lower():
            raise CalendarNotAuthorized(
                "Calendar scope not granted. Please re-authenticate at Settings → Google."
            ) from exc
        raise


def _event_to_dict(event: dict) -> dict:
    """Normalise a Google Calendar event into a simple flat dict."""
    start = event.get("start", {})
    end   = event.get("end", {})
    return {
        "id":          event.get("id", ""),
        "title":       event.get("summary", "(No title)"),
        "start":       start.get("dateTime") or start.get("date", ""),
        "end":         end.get("dateTime")   or end.get("date", ""),
        "location":    event.get("location", ""),
        "description": event.get("description", ""),
        "meet_link":   event.get("hangoutLink", ""),
        "attendees":   [
            a.get("email", "") for a in event.get("attendees", [])
            if not a.get("self", False)
        ],
        "status":      event.get("status", "confirmed"),
        "all_day":     "date" in start and "dateTime" not in start,
    }


def get_events(
    time_min: str,
    time_max: str,
    max_results: int = 20,
    calendar_id: str = "primary",
) -> list[dict]:
    """
    Fetch events between two ISO 8601 timestamps.
    Returns a list of normalised event dicts.
    """
    svc = _get_service()
    try:
        result = (
            svc.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        return [_event_to_dict(e) for e in result.get("items", [])]
    except CalendarNotAuthorized:
        raise
    except Exception as exc:
        if "403" in str(exc) or "insufficient" in str(exc).lower():
            raise CalendarNotAuthorized(
                "Calendar scope not granted. Please re-authenticate at Settings → Google."
            ) from exc
        log.error("calendar: get_events failed", error=str(exc))
        return []


def get_today(calendar_id: str = "primary") -> list[dict]:
    """All events for today (local day in UTC)."""
    now = datetime.datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end   = day_start + datetime.timedelta(days=1)
    return get_events(
        day_start.isoformat() + "Z",
        day_end.isoformat() + "Z",
        calendar_id=calendar_id,
    )


def get_week(
    start_date: str | None = None,
    calendar_id: str = "primary",
) -> list[dict]:
    """
    Events for a 7-day window.
    start_date: ISO date string (YYYY-MM-DD). Defaults to today.
    """
    if start_date:
        try:
            base = datetime.date.fromisoformat(start_date)
        except ValueError:
            base = datetime.date.today()
    else:
        base = datetime.date.today()

    week_start = datetime.datetime(base.year, base.month, base.day, 0, 0, 0)
    week_end   = week_start + datetime.timedelta(days=7)
    return get_events(
        week_start.isoformat() + "Z",
        week_end.isoformat() + "Z",
        max_results=50,
        calendar_id=calendar_id,
    )


def check_free_busy(
    start_iso: str,
    end_iso: str,
    calendar_id: str = "primary",
) -> dict:
    """
    Returns {"free": bool, "conflicts": [{"title": str, "start": str, "end": str}]}.
    Uses the freebusy endpoint — more reliable than scanning individual events.
    """
    svc = _get_service()
    try:
        body = {
            "timeMin": start_iso,
            "timeMax": end_iso,
            "items":   [{"id": calendar_id}],
        }
        result = svc.freebusy().query(body=body).execute()
        busy_slots = result.get("calendars", {}).get(calendar_id, {}).get("busy", [])
        if not busy_slots:
            return {"free": True, "conflicts": []}

        # Fetch the conflicting events for human-readable details
        conflicts = get_events(start_iso, end_iso)
        conflict_summaries = [
            {"title": e["title"], "start": e["start"], "end": e["end"]}
            for e in conflicts
        ]
        return {"free": False, "conflicts": conflict_summaries}
    except CalendarNotAuthorized:
        raise
    except Exception as exc:
        log.error("calendar: free_busy failed", error=str(exc))
        return {"free": True, "conflicts": [], "error": str(exc)}


def create_event(
    title: str,
    start_iso: str,
    end_iso: str,
    description: str = "",
    attendees: list[str] | None = None,
    location: str = "",
    calendar_id: str = "primary",
) -> dict:
    """
    Create a Google Calendar event.
    start_iso / end_iso: RFC 3339 strings (e.g. '2026-07-22T10:00:00+05:30').
    Returns the created event dict or raises on failure.
    """
    svc = _get_service()
    body: dict = {
        "summary":     title,
        "description": description,
        "location":    location,
        "start":       {"dateTime": start_iso, "timeZone": "UTC"},
        "end":         {"dateTime": end_iso,   "timeZone": "UTC"},
    }
    if attendees:
        body["attendees"] = [{"email": a} for a in attendees]

    try:
        created = svc.events().insert(calendarId=calendar_id, body=body).execute()
        return _event_to_dict(created)
    except CalendarNotAuthorized:
        raise
    except Exception as exc:
        if "403" in str(exc) or "insufficient" in str(exc).lower():
            raise CalendarNotAuthorized(
                "Calendar write scope not granted. Please re-authenticate."
            ) from exc
        log.error("calendar: create_event failed", error=str(exc))
        raise


def format_events_for_context(events: list[dict], label: str = "Calendar events") -> str:
    """Convert a list of events into a compact LLM-readable string."""
    if not events:
        return f"[{label}]\nNo events found."

    lines = [f"[{label}]"]
    for e in events:
        start = e["start"]
        # Trim timezone suffix for readability: 2026-07-16T10:00:00+05:30 → 10:00
        try:
            dt = datetime.datetime.fromisoformat(start.replace("Z", "+00:00"))
            time_str = dt.strftime("%a %d %b, %H:%M")
        except Exception:
            time_str = start

        parts = [f"• {time_str} — {e['title']}"]
        if e["location"]:
            parts.append(f"  📍 {e['location']}")
        if e["meet_link"]:
            parts.append(f"  🔗 Google Meet")
        if e["attendees"]:
            parts.append(f"  👥 {', '.join(e['attendees'][:3])}")
        lines.append("\n".join(parts))

    return "\n".join(lines)
