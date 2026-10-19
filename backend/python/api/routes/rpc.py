"""JSON-RPC 2.0 event socket at /ws/rpc. Methods: subscribe{topics,since}, unsubscribe, ping.
Server notifications use the topic name as method. Auth: ?token= must equal WS_TOKEN when that setting is non-empty.
Legacy /ws/ stays untouched (frontend shim until P3)."""
import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.config import settings
from core.contracts import TOPICS
from core.eventbus import bus

router = APIRouter()
HEARTBEAT_S = 15


def _res(id_, result=None, error=None) -> str:
    body = {"jsonrpc": "2.0", "id": id_}
    body.update({"error": error} if error else {"result": result})
    return json.dumps(body)


@router.websocket("/rpc")
async def rpc(ws: WebSocket, token: str = ""):
    if settings.WS_TOKEN and token != settings.WS_TOKEN:
        await ws.close(code=4401)
        return
    await ws.accept()
    sub = None
    pump: asyncio.Task | None = None

    async def pump_events(s):
        while True:
            try:
                env = await asyncio.wait_for(s.q.get(), HEARTBEAT_S)
                await ws.send_text(env.model_dump_json())
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({"jsonrpc": "2.0", "method": "heartbeat", "params": {}}))
            if s.dropped:
                await ws.send_text(json.dumps({"jsonrpc": "2.0", "method": "overflow", "params": {}}))
                return

    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
                method, params, id_ = msg["method"], msg.get("params") or {}, msg.get("id")
            except (ValueError, KeyError, TypeError):
                await ws.send_text(_res(None, error={"code": -32700, "message": "parse error"}))
                continue
            if method == "ping":
                await ws.send_text(_res(id_, "pong"))
            elif method == "subscribe":
                topics = set(params.get("topics") or [])
                if not topics or not topics <= set(TOPICS):
                    await ws.send_text(_res(id_, error={"code": -32602, "message": f"topics must be within {list(TOPICS)}"}))
                    continue
                if sub:
                    bus.unsubscribe(sub)
                    pump.cancel()
                sub = bus.subscribe(topics, params.get("since"))
                pump = asyncio.create_task(pump_events(sub))
                await ws.send_text(_res(id_, {"subscribed": sorted(topics)}))
            elif method == "unsubscribe":
                if sub:
                    bus.unsubscribe(sub)
                    pump.cancel()
                    sub = None
                await ws.send_text(_res(id_, {"ok": True}))
            else:
                await ws.send_text(_res(id_, error={"code": -32601, "message": "method not found"}))
    except WebSocketDisconnect:
        pass
    finally:
        if sub:
            bus.unsubscribe(sub)
        if pump:
            pump.cancel()
