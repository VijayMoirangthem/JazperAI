"""Office V3 world and appearance persistence."""
import json
import math
import re
import time
from pathlib import Path
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from memory.db import aio
from core import audit
from core.config import settings
from .office_ws import broadcast_world_change
from .people import _office_admin, _office_member

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
 text text NOT NULL, private_room boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared.office_conversation_reports (
 id bigserial PRIMARY KEY, conversation_id text NOT NULL, message_id bigint NOT NULL, reporter text NOT NULL,
 reason text NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared.office_person_profiles (
 slug text PRIMARY KEY, founder_note text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '', bio text NOT NULL DEFAULT '', timezone text NOT NULL DEFAULT '', birthday text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared.office_agent_controls (
 slug text PRIMARY KEY, paused boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE shared.office_conversation_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE shared.office_conversation_messages ADD COLUMN IF NOT EXISTS private_room boolean NOT NULL DEFAULT false;
ALTER TABLE shared.office_person_profiles ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE shared.office_person_profiles ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
ALTER TABLE shared.office_person_profiles ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT '';
ALTER TABLE shared.office_person_profiles ADD COLUMN IF NOT EXISTS birthday text NOT NULL DEFAULT '';
"""
_SCHEMA_MIGRATIONS: tuple[tuple[int, str], ...] = (
 (1, _SCHEMA),
 (2, "ALTER TABLE shared.office_conversation_messages ADD COLUMN IF NOT EXISTS private_room boolean NOT NULL DEFAULT false;"),
 (3, "CREATE TABLE IF NOT EXISTS shared.office_agent_controls (slug text PRIMARY KEY, paused boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());"),
)
_ready = False

async def _ensure() -> None:
 global _ready
 if _ready: return
 await aio.execute("CREATE TABLE IF NOT EXISTS shared.office_schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
 applied = {row["version"] for row in await aio.fetch("SELECT version FROM shared.office_schema_migrations")}
 for version, migration in _SCHEMA_MIGRATIONS:
  if version in applied: continue
  for statement in migration.split(";"):
   if statement.strip(): await aio.execute(statement)
  await aio.execute("INSERT INTO shared.office_schema_migrations(version) VALUES($1) ON CONFLICT(version) DO NOTHING", version)
 _ready = True

async def _seed() -> None:
 await _ensure()
 row = await aio.fetch("SELECT id FROM shared.office_worlds WHERE active=true LIMIT 1")
 if row: return
 if not DEFAULT_WORLD.exists(): raise HTTPException(500, "default Office 3 world is unavailable")
 world = json.loads(DEFAULT_WORLD.read_text(encoding="utf-8"))
 await aio.execute("INSERT INTO shared.office_worlds(id,world,active) VALUES($1,$2::jsonb,true)", world["id"], json.dumps(world))

async def _snapshot_before_daily_mutation(world_id: str, rev: int, world: dict) -> bool:
 """Keep the last known-good world before the first write in each 24-hour window."""
 rows = await aio.fetch("SELECT id FROM shared.office_world_snapshots WHERE world_id=$1 AND created_at >= now() - interval '24 hours' LIMIT 1", world_id)
 if rows: return False
 await aio.execute("INSERT INTO shared.office_world_snapshots(world_id,rev,world) VALUES($1,$2,$3::jsonb)", world_id, rev, json.dumps(world))
 await aio.execute("DELETE FROM shared.office_world_snapshots WHERE id IN (SELECT id FROM shared.office_world_snapshots WHERE world_id=$1 ORDER BY created_at DESC OFFSET 20)", world_id)
 await audit.write("default", "office-world-auto-snapshotted", {"world_id": world_id, "rev": rev})
 return True

class WorldPut(BaseModel):
 world: dict
 rev: int = Field(ge=1)

class WorldObjectPatch(BaseModel):
 pos: list[int] | None = Field(default=None, min_length=2, max_length=2)
 rot: float | None = None
 scale: float | None = Field(default=None, ge=.1, le=8)

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
 private_room: bool = False
 role: str = Field(default="founder", max_length=20)

class ConversationModeratePut(BaseModel):
 role: str = Field(min_length=1, max_length=20)

class ConversationReportPut(BaseModel):
 reporter: str = Field(min_length=1, max_length=80)
 reason: str = Field(min_length=1, max_length=500)

class ConversationTypingPut(BaseModel):
 participants: list[str] = Field(min_length=2, max_length=16)
 sender: str = Field(min_length=1, max_length=80)
 active: bool

class PersonProfilePut(BaseModel):
 founder_note: str = Field(default="", max_length=500)
 title: str = Field(default="", max_length=100)
 bio: str = Field(default="", max_length=160)
 timezone: str = Field(default="", max_length=80)
 birthday: str = Field(default="", max_length=5)

class AgentControlPut(BaseModel):
 paused: bool

class ConversationReportResolvePut(BaseModel):
 moderator: str = Field(min_length=1, max_length=80)
 status: str = Field(pattern=r"^(reviewed|dismissed)$")

_conversation_rate: dict[str, list[float]] = {}
_conversation_typing: dict[str, dict[str, float]] = {}

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

def _active_typists(conversation_id: str) -> list[str]:
 now = time.monotonic()
 active = {sender: until for sender, until in _conversation_typing.get(conversation_id, {}).items() if until > now}
 if active: _conversation_typing[conversation_id] = active
 else: _conversation_typing.pop(conversation_id, None)
 return sorted(active)

def _authorize_conversation(actor: dict, members: list[str], sender: str | None = None) -> None:
 if not settings.OFFICE_AUTH_REQUIRED: return
 if actor["id"] not in members and actor["role"] not in {"founder", "admin"}:
  raise HTTPException(403, "Office conversation participant required")
 if sender and actor["role"] not in {"founder", "admin"} and actor["id"] != sender:
  raise HTTPException(403, "Office sender identity does not match session")

def _authorize_conversation_person(actor: dict, person_id: str) -> None:
 if settings.OFFICE_AUTH_REQUIRED and actor["role"] not in {"founder", "admin"} and actor["id"] != person_id:
  raise HTTPException(403, "Office conversation owner or administrator required")

def _safe_slug(value: str) -> str:
 if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value): raise HTTPException(422, "invalid person slug")
 return value

def _appearance(value: dict) -> dict:
 encoded = json.dumps(value)
 if len(encoded.encode()) > 4096: raise HTTPException(413, "appearance exceeds 4 KB")
 if value.get("v", 1) != 1: raise HTTPException(422, "appearance version must be 1")
 if "look" in value and (not isinstance(value["look"], str) or not value["look"] or len(value["look"]) > 120): raise HTTPException(422, "appearance look is invalid")
 if "bodyType" in value and value["bodyType"] not in {"a", "b", "c"}: raise HTTPException(422, "appearance body type is invalid")
 if "scale" in value and (not isinstance(value["scale"], (int, float)) or isinstance(value["scale"], bool) or not .85 <= value["scale"] <= 1.15): raise HTTPException(422, "appearance scale is invalid")
 tints = value.get("tints")
 if tints is not None and (not isinstance(tints, dict) or any(key not in {"skin", "hair", "top", "bottom", "shoes"} or not isinstance(tint, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", tint) for key, tint in tints.items())): raise HTTPException(422, "appearance tints are invalid")
 parts = value.get("parts")
 allowed_parts = {"hair": {"short-02", "long-01", "none"}, "hat": {"cap-01", "none"}, "glasses": {"round", "none"}, "badge": {"lanyard", "pin", "none"}}
 if parts is not None and (not isinstance(parts, dict) or any(key not in allowed_parts or value not in allowed_parts[key] for key, value in parts.items())): raise HTTPException(422, "appearance parts are invalid")
 badge = value.get("badge")
 if badge is not None and (not isinstance(badge, dict) or ("style" in badge and badge["style"] not in {"plate", "floating", "none"}) or ("showRole" in badge and not isinstance(badge["showRole"], bool))): raise HTTPException(422, "appearance badge is invalid")
 if "voice" in value and (not isinstance(value["voice"], str) or len(value["voice"]) > 120): raise HTTPException(422, "appearance voice is invalid")
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
 walls = value.get("walls", [])
 if not isinstance(walls, list): raise HTTPException(422, "walls must be a list")
 for wall in walls:
  if not isinstance(wall, dict): raise HTTPException(422, "wall is invalid")
  start, end = wall.get("from"), wall.get("to")
  if not isinstance(start, list) or not isinstance(end, list) or len(start) != 2 or len(end) != 2 or not all(isinstance(item, int) for item in [*start, *end]) or not (0 <= start[0] < width and 0 <= start[1] < height and 0 <= end[0] < width and 0 <= end[1] < height): raise HTTPException(422, "wall bounds are invalid")
  dx, dz = end[0] - start[0], end[1] - start[1]
  if dx and dz: raise HTTPException(422, "walls must be axis-aligned")
  if not isinstance(wall.get("height"), (int, float)) or isinstance(wall["height"], bool) or not math.isfinite(wall["height"]) or not .5 <= wall["height"] <= 6: raise HTTPException(422, "wall height is invalid")
  if wall.get("style") not in {"plaster", "glass", "brick"}: raise HTTPException(422, "wall style is invalid")
  count = max(abs(dx), abs(dz), 1) + (1 if dx or dz else 0)
  line = {(round(start[0] + (dx * index / (count - 1) if count > 1 else 0)), round(start[1] + (dz * index / (count - 1) if count > 1 else 0))) for index in range(count)}
  horizontal = abs(dx) >= abs(dz)
  doors, windows = wall.get("doors", []), wall.get("windows", [])
  if not isinstance(doors, list) or not isinstance(windows, list): raise HTTPException(422, "wall openings must be lists")
  for opening, kinds in ((item, {"open", "glass", "locked"}) for item in doors):
   if not isinstance(opening, dict) or opening.get("kind") not in kinds or not isinstance(opening.get("at"), list) or len(opening["at"]) != 2 or not all(isinstance(item, int) for item in opening["at"]) or not isinstance(opening.get("width"), int) or not 1 <= opening["width"] <= count: raise HTTPException(422, "wall door is invalid")
   door_tiles = {(opening["at"][0] + (offset if horizontal else 0), opening["at"][1] + (0 if horizontal else offset)) for offset in range(opening["width"])}
   if not door_tiles <= line: raise HTTPException(422, "wall door must lie on its wall")
  for opening in windows:
   if not isinstance(opening, dict) or not isinstance(opening.get("at"), list) or len(opening["at"]) != 2 or not all(isinstance(item, int) for item in opening["at"]) or not isinstance(opening.get("width"), int) or not 1 <= opening["width"] <= count: raise HTTPException(422, "wall window is invalid")
   window_tiles = {(opening["at"][0] + (offset if horizontal else 0), opening["at"][1] + (0 if horizontal else offset)) for offset in range(opening["width"])}
   if not window_tiles <= line: raise HTTPException(422, "wall window must lie on its wall")
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
  if not isinstance(obj.get("rot"), (int, float)) or isinstance(obj["rot"], bool) or not math.isfinite(obj["rot"]): raise HTTPException(422, "object rotation is invalid")
  if not isinstance(obj.get("scale"), (int, float)) or isinstance(obj["scale"], bool) or not math.isfinite(obj["scale"]) or not .1 <= obj["scale"] <= 8: raise HTTPException(422, "object scale is invalid")
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
async def upload_model(slug: str, file: UploadFile = File(...), actor: dict = Depends(_office_member)):
 slug = _safe_slug(slug)
 if settings.OFFICE_AUTH_REQUIRED and actor["role"] not in {"founder", "admin"} and actor["id"] != slug:
  raise HTTPException(403, "Office model owners may upload only their own model")
 if not file.filename or not file.filename.lower().endswith(".glb"): raise HTTPException(422, "only .glb models are supported")
 payload = await file.read(8 * 1024 * 1024 + 1)
 if len(payload) > 8 * 1024 * 1024: raise HTTPException(413, "model exceeds 8 MB")
 if len(payload) < 20 or payload[:4] != b"glTF": raise HTTPException(422, "invalid GLB signature")
 if int.from_bytes(payload[4:8], "little") != 2: raise HTTPException(422, "only GLB version 2 is supported")
 if int.from_bytes(payload[8:12], "little") != len(payload): raise HTTPException(422, "invalid GLB declared length")
 json_size = int.from_bytes(payload[12:16], "little")
 if payload[16:20] != b"JSON" or json_size > len(payload) - 20: raise HTTPException(422, "invalid GLB JSON chunk")
 try: document = json.loads(payload[20:20 + json_size].decode("utf-8").strip())
 except (UnicodeDecodeError, json.JSONDecodeError): raise HTTPException(422, "invalid GLB JSON document")
 skins = document.get("skins") if isinstance(document, dict) else None
 if not isinstance(skins, list) or not skins: raise HTTPException(422, "founder model needs a skeleton")
 if any(not isinstance(skin, dict) or not isinstance(skin.get("joints"), list) or len(skin["joints"]) > 256 for skin in skins): raise HTTPException(422, "invalid or oversized model skeleton")
 accessors = document.get("accessors") if isinstance(document, dict) else None
 meshes = document.get("meshes") if isinstance(document, dict) else None
 if not isinstance(accessors, list) or not isinstance(meshes, list): raise HTTPException(422, "model geometry is missing")
 def accessor_count(index: object) -> int:
  if not isinstance(index, int) or index < 0 or index >= len(accessors) or not isinstance(accessors[index], dict) or not isinstance(accessors[index].get("count"), int): raise HTTPException(422, "model accessor is invalid")
  return accessors[index]["count"]
 triangles = 0
 for mesh in meshes:
  if not isinstance(mesh, dict) or not isinstance(mesh.get("primitives"), list): raise HTTPException(422, "model mesh is invalid")
  for primitive in mesh["primitives"]:
   if not isinstance(primitive, dict): raise HTTPException(422, "model primitive is invalid")
   if primitive.get("mode", 4) != 4: continue
   attributes = primitive.get("attributes")
   if not isinstance(attributes, dict) or "POSITION" not in attributes: raise HTTPException(422, "model primitive has no positions")
   triangles += accessor_count(primitive.get("indices", attributes["POSITION"])) // 3
 if triangles < 1: raise HTTPException(422, "model has no triangle geometry")
 if triangles > 120_000: raise HTTPException(422, "model exceeds 120000 triangles")
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
async def put_world(body: WorldPut, response: Response, actor: dict = Depends(_office_admin)):
 await _seed()
 body.world = _world(body.world)
 row = (await aio.fetch("SELECT id,rev,world FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 if row["rev"] != body.rev:
  response.status_code = 409
  return {"world": row["world"], "rev": row["rev"]}
 await _snapshot_before_daily_mutation(row["id"], row["rev"], row["world"])
 next_rev = row["rev"] + 1
 await aio.execute("UPDATE shared.office_worlds SET world=$1::jsonb,rev=$2,updated_at=now() WHERE id=$3", json.dumps(body.world), next_rev, row["id"])
 await audit.write("default", "office-world-saved", {"world_id": row["id"], "rev": next_rev})
 await broadcast_world_change(row["id"], next_rev)
 return {"world": body.world, "rev": next_rev}

@router.patch("/world/objects/{object_id}")
async def patch_world_object(object_id: str, body: WorldObjectPatch, actor: dict = Depends(_office_admin)):
 await _seed()
 patch = body.model_dump(exclude_none=True)
 if not patch: raise HTTPException(422, "object patch is empty")
 row = (await aio.fetch("SELECT id,rev,world FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 world = dict(row["world"])
 objects = list(world.get("objects", []))
 found = next((index for index, item in enumerate(objects) if isinstance(item, dict) and item.get("id") == object_id), None)
 if found is None: raise HTTPException(404, "Office object not found")
 objects[found] = {**objects[found], **patch}
 world["objects"] = objects
 world = _world(world)
 await _snapshot_before_daily_mutation(row["id"], row["rev"], row["world"])
 next_rev = row["rev"] + 1
 await aio.execute("UPDATE shared.office_worlds SET world=$1::jsonb,rev=$2,updated_at=now() WHERE id=$3", json.dumps(world), next_rev, row["id"])
 await audit.write("default", "office-world-object-patched", {"world_id": row["id"], "rev": next_rev, "object_id": object_id, "fields": sorted(patch)})
 await broadcast_world_change(row["id"], next_rev, {"kind": "object", "id": object_id, "object": objects[found]})
 return {"object": next(item for item in world["objects"] if item["id"] == object_id), "rev": next_rev}

@router.get("/worlds")
async def worlds():
 await _seed()
 rows = await aio.fetch("SELECT id,rev,active,updated_at FROM shared.office_worlds ORDER BY id")
 return {"worlds": [dict(row) for row in rows]}

@router.post("/worlds/{world_id}/activate")
async def activate(world_id: str, actor: dict = Depends(_office_admin)):
 await _ensure()
 rows = await aio.fetch("SELECT id FROM shared.office_worlds WHERE id=$1", world_id)
 if not rows: raise HTTPException(404, "unknown world")
 await aio.execute("UPDATE shared.office_worlds SET active=(id=$1)", world_id)
 await audit.write("default", "office-world-activated", {"world_id": world_id})
 return {"id": world_id, "active": True}

@router.post("/worlds/clone")
async def clone_world(body: WorldClone, actor: dict = Depends(_office_admin)):
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
async def snapshot(actor: dict = Depends(_office_admin)):
 await _seed()
 row = (await aio.fetch("SELECT id,rev,world FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 await aio.execute("INSERT INTO shared.office_world_snapshots(world_id,rev,world) VALUES($1,$2,$3::jsonb)", row["id"], row["rev"], json.dumps(row["world"]))
 await aio.execute("DELETE FROM shared.office_world_snapshots WHERE id IN (SELECT id FROM shared.office_world_snapshots ORDER BY created_at DESC OFFSET 20)")
 return {"world_id": row["id"], "rev": row["rev"]}

@router.get("/snapshots")
async def snapshots(_: dict = Depends(_office_admin)):
 await _ensure()
 rows = await aio.fetch("SELECT id,world_id,rev,created_at FROM shared.office_world_snapshots ORDER BY created_at DESC LIMIT 20")
 return {"snapshots": [dict(row) for row in rows]}

@router.get("/room-locks")
async def room_locks():
 await _ensure()
 rows = await aio.fetch("SELECT room_id,editor,updated_at FROM shared.office_room_locks ORDER BY room_id")
 return {"locks": [dict(row) for row in rows]}

@router.post("/rooms/{room_id}/lock")
async def lock_room(room_id: str, body: RoomLockPut, actor: dict = Depends(_office_admin)):
 await _seed()
 editor = actor["id"] if settings.OFFICE_AUTH_REQUIRED else body.editor
 world = (await aio.fetch("SELECT world FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]["world"]
 if room_id not in {room.get("id") for room in world.get("rooms", []) if isinstance(room, dict)}: raise HTTPException(404, "unknown room")
 rows = await aio.fetch("SELECT editor FROM shared.office_room_locks WHERE room_id=$1", room_id)
 if rows and rows[0]["editor"] != editor: raise HTTPException(409, "room is being edited")
 await aio.execute("INSERT INTO shared.office_room_locks(room_id,editor) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET editor=excluded.editor,updated_at=now()", room_id, editor)
 await audit.write("default", "office-room-locked", {"room": room_id, "editor": editor})
 return {"room": room_id, "editor": editor}

@router.delete("/rooms/{room_id}/lock")
async def unlock_room(room_id: str, editor: str, actor: dict = Depends(_office_admin)):
 await _ensure()
 if settings.OFFICE_AUTH_REQUIRED: editor = actor["id"]
 await aio.execute("DELETE FROM shared.office_room_locks WHERE room_id=$1 AND editor=$2", room_id, editor)
 await audit.write("default", "office-room-unlocked", {"room": room_id, "editor": editor})
 return {"room": room_id, "unlocked": True}

@router.get("/profiles/list")
async def person_profiles(_: dict = Depends(_office_admin)):
 await _ensure()
 rows = await aio.fetch("SELECT slug,birthday FROM shared.office_person_profiles WHERE birthday <> '' ORDER BY slug LIMIT 500")
 return {"profiles": [dict(row) for row in rows]}

@router.get("/profiles/{slug}")
async def person_profile(slug: str, actor: dict = Depends(_office_member)):
 await _ensure()
 safe_slug = _safe_slug(slug)
 if settings.OFFICE_AUTH_REQUIRED and actor["role"] not in {"founder", "admin"} and actor["id"] != safe_slug:
  raise HTTPException(403, "Office profile owners may read only their own profile")
 rows = await aio.fetch("SELECT founder_note,title,bio,timezone,birthday,(extract(epoch FROM updated_at)*1000)::bigint AS updated_at FROM shared.office_person_profiles WHERE slug=$1", safe_slug)
 if not rows: return {"slug": safe_slug, "founder_note": "", "title": "", "bio": "", "timezone": "", "birthday": "", "updated_at": None}
 return {"slug": safe_slug, **dict(rows[0])}

@router.put("/profiles/{slug}")
async def save_person_profile(slug: str, body: PersonProfilePut, actor: dict = Depends(_office_member)):
 await _ensure()
 safe_slug = _safe_slug(slug)
 note, title, bio, timezone, birthday = body.founder_note.strip(), body.title.strip(), body.bio.strip(), body.timezone.strip(), body.birthday.strip()
 if settings.OFFICE_AUTH_REQUIRED and actor["role"] not in {"founder", "admin"} and actor["id"] != safe_slug:
  raise HTTPException(403, "Office profile owners may edit only their own profile")
 if settings.OFFICE_AUTH_REQUIRED and actor["role"] not in {"founder", "admin"}:
  existing = await aio.fetch("SELECT founder_note FROM shared.office_person_profiles WHERE slug=$1", safe_slug)
  note = existing[0]["founder_note"] if existing else ""
 if birthday and not re.fullmatch(r"(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])", birthday): raise HTTPException(422, "birthday must be MM-DD")
 rows = await aio.fetch("""INSERT INTO shared.office_person_profiles(slug,founder_note,title,bio,timezone,birthday) VALUES($1,$2,$3,$4,$5,$6)
  ON CONFLICT(slug) DO UPDATE SET founder_note=excluded.founder_note,title=excluded.title,bio=excluded.bio,timezone=excluded.timezone,birthday=excluded.birthday,updated_at=now()
  RETURNING (extract(epoch FROM updated_at)*1000)::bigint AS updated_at""", safe_slug, note, title, bio, timezone, birthday)
 await audit.write("default", "office-person-profile-updated", {"slug": safe_slug, "has_note": bool(note), "has_bio": bool(bio), "has_timezone": bool(timezone), "has_birthday": bool(birthday)})
 return {"slug": safe_slug, "founder_note": note, "title": title, "bio": bio, "timezone": timezone, "birthday": birthday, "updated_at": rows[0]["updated_at"]}

@router.get("/agent-controls")
async def agent_controls(_: dict = Depends(_office_member)):
 await _ensure()
 rows = await aio.fetch("SELECT slug,paused,updated_at FROM shared.office_agent_controls ORDER BY slug")
 return {"controls": [{"slug": row["slug"], "paused": row["paused"], "updated_at": row["updated_at"].isoformat()} for row in rows]}

@router.put("/agent-controls/{slug}")
async def set_agent_control(slug: str, body: AgentControlPut, actor: dict = Depends(_office_admin)):
 await _ensure()
 safe_slug = _safe_slug(slug)
 await aio.execute("INSERT INTO shared.office_agent_controls(slug,paused,updated_at) VALUES($1,$2,now()) ON CONFLICT(slug) DO UPDATE SET paused=EXCLUDED.paused,updated_at=now()", safe_slug, body.paused)
 await audit.write(actor["id"], "office-agent-control", {"slug": safe_slug, "paused": body.paused})
 return {"slug": safe_slug, "paused": body.paused}

@router.get("/conversations")
async def conversation_history(participants: str, actor: dict = Depends(_office_member)):
 await _ensure()
 members = _conversation_members(participants.split(","))
 _authorize_conversation(actor, members)
 conversation_id = _conversation_id(members)
 await aio.execute("DELETE FROM shared.office_conversation_messages WHERE created_at < now() - interval '30 days'")
 rows = await aio.fetch("SELECT id,sender,text,(extract(epoch FROM created_at)*1000)::bigint AS at FROM shared.office_conversation_messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 100", conversation_id)
 return {"conversation_id": conversation_id, "messages": [dict(row) for row in reversed(rows)]}

@router.get("/conversations/typing")
async def conversation_typing(participants: str, actor: dict = Depends(_office_member)):
 members = _conversation_members(participants.split(","))
 _authorize_conversation(actor, members)
 return {"conversation_id": _conversation_id(members), "typists": _active_typists(_conversation_id(members))}

@router.put("/conversations/typing")
async def set_conversation_typing(body: ConversationTypingPut, actor: dict = Depends(_office_member)):
 members = _conversation_members(body.participants)
 sender = _safe_slug(body.sender)
 if sender not in members: raise HTTPException(422, "sender must be a conversation participant")
 _authorize_conversation(actor, members, sender)
 conversation_id = _conversation_id(members)
 if body.active:
  _conversation_typing.setdefault(conversation_id, {})[sender] = time.monotonic() + 5
 else:
  _conversation_typing.get(conversation_id, {}).pop(sender, None)
 return {"conversation_id": conversation_id, "typists": _active_typists(conversation_id)}

@router.post("/conversations")
async def send_conversation_message(body: ConversationMessagePut, actor: dict = Depends(_office_member)):
 await _ensure()
 members = _conversation_members(body.participants)
 sender = _safe_slug(body.sender)
 if sender not in members: raise HTTPException(422, "sender must be a conversation participant")
 _authorize_conversation(actor, members, sender)
 if not body.text.strip(): raise HTTPException(422, "message is empty")
 if not _conversation_rate_ok(sender): raise HTTPException(429, "message rate limit exceeded")
 conversation_id = _conversation_id(members)
 rows = await aio.fetch("INSERT INTO shared.office_conversation_messages(conversation_id,participants,sender,text,private_room) VALUES($1,$2::jsonb,$3,$4,$5) RETURNING id,sender,text,(extract(epoch FROM created_at)*1000)::bigint AS at", conversation_id, json.dumps(members), sender, body.text.strip(), body.private_room)
 await audit.write("default", "office-conversation-message", {"conversation_id": conversation_id, "sender": sender})
 return {"conversation_id": conversation_id, "message": dict(rows[0])}

@router.delete("/conversations/{conversation_id}/{message_id}")
async def delete_conversation_message(conversation_id: str, message_id: int, body: ConversationModeratePut, actor: dict = Depends(_office_admin)):
 await _ensure()
 rows = await aio.fetch("DELETE FROM shared.office_conversation_messages WHERE id=$1 AND conversation_id=$2 RETURNING id,sender", message_id, conversation_id)
 if not rows: raise HTTPException(404, "message not found")
 await audit.write("default", "office-conversation-message-deleted", {"conversation_id": conversation_id, "message_id": message_id, "sender": rows[0]["sender"], "role": body.role})
 return {"deleted": message_id}

@router.post("/conversations/{conversation_id}/{message_id}/report")
async def report_conversation_message(conversation_id: str, message_id: int, body: ConversationReportPut, actor: dict = Depends(_office_member)):
 await _ensure()
 reporter = _safe_slug(body.reporter)
 members = _conversation_members(conversation_id.split("."))
 _authorize_conversation(actor, members, reporter)
 reason = body.reason.strip()
 if not reason: raise HTTPException(422, "report reason is empty")
 rows = await aio.fetch("SELECT sender FROM shared.office_conversation_messages WHERE id=$1 AND conversation_id=$2", message_id, conversation_id)
 if not rows: raise HTTPException(404, "message not found")
 report = await aio.fetch("INSERT INTO shared.office_conversation_reports(conversation_id,message_id,reporter,reason) VALUES($1,$2,$3,$4) RETURNING id", conversation_id, message_id, reporter, reason)
 await audit.write("default", "office-conversation-message-reported", {"conversation_id": conversation_id, "message_id": message_id, "sender": rows[0]["sender"], "reporter": reporter, "report_id": report[0]["id"]})
 return {"reported": message_id, "report_id": report[0]["id"]}

@router.get("/conversation-reports")
async def conversation_reports(_: dict = Depends(_office_admin)):
 await _ensure()
 rows = await aio.fetch("SELECT r.id,r.conversation_id,r.message_id,r.reporter,r.reason,(extract(epoch FROM r.created_at)*1000)::bigint AS at,m.sender,m.text FROM shared.office_conversation_reports r LEFT JOIN shared.office_conversation_messages m ON m.id=r.message_id WHERE COALESCE(r.status,'pending')='pending' AND COALESCE(m.private_room,false)=false ORDER BY r.id DESC LIMIT 100")
 return {"reports": [dict(row) for row in rows]}

@router.patch("/conversation-reports/{report_id}")
async def resolve_conversation_report(report_id: int, body: ConversationReportResolvePut, actor: dict = Depends(_office_admin)):
 await _ensure()
 moderator = actor["id"] if settings.OFFICE_AUTH_REQUIRED else _safe_slug(body.moderator)
 rows = await aio.fetch("UPDATE shared.office_conversation_reports SET status=$1 WHERE id=$2 AND COALESCE(status,'pending')='pending' RETURNING conversation_id,message_id", body.status, report_id)
 if not rows: raise HTTPException(404, "pending report not found")
 await audit.write("default", "office-conversation-report-resolved", {"report_id": report_id, "conversation_id": rows[0]["conversation_id"], "message_id": rows[0]["message_id"], "moderator": moderator, "status": body.status})
 return {"id": report_id, "status": body.status}

@router.get("/conversation-data/{person_id}")
async def export_person_conversations(person_id: str, actor: dict = Depends(_office_member)):
 await _ensure()
 safe_person_id = _safe_slug(person_id)
 _authorize_conversation_person(actor, safe_person_id)
 messages = await aio.fetch("SELECT id,conversation_id,participants,sender,text,(extract(epoch FROM created_at)*1000)::bigint AS at FROM shared.office_conversation_messages WHERE participants @> jsonb_build_array($1::text) ORDER BY id", safe_person_id)
 reports = await aio.fetch("SELECT id,conversation_id,message_id,reporter,reason,status,(extract(epoch FROM created_at)*1000)::bigint AS at FROM shared.office_conversation_reports WHERE reporter=$1 OR message_id IN (SELECT id FROM shared.office_conversation_messages WHERE sender=$1) ORDER BY id", safe_person_id)
 await audit.write("default", "office-conversation-exported", {"person": safe_person_id, "messages": len(messages), "reports": len(reports)})
 return {"person": safe_person_id, "messages": [dict(row) for row in messages], "reports": [dict(row) for row in reports]}

@router.delete("/conversation-data/{person_id}")
async def delete_person_conversations(person_id: str, actor: dict = Depends(_office_member)):
 await _ensure()
 safe_person_id = _safe_slug(person_id)
 _authorize_conversation_person(actor, safe_person_id)
 messages = await aio.fetch("DELETE FROM shared.office_conversation_messages WHERE sender=$1 RETURNING id", safe_person_id)
 message_ids = [row["id"] for row in messages]
 if message_ids: await aio.execute("DELETE FROM shared.office_conversation_reports WHERE message_id = ANY($1::bigint[])", message_ids)
 reports = await aio.fetch("DELETE FROM shared.office_conversation_reports WHERE reporter=$1 RETURNING id", safe_person_id)
 await audit.write("default", "office-conversation-person-deleted", {"person": safe_person_id, "messages": len(message_ids), "reports": len(reports)})
 return {"person": safe_person_id, "deleted_messages": len(message_ids), "deleted_reports": len(reports)}

@router.post("/minutes")
async def save_minutes(body: MinutesPut, actor: dict = Depends(_office_member)):
 await _ensure()
 rows = await aio.fetch("INSERT INTO shared.office_minutes(room_id,participants,duration_seconds,transcript) VALUES($1,$2::jsonb,$3,$4::jsonb) RETURNING id,created_at", body.room_id, json.dumps(body.participants), body.duration_seconds, json.dumps(body.transcript))
 await audit.write("default", "office-minutes-saved", {"id": rows[0]["id"], "room": body.room_id})
 return {"id": rows[0]["id"], "created_at": rows[0]["created_at"]}

@router.get("/minutes")
async def minutes(room_id: str | None = None, _: dict = Depends(_office_member)):
 await _ensure()
 rows = await aio.fetch("SELECT id,room_id,participants,duration_seconds,transcript,created_at FROM shared.office_minutes WHERE ($1::text IS NULL OR room_id=$1) ORDER BY created_at DESC LIMIT 50", room_id)
 return {"minutes": [dict(row) for row in rows]}

@router.post("/snapshots/{snapshot_id}/restore")
async def restore_snapshot(snapshot_id: int, actor: dict = Depends(_office_admin)):
 await _seed()
 rows = await aio.fetch("SELECT world FROM shared.office_world_snapshots WHERE id=$1", snapshot_id)
 if not rows: raise HTTPException(404, "snapshot not found")
 active = (await aio.fetch("SELECT id,rev FROM shared.office_worlds WHERE active=true LIMIT 1"))[0]
 current = (await aio.fetch("SELECT world FROM shared.office_worlds WHERE id=$1", active["id"]))[0]["world"]
 await _snapshot_before_daily_mutation(active["id"], active["rev"], current)
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
 if not rows: return Response(status_code=204)  # no saved appearance is a normal state, not an error
 return rows[0]["appearance"]

@router.put("/appearance/{slug}")
async def save_appearance(slug: str, body: AppearancePut, actor: dict = Depends(_office_member)):
 await _ensure()
 safe_slug = _safe_slug(slug)
 if settings.OFFICE_AUTH_REQUIRED and actor["role"] not in {"founder", "admin"} and actor["id"] != safe_slug:
  raise HTTPException(403, "Office appearance owners may edit only their own appearance")
 value = _appearance(body.appearance)
 await aio.execute("INSERT INTO shared.office_appearance(slug,appearance) VALUES($1,$2::jsonb) ON CONFLICT(slug) DO UPDATE SET appearance=excluded.appearance,updated_at=now()", safe_slug, json.dumps(value))
 await audit.write("default", "office-appearance-saved", {"slug": safe_slug})
 return value
