"""One-click connector presets. Secrets are referenced by vault name (set them in System -> Secrets); tool tiers decide approval."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
NPX = "npx.cmd" if sys.platform == "win32" else "npx"

PRESETS: dict[str, dict] = {
    "github": {
        "name": "GitHub (official MCP server)",
        "command": [NPX, "-y", "@modelcontextprotocol/server-github"],
        "env_secrets": {"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_TOKEN"},
        "needs": "Set GITHUB_TOKEN in System -> Secrets (a fine-grained personal access token).",
        "tool_tiers": {**{t: "mcp.read" for t in ("search_repositories", "get_file_contents", "list_commits", "list_issues", "search_code", "search_issues", "search_users", "get_issue", "get_pull_request", "list_pull_requests", "get_pull_request_files", "get_pull_request_status", "get_pull_request_comments", "get_pull_request_reviews")},
                       # reads default to Tier 1 via the server's own read-only hints; writes need notification, merging is Tier 3
            "create_branch": "mcp.write", "create_or_update_file": "mcp.write", "push_files": "mcp.write", "create_issue": "mcp.write",
            "create_pull_request": "mcp.write", "add_issue_comment": "mcp.write", "update_issue": "mcp.write", "fork_repository": "mcp.write",
            "merge_pull_request": "mcp.admin"},

    },
    "filesystem": {
        "name": "Project files (official MCP server, project root only)",
        "command": [NPX, "-y", "@modelcontextprotocol/server-filesystem", str(ROOT)],
        "env_secrets": {}, "needs": "",
        "tool_tiers": {"write_file": "mcp.write", "edit_file": "mcp.write", "create_directory": "mcp.write", "move_file": "mcp.write"},
    },
    "memory": {
        "name": "Knowledge graph memory (official MCP server)",
        "command": [NPX, "-y", "@modelcontextprotocol/server-memory"], "env_secrets": {}, "needs": "", "tool_tiers": {},
    },
    "google-workspace": {
        "name": "Google Workspace (Gmail, Calendar, Drive, Docs, Sheets - read and write)",
        "command": [sys.executable, "-m", "hub.servers.google_workspace"], "env_secrets": {},
        "needs": "Connect your Google account in the app's Google settings (OAuth) once.",
        # reads default to Tier 1, creates/edits to Tier 2 (mcp.write); outward-facing or destructive actions are Tier 3
        "tool_tiers": {"gmail_send": "mcp.admin", "drive_share": "mcp.admin", "drive_trash": "mcp.admin"},
    },
}
