from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json
import structlog

router = APIRouter()
log = structlog.get_logger()

_clients: list[WebSocket] = []


async def broadcast(event: str, payload: dict):
    message = json.dumps({"event": event, "payload": payload})
    dead = []
    for client in list(_clients):
        try:
            await client.send_text(message)
        except Exception:
            dead.append(client)
    for client in dead:
        try:
            _clients.remove(client)
        except ValueError:
            pass


def client_count() -> int:
    return len(_clients)


@router.websocket("/")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _clients.append(ws)
    client_id = id(ws)
    log.info("WebSocket client connected", client_id=client_id)
    await ws.send_text(json.dumps({"event": "CONNECTED", "clientId": str(client_id)}))

    try:
        while True:
            data = await ws.receive_text()
            log.info("WS message received", data=data)
            await ws.send_text(json.dumps({"event": "ACK", "data": data}))
    except WebSocketDisconnect:
        try:
            _clients.remove(ws)
        except ValueError:
            pass
        log.info("WebSocket client disconnected", client_id=client_id)
