"""Read-through HTTP cache in Redis for the endpoints behind the left-rail panels.

GET responses (200, JSON, small) for the prefixes in TTL are stored for a few seconds and served from Redis on the next request, so opening a panel
does not re-run its database work. Any non-GET request to the same area clears that area's entries, so edits show up immediately. Redis down =
no caching, never an error. Responses carry `x-cache: HIT|MISS`. Pure ASGI: streaming and websocket traffic is untouched.
"""
import json
import time

from core import cache
from memory.redis import layer

# path prefix -> seconds. Longest matching prefix wins.
TTL = {
    "/api/v1/directory": 30, "/api/v1/bots/": 5, "/api/v1/llm/providers": 30, "/api/v1/llm/routing": 30, "/api/v1/finops": 10,
    "/api/v1/mcp-hub/connectors": 5, "/api/v1/mcp-hub/tools": 10, "/api/v1/mcp-hub/presets": 300, "/api/v1/company": 10,
    "/api/v1/system/health": 8, "/api/v1/skills": 5, "/api/v1/workspaces": 10, "/api/v1/voice2/voices": 3600, "/api/v1/devloop": 5,
    "/api/business": 15, "/api/agents/": 10, "/api/company": 10, "/api/model-costs": 15,
}
MAX_BODY = 512_000
STATS = {"hit": 0, "miss": 0, "since": time.time()}


def _ttl(path: str) -> int:
    best = max((p for p in TTL if path.startswith(p)), key=len, default=None)
    return TTL[best] if best else 0


def _area(path: str) -> str:
    return "/".join(path.split("/")[:4])  # /api/v1/llm  or  /api/business


class HttpCacheMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        method, path = scope["method"], scope["path"]
        if method != "GET":
            if method in ("POST", "PUT", "PATCH", "DELETE") and any(path.startswith(p) for p in TTL):
                await self._invalidate(_area(path))
            return await self.app(scope, receive, send)
        ttl = _ttl(path)
        if not ttl:
            return await self.app(scope, receive, send)
        key = cache.k("http", path, scope.get("query_string", b"").decode())
        try:
            hit = await layer.client().get(key)
        except Exception:
            hit = None
        if hit:
            STATS["hit"] += 1
            d = json.loads(hit)
            await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", d["ct"].encode()), (b"x-cache", b"HIT"), (b"content-length", str(len(d["body"].encode())).encode())]})
            return await send({"type": "http.response.body", "body": d["body"].encode()})
        STATS["miss"] += 1
        state = {"status": 0, "ct": "", "chunks": [], "size": 0}

        async def _send(msg):
            if msg["type"] == "http.response.start":
                state["status"] = msg["status"]
                state["ct"] = next((v.decode() for k, v in msg["headers"] if k == b"content-type"), "")
                msg = {**msg, "headers": [*msg["headers"], (b"x-cache", b"MISS")]}
            elif msg["type"] == "http.response.body":
                state["size"] += len(msg.get("body", b""))
                if state["size"] <= MAX_BODY:
                    state["chunks"].append(msg.get("body", b""))
                if not msg.get("more_body") and state["status"] == 200 and "json" in state["ct"] and state["size"] <= MAX_BODY:
                    try:
                        await layer.client().set(key, json.dumps({"ct": state["ct"], "body": b"".join(state["chunks"]).decode()}), ex=ttl)
                    except Exception:
                        pass
            await send(msg)

        await self.app(scope, receive, _send)

    async def _invalidate(self, area: str) -> None:
        try:
            c = layer.client()
            cur = 0
            while True:
                cur, keys = await c.scan(cur, match=cache.k("http", area + "*"), count=200)
                if keys:
                    await c.delete(*keys)
                if cur == 0:
                    return
        except Exception:
            pass
