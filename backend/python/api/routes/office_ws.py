"""Small authoritative Office V3 presence websocket (single-process fallback)."""
import asyncio
import json
import math
import time
import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from memory.db import aio
from core.config import settings
from api.routes.people import _auth_key

router = APIRouter()
_clients: dict[str, WebSocket] = {}
_positions: dict[str, tuple[float, float, float, float, str]] = {}
_lock = asyncio.Lock()
CELL_SIZE = 16.0
MAX_COORDINATE = 256.0
VALID_ANIMATIONS = {"idle", "walk", "sit", "typing", "reading", "hand-raise", "pace"}
VALID_STATUSES = {"idle", "away", "walking", "interacting", "working", "planning", "waiting_human", "waiting_tool", "testing", "repairing", "error", "rolled_back", "escalated", "deprecated", "focus", "dnd", "paused", "busy"}
VALID_EMOTES = {"wave", "thumbsup", "clap", "laugh", "question", "heart", "coffee", "thinking", "sleep"}
_navigation_cache: tuple[int, int, set[tuple[int, int]]] | None = None

def _valid_identity(value: str) -> bool:
    return bool(value) and len(value) <= 80 and all(char.isalnum() or char in "._:-" for char in value)

def _valid_coordinate(value: object) -> float | None:
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        return None
    return coordinate if math.isfinite(coordinate) and -MAX_COORDINATE <= coordinate <= MAX_COORDINATE else None

def _valid_facing(value: object) -> float | None:
    facing = _valid_coordinate(value)
    if facing is None: return None
    return math.atan2(math.sin(facing), math.cos(facing))

