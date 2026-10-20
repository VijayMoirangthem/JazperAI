"""MCP hub (spec §12/§14): connector supervisor + tool bridge.

Agents see two meta-tools instead of the whole catalogue (pattern: OpenMausBot agents-tool-bridge):
  find_tool(query)            -> best matches with full input schemas
  use_tool(name, arguments)   -> runs one tool through validation, tier gating, rate limiting, audit
Tool tiers come from the connector manifest (tool -> HITL action); unlisted tools default to mcp.read when the server marks them
read-only, else mcp.write. Anything mapped to an unknown action is Tier 3 (default-deny).
"""
import asyncio
import hashlib
import json
import time

import structlog

from core import audit, hitl
from core.telemetry import span
from hub.connection import Connection, ConnectionError_
from memory.db import aio

log = structlog.get_logger()


class ToolError(Exception):
    pass


class Bucket:
    def __init__(self, per_min: int):
        self.cap, self.tokens, self.t = float(per_min), float(per_min), time.monotonic()

    def take(self) -> bool:
        now = time.monotonic()
        self.tokens = min(self.cap, self.tokens + (now - self.t) * self.cap / 60)
        self.t = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


class Hub:
    def __init__(self):
        self.manifests: dict[str, dict] = {}
        self.conns: dict[str, Connection] = {}
        self.buckets: dict[str, Bucket] = {}

    async def reload(self) -> None:
        rows = await aio.fetch("SELECT * FROM shared.mcp_connectors WHERE enabled")
        self.manifests = {r["id"]: {**dict(r), "command": json.loads(r["command"]), "env_secrets": json.loads(r["env_secrets"]),
                                    "tool_tiers": json.loads(r["tool_tiers"])} for r in rows}
        for cid in [c for c in self.conns if c not in self.manifests]:  # removed/disabled connector: its tools vanish immediately
            await asyncio.to_thread(self.conns.pop(cid).stop)

    async def upsert(self, cid: str, name: str, command: list[str], env_secrets: dict | None = None, tool_tiers: dict | None = None,
                     rate_per_min: int = 60) -> None:
        await aio.execute(
            """INSERT INTO shared.mcp_connectors (id, name, command, env_secrets, tool_tiers, rate_per_min) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6)
               ON CONFLICT (id) DO UPDATE SET name=$2, command=$3::jsonb, env_secrets=$4::jsonb, tool_tiers=$5::jsonb, rate_per_min=$6, enabled=true""",
            cid, name, json.dumps(command), json.dumps(env_secrets or {}), json.dumps(tool_tiers or {}), rate_per_min)
        old = self.conns.pop(cid, None)
        if old:
            await asyncio.to_thread(old.stop)
        await self.reload()

    async def remove(self, cid: str) -> bool:
        n = await aio.execute("DELETE FROM shared.mcp_connectors WHERE id=$1", cid)
        await self.reload()
        return not n.endswith(" 0")

    def _env(self, m: dict) -> dict[str, str]:
        from core import vault
        out = {}
        for env, secret in m["env_secrets"].items():
            v = vault.get(secret)
            if v:
                out[env] = v
        return out

    async def ensure(self, cid: str) -> Connection:
        m = self.manifests.get(cid)
        if m is None:
            raise ToolError(f"unknown connector {cid}")
        c = self.conns.get(cid)
        if c is None or not c.alive:
            if c:
                await asyncio.to_thread(c.stop)
            c = Connection(cid, m["command"], self._env(m))
            try:
                await asyncio.to_thread(c.start)
            except ConnectionError_ as e:
                raise ToolError(f"connector {cid} is DEGRADED: {e}") from e
            self.conns[cid] = c
        return c

    async def catalogue(self) -> list[dict]:
        out = []
        for cid, m in self.manifests.items():
            try:
                conn = await self.ensure(cid)
            except ToolError as e:
                log.warning("connector unavailable", id=cid, error=str(e)[:120])
                continue
            for t in conn.tools:
                out.append({"name": f"{cid}.{t['name']}", "connector": cid, "tool": t["name"], "description": t["description"], "schema": t["schema"],
                            "action": m["tool_tiers"].get(t["name"]) or ("mcp.read" if t["read_only"] else "mcp.write")})
        return out

    async def find_tool(self, query: str, k: int = 3) -> list[dict]:
        words = {w for w in query.lower().replace("_", " ").replace(".", " ").split() if len(w) > 2}
        scored = []
        for t in await self.catalogue():
            hay = f"{t['name']} {t['description']}".lower().replace("_", " ").replace(".", " ")
            s = sum(w in hay for w in words)
            if s:
                scored.append((s, t))
        scored.sort(key=lambda x: -x[0])
        return [{**t, "tier": hitl.tier_of(t["action"])} for _, t in scored[:k]]

    async def use_tool(self, name: str, arguments: dict, agent: str = "system", gate_ttl_s: float = hitl.DEFAULT_TTL_S, taint: bool = False, note: str = "") -> dict:
        tool = next((t for t in await self.catalogue() if t["name"] == name), None)
        if tool is None:
            raise ToolError(f"unknown tool {name}")
        from jsonschema import Draft7Validator  # lazy: ~2.5 s import
        errors = [e.message for e in Draft7Validator(tool["schema"]).iter_errors(arguments)]
        if errors:
            raise ToolError("invalid arguments: " + "; ".join(errors[:3]))
        m = self.manifests[tool["connector"]]
        if not self.buckets.setdefault(tool["connector"], Bucket(m["rate_per_min"])).take():
            raise ToolError("rate limit exceeded for connector " + tool["connector"])
        tier = hitl.tier_of(tool["action"])
        # a tainted request (untrusted content in context) may not write silently: writes become Tier 3, reads stay as they are
        allowed = await hitl.gate(tool["action"], f"{name} {json.dumps(arguments)[:300]}{note}", agent, ttl_s=gate_ttl_s, min_tier=3 if taint and tier > 1 else 0)
        digest = hashlib.sha256(json.dumps(arguments, sort_keys=True).encode()).hexdigest()
        meta = {"tool": name, "args_sha256": digest, "agent": agent, "tier": tier}
        if not allowed:
            await audit.write("create_origins", "mcp-call", {**meta, "status": "denied"})
            return {"blocked": True, "reason": f"Tier {tier} action {tool['action']} was not approved"}
        last = None
        for attempt in (1, 2):  # one automatic restart when the connector died
            try:
                conn = await self.ensure(tool["connector"])
                with span("tool.call", tool=name, tier=tier, agent=agent):
                    res = await asyncio.to_thread(conn.call, tool["tool"], arguments)
                await audit.write("create_origins", "mcp-call", {**meta, "status": "error" if res["is_error"] else "ok", "restarted": attempt == 2})
                return {"blocked": False, **res}
            except (ConnectionError_, ToolError) as e:
                last = e
                bad = self.conns.pop(tool["connector"], None)
                if bad:
                    await asyncio.to_thread(bad.stop)
        await audit.write("create_origins", "mcp-call", {**meta, "status": "degraded"})
        raise ToolError(f"connector {tool['connector']} is DEGRADED: {last}")

    async def shutdown(self) -> None:
        for c in list(self.conns.values()):
            await asyncio.to_thread(c.stop)
        self.conns.clear()


hub = Hub()

BRIDGE_TOOLS = [
    {"name": "find_tool", "description": "Search the connector tool catalogue; returns names, descriptions and input schemas.",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "use_tool", "description": "Run a catalogue tool by name with arguments (validated, tier-gated, audited).",
     "input_schema": {"type": "object", "properties": {"name": {"type": "string"}, "arguments": {"type": "object"}}, "required": ["name"]}},
]
