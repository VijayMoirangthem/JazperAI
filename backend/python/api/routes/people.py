"""Local Office V3 people and role management."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from memory.db import aio
from core import audit

router = APIRouter()
ROLES = {"founder", "admin", "employee", "intern", "guest"}
_ready = False

async def _ensure() -> None:
    global _ready
    if _ready:
        return
    await aio.execute("""CREATE TABLE IF NOT EXISTS shared.office_people (
      id text PRIMARY KEY, display_name text NOT NULL, email text, role text NOT NULL,
      disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())""")
    _ready = True

class PersonCreate(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    display_name: str = Field(min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=254)
    role: str = "employee"

class RolePut(BaseModel):
    role: str

def _role(role: str) -> str:
    if role not in ROLES:
        raise HTTPException(422, "invalid Office role")
    return role

@router.get("")
async def people():
    await _ensure()
    rows = await aio.fetch("SELECT id,display_name,email,role,disabled,created_at FROM shared.office_people ORDER BY id")
    return {"people": [dict(row) for row in rows]}

@router.post("")
async def create_person(body: PersonCreate):
    await _ensure()
    role = _role(body.role)
    rows = await aio.fetch("SELECT id FROM shared.office_people WHERE id=$1", body.id)
    if rows:
        raise HTTPException(409, "person already exists")
    await aio.execute("INSERT INTO shared.office_people(id,display_name,email,role) VALUES($1,$2,$3,$4)", body.id, body.display_name, body.email, role)
    await audit.write("default", "office-person-created", {"id": body.id, "role": role})
    return {"id": body.id, "display_name": body.display_name, "email": body.email, "role": role, "disabled": False}

@router.put("/{person_id}/role")
async def change_role(person_id: str, body: RolePut):
    await _ensure()
    role = _role(body.role)
    if person_id == "founder" and role != "founder":
        raise HTTPException(403, "founder cannot be demoted")
    result = await aio.execute("UPDATE shared.office_people SET role=$1 WHERE id=$2", role, person_id)
    if result.endswith("0"):
        raise HTTPException(404, "person not found")
    await audit.write("default", "office-person-role-changed", {"id": person_id, "role": role})
    return {"id": person_id, "role": role}

@router.delete("/{person_id}")
async def disable_person(person_id: str):
    await _ensure()
    if person_id == "founder":
        raise HTTPException(403, "founder cannot be disabled")
    result = await aio.execute("UPDATE shared.office_people SET disabled=true WHERE id=$1", person_id)
    if result.endswith("0"):
        raise HTTPException(404, "person not found")
    await audit.write("default", "office-person-disabled", {"id": person_id})
    return {"id": person_id, "disabled": True}
