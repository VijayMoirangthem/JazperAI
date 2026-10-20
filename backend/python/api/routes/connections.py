"""Connections (aliased /api/v1/connections), bot-to-bot communications and the skill library.

Secrets sent to PUT /{id}/secrets go straight to the OS vault; they are never echoed back, logged, or stored in chat history.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents import comms, connector, skills
from core import cache

router = APIRouter()
comms_router = APIRouter()
skills_router = APIRouter()


class SecretIn(BaseModel):
    name: str
    value: str


@router.get("/")
async def overview():
    return {"connections": await cache.cached("connections", 5, connector.overview)}


@router.post("/{cid}/connect")
async def connect(cid: str):
    await cache.invalidate("connections")
    return await connector.connect(cid)


@router.post("/{cid}/test")
async def test(cid: str):
    await cache.invalidate("connections")
    return await connector.test(cid)


@router.put("/{cid}/secrets")
async def put_secret(cid: str, body: SecretIn):
    try:
        st = await connector.set_secret(cid, body.name, body.value)
    except KeyError:
        raise HTTPException(400, "this connector does not use that secret")
    await cache.invalidate("connections")
    return {k: v for k, v in st.items() if k != "request"}


@router.delete("/{cid}")
async def disconnect(cid: str):
    await cache.invalidate("connections")
    return await connector.disconnect(cid)


# ── communications between bots (read-only) ───────────────────────────────────────────────────────────
@comms_router.get("/agents")
async def agent_states():
    """Live bot states kept in Redis (survive a backend restart)."""
    return {"agents": await cache.agent_states()}


@comms_router.get("/threads")
async def threads():
    return {"threads": await comms.threads()}


@comms_router.get("/thread")
async def thread(id: str, since_id: int = 0):
    return {"messages": await comms.messages(id, since_id)}


@comms_router.get("/recent")
async def recent(since_id: int = 0, limit: int = 100):
    return {"messages": await comms.recent(since_id, min(limit, 300))}


# ── skills ────────────────────────────────────────────────────────────────────────────────────────────
class SkillIn(BaseModel):
    name: str
    description: str
    body: str


@skills_router.get("/")
async def list_skills():
    return {"skills": await skills.list_skills()}


@skills_router.get("/{name}")
async def get_skill(name: str):
    s = await skills.view(name, count_use=False)
    if not s:
        raise HTTPException(404, "no such skill")
    hist = await skills.history(name)
    return {**s, "history": hist}


@skills_router.put("/")
async def save_skill(body: SkillIn):
    r = await skills.save(body.name, body.description, body.body, "founder", "edited by founder")
    if not r["ok"]:
        raise HTTPException(400, r["error"])
    return r


@skills_router.post("/{name}/enabled")
async def enable(name: str, enabled: bool = True):
    await skills.set_enabled(name, enabled)
    return {"name": name, "enabled": enabled}
