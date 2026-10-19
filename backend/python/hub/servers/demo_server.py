"""Built-in demo MCP server (stdio) used for tests and as a template connector: one read tool, one write tool, one admin tool."""
import time

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

READ = ToolAnnotations(readOnlyHint=True)

mcp = FastMCP("demo")


@mcp.tool(annotations=READ)
def echo(text: str) -> str:
    """Echo text back (read-only)."""
    return text


@mcp.tool(annotations=READ)
def clock() -> str:
    """Current UTC time (read-only)."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@mcp.tool()
def write_note(title: str, body: str) -> str:
    """Pretend to save a note (write)."""
    return f"saved {title!r} ({len(body)} chars)"


@mcp.tool()
def wipe(target: str) -> str:
    """Dangerous admin operation (must be Tier 3)."""
    return f"wiped {target}"


@mcp.tool()
def crash() -> str:
    """Kills the server process (for crash-recovery tests)."""
    import os
    os._exit(1)


if __name__ == "__main__":
    mcp.run("stdio")
