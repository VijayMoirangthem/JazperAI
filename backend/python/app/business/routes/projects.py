"""COOS — Business Platform: REST routes for Projects.

Thin FastAPI wrapper over app.business.project_service — the single source of
truth also used by the LLM tool bridge (app.business.tools).
"""

from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.business import project_service, team_service

router = APIRouter()
log = structlog.get_logger()


class ProjectCreate(BaseModel):
    client_id: str
    title: str
    description: str = ""
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    notes: str = ""


class ProjectPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None


@router.post("")
def create_project(body: ProjectCreate):
    try:
        return project_service.create_project(
            client_id=body.client_id,
            title=body.title,
            description=body.description,
            start_date=body.start_date,
            due_date=body.due_date,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("create_project failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("")
def list_projects(client_id: Optional[str] = None, status: Optional[str] = None):
    try:
        return project_service.list_projects(client_id=client_id, status=status)
    except Exception as e:
        log.warning("list_projects failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/{project_id}")
def get_project(project_id: str):
    try:
        row = project_service.get_project(project_id)
    except Exception as e:
        log.warning("get_project failed", error=str(e))
        raise HTTPException(500, str(e))
    if not row:
        raise HTTPException(404, "Project not found")
    return row


@router.patch("/{project_id}")
def patch_project(project_id: str, body: ProjectPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        row = project_service.update_project(project_id, **fields)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("patch_project failed", error=str(e))
        raise HTTPException(500, str(e))
    if not row:
        raise HTTPException(404, "Project not found")
    return row


@router.get("/{project_id}/team")
def get_project_team(project_id: str):
    try:
        return team_service.list_project_assignments(project_id)
    except Exception as e:
        log.warning("get_project_team failed", error=str(e))
        raise HTTPException(500, str(e))


@router.delete("/{project_id}")
def delete_project(project_id: str):
    try:
        existing = project_service.get_project(project_id)
        if not existing:
            raise HTTPException(404, "Project not found")
        project_service.delete_project(project_id)
    except HTTPException:
        raise
    except Exception as e:
        log.warning("delete_project failed", error=str(e))
        raise HTTPException(500, str(e))
    return Response(status_code=204)