def _valid_sequence(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 2_147_483_647 else None

def _cell(x: float, z: float) -> tuple[int, int]:
    return int(x // CELL_SIZE), int(z // CELL_SIZE)

def _interested(viewer: str, subject_x: float, subject_z: float) -> bool:
    position = _positions.get(viewer)
    if position is None:
        return True
    viewer_cell, subject_cell = _cell(position[0], position[1]), _cell(subject_x, subject_z)
    return abs(viewer_cell[0] - subject_cell[0]) <= 1 and abs(viewer_cell[1] - subject_cell[1]) <= 1

async def _navigation() -> tuple[int, int, set[tuple[int, int]]] | None:
    global _navigation_cache
    if _navigation_cache is not None: return _navigation_cache
    rows = await aio.fetch("SELECT world FROM shared.office_worlds WHERE active=true LIMIT 1")
    if not rows: return None
    world = rows[0]["world"]
    if isinstance(world, (str, bytes)): world = __import__("json").loads(world)
    size = world.get("size", {}) if isinstance(world, dict) else {}
    width, height = size.get("w"), size.get("h")
    if not isinstance(width, int) or not isinstance(height, int) or width < 1 or height < 1: return None
    blocked: set[tuple[int, int]] = set()
    for wall in world.get("walls", []):
        if not isinstance(wall, dict): continue
        start, end = wall.get("from"), wall.get("to")
        if not (isinstance(start, list) and isinstance(end, list) and len(start) == 2 and len(end) == 2 and all(isinstance(point, int) for point in [*start, *end])): continue
        x, z = start
        target_x, target_z = end
        step_x = 0 if x == target_x else (1 if target_x > x else -1)
        step_z = 0 if z == target_z else (1 if target_z > z else -1)
        while True:
            blocked.add((x, z))
            if (x, z) == (target_x, target_z): break
            x += step_x; z += step_z
        for door in wall.get("doors", []):
            if not isinstance(door, dict) or not isinstance(door.get("at"), list) or len(door["at"]) != 2: continue
            at, door_width = door["at"], door.get("width", 1)
            if not (all(isinstance(point, int) for point in at) and isinstance(door_width, int)): continue
            for offset in range(max(1, door_width)): blocked.discard((at[0] + (offset if step_x else 0), at[1] + (offset if step_z else 0)))
    _navigation_cache = (width, height, blocked)
    return _navigation_cache

async def _walkable(x: float, z: float) -> bool:
    navigation = await _navigation()
    if navigation is None: return False
    width, height, blocked = navigation
    tile = (math.floor(x), math.floor(z))
    return 0 <= tile[0] < width and 0 <= tile[1] < height and tile not in blocked

async def _authenticated_person(token: str) -> str | None:
    """Validate the optional Office-person browser token before it can name presence."""
    try:
        claims = jwt.decode(token, _auth_key(), algorithms=["HS256"])
        person_id = str(claims.get("sub", ""))
        if claims.get("typ") != "office-person" or not _valid_identity(person_id):
            return None
        rows = await aio.fetch("SELECT id FROM shared.office_people WHERE id=$1 AND disabled=false", person_id)
        return person_id if rows else None
    except Exception:
        return None

async def _broadcast(payload: dict, except_id: str | None = None, subject: tuple[float, float] | None = None) -> None:
    raw = json.dumps(payload, separators=(",", ":"))
    dead: list[tuple[str, WebSocket]] = []
    for person_id, client in list(_clients.items()):
        if person_id == except_id:
            continue
        if subject is not None and not _interested(person_id, subject[0], subject[1]):
            continue
        try:
            await client.send_text(raw)
        except Exception:
            dead.append((person_id, client))
    for person_id, client in dead:
        if _clients.get(person_id) is client:
            _clients.pop(person_id, None)

async def _send_to(person_id: str, payload: dict) -> bool:
    client = _clients.get(person_id)
    if client is None:
        return False
    try:
        await client.send_text(json.dumps(payload, separators=(",", ":")))
        return True
    except Exception:
        if _clients.get(person_id) is client:
            _clients.pop(person_id, None)
        return False

async def broadcast_world_change(world_id: str, rev: int, change: dict | None = None) -> None:
    """Notify every connected Office client of a persisted world revision.

    Small, validated object edits may include their complete replacement object so
    connected scenes can apply them without rebuilding the renderer.
    """
    global _navigation_cache
    _navigation_cache = None
    payload = {"type": "world", "world_id": world_id, "rev": rev}
    if change is not None: payload["change"] = change
    await _broadcast(payload)

@router.websocket("/")
async def office_socket(ws: WebSocket, token: str = "", person_token: str = ""):
    if settings.WS_TOKEN and token != settings.WS_TOKEN:
        await ws.close(code=4401)
        return
    authenticated_person = await _authenticated_person(person_token) if person_token else None
    if person_token and not authenticated_person:
        await ws.close(code=4401)
        return
    await ws.accept()
    person_id: str | None = None
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 4096:
                await ws.send_json({"type": "error", "code": "message_too_large"})
                continue
            message = json.loads(raw)
            if not isinstance(message, dict):
                await ws.send_json({"type": "error", "code": "invalid_message"})
                continue
            kind = message.get("type")
            if kind == "hello":
                candidate = str(message.get("id", ""))[:80]
                if not _valid_identity(candidate):
                    await ws.send_json({"type": "error", "code": "missing_id"})
                    continue
                if authenticated_person and candidate != authenticated_person:
                    await ws.send_json({"type": "error", "code": "identity_mismatch"})
                    await ws.close(code=4403)
                    return
                person_id = candidate
                async with _lock:
                    prior = _clients.get(person_id)
                    _clients[person_id] = ws
                    roster = [{"id": key, "x": value[0], "z": value[1], "facing": value[2], "anim": value[4]} for key, value in _positions.items()]
                if prior and prior is not ws:
                    try:
                        await prior.close(code=4001, reason="replaced by a newer Office connection")
                    except Exception:
                        pass
                await ws.send_json({"type": "welcome", "self": person_id, "roster": roster})
                await _broadcast({"type": "join", "id": person_id}, person_id)
            elif kind == "move" and person_id:
                x, z, facing, sequence = _valid_coordinate(message.get("x")), _valid_coordinate(message.get("z")), _valid_facing(message.get("facing", 0)), _valid_sequence(message.get("seq", 0))
                if x is None or z is None or facing is None:
                    await ws.send_json({"type": "error", "code": "position_bounds"})
                    continue
                if sequence is None:
                    await ws.send_json({"type": "error", "code": "sequence"})
                    continue
                try:
                    walkable = await _walkable(x, z)
                except Exception:
                    await ws.send_json({"type": "error", "code": "world_unavailable"})
                    continue
                if not walkable:
                    await ws.send_json({"type": "error", "code": "world_collision"})
                    continue
                animation = str(message.get("anim", "idle"))
                if animation not in VALID_ANIMATIONS:
                    await ws.send_json({"type": "error", "code": "animation"})
                    continue
                now = time.monotonic()
                previous = _positions.get(person_id)
                if previous and now - previous[3] < 0.01:
                    continue
                if previous and ((x - previous[0]) ** 2 + (z - previous[1]) ** 2) ** .5 > 6 * max(now - previous[3], .01) + .1:
                    await ws.send_json({"type": "error", "code": "speed"})
                    continue
                _positions[person_id] = (x, z, facing, now, animation)
                await _broadcast({"type": "pos", "id": person_id, "x": x, "z": z, "facing": facing, "anim": animation, "seq": sequence}, person_id, (x, z))
            elif kind == "cursor" and person_id:
                x, z = _valid_coordinate(message.get("x")), _valid_coordinate(message.get("z"))
                if x is None or z is None:
                    await ws.send_json({"type": "error", "code": "cursor_bounds"})
                    continue
                await _broadcast({"type": "cursor", "id": person_id, "x": x, "z": z}, person_id, (x, z))
            elif kind in {"emote", "status", "say"} and person_id:
                value = str(message.get("value", ""))
                if kind == "status" and value not in VALID_STATUSES:
                    await ws.send_json({"type": "error", "code": "status"})
                    continue
                if kind == "emote" and value not in VALID_EMOTES:
                    await ws.send_json({"type": "error", "code": "emote"})
                    continue
                if kind == "say" and (not value or len(value) > 1000):
                    await ws.send_json({"type": "error", "code": "say"})
                    continue
                position = _positions.get(person_id)
                await _broadcast({"type": kind, "id": person_id, "value": value}, person_id, (position[0], position[1]) if position else None)
            elif kind in {"conv.invite", "conv.invite.response"} and person_id:
                target = str(message.get("to", ""))[:80]
                if not _valid_identity(target) or target == person_id:
                    await ws.send_json({"type": "error", "code": "conversation_target"})
                    continue
                if kind == "conv.invite.response":
                    value = str(message.get("value", ""))
                    if value not in {"accept", "decline"}:
                        await ws.send_json({"type": "error", "code": "conversation_response"})
                        continue
                    payload = {"type": kind, "id": person_id, "to": target, "value": value}
                else:
                    payload = {"type": kind, "id": person_id, "to": target}
                if not await _send_to(target, payload):
                    await ws.send_json({"type": "error", "code": "conversation_offline"})
            else:
                await ws.send_json({"type": "error", "code": "invalid_message"})
    except (WebSocketDisconnect, ValueError, TypeError, json.JSONDecodeError):
        pass
    finally:
        if person_id and _clients.get(person_id) is ws:
            _clients.pop(person_id, None)
            _positions.pop(person_id, None)
            await _broadcast({"type": "leave", "id": person_id})
