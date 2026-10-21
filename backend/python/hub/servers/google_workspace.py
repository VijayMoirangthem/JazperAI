"""Google Workspace MCP connector (stdio): Gmail, Calendar, Drive, Docs, Sheets - read AND write, on the app's own Google OAuth token
(connect once in the app). No credentials pass through the connector manifest.

Governance: reads are Tier 1, creates/edits are Tier 2 (mcp.write), anything outward-facing or destructive (send mail, share, trash)
is mapped to mcp.admin in hub/presets.py. Errors are returned as readable sentences so a bot can act on them."""
import json
import time

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

READ = ToolAnnotations(readOnlyHint=True)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False)
DANGER = ToolAnnotations(readOnlyHint=False, destructiveHint=True)
mcp = FastMCP("google-workspace")


def _dump(obj) -> str:
    return json.dumps(obj, default=str)[:30000]


def _drive():
    from core.services import drive_service
    return drive_service


# ── Gmail ────────────────────────────────────────────────────────────────────────────────────────
@mcp.tool(annotations=READ)
def gmail_search(query: str, max_results: int = 10) -> str:
    """Search Gmail with Gmail query syntax (e.g. 'from:alice newer_than:7d'). Returns message summaries."""
    from core.services import gmail_service
    return _dump(gmail_service.search_emails(query, max_results=min(max_results, 25)))


@mcp.tool(annotations=READ)
def gmail_read(message_id: str) -> str:
    """Read one Gmail message by id (does not mark it as read)."""
    from core.services import gmail_service
    return _dump(gmail_service.get_email(message_id, mark_read=False))


@mcp.tool(annotations=WRITE)
def gmail_create_draft(to: str, subject: str, body: str, reply_to_id: str = "") -> str:
    """Save an email draft (does not send)."""
    from core.services import gmail_service
    return _dump(gmail_service.create_draft(to, subject, body, reply_to_id=reply_to_id or None))


@mcp.tool(annotations=DANGER)
def gmail_send(to: str, subject: str, body: str, cc: str = "", reply_to_id: str = "") -> str:
    """Send an email now (outward-facing: needs approval)."""
    from core.services import gmail_service
    return _dump(gmail_service.send_email(to, subject, body, reply_to_id=reply_to_id or None, cc=cc or None))


# ── Calendar ─────────────────────────────────────────────────────────────────────────────────────
@mcp.tool(annotations=READ)
def calendar_today() -> str:
    """Today's events on the primary calendar."""
    from core.services import calendar_service
    return _dump(calendar_service.get_today())


@mcp.tool(annotations=READ)
def calendar_range(time_min: str, time_max: str) -> str:
    """Events between two ISO-8601 timestamps on the primary calendar."""
    from core.services import calendar_service
    return _dump(calendar_service.get_events(time_min, time_max))


@mcp.tool(annotations=WRITE)
def calendar_create_event(title: str, start_iso: str, end_iso: str, description: str = "", attendees: str = "", location: str = "") -> str:
    """Create a calendar event (RFC 3339 times, attendees comma-separated emails)."""
    from core.services import calendar_service
    people = [a.strip() for a in attendees.split(",") if a.strip()] or None
    return _dump(calendar_service.create_event(title, start_iso, end_iso, description=description, attendees=people, location=location))


