"""Remote-access guard (Plan V3 W8). A tunnel (Cloudflare/Tailscale) forwards to this backend from localhost, so "client is loopback" proves nothing.
A request is treated as REMOTE when its Host is not localhost/127.0.0.1, or it carries proxy headers (CF-Connecting-IP, X-Forwarded-For, Forwarded,
CF-Ray). Remote requests may only use /remote/v1/* (and CORS preflight); every other route answers 403, so file access, secrets, system and connector
credential routes can never be reached from outside, whatever the tunnel is configured to forward.
"""
import json

LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}
PROXY_HEADERS = (b"cf-connecting-ip", b"x-forwarded-for", b"forwarded", b"cf-ray", b"x-real-ip", b"cf-access-jwt-assertion")
ALLOWED_PREFIX = "/remote/v1"


def is_remote(scope) -> bool:
    headers = {k.lower(): v for k, v in scope.get("headers", [])}
    host = headers.get(b"host", b"").decode().split(":")[0].lower()
    if host and host not in LOCAL_HOSTS:
        return True
    return any(h in headers for h in PROXY_HEADERS)


class RemoteGuardMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if is_remote(scope) and not path.startswith(ALLOWED_PREFIX) and path not in ("/health", "/health/") and scope.get("method") != "OPTIONS":
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008})
            body = json.dumps({"detail": "not available remotely"}).encode()
            await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            return await send({"type": "http.response.body", "body": body})
        await self.app(scope, receive, send)
