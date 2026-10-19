"""Google Workspace MCP connector (stdio): read-only Gmail and Calendar tools built on the app's existing Google services and OAuth
tokens (connect your account once in the app's Google settings). No credentials pass through the connector manifest.
Writes (send mail, create events) are deliberately not exposed yet: they need their own Tier-3 review."""
import json
import time

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

READ = ToolAnnotations(readOnlyHint=True)
mcp = FastMCP("google-workspace")


def _dump(obj) -> str:
    return json.dumps(obj, default=str)[:20000]


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


@mcp.tool(annotations=READ)
def server_time() -> str:
    """Current UTC time (useful for building calendar ranges)."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


if __name__ == "__main__":
    mcp.run("stdio")
