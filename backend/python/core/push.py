"""Phone push through the Expo push service (Plan V3 W8/W10). Only a generic title and a short label are sent; the app fetches details after opening.
Tokens come from shared.devices (paired, not revoked). Never raises."""
import httpx
import structlog

from memory.db import aio

log = structlog.get_logger()
EXPO_URL = "https://exp.host/--/api/v2/push/send"


async def send(title: str, body: str, data: dict | None = None, channel: str = "general") -> int:
    rows = await aio.fetch("SELECT push_token FROM shared.devices WHERE NOT revoked AND push_token LIKE 'ExponentPushToken%'")
    if not rows:
        return 0
    msgs = [{"to": r["push_token"], "title": title[:60], "body": body[:100], "data": data or {}, "channelId": "approvals" if (data or {}).get("type") == "approval" else channel, "sound": "default"} for r in rows]
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(EXPO_URL, json=msgs)
            return len(msgs) if r.status_code == 200 else 0
    except Exception as e:
        log.warning("push failed", error=str(e)[:100])
        return 0
