"""Small authoritative Office V3 presence websocket (single-process fallback)."""
import asyncio
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
_clients: dict[str, WebSocket] = {}
_positions: dict[str, tuple[float, float, float]] = {}
_lock = asyncio.Lock()
CELL_SIZE = 16.0

def _cell(x: float, z: float) -> tuple[int, int]:
    return int(x // CELL_SIZE), int(z // CELL_SIZE)

def _interested(viewer: str, subject_x: float, subject_z: float) -> bool:
    position = _positions.get(viewer)
    if position is None:
        return True
    viewer_cell, subject_cell = _cell(position[0], position[1]), _cell(subject_x, subject_z)
    return abs(viewer_cell[0] - subject_cell[0]) <= 1 and abs(viewer_cell[1] - subject_cell[1]) <= 1

async def _broadcast(payload: dict, except_id: str | None = None, subject: tuple[float, float] | None = None) -> None:
    raw = json.dumps(payload, separators=(",", ":"))
    dead: list[str] = []
    for person_id, client in list(_clients.items()):
        if person_id == except_id:
            continue
        if subject is not None and not _interested(person_id, subject[0], subject[1]):
            continue
        try:
            await client.send_text(raw)
        except Exception:
            dead.append(person_id)
    for person_id in dead:
        _clients.pop(person_id, None)

@router.websocket("/")
async def office_socket(ws: WebSocket):
    await ws.accept()
    person_id: str | None = None
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 4096:
                await ws.send_json({"type": "error", "code": "message_too_large"})
                continue
            message = json.loads(raw)
            kind = message.get("type")
            if kind == "hello":
                candidate = str(message.get("id", ""))[:80]
                if not candidate:
                    await ws.send_json({"type": "error", "code": "missing_id"})
                    continue
                person_id = candidate
                async with _lock:
                    _clients[person_id] = ws
                    roster = [{"id": key, "x": value[0], "z": value[1], "facing": 0} for key, value in _positions.items()]
                await ws.send_json({"type": "welcome", "self": person_id, "roster": roster})
                await _broadcast({"type": "join", "id": person_id}, person_id)
            elif kind == "move" and person_id:
                x, z, facing = float(message.get("x")), float(message.get("z")), float(message.get("facing", 0))
                now = time.monotonic()
                previous = _positions.get(person_id)
                if previous and now - previous[2] < 0.01:
                    continue
                if previous and ((x - previous[0]) ** 2 + (z - previous[1]) ** 2) ** .5 > 6 * max(now - previous[2], .01) + .1:
                    await ws.send_json({"type": "error", "code": "speed"})
                    continue
                _positions[person_id] = (x, z, now)
                await _broadcast({"type": "pos", "id": person_id, "x": x, "z": z, "facing": facing, "seq": message.get("seq", 0)}, person_id, (x, z))
            elif kind == "cursor" and person_id:
                x, z = float(message.get("x")), float(message.get("z"))
                if not -256 <= x <= 256 or not -256 <= z <= 256:
                    await ws.send_json({"type": "error", "code": "cursor_bounds"})
                    continue
                await _broadcast({"type": "cursor", "id": person_id, "x": x, "z": z}, person_id, (x, z))
            elif kind in {"emote", "status", "say"} and person_id:
                await _broadcast({"type": kind, "id": person_id, "value": message.get("value", "")[:1000]}, person_id)
            else:
                await ws.send_json({"type": "error", "code": "invalid_message"})
    except (WebSocketDisconnect, ValueError, TypeError, json.JSONDecodeError):
        pass
    finally:
        if person_id:
            _clients.pop(person_id, None)
            _positions.pop(person_id, None)
            await _broadcast({"type": "leave", "id": person_id})
