"""Switch Google APIs on for the app's own Google Cloud project, automatically (Service Usage API), so the founder never has to open the console.

Needs the `cloud-platform` scope on the stored token (one extra approval) and that the signed-in account owns the project (it created the OAuth client).
The project number is the first part of the OAuth client id.
"""
from __future__ import annotations

import time

from core.config import settings
from core.services.gmail_service import get_google_service

# everything the Google Workspace connector can use
WORKSPACE_APIS = ["drive.googleapis.com", "docs.googleapis.com", "sheets.googleapis.com", "slides.googleapis.com", "gmail.googleapis.com", "calendar-json.googleapis.com"]


def project_number() -> str:
    return (settings.GOOGLE_CLIENT_ID or "").split("-")[0]


def enable_apis(services: list[str] | None = None, wait_s: int = 40) -> dict:
    """batchEnable the given services and wait for the operation. Raises RuntimeError with a readable reason."""
    num = project_number()
    if not num.isdigit():
        raise RuntimeError("Cannot tell the Google Cloud project from GOOGLE_CLIENT_ID.")
    ids = services or WORKSPACE_APIS
    su = get_google_service("serviceusage", "v1")
    try:
        op = su.services().batchEnable(parent=f"projects/{num}", body={"serviceIds": ids}).execute()
        t0 = time.monotonic()
        while not op.get("done") and time.monotonic() - t0 < wait_s:
            time.sleep(2)
            op = su.operations().get(name=op["name"]).execute()
        if op.get("error"):
            raise RuntimeError(str(op["error"].get("message", op["error"]))[:200])
        return {"project": num, "enabled": ids, "done": bool(op.get("done"))}
    except RuntimeError:
        raise
    except Exception as e:  # googleapiclient HttpError
        status = getattr(getattr(e, "resp", None), "status", None)
        if status == 403:
            raise RuntimeError("Google refused to switch the APIs on: the signed-in account is not an owner of the Google Cloud project, or the cloud-platform permission is missing.") from e
        raise RuntimeError(f"Google could not enable the APIs ({status}): {str(e)[:160]}") from e
