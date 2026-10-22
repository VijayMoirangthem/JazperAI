"""Office V3 world and appearance persistence."""
import json
import re
import time
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from memory.db import aio
from core import audit

router = APIRouter()
ROOT = Path(__file__).resolve().parents[4]
DEFAULT_WORLD = ROOT / "app" / "public" / "office3" / "world.json"
CUSTOM_MODELS = ROOT / "app" / "public" / "office3" / "custom"
_SCHEMA = """
CREATE TABLE IF NOT EXISTS shared.office_worlds (
 id text PRIMARY KEY, world jsonb NOT NULL, rev integer NOT NULL DEFAULT 1,
 active boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared.office_world_snapshots (
 id bigserial PRIMARY KEY, world_id text NOT NULL, rev integer NOT NULL, world jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared.office_appearance (
 slug text PRIMARY KEY, appearance jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared.office_room_locks (
 room_id text PRIMARY KEY, editor text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared.office_minutes (
 id bigserial PRIMARY KEY, room_id text NOT NULL, participants jsonb NOT NULL, duration_seconds integer NOT NULL,
 transcript jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared.office_conversation_messages (
 id bigserial PRIMARY KEY, conversation_id text NOT NULL, participants jsonb NOT NULL, sender text NOT NULL,
 text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
"""
_ready = False

async def _ensure() -> None:
 global _ready
 if _ready: return
 for statement in _SCHEMA.split(";"):
  if statement.strip(): await aio.execute(statement)
 _ready = True

async def _seed() -> None:
 await _ensure()
 row = await aio.fetch("SELECT id FROM shared.office_worlds WHERE active=true LIMIT 1")
 if row: return
 if not DEFAULT_WORLD.exists(): raise HTTPException(500, "default Office 3 world is unavailable")
 world = json.loads(DEFAULT_WORLD.read_text(encoding="utf-8"))
 await aio.execute("INSERT INTO shared.office_worlds(id,world,active) VALUES($1,$2::jsonb,true)", world["id"], json.dumps(world))

class WorldPut(BaseModel):
 world: dict
 rev: int = Field(ge=1)

class AppearancePut(BaseModel):
 appearance: dict

class RoomLockPut(BaseModel):
 editor: str = Field(min_length=1, max_length=80)

class MinutesPut(BaseModel):
 room_id: str = Field(min_length=1, max_length=80)
 participants: list[str] = Field(default_factory=list, max_length=64)
 duration_seconds: int = Field(ge=0, le=86400)
 transcript: list[dict] = Field(default_factory=list, max_length=200)

class WorldClone(BaseModel):
 id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
 name: str = Field(min_length=1, max_length=120)

class ConversationMessagePut(BaseModel):
 participants: list[str] = Field(min_length=2, max_length=16)
 sender: str = Field(min_length=1, max_length=80)
 text: str = Field(min_length=1, max_length=1000)
 role: str = Field(default="founder", max_length=20)

class ConversationModeratePut(BaseModel):
 role: str = Field(min_length=1, max_length=20)

_conversation_rate: dict[str, list[float]] = {}

def _conversation_members(members: list[str]) -> list[str]:
 cleaned = sorted({_safe_slug(member) for member in members})
 if len(cleaned) < 2: raise HTTPException(422, "conversation needs two people")
 return cleaned

def _conversation_id(members: list[str]) -> str:
 return ".".join(members)

def _conversation_rate_ok(sender: str) -> bool:
 now = time.monotonic()
 recent = [stamp for stamp in _conversation_rate.get(sender, []) if now - stamp < 1]
 if len(recent) >= 30: return False
 recent.append(now)
 _conversation_rate[sender] = recent
 return True

def _safe_slug(value: str) -> str:
 if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value): raise HTTPException(422, "invalid person slug")
 return value

def _appearance(value: dict) -> dict:
 encoded = json.dumps(value)
 if len(encoded.encode()) > 4096: raise HTTPException(413, "appearance exceeds 4 KB")
 if value.get("v", 1) != 1: raise HTTPException(422, "appearance version must be 1")
 return value