@mcp.tool(annotations=READ)
def server_time() -> str:
    """Current UTC time (useful for building calendar ranges)."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ── Drive: find and read ─────────────────────────────────────────────────────────────────────────
def _safe(fn, *a, **k) -> str:
    try:
        return _dump(fn(*a, **k))
    except RuntimeError as e:
        return _dump({"error": str(e)})


@mcp.tool(annotations=READ)
def drive_list_recent(limit: int = 10, folder_id: str = "", mime_type: str = "") -> str:
    """The most recently modified files in Drive (name, id, modified time, type, link). Optional folder id and mime type filter."""
    return _safe(_drive().list_recent, limit, folder_id or None, mime_type or None)


@mcp.tool(annotations=READ)
def drive_search(text: str, limit: int = 20) -> str:
    """Search Drive by file name or content."""
    return _safe(_drive().search, text, limit)


@mcp.tool(annotations=READ)
def drive_query(q: str, limit: int = 20) -> str:
    """Search Drive with raw query syntax, e.g. "mimeType='application/pdf' and modifiedTime > '2026-01-01T00:00:00'"."""
    return _safe(_drive().raw_query, q, limit)


@mcp.tool(annotations=READ)
def drive_get_file(file_id: str) -> str:
    """Metadata of one file or folder."""
    return _safe(_drive().get_file, file_id)


@mcp.tool(annotations=READ)
def drive_read_file(file_id: str, max_chars: int = 20000) -> str:
    """Read a file as text: Docs/Slides as plain text, Sheets as CSV, text files as-is."""
    return _safe(_drive().read_file, file_id, max_chars)


@mcp.tool(annotations=READ)
def drive_list_permissions(file_id: str) -> str:
    """Who has access to a file."""
    return _safe(_drive().list_permissions, file_id)


# ── Drive: write ─────────────────────────────────────────────────────────────────────────────────
@mcp.tool(annotations=WRITE)
def drive_create_folder(name: str, parent_id: str = "") -> str:
    """Create a folder."""
    return _safe(_drive().create_folder, name, parent_id or None)


@mcp.tool(annotations=WRITE)
def drive_create_file(name: str, text: str, mime_type: str = "text/plain", parent_id: str = "") -> str:
    """Create a text file (txt, md, csv, json, html). Use docs_create for a Google Doc."""
    return _safe(_drive().create_file, name, text, mime_type, parent_id or None)


@mcp.tool(annotations=WRITE)
def drive_update_file_text(file_id: str, text: str, mime_type: str = "text/plain") -> str:
    """Replace the content of a plain file. (For Docs use docs_append/docs_replace, for Sheets sheets_write.)"""
    return _safe(_drive().update_file_text, file_id, text, mime_type)


@mcp.tool(annotations=WRITE)
def drive_rename(file_id: str, new_name: str) -> str:
    """Rename a file or folder."""
    return _safe(_drive().rename_file, file_id, new_name)


@mcp.tool(annotations=WRITE)
def drive_copy(file_id: str, new_name: str = "", parent_id: str = "") -> str:
    """Copy a file."""
    return _safe(_drive().copy_file, file_id, new_name or None, parent_id or None)


@mcp.tool(annotations=WRITE)
def drive_move(file_id: str, new_parent_id: str) -> str:
    """Move a file into another folder."""
    return _safe(_drive().move_file, file_id, new_parent_id)


@mcp.tool(annotations=DANGER)
def drive_trash(file_id: str) -> str:
    """Move a file to the trash (recoverable for 30 days)."""
    return _safe(_drive().trash_file, file_id)


@mcp.tool(annotations=WRITE)
def drive_restore(file_id: str) -> str:
    """Restore a file from the trash."""
    return _safe(_drive().restore_file, file_id)


@mcp.tool(annotations=DANGER)
def drive_share(file_id: str, email: str, role: str = "reader") -> str:
    """Share a file with a person (reader, commenter or writer). Outward-facing: needs approval."""
    return _safe(_drive().share_file, file_id, email, role)


# ── Docs ─────────────────────────────────────────────────────────────────────────────────────────
@mcp.tool(annotations=WRITE)
def docs_create(title: str, text: str = "", parent_id: str = "") -> str:
    """Create a Google Doc with optional starting text."""
    return _safe(_drive().create_doc, title, text, parent_id or None)


@mcp.tool(annotations=READ)
def docs_read(doc_id: str, max_chars: int = 20000) -> str:
    """Read a Google Doc as plain text."""
    return _safe(_drive().docs_read, doc_id, max_chars)


@mcp.tool(annotations=WRITE)
def docs_append(doc_id: str, text: str) -> str:
    """Append text to the end of a Google Doc."""
    return _safe(_drive().docs_append, doc_id, text)


@mcp.tool(annotations=WRITE)
def docs_replace(doc_id: str, find: str, replace: str, match_case: bool = False) -> str:
    """Replace every occurrence of a text in a Google Doc."""
    return _safe(_drive().docs_replace, doc_id, find, replace, match_case)


# ── Sheets ───────────────────────────────────────────────────────────────────────────────────────
@mcp.tool(annotations=WRITE)
def sheets_create(title: str, parent_id: str = "") -> str:
    """Create a Google Sheet."""
    return _safe(_drive().create_sheet, title, parent_id or None)


@mcp.tool(annotations=READ)
def sheets_read(spreadsheet_id: str, range_a1: str) -> str:
    """Read cell values, e.g. range 'Sheet1!A1:D20'."""
    return _safe(_drive().sheets_read, spreadsheet_id, range_a1)


@mcp.tool(annotations=WRITE)
def sheets_write(spreadsheet_id: str, range_a1: str, values_json: str) -> str:
    """Write cell values. values_json is a JSON array of rows, e.g. [["Name","Qty"],["Pens",3]]."""
    return _safe(_drive().sheets_write, spreadsheet_id, range_a1, json.loads(values_json))


@mcp.tool(annotations=WRITE)
def sheets_append(spreadsheet_id: str, range_a1: str, values_json: str) -> str:
    """Append rows after the last used row. values_json is a JSON array of rows."""
    return _safe(_drive().sheets_append, spreadsheet_id, range_a1, json.loads(values_json))


if __name__ == "__main__":
    mcp.run("stdio")
