"""Phase 24 — Portfolio Tracker."""
from __future__ import annotations

import json
from typing import Optional, List

import psycopg2.extras
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.providers.ai_provider import ai_provider
from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ─────────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    tech_stack: Optional[List[str]] = []
    github_url: Optional[str] = ""
    live_url: Optional[str] = ""


class PortfolioUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tech_stack: Optional[List[str]] = None
    github_url: Optional[str] = None
    live_url: Optional[str] = None
    status: Optional[str] = None


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _fmt(r: dict) -> dict:
    out = {}
    for k, v in r.items():
        if v is None:
            out[k] = None
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif hasattr(v, "hex"):
            out[k] = str(v)
        else:
            out[k] = v
    return out


async def _generate_pitch(name: str, description: str, tech_stack: List[str]) -> str:
    """Call the LLM to generate a 1-line project pitch (max 20 words)."""
    tech_str = ", ".join(tech_stack) if tech_stack else "various technologies"
    prompt = (
        f"Generate a compelling 1-sentence pitch (max 20 words) for this project: {name}. "
        f"Description: {description}. Tech: {tech_str}."
    )
    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            max_tokens=100,
            temperature=0.4,
        )
        return result.content.strip().strip('"').strip("'")
    except Exception as exc:
        log.warning("portfolio: pitch generation failed", error=str(exc))
        return ""


# ── Routes ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_portfolio():
    """List all active portfolio items."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM portfolio_items WHERE status = 'active' ORDER BY created_at DESC"
                )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"items": [_fmt(r) for r in rows]}


@router.post("")
async def create_portfolio_item(body: PortfolioCreate):
    """Create a new portfolio item and generate a pitch via AI."""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name is required")

    pitch = await _generate_pitch(
        name,
        body.description or "",
        body.tech_stack or [],
    )

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO portfolio_items
                        (name, description, tech_stack, github_url, live_url, pitch)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (
                        name,
                        body.description or "",
                        body.tech_stack or [],
                        body.github_url or "",
                        body.live_url or "",
                        pitch,
                    ),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    return _fmt(row)


@router.patch("/{item_id}")
async def update_portfolio_item(item_id: str, body: PortfolioUpdate):
    """Update a portfolio item. Regenerates pitch if name/description/tech_stack change."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    # Regenerate pitch if content-related fields are changing
    pitch_fields = {"name", "description", "tech_stack"}
    needs_pitch = bool(pitch_fields & set(updates.keys()))

    if needs_pitch:
        # Fetch current item to fill in any un-changed fields for pitch generation
        try:
            with _pg() as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        "SELECT name, description, tech_stack FROM portfolio_items WHERE id = %s::uuid",
                        (item_id,),
                    )
                    current = cur.fetchone()
        except Exception as e:
            raise HTTPException(500, str(e))

        if not current:
            raise HTTPException(404, "Portfolio item not found")

        pitch_name = updates.get("name", current["name"])
        pitch_desc = updates.get("description", current["description"])
        pitch_tech = updates.get("tech_stack", current["tech_stack"] or [])
        new_pitch = await _generate_pitch(pitch_name, pitch_desc, pitch_tech)
        if new_pitch:
            updates["pitch"] = new_pitch

    set_parts = [f"{k} = %s" for k in updates]
    values = list(updates.values()) + [item_id]

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"UPDATE portfolio_items SET {', '.join(set_parts)} WHERE id = %s::uuid RETURNING *",
                    values,
                )
                row = cur.fetchone()
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if not row:
        raise HTTPException(404, "Portfolio item not found")
    return _fmt(dict(row))


@router.delete("/{item_id}")
def delete_portfolio_item(item_id: str):
    """Delete a portfolio item."""
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM portfolio_items WHERE id = %s::uuid",
                    (item_id,),
                )
                deleted = cur.rowcount
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if deleted == 0:
        raise HTTPException(404, "Portfolio item not found")
    return {"ok": True, "deleted_id": item_id}
