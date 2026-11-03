"""Local Office V3 people, invitation, and credential management."""
import hashlib
import hmac
import secrets
import time

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from memory.db import aio
from core import audit, vault
from core.config import settings

router = APIRouter()
ROLES = {"founder", "admin", "employee", "intern", "guest"}
AUTH_TTL = 15 * 60
INVITE_TTL = 24 * 60 * 60
LOGIN_ATTEMPT_WINDOW = 60
LOGIN_ATTEMPT_LIMIT = 5
_ready = False
_login_attempts: dict[str, list[float]] = {}

async def _ensure() -> None:
    global _ready
    if _ready:
        return
    await aio.execute("""CREATE TABLE IF NOT EXISTS shared.office_people (
      id text PRIMARY KEY, display_name text NOT NULL, email text, role text NOT NULL,
      mentor_id text, desk_label text, credential_salt text, credential_hash text,
      disabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now())""")
    # These ALTER statements also upgrade existing local Office databases.
    await aio.execute("ALTER TABLE shared.office_people ADD COLUMN IF NOT EXISTS mentor_id text")
    await aio.execute("ALTER TABLE shared.office_people ADD COLUMN IF NOT EXISTS desk_label text")
    await aio.execute("ALTER TABLE shared.office_people ADD COLUMN IF NOT EXISTS credential_salt text")
    await aio.execute("ALTER TABLE shared.office_people ADD COLUMN IF NOT EXISTS credential_hash text")
    await aio.execute("""CREATE TABLE IF NOT EXISTS shared.office_invites (
      id bigserial PRIMARY KEY, email text NOT NULL, display_name text NOT NULL,
      suggested_id text NOT NULL, role text NOT NULL, mentor_id text, desk_label text, invite_code_hash text, expires_at timestamptz,
      status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now())""")
    await aio.execute("ALTER TABLE shared.office_invites ADD COLUMN IF NOT EXISTS invite_code_hash text")
    await aio.execute("ALTER TABLE shared.office_invites ADD COLUMN IF NOT EXISTS expires_at timestamptz")
    _ready = True

def _auth_key() -> str:
    key = vault.get("OFFICE_PERSON_JWT_KEY")
    if not key:
        key = secrets.token_urlsafe(48)
        vault.set("OFFICE_PERSON_JWT_KEY", key)
    return key

