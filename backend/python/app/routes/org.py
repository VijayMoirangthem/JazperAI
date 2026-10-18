"""Org structure CRUD — divisions (floors), teams, agent reassignment."""

from __future__ import annotations

import json
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

log = structlog.get_logger()
router = APIRouter()


def _conn():
    import psycopg2
    from app.core.config import settings as s
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


class DivisionCreate(BaseModel):
    id: str
    name: str
    label: str
    order_index: int = 0
    map_theme: str = "office"


class DivisionUpdate(BaseModel):
    name: Optional[str] = None
    label: Optional[str] = None
    order_index: Optional[int] = None
    map_theme: Optional[str] = None


class TeamCreate(BaseModel):
    id: str
    name: str
    department_id: str
    division_id: Optional[str] = None
    order_index: int = 0


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    department_id: Optional[str] = None
    division_id: Optional[str] = None
    order_index: Optional[int] = None


class DepartmentCreate(BaseModel):
    id: str
    name: str
    description: str = ""
    badge_color: str = "#94a3b8"
    division_id: Optional[str] = None
    floor_id: Optional[str] = None


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    badge_color: Optional[str] = None
    division_id: Optional[str] = None
    floor_id: Optional[str] = None
    head_agent: Optional[str] = None
    floor_position: Optional[dict] = None
    enabled: Optional[bool] = None


class ActivateAgent(BaseModel):
    agent_id: str
    team_id: Optional[str] = None
    department: Optional[str] = None
    floor_id: Optional[str] = None
    desk_slot: Optional[int] = None


class MergeDepartments(BaseModel):
    source_id: str
    target_id: str


class ReassignAgent(BaseModel):
    agent_id: str
    team_id: Optional[str] = None
    department: Optional[str] = None
    floor_id: Optional[str] = None
    desk_slot: Optional[int] = None


@router.get("/divisions")
def list_divisions():
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT id, name, label, order_index, map_theme, created_at "
            "FROM divisions ORDER BY order_index"
        )
        cols = ["id", "name", "label", "order_index", "map_theme", "created_at"]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        cur.close()
        conn.close()
        return {"divisions": rows}
    except Exception as e:
        log.error("org_divisions_list_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/divisions")
def create_division(body: DivisionCreate):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO divisions (id, name, label, order_index, map_theme) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (body.id, body.name, body.label, body.order_index, body.map_theme),
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": body.id}
    except Exception as e:
        log.error("org_division_create_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/divisions/{division_id}")
def update_division(division_id: str, body: DivisionUpdate):
    sets, params = [], []
    for field, val in body.model_dump(exclude_none=True).items():
        sets.append(f"{field} = %s")
        params.append(val)
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE divisions SET {', '.join(sets)} WHERE id = %s",
            params + [division_id],
        )
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Division not found")
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": division_id}
    except HTTPException:
        raise
    except Exception as e:
        log.error("org_division_update_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/divisions/{division_id}")
def delete_division(division_id: str):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM divisions WHERE id = %s", (division_id,))
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Division not found")
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": division_id}
    except HTTPException:
        raise
    except Exception as e:
        log.error("org_division_delete_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/teams")
def list_teams():
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT id, name, department_id, division_id, order_index, created_at "
            "FROM teams ORDER BY order_index, name"
        )
        cols = ["id", "name", "department_id", "division_id", "order_index", "created_at"]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        cur.close()
        conn.close()
        return {"teams": rows}
    except Exception as e:
        log.error("org_teams_list_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/teams")
def create_team(body: TeamCreate):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO teams (id, name, department_id, division_id, order_index) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (body.id, body.name, body.department_id, body.division_id, body.order_index),
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": body.id}
    except Exception as e:
        log.error("org_team_create_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/teams/{team_id}")
def update_team(team_id: str, body: TeamUpdate):
    sets, params = [], []
    for field, val in body.model_dump(exclude_none=True).items():
        sets.append(f"{field} = %s")
        params.append(val)
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE teams SET {', '.join(sets)} WHERE id = %s",
            params + [team_id],
        )
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Team not found")
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": team_id}
    except HTTPException:
        raise
    except Exception as e:
        log.error("org_team_update_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/teams/{team_id}")
def delete_team(team_id: str):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("UPDATE agent_registry SET team_id = NULL WHERE team_id = %s", (team_id,))
        cur.execute("DELETE FROM teams WHERE id = %s", (team_id,))
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Team not found")
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": team_id}
    except HTTPException:
        raise
    except Exception as e:
        log.error("org_team_delete_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/departments")
