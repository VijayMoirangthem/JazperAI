"""Phase 9A — Shared Agent Memory Federation
Agents can write and read a global key-value memory store visible to ALL agents.
"""
from __future__ import annotations
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2
import structlog
from app.core.config import settings as s

router = APIRouter()
log = structlog.get_logger()


def _conn():
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


class WriteBody(BaseModel):
    key: str
    value: str
    writing_agent: str = "system"
    tags: list[str] = []


@router.get("")
def list_memories(agent: str = "", tag: str = "", search: str = "", limit: int = 100):
    conn = _conn()
    cur = conn.cursor()
    try:
        clauses, params = [], []
        if agent:
            clauses.append("writing_agent = %s")
            params.append(agent)
        if tag:
            clauses.append("%s = ANY(tags)")
            params.append(tag)
        if search:
            clauses.append("(key ILIKE %s OR value ILIKE %s)")
            params += [f"%{search}%", f"%{search}%"]
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        cur.execute(
            f"""SELECT id, key, value, writing_agent, tags, created_at, updated_at
               FROM shared_memory {where}
               ORDER BY updated_at DESC LIMIT %s""",
            params + [limit],
        )
        rows = cur.fetchall()
        return [
            {"id": str(r[0]), "key": r[1], "value": r[2], "writing_agent": r[3],
             "tags": r[4], "created_at": r[5].isoformat(), "updated_at": r[6].isoformat()}
            for r in rows
        ]
    finally:
        cur.close(); conn.close()


@router.post("", status_code=201)
def write_memory(body: WriteBody):
    if not body.key.strip():
        raise HTTPException(400, "key cannot be empty")
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO shared_memory (key, value, writing_agent, tags)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (key) DO UPDATE
              SET value = EXCLUDED.value,
                  writing_agent = EXCLUDED.writing_agent,
                  tags = EXCLUDED.tags,
                  updated_at = NOW()
            RETURNING id
        """, (body.key, body.value, body.writing_agent, body.tags))
        row_id = cur.fetchone()[0]
        conn.commit()
        log.info("shared_memory: write", key=body.key, agent=body.writing_agent)
        return {"ok": True, "id": str(row_id)}
    finally:
        cur.close(); conn.close()


@router.delete("/{key:path}")
def delete_memory(key: str):
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM shared_memory WHERE key = %s RETURNING id", (key,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, f"Key '{key}' not found")
        conn.commit()
        return {"ok": True}
    finally:
        cur.close(); conn.close()


@router.get("/agents")
def list_contributing_agents():
    """Return distinct agent names that have written shared memories."""
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute(
            "SELECT writing_agent, COUNT(*) as cnt FROM shared_memory GROUP BY writing_agent ORDER BY cnt DESC"
        )
        return [{"agent": r[0], "count": r[1]} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()
