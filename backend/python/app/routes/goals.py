"""Phase 22 — OKR Goal Tracker."""
from __future__ import annotations

from typing import Optional
from datetime import date

import structlog
import psycopg2.extras
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ────────────────────────────────────────────────────────────

class GoalCreate(BaseModel):
    title: str
    description: str = ""
    type: str = "quarterly"
    target_date: Optional[date] = None


class GoalPatch(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None


class KeyResultCreate(BaseModel):
    title: str
    metric_type: str = "percent"
    current_value: float = 0
    target_value: float = 100
    unit: str = "%"


class KeyResultPatch(BaseModel):
    current_value: Optional[float] = None
    title: Optional[str] = None
    target_value: Optional[float] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _rows_to_goals(goal_rows: list, kr_rows: list) -> list:
    """Join key_results onto goals and compute progress."""
    kr_by_goal: dict = {}
    for kr in kr_rows:
        gid = str(kr["goal_id"])
        kr_by_goal.setdefault(gid, []).append(kr)

    result = []
    for g in goal_rows:
        gid = str(g["id"])
        krs = kr_by_goal.get(gid, [])
        if krs:
            progress = sum(
                min((kr["current_value"] / kr["target_value"]) * 100, 100)
                if kr["target_value"] and kr["target_value"] != 0 else 0
                for kr in krs
            ) / len(krs)
        else:
            progress = 0.0
        result.append({
            "id": gid,
            "title": g["title"],
            "description": g["description"],
            "type": g["type"],
            "status": g["status"],
            "target_date": g["target_date"].isoformat() if g.get("target_date") else None,
            "created_at": g["created_at"].isoformat() if g.get("created_at") else None,
            "progress": round(progress, 1),
            "key_results": [
                {
                    "id": str(kr["id"]),
                    "goal_id": str(kr["goal_id"]),
                    "title": kr["title"],
                    "metric_type": kr["metric_type"],
                    "current_value": kr["current_value"],
                    "target_value": kr["target_value"],
                    "unit": kr["unit"],
                    "created_at": kr["created_at"].isoformat() if kr.get("created_at") else None,
                }
                for kr in krs
            ],
        })
    return result


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("")
def list_goals(status: str = "active"):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if status == "all":
                    cur.execute("SELECT * FROM goals ORDER BY created_at DESC")
                else:
                    cur.execute(
                        "SELECT * FROM goals WHERE status = %s ORDER BY created_at DESC",
                        (status,),
                    )
                goals = [dict(g) for g in cur.fetchall()]

                goal_ids = [str(g["id"]) for g in goals]
                if goal_ids:
                    cur.execute(
                        "SELECT * FROM key_results WHERE goal_id = ANY(%s::uuid[]) ORDER BY created_at",
                        (goal_ids,),
                    )
                    krs = [dict(r) for r in cur.fetchall()]
                else:
                    krs = []

        return _rows_to_goals(goals, krs)
    except Exception as e:
        log.warning("list_goals failed", error=str(e))
        raise HTTPException(500, str(e))


@router.post("")
def create_goal(body: GoalCreate):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO goals (title, description, type, target_date)
                    VALUES (%s, %s, %s, %s)
                    RETURNING *
                    """,
                    (body.title, body.description, body.type, body.target_date),
                )
                g = dict(cur.fetchone())
            conn.commit()
        return {
            "id": str(g["id"]),
            "title": g["title"],
            "description": g["description"],
            "type": g["type"],
            "status": g["status"],
            "target_date": g["target_date"].isoformat() if g.get("target_date") else None,
            "created_at": g["created_at"].isoformat() if g.get("created_at") else None,
            "progress": 0.0,
            "key_results": [],
        }
    except Exception as e:
        log.warning("create_goal failed", error=str(e))
        raise HTTPException(500, str(e))


@router.delete("/{goal_id}")
def delete_goal(goal_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM goals WHERE id = %s", (goal_id,))
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("delete_goal failed", error=str(e))
        raise HTTPException(500, str(e))


@router.patch("/{goal_id}")
def patch_goal(goal_id: str, body: GoalPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                set_clause = ", ".join(f"{k} = %s" for k in fields)
                values = list(fields.values()) + [goal_id]
                cur.execute(
                    f"UPDATE goals SET {set_clause} WHERE id = %s RETURNING *",
                    values,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Goal not found")
                g = dict(row)
            conn.commit()
        return {
            "id": str(g["id"]),
            "title": g["title"],
            "description": g["description"],
            "type": g["type"],
            "status": g["status"],
            "target_date": g["target_date"].isoformat() if g.get("target_date") else None,
            "created_at": g["created_at"].isoformat() if g.get("created_at") else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        log.warning("patch_goal failed", error=str(e))
        raise HTTPException(500, str(e))


@router.post("/{goal_id}/key-results")
def add_key_result(goal_id: str, body: KeyResultCreate):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO key_results (goal_id, title, metric_type, current_value, target_value, unit)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (goal_id, body.title, body.metric_type, body.current_value, body.target_value, body.unit),
                )
                kr = dict(cur.fetchone())
            conn.commit()
        return {
            "id": str(kr["id"]),
            "goal_id": str(kr["goal_id"]),
            "title": kr["title"],
            "metric_type": kr["metric_type"],
            "current_value": kr["current_value"],
            "target_value": kr["target_value"],
            "unit": kr["unit"],
            "created_at": kr["created_at"].isoformat() if kr.get("created_at") else None,
        }
    except Exception as e:
        log.warning("add_key_result failed", error=str(e))
        raise HTTPException(500, str(e))


@router.patch("/{goal_id}/key-results/{kr_id}")
def patch_key_result(goal_id: str, kr_id: str, body: KeyResultPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                set_clause = ", ".join(f"{k} = %s" for k in fields)
                values = list(fields.values()) + [kr_id, goal_id]
                cur.execute(
                    f"UPDATE key_results SET {set_clause} WHERE id = %s AND goal_id = %s RETURNING *",
                    values,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Key result not found")
                kr = dict(row)
            conn.commit()
        return {
            "id": str(kr["id"]),
            "goal_id": str(kr["goal_id"]),
            "title": kr["title"],
            "metric_type": kr["metric_type"],
            "current_value": kr["current_value"],
            "target_value": kr["target_value"],
            "unit": kr["unit"],
        }
    except HTTPException:
        raise
    except Exception as e:
        log.warning("patch_key_result failed", error=str(e))
        raise HTTPException(500, str(e))


@router.delete("/{goal_id}/key-results/{kr_id}")
def delete_key_result(goal_id: str, kr_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM key_results WHERE id = %s AND goal_id = %s",
                    (kr_id, goal_id),
                )
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("delete_key_result failed", error=str(e))
        raise HTTPException(500, str(e))
