"""Phase 11A — Automation rules CRUD + template installer."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.automation_service import (
    get_rules, create_rule, update_rule, delete_rule,
    get_templates, get_history,
)

router = APIRouter()


class RuleCreate(BaseModel):
    name: str
    trigger_event: str
    conditions: list = []
    actions: list = []


class RuleUpdate(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    conditions: list | None = None
    actions: list | None = None


@router.get("")
def list_rules():
    rules = get_rules()
    for r in rules:
        if r.get("last_fired_at"):
            r["last_fired_at"] = r["last_fired_at"].isoformat()
        if r.get("created_at"):
            r["created_at"] = r["created_at"].isoformat()
    return {"rules": rules}


@router.post("")
def add_rule(body: RuleCreate):
    result = create_rule(body.name, body.trigger_event, body.conditions, body.actions)
    return result


@router.patch("/{rule_id}")
def patch_rule(rule_id: str, body: RuleUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No updates")
    update_rule(rule_id, updates)
    return {"ok": True}


@router.delete("/{rule_id}")
def remove_rule(rule_id: str):
    delete_rule(rule_id)
    return {"ok": True}


@router.get("/templates")
def list_templates():
    return {"templates": get_templates()}


@router.post("/templates/{index}/install")
def install_template(index: int):
    templates = get_templates()
    if index < 0 or index >= len(templates):
        raise HTTPException(404, "Template not found")
    t = templates[index]
    result = create_rule(t["name"], t["trigger_event"], t["conditions"], t["actions"])
    return result


@router.get("/history")
def rule_history(limit: int = 20):
    return {"history": get_history(limit)}
