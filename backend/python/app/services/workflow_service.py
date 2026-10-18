"""
Voice-triggered workflow service — Option A.

Detects intent from a voice command and maps it to a multi-agent workflow.
Each workflow definition describes the steps; execution creates an agent_plan
and fires the appropriate agents in sequence.

Trigger detection is keyword-based (no LLM cost). The LLM only runs inside
the individual agents that the workflow launches.
"""

import re
import uuid
import json
import structlog

log = structlog.get_logger()

# ── Workflow definitions ───────────────────────────────────────────────────────

WORKFLOWS = [
    {
        "id":       "job_apply",
        "name":     "Apply to Jobs",
        "agent":    "Atlas",
        "triggers": [
            r"apply.{0,40}(job|jobs|position|role)",
            r"(find|search).{0,30}(job|jobs|opening).{0,30}apply",
            r"job.{0,20}(hunt|search|apply)",
        ],
        "steps": [
            {"title": "Scout finds matching jobs",     "description": "Web search for job openings matching your profile"},
            {"title": "Filter by preferences",         "description": "Remove blacklisted companies, wrong locations, salary range"},
            {"title": "Atlas submits applications",    "description": "Easy Apply via Playwright for each qualifying job"},
            {"title": "Record applications in DB",     "description": "Save status and URLs to job_applications table"},
        ],
        "approval": {
            "action_type": "submit_job_application",
            "description": "Apply to jobs matching your profile using Easy Apply",
        },
    },
    {
        "id":       "check_email",
        "name":     "Check Email",
        "agent":    "Hermes",
        "triggers": [
            r"check.{0,15}(email|inbox|mail)",
            r"(any|new).{0,15}(email|message|mail)",
            r"what.{0,15}(email|message|mail)",
        ],
        "steps": [
            {"title": "Hermes reads inbox",       "description": "Fetch unread emails via Gmail API"},
            {"title": "Summarise messages",       "description": "AI summary of each email"},
            {"title": "Flag action items",        "description": "Identify emails needing a reply or action"},
            {"title": "Push notifications",       "description": "Send results as notifications"},
        ],
        "approval": None,  # no approval needed for reading
    },
    {
        "id":       "web_research",
        "name":     "Deep Web Research",
        "agent":    "Scout",
        "triggers": [
            r"research.{0,30}(about|on|for)",
            r"(find|search|look up).{0,20}(information|info|details|news)",
            r"what.{0,20}(latest|recent|new).{0,20}(news|update|development)",
        ],
        "steps": [
            {"title": "Scout searches the web",        "description": "Multi-source search: Tavily → Brave → DuckDuckGo"},
            {"title": "Sage extracts key facts",       "description": "Summarise and extract structured information"},
            {"title": "Store to memory",               "description": "Save key findings to semantic memory"},
            {"title": "Return summary",                "description": "Present findings in chat"},
        ],
        "approval": None,
    },
    {
        "id":       "send_email",
        "name":     "Send Email",
        "agent":    "Hermes",
        "triggers": [
            r"send.{0,20}(email|mail|message).{0,30}to",
            r"email.{0,20}(someone|them|recruiter|company)",
            r"reply.{0,20}(email|mail|message)",
            r"write.{0,20}(email|mail|message)",
        ],
        "steps": [
            {"title": "Draft email",        "description": "Hermes writes the email based on your instruction"},
            {"title": "Wait for approval",  "description": "Show draft — you approve before sending"},
            {"title": "Send via Gmail",     "description": "Deliver email using Gmail API"},
            {"title": "Log sent email",     "description": "Record in notifications and job tracker if applicable"},
        ],
        "approval": {
            "action_type": "send_email",
            "description": "Hermes will draft and send an email on your behalf",
        },
    },
]


# ── Detection ─────────────────────────────────────────────────────────────────

def detect_workflow(text: str) -> dict | None:
    """
    Check if text matches any workflow trigger.
    Returns the matched workflow definition or None.
    """
    text_lower = text.lower().strip()
    for wf in WORKFLOWS:
        for pattern in wf["triggers"]:
            if re.search(pattern, text_lower, re.IGNORECASE):
                log.info("Workflow detected", id=wf["id"], pattern=pattern[:40])
                return wf
    return None


# ── Plan creation ─────────────────────────────────────────────────────────────

async def create_plan_for_workflow(workflow: dict, trigger_text: str) -> str | None:
    """
    Persist an agent_plans row for this workflow.
    Returns plan_id or None on failure.
    """
    plan_id = str(uuid.uuid4())
    steps   = [dict(s, status="pending", result="") for s in workflow["steps"]]
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO agent_plans (id, title, description, agent, steps) VALUES (%s,%s,%s,%s,%s)",
            (plan_id, workflow["name"], f'Triggered by: "{trigger_text}"',
             workflow["agent"], json.dumps(steps)),
        )
        conn.commit()
        cur.close(); conn.close()
        return plan_id
    except Exception as e:
        log.warning("workflow: plan persist failed", error=str(e))
        return None


# ── Plan completion ───────────────────────────────────────────────────────────

def complete_plan_sync(plan_id: str, success: bool = True) -> None:
    """Mark all steps done/failed and plan as completed/failed."""
    step_status = "done" if success else "failed"
    plan_status = "completed" if success else "failed"
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("SELECT steps FROM agent_plans WHERE id=%s", (plan_id,))
        row = cur.fetchone()
        if row:
            steps = [dict(step, status=step_status) for step in row[0]]
            cur.execute(
                "UPDATE agent_plans SET steps=%s, status=%s, updated_at=NOW() WHERE id=%s",
                (json.dumps(steps), plan_status, plan_id),
            )
            conn.commit()
        cur.close(); conn.close()
    except Exception as e:
        log.warning("workflow: complete_plan failed", plan_id=plan_id, error=str(e))


# ── Per-step tracking ─────────────────────────────────────────────────────────

def update_plan_step_sync(plan_id: str, step_idx: int, status: str, result: str = "") -> None:
    """Mark a single step inside an agent_plans row as running/done/failed."""
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("SELECT steps FROM agent_plans WHERE id=%s", (plan_id,))
        row = cur.fetchone()
        if row:
            steps = list(row[0])
            if step_idx < len(steps):
                steps[step_idx] = dict(steps[step_idx], status=status, result=result)
                cur.execute(
                    "UPDATE agent_plans SET steps=%s, status='running', updated_at=NOW() WHERE id=%s",
                    (json.dumps(steps), plan_id),
                )
                conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        log.warning("workflow: update_plan_step failed", plan_id=plan_id, step=step_idx, error=str(e))


# ── Public summary for API ────────────────────────────────────────────────────

def list_workflows() -> list[dict]:
    return [
        {
            "id":      w["id"],
            "name":    w["name"],
            "agent":   w["agent"],
            "steps":   len(w["steps"]),
            "needs_approval": w["approval"] is not None,
        }
        for w in WORKFLOWS
    ]