def _world(value: dict) -> dict:
 if not isinstance(value, dict): raise HTTPException(422, "world must be an object")
 if len(json.dumps(value).encode()) > 2 * 1024 * 1024: raise HTTPException(413, "world exceeds 2 MB")
 if value.get("version") != 3: raise HTTPException(422, "world version must be 3")
 size = value.get("size") if isinstance(value.get("size"), dict) else {}
 width, height = size.get("w"), size.get("h")
 if not isinstance(width, int) or not isinstance(height, int) or not 1 <= width <= 256 or not 1 <= height <= 256: raise HTTPException(422, "world size is invalid")
 rooms = value.get("rooms")
 if not isinstance(rooms, list) or not rooms: raise HTTPException(422, "world needs rooms")
 room_ids: set[str] = set()
 room_rects: list[tuple[str, list[int]]] = []
 for room in rooms:
  if not isinstance(room, dict) or not isinstance(room.get("id"), str) or not room["id"] or room["id"] in room_ids or not isinstance(room.get("label"), str) or not room["label"] or room.get("kind") not in {"work", "meet", "tools", "social", "private", "transit"}: raise HTTPException(422, "room is invalid")
  rect = room.get("rect")
  if not isinstance(rect, list) or len(rect) != 4 or not all(isinstance(item, int) for item in rect) or rect[0] > rect[2] or rect[1] > rect[3] or rect[0] < 0 or rect[1] < 0 or rect[2] >= width or rect[3] >= height: raise HTTPException(422, "room bounds are invalid")
  rules = room.get("rules", {})
  if not isinstance(rules, dict) or ("tooltip" in rules and (not isinstance(rules["tooltip"], str) or len(rules["tooltip"]) > 120)) or ("roles" in rules and (not isinstance(rules["roles"], list) or len(set(rules["roles"])) != len(rules["roles"]) or any(role not in {"founder", "member"} for role in rules["roles"]))) or ("silent" in rules and not isinstance(rules["silent"], bool)) or ("focusable" in rules and not isinstance(rules["focusable"], bool)) or ("locked" in rules and not isinstance(rules["locked"], bool)) or ("capacity" in rules and (not isinstance(rules["capacity"], int) or isinstance(rules["capacity"], bool) or not 0 <= rules["capacity"] <= 256)) or ("ambience" in rules and rules["ambience"] not in {"none", "focus", "social", "meeting"}): raise HTTPException(422, "room rules are invalid")
  room_ids.add(room["id"])
  room_rects.append((room["id"], rect))
 for index, (room_id, rect) in enumerate(room_rects):
  for other_id, other in room_rects[index + 1:]:
   intersects = rect[0] <= other[2] and other[0] <= rect[2] and rect[1] <= other[3] and other[1] <= rect[3]
   contains = rect[0] <= other[0] and rect[1] <= other[1] and rect[2] >= other[2] and rect[3] >= other[3]
   contained_by = other[0] <= rect[0] and other[1] <= rect[1] and other[2] >= rect[2] and other[3] >= rect[3]
   if intersects and not (contains or contained_by): raise HTTPException(422, f"rooms '{room_id}' and '{other_id}' partially overlap")
 def inside(item: dict, label: str) -> None:
  pos = item.get("pos")
  if not isinstance(pos, list) or len(pos) != 2 or not all(isinstance(value, int) for value in pos) or not 0 <= pos[0] < width or not 0 <= pos[1] < height: raise HTTPException(422, f"{label} position is invalid")
 collections: dict[str, list] = {}
 for name in ("objects", "seats", "spots"):
  collection = value.get(name, [])
  if not isinstance(collection, list): raise HTTPException(422, f"{name} must be a list")
  collections[name] = collection
 object_ids: set[str] = set()
 for obj in collections["objects"]:
  if not isinstance(obj, dict) or not isinstance(obj.get("id"), str) or not obj["id"] or obj["id"] in object_ids or not isinstance(obj.get("prefab"), str) or not obj["prefab"]: raise HTTPException(422, "object is invalid")
  object_ids.add(obj["id"])
  inside(obj, "object")
 place_ids: set[str] = set()
 for place in [*collections["seats"], *collections["spots"]]:
  if not isinstance(place, dict) or not isinstance(place.get("id"), str) or not place["id"] or place["id"] in place_ids or place.get("room") not in room_ids: raise HTTPException(422, "place is invalid")
  place_ids.add(place["id"])
  inside(place, "place")
 spawn_points = value.get("spawn")
 if not isinstance(spawn_points, dict) or not spawn_points: raise HTTPException(422, "world needs spawn points")
 for spawn in spawn_points.values():
  if not isinstance(spawn, list) or len(spawn) != 2 or not all(isinstance(item, int) for item in spawn) or not 0 <= spawn[0] < width or not 0 <= spawn[1] < height: raise HTTPException(422, "spawn is invalid")
 return value

