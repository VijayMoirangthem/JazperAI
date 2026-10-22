"""Google Drive, Docs, Sheets and Slides: full read/write helpers on the app's Google OAuth token.

Every function is synchronous (the MCP server and routes run them in executors), returns plain dicts/lists, and raises a readable
RuntimeError when Google refuses (missing scope, API not enabled in the Google Cloud project, file not found). Output sizes are capped.
"""
from __future__ import annotations

import io

from core.services.gmail_service import get_google_service

FILE_FIELDS = "id,name,mimeType,modifiedTime,createdTime,size,webViewLink,parents,owners(displayName,emailAddress),trashed,shared"
FOLDER = "application/vnd.google-apps.folder"
GDOC = "application/vnd.google-apps.document"
GSHEET = "application/vnd.google-apps.spreadsheet"
GSLIDES = "application/vnd.google-apps.presentation"
MAX_TEXT = 60_000


def _drive():
    return get_google_service("drive", "v3")


def _call(fn):
    """Run a Google API request and turn HttpError into a sentence the bot (and the founder) can act on."""
    try:
        return fn()
    except Exception as e:  # googleapiclient.errors.HttpError and friends
        status = getattr(getattr(e, "resp", None), "status", None)
        msg = str(e)
        if status == 403 and ("insufficient" in msg.lower() or "scope" in msg.lower()):
            raise RuntimeError("Google refused: the connected account has not granted this permission (re-authorise Google with the full scopes).") from e
        if status == 403 and ("has not been used" in msg or "disabled" in msg):
            raise RuntimeError("Google refused: this API is not enabled in the Google Cloud project (enable the Drive/Docs/Sheets/Slides API).") from e
        if status == 404:
            raise RuntimeError("Google says that file or folder was not found (check the id).") from e
        raise RuntimeError(f"Google API error{f' {status}' if status else ''}: {msg[:300]}") from e


def _clean(f: dict) -> dict:
    return {k: v for k, v in f.items() if v is not None}


# ── Drive: find and read ────────────────────────────────────────────────────────────────────────

def list_recent(limit: int = 10, folder_id: str | None = None, mime_type: str | None = None, include_trashed: bool = False) -> list[dict]:
    """Most recently modified files (whole Drive unless folder_id is given)."""
    q = []
    if not include_trashed:
        q.append("trashed = false")
    if folder_id:
        q.append(f"'{folder_id}' in parents")
    if mime_type:
        q.append(f"mimeType = '{mime_type}'")
    res = _call(lambda: _drive().files().list(q=" and ".join(q) or None, orderBy="modifiedTime desc", pageSize=max(1, min(limit, 100)),
                                              fields=f"files({FILE_FIELDS})", supportsAllDrives=True, includeItemsFromAllDrives=True).execute())
    return [_clean(f) for f in res.get("files", [])]


def search(text: str, limit: int = 20) -> list[dict]:
    """Search by name or content. `text` is plain words; quotes are escaped."""
    t = text.replace("\\", "\\\\").replace("'", "\\'")
    res = _call(lambda: _drive().files().list(q=f"(name contains '{t}' or fullText contains '{t}') and trashed = false", orderBy="modifiedTime desc",
                                              pageSize=max(1, min(limit, 100)), fields=f"files({FILE_FIELDS})", supportsAllDrives=True,
                                              includeItemsFromAllDrives=True).execute())
    return [_clean(f) for f in res.get("files", [])]


def raw_query(q: str, limit: int = 20) -> list[dict]:
    """Drive query syntax (e.g. "mimeType='application/pdf' and modifiedTime > '2026-01-01T00:00:00'")."""
    res = _call(lambda: _drive().files().list(q=q, orderBy="modifiedTime desc", pageSize=max(1, min(limit, 100)), fields=f"files({FILE_FIELDS})",
                                              supportsAllDrives=True, includeItemsFromAllDrives=True).execute())
    return [_clean(f) for f in res.get("files", [])]


