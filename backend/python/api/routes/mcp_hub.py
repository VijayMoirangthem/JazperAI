"""MCP hub API (aliased /api/v1/mcp-hub)."""
import sys

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from hub.hub import BRIDGE_TOOLS, ToolError, hub

router = APIRouter()


class ConnectorIn(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,40}$")
    name: str
    command: list[str]
    env_secrets: dict[str, str] = {}  # ENV_VAR -> vault entry name (never the secret itself)
    tool_tiers: dict[str, str] = {}  # tool -> HITL action (mcp.read / mcp.write / anything else = Tier 3)
    rate_per_min: int = 60


class FindIn(BaseModel):
    query: str


class CallIn(BaseModel):
    name: str
    arguments: dict = {}
    agent: str = "system"


@router.get("/connectors")
async def connectors():
    await hub.reload()
    return {"connectors": [{"id": m["id"], "name": m["name"], "command": m["command"], "tool_tiers": m["tool_tiers"],
                            "running": bool(hub.conns.get(m["id"]) and hub.conns[m["id"]].alive)} for m in hub.manifests.values()]}


@router.put("/connectors")
async def put_connector(c: ConnectorIn):
    await hub.upsert(c.id, c.name, c.command, c.env_secrets, c.tool_tiers, c.rate_per_min)
    return {"saved": c.id}


@router.post("/connectors/demo")
async def seed_demo():
    await hub.upsert("demo", "Demo connector", [sys.executable, "-m", "hub.servers.demo_server"], tool_tiers={"wipe": "mcp.admin"})
    return {"saved": "demo"}


@router.delete("/connectors/{cid}")
async def delete_connector(cid: str):
    if not await hub.remove(cid):
        raise HTTPException(404, "unknown connector")
    return {"deleted": cid}


@router.get("/tools")
async def tools():
    return {"tools": await hub.catalogue(), "bridge": BRIDGE_TOOLS}


@router.post("/find")
async def find(body: FindIn):
    return {"matches": await hub.find_tool(body.query)}


@router.post("/call")
async def call(body: CallIn):
    try:
        return await hub.use_tool(body.name, body.arguments, body.agent)
    except ToolError as e:
        raise HTTPException(422, str(e))
