"""COOS — Business Platform: REST routes for Team Members + project assignments.

Thin FastAPI wrapper over api.business.team_service — the single source of
truth also used by the LLM tool bridge (api.business.tools). Assignment
endpoints live here too since assignments are a sub-resource of both Projects
and Team Members.
"""

from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from api.business import team_service

router = APIRouter()
log = structlog.get_logger()


class TeamMemberCreate(BaseModel):
    name: str
    email: str = ""
    role: str = ""
    member_type: str = "employee"
    rate: float = 0
    rate_unit: str = "hourly"
    start_date: Optional[str] = None
    notes: str = ""


class TeamMemberPatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    member_type: Optional[str] = None
    rate: Optional[float] = None
    rate_unit: Optional[str] = None
    status: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None


class AssignmentCreate(BaseModel):
    project_id: str
    role_on_project: str = ""


@router.post("")
def create_team_member(body: TeamMemberCreate):
    try:
        return team_service.create_team_member(
            name=body.name,
            email=body.email,
            role=body.role,
            member_type=body.member_type,
            rate=body.rate,
            rate_unit=body.rate_unit,
            start_date=body.start_date,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("create_team_member failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("")
def list_team_members(member_type: Optional[str] = None, status: Optional[str] = None):
    try:
        return team_service.list_team_members(member_type=member_type, status=status)
    except Exception as e:
        log.warning("list_team_members failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/{member_id}")
def get_team_member(member_id: str):
    try:
        row = team_service.get_team_member(member_id)
    except Exception as e:
        log.warning("get_team_member failed", error=str(e))
        raise HTTPException(500, str(e))
    if not row:
        raise HTTPException(404, "Team member not found")
    return row


@router.patch("/{member_id}")
def patch_team_member(member_id: str, body: TeamMemberPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        row = team_service.update_team_member(member_id, **fields)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("patch_team_member failed", error=str(e))
        raise HTTPException(500, str(e))
    if not row:
        raise HTTPException(404, "Team member not found")
    return row


@router.delete("/{member_id}")
def delete_team_member(member_id: str):
    try:
        existing = team_service.get_team_member(member_id)
        if not existing:
            raise HTTPException(404, "Team member not found")
        team_service.delete_team_member(member_id)
    except HTTPException:
        raise
    except Exception as e:
        log.warning("delete_team_member failed", error=str(e))
        raise HTTPException(500, str(e))
    return Response(status_code=204)


@router.post("/{member_id}/assignments")
def assign_team_member(member_id: str, body: AssignmentCreate):
    try:
        return team_service.assign_to_project(
            project_id=body.project_id,
            team_member_id=member_id,
            role_on_project=body.role_on_project,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("assign_team_member failed", error=str(e))
        raise HTTPException(500, str(e))


@router.delete("/{member_id}/assignments/{project_id}")
def unassign_team_member(member_id: str, project_id: str):
    try:
        team_service.unassign_from_project(project_id=project_id, team_member_id=member_id)
    except Exception as e:
        log.warning("unassign_team_member failed", error=str(e))
        raise HTTPException(500, str(e))
    return Response(status_code=204)
