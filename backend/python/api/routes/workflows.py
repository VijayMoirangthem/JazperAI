"""
Workflow routes — voice-triggered multi-agent chains.

  GET  /api/workflows/           — list all defined workflows
  POST /api/workflows/detect     — detect if text matches a workflow trigger
  POST /api/workflows/trigger    — create a plan + request approval if needed
"""

from fastapi import APIRouter
from pydantic import BaseModel
from core.services.workflow_service import detect_workflow, create_plan_for_workflow, list_workflows

router = APIRouter()


class DetectRequest(BaseModel):
    text: str


class TriggerRequest(BaseModel):
    workflow_id: str
    trigger_text: str
    auto_approve: bool = False


@router.get("/")
async def get_workflows():
    return {"workflows": list_workflows()}


@router.post("/detect")
async def detect(req: DetectRequest):
    """
    Check if the given text (e.g. voice transcript) matches a workflow trigger.
    Returns the matched workflow or null.
    """
    matched = detect_workflow(req.text)
    if not matched:
        return {"matched": False, "workflow": None}
    return {
        "matched": True,
        "workflow": {
            "id":             matched["id"],
            "name":           matched["name"],
            "agent":          matched["agent"],
            "steps":          matched["steps"],
            "needs_approval": matched["approval"] is not None,
            "approval":       matched["approval"],
        },
    }


@router.post("/trigger")
async def trigger(req: TriggerRequest):
    """
    Create a plan for the matched workflow.
    If the workflow needs approval and auto_approve is False,
    also creates an approval request via approval_service.
    Returns plan_id and approval_id (if applicable).
    """
    from core.services.workflow_service import WORKFLOWS
    from core.services import approval_service

    wf = next((w for w in WORKFLOWS if w["id"] == req.workflow_id), None)
    if not wf:
        return {"error": f"Unknown workflow: {req.workflow_id}"}

    plan_id = await create_plan_for_workflow(wf, req.trigger_text)

    approval_id = None
    if wf["approval"] and not req.auto_approve:
        appr = wf["approval"]
        approval_id, _ = await approval_service.request_approval(
            agent       = wf["agent"],
            action_type = appr["action_type"],
            description = appr["description"],
            payload     = {"workflow": wf["id"], "plan_id": plan_id, "trigger": req.trigger_text},
        )

    return {
        "plan_id":     plan_id,
        "approval_id": approval_id,
        "workflow":    wf["id"],
        "name":        wf["name"],
    }