def _credential_hash(credential: str, salt: str) -> str:
    return hashlib.scrypt(credential.encode("utf-8"), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()

def _new_credential(credential: str) -> tuple[str, str]:
    salt = secrets.token_hex(16)
    return salt, _credential_hash(credential, salt)

def _issue_token(person_id: str, role: str) -> str:
    now = int(time.time())
    return jwt.encode({"sub": person_id, "role": role, "typ": "office-person", "iat": now, "exp": now + AUTH_TTL}, _auth_key(), algorithm="HS256")

def _login_key(request: Request, person_id: str) -> str:
    return f"{request.client.host if request.client else 'local'}:{person_id.lower()}"

def _login_limited(key: str) -> bool:
    now = time.monotonic()
    attempts = [value for value in _login_attempts.get(key, []) if now - value < LOGIN_ATTEMPT_WINDOW]
    _login_attempts[key] = attempts
    return len(attempts) >= LOGIN_ATTEMPT_LIMIT

def _record_login_failure(key: str) -> None:
    now = time.monotonic()
    attempts = [value for value in _login_attempts.get(key, []) if now - value < LOGIN_ATTEMPT_WINDOW]
    attempts.append(now)
    _login_attempts[key] = attempts

async def _session_person(authorization: str) -> dict:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing Office token")
    try:
        claims = jwt.decode(authorization[7:], _auth_key(), algorithms=["HS256"])
    except jwt.PyJWTError as error:
        raise HTTPException(401, "invalid or expired Office token") from error
    if claims.get("typ") != "office-person" or not isinstance(claims.get("sub"), str):
        raise HTTPException(401, "invalid Office token")
    rows = await aio.fetch("SELECT id,display_name,role,disabled FROM shared.office_people WHERE id=$1", claims["sub"])
    if not rows or rows[0]["disabled"]:
        raise HTTPException(401, "Office account unavailable")
    return dict(rows[0])

async def _office_member(authorization: str = Header(default="")) -> dict:
    if not settings.OFFICE_AUTH_REQUIRED:
        return {"id": "local-founder", "role": "founder"}
    return await _session_person(authorization)

async def _office_admin(person: dict = Depends(_office_member)) -> dict:
    if person["role"] not in {"founder", "admin"}:
        raise HTTPException(403, "Office founder or admin role required")
    return person

class PersonCreate(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    display_name: str = Field(min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=254)
    role: str = "employee"
    mentor_id: str | None = Field(default=None, max_length=80)
    desk_label: str | None = Field(default=None, max_length=100)
    credential: str | None = Field(default=None, min_length=4, max_length=128)

class RolePut(BaseModel):
    role: str

class InviteCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(min_length=1, max_length=100)
    suggested_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    role: str = "employee"
    mentor_id: str | None = Field(default=None, max_length=80)
    desk_label: str | None = Field(default=None, max_length=100)

class AssignmentPut(BaseModel):
    mentor_id: str | None = Field(default=None, max_length=80)
    desk_label: str | None = Field(default=None, max_length=100)

class LoginBody(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    credential: str = Field(min_length=4, max_length=128)

class InviteRedeem(BaseModel):
    code: str = Field(min_length=8, max_length=64)
    credential: str = Field(min_length=4, max_length=128)

def _role(role: str) -> str:
    if role not in ROLES:
        raise HTTPException(422, "invalid Office role")
    return role

@router.get("")
async def people(_: dict = Depends(_office_member)):
    await _ensure()
    rows = await aio.fetch("SELECT id,display_name,email,role,mentor_id,desk_label,disabled,created_at FROM shared.office_people ORDER BY id")
    return {"people": [dict(row) for row in rows]}

@router.get("/auth/config")
async def auth_config():
    """Expose only the client UX toggle; route authorization remains server-side."""
    return {"required": settings.OFFICE_AUTH_REQUIRED}

@router.post("/auth/login")
async def login(body: LoginBody, request: Request):
    """Issue a short-lived local Office token; credentials are never returned or audited."""
    await _ensure()
    attempt_key = _login_key(request, body.id)
    if _login_limited(attempt_key):
        raise HTTPException(429, "too many login attempts; try again shortly")
    rows = await aio.fetch("SELECT id,role,disabled,credential_salt,credential_hash FROM shared.office_people WHERE id=$1", body.id)
    if not rows:
        _record_login_failure(attempt_key)
        raise HTTPException(401, "invalid Office credentials")
    person = dict(rows[0])
    expected, salt = person.get("credential_hash"), person.get("credential_salt")
    if person["disabled"] or not expected or not salt or not hmac.compare_digest(_credential_hash(body.credential, salt), expected):
        _record_login_failure(attempt_key)
        raise HTTPException(401, "invalid Office credentials")
    _login_attempts.pop(attempt_key, None)
    await audit.write("default", "office-person-login", {"id": person["id"]})
    return {"access_token": _issue_token(person["id"], person["role"]), "token_type": "bearer", "expires_in": AUTH_TTL, "person": {"id": person["id"], "role": person["role"]}}

@router.get("/auth/me")
async def current_person(authorization: str = Header(default="")):
    await _ensure()
    return {"person": await _session_person(authorization)}

@router.get("/invites")
async def invites(_: dict = Depends(_office_admin)):
    await _ensure()
    rows = await aio.fetch("SELECT id,email,display_name,suggested_id,role,mentor_id,desk_label,status,created_at FROM shared.office_invites WHERE status='pending' ORDER BY created_at DESC")
    return {"invites": [dict(row) for row in rows]}

@router.post("/invites")
async def create_invite(body: InviteCreate, _: dict = Depends(_office_admin)):
    await _ensure()
    role = _role(body.role)
    if "@" not in body.email:
        raise HTTPException(422, "valid email required")
    if body.mentor_id:
        mentor = await aio.fetch("SELECT id FROM shared.office_people WHERE id=$1 AND disabled=false", body.mentor_id)
        if not mentor:
            raise HTTPException(422, "mentor not found")
    duplicate = await aio.fetch("SELECT id FROM shared.office_invites WHERE email=$1 AND status='pending'", body.email.lower())
    if duplicate:
        raise HTTPException(409, "a pending invitation already exists for this email")
    code = secrets.token_urlsafe(18)
    row = await aio.fetch("""INSERT INTO shared.office_invites(email,display_name,suggested_id,role,mentor_id,desk_label,invite_code_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now() + interval '24 hours') RETURNING id,email,display_name,suggested_id,role,mentor_id,desk_label,status,created_at,expires_at""",
      body.email.lower(), body.display_name, body.suggested_id, role, body.mentor_id, body.desk_label, hashlib.sha256(code.encode()).hexdigest())
    invite = dict(row[0])
    await audit.write("default", "office-person-invited", {"id": invite["id"], "email": invite["email"], "role": role})
    return {**invite, "activation_code": code, "expires_in": INVITE_TTL}

@router.post("/invites/{invite_id}/redeem")
async def redeem_invite(invite_id: int, body: InviteRedeem):
    """Public-style invite acceptance path; the one-time code and credential stay off audit records."""
    await _ensure()
    rows = await aio.fetch("SELECT id,email,display_name,suggested_id,role,mentor_id,desk_label,status,invite_code_hash,expires_at FROM shared.office_invites WHERE id=$1", invite_id)
    if not rows:
        raise HTTPException(404, "invitation not found")
    invite = dict(rows[0])
    supplied = hashlib.sha256(body.code.encode()).hexdigest()
    if invite["status"] != "pending" or not invite.get("expires_at") or invite["expires_at"].timestamp() < time.time() or not invite.get("invite_code_hash") or not hmac.compare_digest(invite["invite_code_hash"], supplied):
        raise HTTPException(401, "invalid or expired invitation")
    existing = await aio.fetch("SELECT id FROM shared.office_people WHERE id=$1", invite["suggested_id"])
    if existing:
        raise HTTPException(409, "suggested person ID already exists")
    salt, credential_hash = _new_credential(body.credential)
    await aio.execute("INSERT INTO shared.office_people(id,display_name,email,role,mentor_id,desk_label,credential_salt,credential_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", invite["suggested_id"], invite["display_name"], invite["email"], invite["role"], invite["mentor_id"], invite["desk_label"], salt, credential_hash)
    await aio.execute("UPDATE shared.office_invites SET status='accepted',invite_code_hash=NULL WHERE id=$1", invite_id)
    await audit.write("default", "office-person-invite-redeemed", {"invite_id": invite_id, "id": invite["suggested_id"]})
    return {"access_token": _issue_token(invite["suggested_id"], invite["role"]), "token_type": "bearer", "expires_in": AUTH_TTL, "person": {"id": invite["suggested_id"], "role": invite["role"]}}

@router.post("/invites/{invite_id}/accept")
async def accept_invite(invite_id: int, _: dict = Depends(_office_admin)):
    await _ensure()
    rows = await aio.fetch("SELECT id,email,display_name,suggested_id,role,mentor_id,desk_label,status FROM shared.office_invites WHERE id=$1", invite_id)
    if not rows:
        raise HTTPException(404, "invitation not found")
    invite = dict(rows[0])
    if invite["status"] != "pending":
        raise HTTPException(409, "invitation is no longer pending")
    existing = await aio.fetch("SELECT id FROM shared.office_people WHERE id=$1", invite["suggested_id"])
    if existing:
        raise HTTPException(409, "suggested person ID already exists")
    await aio.execute("INSERT INTO shared.office_people(id,display_name,email,role,mentor_id,desk_label) VALUES($1,$2,$3,$4,$5,$6)", invite["suggested_id"], invite["display_name"], invite["email"], invite["role"], invite["mentor_id"], invite["desk_label"])
    await aio.execute("UPDATE shared.office_invites SET status='accepted' WHERE id=$1", invite_id)
    await audit.write("default", "office-person-invite-accepted", {"invite_id": invite_id, "id": invite["suggested_id"]})
    return {"id": invite["suggested_id"], "display_name": invite["display_name"], "email": invite["email"], "role": invite["role"], "mentor_id": invite["mentor_id"], "desk_label": invite["desk_label"], "disabled": False}

@router.delete("/invites/{invite_id}")
async def dismiss_invite(invite_id: int, _: dict = Depends(_office_admin)):
    await _ensure()
    rows = await aio.fetch("UPDATE shared.office_invites SET status='dismissed' WHERE id=$1 AND status='pending' RETURNING email", invite_id)
    if not rows:
        raise HTTPException(404, "pending invitation not found")
    await audit.write("default", "office-person-invite-dismissed", {"invite_id": invite_id, "email": rows[0]["email"]})
    return {"id": invite_id, "status": "dismissed"}

@router.post("")
async def create_person(body: PersonCreate, _: dict = Depends(_office_admin)):
    await _ensure()
    role = _role(body.role)
    rows = await aio.fetch("SELECT id FROM shared.office_people WHERE id=$1", body.id)
    if rows:
        raise HTTPException(409, "person already exists")
    if body.mentor_id:
        if body.mentor_id == body.id:
            raise HTTPException(422, "a person cannot mentor themselves")
        mentor = await aio.fetch("SELECT id FROM shared.office_people WHERE id=$1 AND disabled=false", body.mentor_id)
        if not mentor:
            raise HTTPException(422, "mentor not found")
    salt, credential_hash = _new_credential(body.credential) if body.credential else (None, None)
    await aio.execute("INSERT INTO shared.office_people(id,display_name,email,role,mentor_id,desk_label,credential_salt,credential_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", body.id, body.display_name, body.email, role, body.mentor_id, body.desk_label or None, salt, credential_hash)
    await audit.write("default", "office-person-created", {"id": body.id, "role": role, "mentor_id": body.mentor_id, "desk_label": body.desk_label})
    return {"id": body.id, "display_name": body.display_name, "email": body.email, "role": role, "mentor_id": body.mentor_id, "desk_label": body.desk_label or None, "disabled": False}

@router.put("/{person_id}/role")
async def change_role(person_id: str, body: RolePut, _: dict = Depends(_office_admin)):
    await _ensure()
    role = _role(body.role)
    if person_id == "founder" and role != "founder":
        raise HTTPException(403, "founder cannot be demoted")
    result = await aio.execute("UPDATE shared.office_people SET role=$1 WHERE id=$2", role, person_id)
    if result.endswith("0"):
        raise HTTPException(404, "person not found")
    await audit.write("default", "office-person-role-changed", {"id": person_id, "role": role})
    return {"id": person_id, "role": role}

@router.put("/{person_id}/assignment")
async def change_assignment(person_id: str, body: AssignmentPut, _: dict = Depends(_office_admin)):
    await _ensure()
    if person_id == "founder" and body.mentor_id:
        raise HTTPException(422, "founder cannot have a mentor")
    if body.mentor_id:
        if body.mentor_id == person_id:
            raise HTTPException(422, "a person cannot mentor themselves")
        mentor = await aio.fetch("SELECT id FROM shared.office_people WHERE id=$1 AND disabled=false", body.mentor_id)
        if not mentor:
            raise HTTPException(422, "mentor not found")
    result = await aio.execute("UPDATE shared.office_people SET mentor_id=$1,desk_label=$2 WHERE id=$3", body.mentor_id, body.desk_label or None, person_id)
    if result.endswith("0"):
        raise HTTPException(404, "person not found")
    await audit.write("default", "office-person-assignment-changed", {"id": person_id, "mentor_id": body.mentor_id, "desk_label": body.desk_label})
    return {"id": person_id, "mentor_id": body.mentor_id, "desk_label": body.desk_label or None}

@router.delete("/{person_id}")
async def disable_person(person_id: str, _: dict = Depends(_office_admin)):
    await _ensure()
    if person_id == "founder":
        raise HTTPException(403, "founder cannot be disabled")
    result = await aio.execute("UPDATE shared.office_people SET disabled=true WHERE id=$1", person_id)
    if result.endswith("0"):
        raise HTTPException(404, "person not found")
    await audit.write("default", "office-person-disabled", {"id": person_id})
    return {"id": person_id, "disabled": True}