def get_file(file_id: str) -> dict:
    return _clean(_call(lambda: _drive().files().get(fileId=file_id, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def read_file(file_id: str, max_chars: int = 20_000) -> dict:
    """Text content: Docs/Slides as plain text, Sheets as CSV (first sheet), text files as-is. Binary files return metadata only."""
    meta = get_file(file_id)
    mt = meta.get("mimeType", "")
    d = _drive()
    if mt in (GDOC, GSLIDES):
        data = _call(lambda: d.files().export(fileId=file_id, mimeType="text/plain").execute())
    elif mt == GSHEET:
        data = _call(lambda: d.files().export(fileId=file_id, mimeType="text/csv").execute())
    elif mt.startswith("text/") or mt in ("application/json", "application/xml", "application/javascript"):
        data = _call(lambda: d.files().get_media(fileId=file_id, supportsAllDrives=True).execute())
    else:
        return {**meta, "content": None, "note": f"{mt} is a binary format; only metadata is available (download it or ask for a text export)."}
    text = data.decode("utf-8", "replace") if isinstance(data, bytes) else str(data)
    cap = max(500, min(max_chars, MAX_TEXT))
    return {**meta, "content": text[:cap], "truncated": len(text) > cap, "chars": len(text)}


# ── Drive: write ────────────────────────────────────────────────────────────────────────────────

def create_folder(name: str, parent_id: str | None = None) -> dict:
    body = {"name": name, "mimeType": FOLDER, **({"parents": [parent_id]} if parent_id else {})}
    return _clean(_call(lambda: _drive().files().create(body=body, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def create_file(name: str, text: str, mime_type: str = "text/plain", parent_id: str | None = None) -> dict:
    """New text file (txt, md, csv, json, html...). For a Google Doc use create_doc."""
    from googleapiclient.http import MediaIoBaseUpload
    media = MediaIoBaseUpload(io.BytesIO(text.encode("utf-8")), mimetype=mime_type, resumable=False)
    body = {"name": name, **({"parents": [parent_id]} if parent_id else {})}
    return _clean(_call(lambda: _drive().files().create(body=body, media_body=media, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def update_file_text(file_id: str, text: str, mime_type: str = "text/plain") -> dict:
    """Replace the content of a non-Google file. (Use docs_* for Docs, sheets_* for Sheets.)"""
    from googleapiclient.http import MediaIoBaseUpload
    media = MediaIoBaseUpload(io.BytesIO(text.encode("utf-8")), mimetype=mime_type, resumable=False)
    return _clean(_call(lambda: _drive().files().update(fileId=file_id, media_body=media, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def rename_file(file_id: str, new_name: str) -> dict:
    return _clean(_call(lambda: _drive().files().update(fileId=file_id, body={"name": new_name}, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def copy_file(file_id: str, new_name: str | None = None, parent_id: str | None = None) -> dict:
    body = {**({"name": new_name} if new_name else {}), **({"parents": [parent_id]} if parent_id else {})}
    return _clean(_call(lambda: _drive().files().copy(fileId=file_id, body=body, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def move_file(file_id: str, new_parent_id: str) -> dict:
    cur = _call(lambda: _drive().files().get(fileId=file_id, fields="parents", supportsAllDrives=True).execute())
    old = ",".join(cur.get("parents", []))
    return _clean(_call(lambda: _drive().files().update(fileId=file_id, addParents=new_parent_id, removeParents=old, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def trash_file(file_id: str) -> dict:
    """Move to trash (recoverable for 30 days). Never deletes permanently."""
    return _clean(_call(lambda: _drive().files().update(fileId=file_id, body={"trashed": True}, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def restore_file(file_id: str) -> dict:
    return _clean(_call(lambda: _drive().files().update(fileId=file_id, body={"trashed": False}, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def list_permissions(file_id: str) -> list[dict]:
    res = _call(lambda: _drive().permissions().list(fileId=file_id, fields="permissions(id,type,role,emailAddress,displayName)", supportsAllDrives=True).execute())
    return res.get("permissions", [])


def share_file(file_id: str, email: str, role: str = "reader", notify: bool = True) -> dict:
    """Share with one person. role: reader | commenter | writer."""
    if role not in ("reader", "commenter", "writer"):
        raise RuntimeError("role must be reader, commenter or writer")
    return _call(lambda: _drive().permissions().create(fileId=file_id, body={"type": "user", "role": role, "emailAddress": email},
                                                       sendNotificationEmail=notify, supportsAllDrives=True, fields="id,role,emailAddress").execute())


# ── Docs ────────────────────────────────────────────────────────────────────────────────────────

def create_doc(title: str, text: str = "", parent_id: str | None = None) -> dict:
    body = {"name": title, "mimeType": GDOC, **({"parents": [parent_id]} if parent_id else {})}
    f = _clean(_call(lambda: _drive().files().create(body=body, fields=FILE_FIELDS, supportsAllDrives=True).execute()))
    if text:
        docs_append(f["id"], text)
    return f


def docs_read(doc_id: str, max_chars: int = 20_000) -> dict:
    return read_file(doc_id, max_chars)


def docs_append(doc_id: str, text: str) -> dict:
    d = get_google_service("docs", "v1")
    doc = _call(lambda: d.documents().get(documentId=doc_id, fields="body(content(endIndex))").execute())
    end = max(1, doc["body"]["content"][-1]["endIndex"] - 1)
    _call(lambda: d.documents().batchUpdate(documentId=doc_id, body={"requests": [{"insertText": {"location": {"index": end}, "text": text}}]}).execute())
    return {"id": doc_id, "appended_chars": len(text)}


def docs_replace(doc_id: str, find: str, replace: str, match_case: bool = False) -> dict:
    d = get_google_service("docs", "v1")
    r = _call(lambda: d.documents().batchUpdate(documentId=doc_id, body={"requests": [{"replaceAllText": {
        "containsText": {"text": find, "matchCase": match_case}, "replaceText": replace}}]}).execute())
    return {"id": doc_id, "replaced": r["replies"][0].get("replaceAllText", {}).get("occurrencesChanged", 0)}


# ── Sheets ──────────────────────────────────────────────────────────────────────────────────────

def create_sheet(title: str, parent_id: str | None = None) -> dict:
    body = {"name": title, "mimeType": GSHEET, **({"parents": [parent_id]} if parent_id else {})}
    return _clean(_call(lambda: _drive().files().create(body=body, fields=FILE_FIELDS, supportsAllDrives=True).execute()))


def sheets_read(spreadsheet_id: str, range_a1: str) -> dict:
    s = get_google_service("sheets", "v4")
    r = _call(lambda: s.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=range_a1).execute())
    return {"range": r.get("range"), "values": r.get("values", [])[:2000]}


def sheets_write(spreadsheet_id: str, range_a1: str, values: list[list]) -> dict:
    s = get_google_service("sheets", "v4")
    r = _call(lambda: s.spreadsheets().values().update(spreadsheetId=spreadsheet_id, range=range_a1, valueInputOption="USER_ENTERED", body={"values": values}).execute())
    return {"updated_cells": r.get("updatedCells", 0), "range": r.get("updatedRange")}


def sheets_append(spreadsheet_id: str, range_a1: str, values: list[list]) -> dict:
    s = get_google_service("sheets", "v4")
    r = _call(lambda: s.spreadsheets().values().append(spreadsheetId=spreadsheet_id, range=range_a1, valueInputOption="USER_ENTERED", insertDataOption="INSERT_ROWS",
                                                       body={"values": values}).execute())
    return {"updated_cells": r.get("updates", {}).get("updatedCells", 0), "range": r.get("updates", {}).get("updatedRange")}


# ── Viewing: bytes for the in-app file viewer ───────────────────────────────────────────────────

CACHE_DIR = None  # set lazily to storage/drive_cache
MAX_VIEW_BYTES = 200 * 1024 * 1024
EXPORT = {GDOC: ("text/html", ".html"), GSHEET: ("text/csv", ".csv"), GSLIDES: ("application/pdf", ".pdf")}


def view_file(file_id: str, mode: str = "auto"):
    """Returns (path, content_type, meta). Google files are exported (Doc -> html, Sheet -> csv, Slides -> pdf; mode=pdf forces pdf), other files downloaded.
    The result is cached on disk per (id, modified time) so audio/video can be served with Range requests."""
    import re
    from pathlib import Path

    from googleapiclient.http import MediaIoBaseDownload
    global CACHE_DIR
    if CACHE_DIR is None:
        CACHE_DIR = Path(__file__).resolve().parents[3] / "storage" / "drive_cache"
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
    meta = get_file(file_id)
    mt = meta.get("mimeType", "")
    size = int(meta.get("size") or 0)
    if size > MAX_VIEW_BYTES:
        raise RuntimeError(f"That file is {size // 1_000_000} MB; the viewer opens files up to {MAX_VIEW_BYTES // 1_000_000} MB.")
    exp = ("application/pdf", ".pdf") if (mode == "pdf" and mt in EXPORT) else EXPORT.get(mt)
    ctype, ext = exp if exp else (mt or "application/octet-stream", "")
    key = re.sub(r"[^A-Za-z0-9_-]", "", file_id) + "-" + re.sub(r"[^0-9]", "", str(meta.get("modifiedTime", ""))) + ext
    path = CACHE_DIR / key
    if not path.exists():
        d = _drive()
        req = d.files().export_media(fileId=file_id, mimeType=ctype) if exp else d.files().get_media(fileId=file_id, supportsAllDrives=True)
        tmp = path.with_suffix(path.suffix + ".part")
        with open(tmp, "wb") as fh:
            dl = MediaIoBaseDownload(fh, req, chunksize=8 * 1024 * 1024)
            done = False
            while not done:
                _, done = _call(lambda: dl.next_chunk())
        tmp.replace(path)
    return path, ctype, meta