@router.post("/models/{slug}")
async def upload_model(slug: str, file: UploadFile = File(...)):
 slug = _safe_slug(slug)
 if not file.filename or not file.filename.lower().endswith(".glb"): raise HTTPException(422, "only .glb models are supported")
 payload = await file.read(8 * 1024 * 1024 + 1)
 if len(payload) > 8 * 1024 * 1024: raise HTTPException(413, "model exceeds 8 MB")
 if payload[:4] != b"glTF": raise HTTPException(422, "invalid GLB signature")
 CUSTOM_MODELS.mkdir(parents=True, exist_ok=True)
 path = CUSTOM_MODELS / f"{slug}.glb"
 path.write_bytes(payload)
 await audit.write("default", "office-model-uploaded", {"slug": slug, "bytes": len(payload)})
 return {"url": f"/office3/custom/{slug}.glb", "bytes": len(payload)}

@router.get("/world")
async def get_world():
 await _seed()
 row = (await aio.fetch("SELECT world,rev FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 try:
  _world(row["world"])
  return {"world": row["world"], "rev": row["rev"]}
 except HTTPException:
  snapshot = await aio.fetch("SELECT world FROM shared.office_world_snapshots WHERE world_id=(SELECT id FROM shared.office_worlds WHERE active=true LIMIT 1) ORDER BY created_at DESC LIMIT 1")
  if not snapshot: raise HTTPException(500, "active Office world is corrupted and has no recovery snapshot")
  recovered = _world(snapshot[0]["world"])
  active = (await aio.fetch("SELECT id,rev FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
  next_rev = active["rev"] + 1
  await aio.execute("UPDATE shared.office_worlds SET world=$1::jsonb,rev=$2,updated_at=now() WHERE id=$3", json.dumps(recovered), next_rev, active["id"])
  await audit.write("default", "office-world-recovered", {"world_id": active["id"], "rev": next_rev})
  return {"world": recovered, "rev": next_rev, "recovered": True}

@router.put("/world")
async def put_world(body: WorldPut, response: Response):
 await _seed()
 body.world = _world(body.world)
 row = (await aio.fetch("SELECT id,rev,world FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 if row["rev"] != body.rev:
  response.status_code = 409
  return {"world": row["world"], "rev": row["rev"]}
 next_rev = row["rev"] + 1
 await aio.execute("UPDATE shared.office_worlds SET world=$1::jsonb,rev=$2,updated_at=now() WHERE id=$3", json.dumps(body.world), next_rev, row["id"])
 await audit.write("default", "office-world-saved", {"world_id": row["id"], "rev": next_rev})
 return {"world": body.world, "rev": next_rev}

@router.get("/worlds")
async def worlds():
 await _seed()
 rows = await aio.fetch("SELECT id,rev,active,updated_at FROM shared.office_worlds ORDER BY id")
 return {"worlds": [dict(row) for row in rows]}

@router.post("/worlds/{world_id}/activate")
async def activate(world_id: str):
 await _ensure()
 rows = await aio.fetch("SELECT id FROM shared.office_worlds WHERE id=$1", world_id)
 if not rows: raise HTTPException(404, "unknown world")
 await aio.execute("UPDATE shared.office_worlds SET active=(id=$1)", world_id)
 await audit.write("default", "office-world-activated", {"world_id": world_id})
 return {"id": world_id, "active": True}

@router.post("/worlds/clone")
async def clone_world(body: WorldClone):
 await _seed()
 exists = await aio.fetch("SELECT id FROM shared.office_worlds WHERE id=$1", body.id)
 if exists: raise HTTPException(409, "world already exists")
 row = (await aio.fetch("SELECT world FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 world = dict(row["world"])
 world["id"], world["name"] = body.id, body.name
 await aio.execute("INSERT INTO shared.office_worlds(id,world,active) VALUES($1,$2::jsonb,false)", body.id, json.dumps(world))
 await audit.write("default", "office-world-cloned", {"world_id": body.id})
 return {"world": world, "rev": 1}

@router.post("/snapshots")
async def snapshot():
 await _seed()
 row = (await aio.fetch("SELECT id,rev,world FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 await aio.execute("INSERT INTO shared.office_world_snapshots(world_id,rev,world) VALUES($1,$2,$3::jsonb)", row["id"], row["rev"], json.dumps(row["world"]))
 await aio.execute("DELETE FROM shared.office_world_snapshots WHERE id IN (SELECT id FROM shared.office_world_snapshots ORDER BY created_at DESC OFFSET 20)")
 return {"world_id": row["id"], "rev": row["rev"]}

@router.get("/snapshots")
async def snapshots():
 await _ensure()
 rows = await aio.fetch("SELECT id,world_id,rev,created_at FROM shared.office_world_snapshots ORDER BY created_at DESC LIMIT 20")
 return {"snapshots": [dict(row) for row in rows]}

@router.get("/room-locks")
async def room_locks():
 await _ensure()
 rows = await aio.fetch("SELECT room_id,editor,updated_at FROM shared.office_room_locks ORDER BY room_id")
 return {"locks": [dict(row) for row in rows]}

@router.post("/rooms/{room_id}/lock")
async def lock_room(room_id: str, body: RoomLockPut):
 await _seed()
 world = (await aio.fetch("SELECT world FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]["world"]
 if room_id not in {room.get("id") for room in world.get("rooms", []) if isinstance(room, dict)}: raise HTTPException(404, "unknown room")
 rows = await aio.fetch("SELECT editor FROM shared.office_room_locks WHERE room_id=$1", room_id)
 if rows and rows[0]["editor"] != body.editor: raise HTTPException(409, "room is being edited")
 await aio.execute("INSERT INTO shared.office_room_locks(room_id,editor) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET editor=excluded.editor,updated_at=now()", room_id, body.editor)
 await audit.write("default", "office-room-locked", {"room": room_id, "editor": body.editor})
 return {"room": room_id, "editor": body.editor}

@router.delete("/rooms/{room_id}/lock")
async def unlock_room(room_id: str, editor: str):
 await _ensure()
 await aio.execute("DELETE FROM shared.office_room_locks WHERE room_id=$1 AND editor=$2", room_id, editor)
 await audit.write("default", "office-room-unlocked", {"room": room_id, "editor": editor})
 return {"room": room_id, "unlocked": True}

@router.get("/conversations")
async def conversation_history(participants: str):
 await _ensure()
 members = _conversation_members(participants.split(","))
 conversation_id = _conversation_id(members)
 await aio.execute("DELETE FROM shared.office_conversation_messages WHERE created_at < now() - interval '30 days'")
 rows = await aio.fetch("SELECT id,sender,text,(extract(epoch FROM created_at)*1000)::bigint AS at FROM shared.office_conversation_messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 100", conversation_id)
 return {"conversation_id": conversation_id, "messages": [dict(row) for row in reversed(rows)]}

@router.post("/conversations")
async def send_conversation_message(body: ConversationMessagePut):
 await _ensure()
 members = _conversation_members(body.participants)
 sender = _safe_slug(body.sender)
 if sender not in members: raise HTTPException(422, "sender must be a conversation participant")
 if not body.text.strip(): raise HTTPException(422, "message is empty")
 if not _conversation_rate_ok(sender): raise HTTPException(429, "message rate limit exceeded")
 conversation_id = _conversation_id(members)
 rows = await aio.fetch("INSERT INTO shared.office_conversation_messages(conversation_id,participants,sender,text) VALUES($1,$2::jsonb,$3,$4) RETURNING id,sender,text,(extract(epoch FROM created_at)*1000)::bigint AS at", conversation_id, json.dumps(members), sender, body.text.strip())
 await audit.write("default", "office-conversation-message", {"conversation_id": conversation_id, "sender": sender})
 return {"conversation_id": conversation_id, "message": dict(rows[0])}

@router.delete("/conversations/{conversation_id}/{message_id}")
async def delete_conversation_message(conversation_id: str, message_id: int, body: ConversationModeratePut):
 await _ensure()
 if body.role not in {"founder", "admin"}: raise HTTPException(403, "moderation permission required")
 rows = await aio.fetch("DELETE FROM shared.office_conversation_messages WHERE id=$1 AND conversation_id=$2 RETURNING id,sender", message_id, conversation_id)
 if not rows: raise HTTPException(404, "message not found")
 await audit.write("default", "office-conversation-message-deleted", {"conversation_id": conversation_id, "message_id": message_id, "sender": rows[0]["sender"], "role": body.role})
 return {"deleted": message_id}

@router.post("/minutes")
async def save_minutes(body: MinutesPut):
 await _ensure()
 rows = await aio.fetch("INSERT INTO shared.office_minutes(room_id,participants,duration_seconds,transcript) VALUES($1,$2::jsonb,$3,$4::jsonb) RETURNING id,created_at", body.room_id, json.dumps(body.participants), body.duration_seconds, json.dumps(body.transcript))
 await audit.write("default", "office-minutes-saved", {"id": rows[0]["id"], "room": body.room_id})
 return {"id": rows[0]["id"], "created_at": rows[0]["created_at"]}

@router.get("/minutes")
async def minutes(room_id: str | None = None):
 await _ensure()
 rows = await aio.fetch("SELECT id,room_id,participants,duration_seconds,transcript,created_at FROM shared.office_minutes WHERE ($1::text IS NULL OR room_id=$1) ORDER BY created_at DESC LIMIT 50", room_id)
 return {"minutes": [dict(row) for row in rows]}

@router.post("/snapshots/{snapshot_id}/restore")
async def restore_snapshot(snapshot_id: int):
 await _seed()
 rows = await aio.fetch("SELECT world FROM shared.office_world_snapshots WHERE id=$1", snapshot_id)
 if not rows: raise HTTPException(404, "snapshot not found")
 active = (await aio.fetch("SELECT id,rev FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 next_rev = active["rev"] + 1
 await aio.execute("UPDATE shared.office_worlds SET world=$1::jsonb,rev=$2,updated_at=now() WHERE id=$3", json.dumps(rows[0]["world"]), next_rev, active["id"])
 await audit.write("default", "office-world-restored", {"snapshot_id": snapshot_id, "rev": next_rev})
 return {"world": rows[0]["world"], "rev": next_rev}

@router.get("/appearance")
async def appearances():
 await _ensure()
 rows = await aio.fetch("SELECT slug,appearance FROM shared.office_appearance ORDER BY slug")
 return {"appearances": {row["slug"]: row["appearance"] for row in rows}}

@router.get("/appearance/{slug}")
async def appearance(slug: str):
 await _ensure()
 rows = await aio.fetch("SELECT appearance FROM shared.office_appearance WHERE slug=$1", slug)
 if not rows: raise HTTPException(404, "appearance not found")
 return rows[0]["appearance"]

@router.put("/appearance/{slug}")
async def save_appearance(slug: str, body: AppearancePut):
 await _ensure()
 value = _appearance(body.appearance)
 await aio.execute("INSERT INTO shared.office_appearance(slug,appearance) VALUES($1,$2::jsonb) ON CONFLICT(slug) DO UPDATE SET appearance=excluded.appearance,updated_at=now()", slug, json.dumps(value))
 await audit.write("default", "office-appearance-saved", {"slug": slug})
 return value
