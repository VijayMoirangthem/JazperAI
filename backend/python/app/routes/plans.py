"""
Agent plans — multi-step task tracking.

  POST   /api/plans/                        — create a plan
  GET    /api/plans/                        — list plans (optional ?status=)
  GET    /api/plans/{id}                    — get one plan
  PATCH  /api/plans/{id}/steps/{index}      — update a step's status/result
  DELETE /api/plans/{id}                    — delete a plan
"""

import json
import uuid
import datetime
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class StepDef(BaseModel):
    title:       str
    description: str = ""
    status:      str = "pending"   # pending | running | done | failed | skipped
    result:      str = ""


class CreatePlanRequest(BaseModel):
    title:       str
    description: str = ""
    agent:       str = "Jazper"
    steps:       list[StepDef]


class UpdateStepRequest(BaseModel):
    status: str           # pending | running | done | failed | skipped
    result: str = ""


def _compute_plan_status(steps: list[dict]) -> str:
    statuses = [s.get("status", "pending") for s in steps]
    if all(s == "done" for s in statuses):
        return "completed"
    if any(s == "failed" for s in statuses):
        return "failed"
    if any(s == "running" for s in statuses):
        return "running"
    return "pending"


def _connect():
    import psycopg2
    from app.core.config import settings as s
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


@router.post("/")
async def create_plan(req: CreatePlanRequest):
    plan_id = str(uuid.uuid4())
    steps   = [s.model_dump() for s in req.steps]
    try:
        conn = _connect()
        cur  = conn.cursor()
        cur.execute(
            "INSERT INTO agent_plans (id, title, description, agent, steps) VALUES (%s, %s, %s, %s, %s)",
            (plan_id, req.title, req.description, req.agent, json.dumps(steps)),
        )
        conn.commit()
        cur.close(); conn.close()
        return {"id": plan_id, "title": req.title, "steps": steps,
                "status": "pending", "created_at": datetime.datetime.utcnow().isoformat()}
    except Exception as e:
        return {"error": str(e)}


@router.get("/")
async def list_plans(status: Optional[str] = None):
    try:
        conn = _connect()
        cur  = conn.cursor()
        if status:
            cur.execute(
                "SELECT id,title,description,agent,steps,status,created_at,updated_at FROM agent_plans WHERE status=%s ORDER BY created_at DESC LIMIT 100",
                (status,),
            )
        else:
            cur.execute(
                "SELECT id,title,description,agent,steps,status,created_at,updated_at FROM agent_plans ORDER BY created_at DESC LIMIT 100"
            )
        rows = cur.fetchall()
        cur.close(); conn.close()
        return {"plans": [_row_to_dict(r) for r in rows]}
    except Exception as e:
        return {"error": str(e), "plans": []}


@router.get("/{plan_id}")
async def get_plan(plan_id: str):
    try:
        conn = _connect()
        cur  = conn.cursor()
        cur.execute(
            "SELECT id,title,description,agent,steps,status,created_at,updated_at FROM agent_plans WHERE id=%s",
            (plan_id,),
        )
        row = cur.fetchone()
        cur.close(); conn.close()
        if not row:
            return {"error": "Plan not found"}
        return _row_to_dict(row)
    except Exception as e:
        return {"error": str(e)}


@router.patch("/{plan_id}/steps/{step_index}")
async def update_step(plan_id: str, step_index: int, req: UpdateStepRequest):
    try:
        conn = _connect()
        cur  = conn.cursor()
        cur.execute("SELECT steps FROM agent_plans WHERE id=%s", (plan_id,))
        row = cur.fetchone()
        if not row:
            cur.close(); conn.close()
            return {"error": "Plan not found"}

        steps = row[0]
        if step_index < 0 or step_index >= len(steps):
            cur.close(); conn.close()
            return {"error": f"Step index {step_index} out of range (plan has {len(steps)} steps)"}

        steps[step_index]["status"] = req.status
        steps[step_index]["result"] = req.result
        plan_status = _compute_plan_status(steps)

        cur.execute(
            "UPDATE agent_plans SET steps=%s, status=%s, updated_at=NOW() WHERE id=%s",
            (json.dumps(steps), plan_status, plan_id),
        )
        conn.commit()
        cur.close(); conn.close()
        return {"ok": True, "plan_status": plan_status, "steps": steps}
    except Exception as e:
        return {"error": str(e)}


@router.delete("/{plan_id}")
async def delete_plan(plan_id: str):
    try:
        conn = _connect()
        cur  = conn.cursor()
        cur.execute("DELETE FROM agent_plans WHERE id=%s", (plan_id,))
        conn.commit()
        cur.close(); conn.close()
        return {"deleted": plan_id}
    except Exception as e:
        return {"error": str(e)}


def _row_to_dict(r) -> dict:
    return {
        "id":          str(r[0]),
        "title":       r[1],
        "description": r[2],
        "agent":       r[3],
        "steps":       r[4],
        "status":      r[5],
        "created_at":  r[6].isoformat() if r[6] else None,
        "updated_at":  r[7].isoformat() if r[7] else None,
    }