def create_department(body: DepartmentCreate):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO departments (id, name, description, badge_color, division_id, floor_id) "
            "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (body.id, body.name, body.description, body.badge_color,
             body.division_id, body.floor_id),
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": body.id}
    except Exception as e:
        log.error("org_dept_create_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


        raise HTTPException(status_code=500, detail=str(e))


@router.get("/departments")
def list_org_departments():
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT id, name, description, badge_color, division_id, floor_id, "
            "head_agent, enabled, floor_position FROM departments ORDER BY name"
        )
        cols = ["id", "name", "description", "badge_color", "division_id", "floor_id",
                "head_agent", "enabled", "floor_position"]
        rows = []
        for r in cur.fetchall():
            d = dict(zip(cols, r))
            if isinstance(d.get("floor_position"), str):
                try:
                    d["floor_position"] = json.loads(d["floor_position"])
                except Exception:
                    d["floor_position"] = {}
            rows.append(d)
        cur.close()
        conn.close()
        return {"departments": rows}
    except Exception as e:
        log.error("org_dept_list_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/departments/{dept_id}")
def update_department(dept_id: str, body: DepartmentUpdate):
    sets, params = [], []
    patch = body.model_dump(exclude_none=True)
    for field, val in patch.items():
        if field == "floor_position":
            sets.append("floor_position = %s::jsonb")
            params.append(json.dumps(val))
        else:
            sets.append(f"{field} = %s")
            params.append(val)
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE departments SET {', '.join(sets)} WHERE id = %s",
            params + [dept_id],
        )
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Department not found")
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": dept_id}
    except HTTPException:
        raise
    except Exception as e:
        log.error("org_dept_update_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/departments/{dept_id}")
def delete_department(dept_id: str):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM agent_registry WHERE department = %s", (dept_id,))
        count = cur.fetchone()[0]
        if count > 0:
            cur.close()
            conn.close()
            raise HTTPException(
                status_code=400,
                detail=f"Department has {count} agents — reassign them first",
            )
        cur.execute("DELETE FROM teams WHERE department_id = %s", (dept_id,))
        cur.execute("DELETE FROM departments WHERE id = %s", (dept_id,))
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Department not found")
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "id": dept_id}
    except HTTPException:
        raise
    except Exception as e:
        log.error("org_dept_delete_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merge-departments")
def merge_departments(body: MergeDepartments):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "UPDATE agent_registry SET department = %s WHERE department = %s",
            (body.target_id, body.source_id),
        )
        cur.execute(
            "UPDATE teams SET department_id = %s WHERE department_id = %s",
            (body.target_id, body.source_id),
        )
        cur.execute("DELETE FROM departments WHERE id = %s", (body.source_id,))
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "merged": body.source_id, "into": body.target_id}
    except Exception as e:
        log.error("org_dept_merge_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalogue")
def list_catalogue_agents():
    """Agents not actively deployed (standby / catalogue status)."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """SELECT agent_id, codename, name, status, department, title, team_id, floor_id
               FROM agent_registry
               WHERE status NOT IN ('active', 'working', 'busy')
               ORDER BY department, name"""
        )
        cols = ["agent_id", "codename", "name", "status", "department", "title", "team_id", "floor_id"]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        cur.close()
        conn.close()
        return {"agents": rows, "count": len(rows)}
    except Exception as e:
        log.error("org_catalogue_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/activate-agent")
def activate_agent(body: ActivateAgent):
    """Deploy a catalogue / standby agent onto the floor."""
    sets = ["status = 'active'", "updated_at = NOW()"]
    params: list = []
    if body.team_id:
        sets.append("team_id = %s")
        params.append(body.team_id)
    if body.department:
        sets.append("department = %s")
        params.append(body.department)
    if body.floor_id:
        sets.append("floor_id = %s")
        params.append(body.floor_id)
    if body.desk_slot is not None:
        sets.append("desk_slot = %s")
        params.append(body.desk_slot)
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE agent_registry SET {', '.join(sets)} "
            "WHERE agent_id = %s OR codename = %s RETURNING codename",
            params + [body.agent_id, body.agent_id],
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Agent not found")
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "agent_id": row[0], "status": "active"}
    except HTTPException:
        raise
    except Exception as e:
        log.error("org_activate_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reassign-agent")
def reassign_agent(body: ReassignAgent):
    sets, params = [], []
    patch = body.model_dump(exclude_none=True, exclude={"agent_id"})
    field_map = {
        "team_id": "team_id",
        "department": "department",
        "floor_id": "floor_id",
        "desk_slot": "desk_slot",
    }
    for key, col in field_map.items():
        if key in patch:
            sets.append(f"{col} = %s")
            params.append(patch[key])
    if not sets:
        raise HTTPException(status_code=400, detail="No reassignment fields")
    sets.append("updated_at = NOW()")
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE agent_registry SET {', '.join(sets)} "
            "WHERE agent_id = %s OR codename = %s",
            params + [body.agent_id, body.agent_id],
        )
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Agent not found")
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True, "agent_id": body.agent_id, "updated": list(patch.keys())}
    except HTTPException:
        raise
    except Exception as e:
        log.error("org_reassign_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
