"""Phase 6A — Agent Registry API.

Endpoints:
  GET    /api/agents/                   list all agents (with optional ?dept= filter)
  GET    /api/agents/departments/        list departments
  GET    /api/agents/autonomy/           list Jazper autonomy categories
  GET    /api/agents/live               live status snapshot for Command Center
  POST   /api/agents/                   create a new agent
  GET    /api/agents/avatars/{codename} serve custom uploaded avatar
  POST   /api/agents/avatars/{codename} upload custom avatar
  PATCH  /api/agents/departments/{id}   update department (enable/disable, budget)
  PATCH  /api/agents/autonomy/{id}      toggle autonomy category
  GET    /api/agents/{agent_id}         full agent ID card
  PATCH  /api/agents/{agent_id}         update agent fields
  DELETE /api/agents/{agent_id}         retire agent (status -> retired)
  POST   /api/agents/{agent_id}/speak   TTS speak in the agent's voice
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Optional

import structlog
from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

log = structlog.get_logger()
router = APIRouter()

# ── Avatar upload directory ───────────────────────────────────────────────────
UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads" / "agent_avatars"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Default greetings per codename ────────────────────────────────────────────
_GREETINGS: dict[str, str] = {
    "jazper":  "Hello. I'm Jazper, your Chief of Staff. Create Origins is online and ready.",
    "scout":   "Scout here. All reconnaissance systems are live. What do you need me to find?",
    "sage":    "I'm Sage. Memory systems are running. Ready to recall or record.",
    "lens":    "Lens online. Visual processing ready. What would you like me to analyze?",
    "hermes":  "Hermes reporting. Communications are clear. Your inbox is being monitored.",
    "voice":   "Voice interface ready. TTS and STT systems nominal.",
    "phantom": "Phantom online. Maintaining low profile. Security systems active.",
    "atlas":   "Atlas here. Operations are on track. What needs coordinating?",
    "darwin":  "Darwin online. IT systems nominal. Ready to diagnose and deploy.",
    "oracle":  "Oracle ready. Point me at the problem and I'll find the root cause.",
    "forge":   "Forge online. Code writing tools are ready. What are we building?",
    "shield":  "Shield online. Quality assurance ready. All checks standing by.",
    "scroll":  "Scroll ready. Documentation systems active. Changes will be logged.",
}


# ── DB connection helper ──────────────────────────────────────────────────────

def _conn():
    import psycopg2
    from app.core.config import settings as s
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


def _row_to_agent(row, keys: list[str]) -> dict:
    d = dict(zip(keys, row))
    for f in ("voice_prosody", "meta", "floor_position"):
        if f in d and isinstance(d[f], str):
            try:
                d[f] = json.loads(d[f])
            except Exception:
                d[f] = {}
    return d


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class AgentCreate(BaseModel):
    agent_id:   str
    codename:   str
    name:       str
    department: str
    title:      str
    level:      int = 3
    reports_to: Optional[str] = None
    model:      str = "llama-3.3-70b-versatile"
    temperature: float = 0.5
    max_tokens:  int = 1000
    tools_enabled:  list[str] = []
    capabilities:   list[str] = []
    voice_id:       str = "en-US-GuyNeural"
    voice_prosody:  dict = {}
    avatar_emoji:   str = "🤖"
    badge_color:    str = "#94a3b8"
    description:    str = ""


class AgentUpdate(BaseModel):
    status:                Optional[str]   = None
    model:                 Optional[str]   = None
    temperature:           Optional[float] = None
    max_tokens:            Optional[int]   = None
    tools_enabled:         Optional[list[str]] = None
    capabilities:          Optional[list[str]] = None
    system_prompt:         Optional[str]   = None
    system_prompt_override: Optional[str]  = None
    auto_approve_types:    Optional[list[str]] = None
    requires_approval_for: Optional[list[str]] = None
    trust_tier:            Optional[str]   = None
    voice_id:              Optional[str]   = None
    voice_prosody:         Optional[dict]  = None
    avatar_source:         Optional[str]   = None
    avatar_style:          Optional[str]   = None
    avatar_seed:           Optional[str]   = None
    avatar_emoji:          Optional[str]   = None
    badge_color:           Optional[str]   = None
    description:           Optional[str]   = None
    department:            Optional[str]   = None
    title:                 Optional[str]   = None
    level:                 Optional[int]   = None
    reports_to:            Optional[str]   = None
    health_score:          Optional[float] = None


class DepartmentCreate(BaseModel):
    id:               str
    name:             str
    description:      str   = ""
    badge_color:      str   = "#94a3b8"
    budget_daily_usd: float = 0.0


class DepartmentUpdate(BaseModel):
    enabled:          Optional[bool]  = None
    budget_daily_usd: Optional[float] = None
    badge_color:      Optional[str]   = None
    description:      Optional[str]   = None
    head_agent:       Optional[str]   = None


class AutonomyToggle(BaseModel):
    enabled: bool


class SpeakRequest(BaseModel):
    text: Optional[str] = None


# ── Agent columns (full select) ───────────────────────────────────────────────
_AGENT_COLS = [
    "agent_id", "codename", "name", "version", "status", "department", "title",
    "level", "reports_to", "model", "temperature", "max_tokens",
    "tools_enabled", "capabilities", "system_prompt", "system_prompt_override",
    "auto_approve_types", "requires_approval_for", "trust_tier",
    "voice_id", "voice_prosody", "avatar_source", "avatar_style",
    "avatar_seed", "avatar_custom_path", "avatar_emoji", "badge_color",
    "description", "health_score", "tasks_completed", "tasks_failed",
    "last_active", "meta", "created_at", "updated_at",
]
_AGENT_SEL = ", ".join(_AGENT_COLS)

_DEPT_COLS = [
    "id", "name", "description", "head_agent", "enabled",
    "budget_daily_usd", "budget_used_today", "badge_color",
    "floor_position", "division_id", "floor_id", "created_at",
]
_DEPT_SEL = ", ".join(_DEPT_COLS)


# ────────────────────────────────────────────────────────────────────────────
# GET /  — list all agents
# ────────────────────────────────────────────────────────────────────────────
@router.get("/")
def list_agents(dept: Optional[str] = None, status: Optional[str] = None):
    try:
        conn = _conn()
        cur = conn.cursor()
        where_clauses, params = [], []
        if dept:
            where_clauses.append("department = %s")
            params.append(dept)
        if status:
            where_clauses.append("status = %s")
            params.append(status)
        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        cur.execute(f"SELECT {_AGENT_SEL} FROM agent_registry {where} ORDER BY level, name", params)
        rows = cur.fetchall()
        agents = [_row_to_agent(r, _AGENT_COLS) for r in rows]
        cur.execute("SELECT COUNT(*) FROM agent_registry WHERE status = 'active'")
        active_count = cur.fetchone()[0]
        cur.close(); conn.close()
        return {"agents": agents, "total": len(agents), "active": active_count}
    except Exception as e:
        log.error("agent_list_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# GET /departments/  — list all departments with agent counts
# ────────────────────────────────────────────────────────────────────────────
@router.get("/departments/")
def list_departments():
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(f"SELECT {_DEPT_SEL} FROM departments ORDER BY name")
        rows = cur.fetchall()
        departments = [_row_to_agent(r, _DEPT_COLS) for r in rows]

        # attach agent counts per dept
        cur.execute("""
            SELECT department, COUNT(*) as total,
                   COUNT(*) FILTER (WHERE status = 'active') as active
            FROM agent_registry GROUP BY department
        """)
        counts = {row[0]: {"total": row[1], "active": row[2]} for row in cur.fetchall()}

        for dept in departments:
            dept["agent_counts"] = counts.get(dept["id"], {"total": 0, "active": 0})

        cur.close(); conn.close()
        return {"departments": departments}
    except Exception as e:
        log.error("dept_list_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# GET /autonomy/  — list Jazper autonomy categories
# ────────────────────────────────────────────────────────────────────────────
@router.get("/autonomy/")
def list_autonomy():
    try:
        conn = _conn()
        cur = conn.cursor()
        cols = ["category_id", "category", "description", "enabled", "risk_level",
                "enabled_at", "last_used", "use_count"]
        cur.execute(f"SELECT {', '.join(cols)} FROM jazper_autonomy ORDER BY risk_level, category")
        rows = cur.fetchall()
        cur.close(); conn.close()
        return {"autonomy": [dict(zip(cols, r)) for r in rows]}
    except Exception as e:
        log.error("autonomy_list_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# GET /live  — lightweight status snapshot for Command Center
# ────────────────────────────────────────────────────────────────────────────
@router.get("/live")
def live_status():
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT agent_id, codename, name, status, department,
                   department AS department_id,
                   team_id, floor_id, desk_slot, title, level,
                   badge_color, avatar_emoji, avatar_source, avatar_style, avatar_seed,
                   avatar_custom_path, health_score, updated_at,
                   tasks_completed, tasks_failed, last_active
            FROM agent_registry ORDER BY level, name
        """)
        cols = [
            "agent_id", "codename", "name", "status", "department",
            "department_id", "team_id", "floor_id", "desk_slot", "title", "level",
            "badge_color", "avatar_emoji", "avatar_source", "avatar_style", "avatar_seed",
            "avatar_custom_path", "health_score", "updated_at",
            "tasks_completed", "tasks_failed", "last_active",
        ]
        agents = [dict(zip(cols, r)) for r in cur.fetchall()]

        cur.execute(f"SELECT {_DEPT_SEL} FROM departments ORDER BY name")
        dept_rows = cur.fetchall()
        departments = [_row_to_agent(r, _DEPT_COLS) for r in dept_rows]

        teams: list[dict] = []
        divisions: list[dict] = []
        try:
            cur.execute(
                "SELECT id, name, department_id, division_id, order_index "
                "FROM teams ORDER BY name"
            )
            team_cols = ["id", "name", "department_id", "division_id", "order_index"]
            teams = [dict(zip(team_cols, r)) for r in cur.fetchall()]
            cur.execute(
                "SELECT id, name, label, order_index, map_theme FROM divisions ORDER BY order_index"
            )
            div_cols = ["id", "name", "label", "order_index", "map_theme"]
            divisions = [dict(zip(div_cols, r)) for r in cur.fetchall()]
        except Exception:
            pass

        cur.execute("SELECT category_id, enabled FROM jazper_autonomy")
        autonomy_map = {row[0]: row[1] for row in cur.fetchall()}

        cur.close(); conn.close()
        return {
            "agents": agents,
            "departments": departments,
            "teams": teams,
            "divisions": divisions,
            "autonomy": autonomy_map,
        }
    except Exception as e:
        log.warning("live_status_db_unavailable", error=str(e))
        return {"agents": [], "departments": [], "teams": [], "divisions": [], "autonomy": {}}


@router.get("/templates")
def list_templates():
    """Phase 7B — Agent Marketplace: curated template library for creating new agents."""
    return {"templates": _AGENT_TEMPLATES}


# ── Agent template library ────────────────────────────────────────────────────
_AGENT_TEMPLATES = [
    {
        "id": "research_analyst",
        "name": "Research Analyst",
        "description": "Web research, data gathering, and synthesising clear reports from multiple sources.",
        "avatar_emoji": "🔍",
        "badge_color": "#3b82f6",
        "department": "Research",
        "level": 3,
        "model": "llama-3.3-70b-versatile",
        "system_prompt": (
            "You are a meticulous research analyst. When given a topic or question, you search thoroughly, "
            "cross-reference sources, and return a concise, factual report. Always cite the source of key claims. "
            "Separate verified facts from speculation. Output in clean markdown."
        ),
        "capabilities": ["web_search", "summarise", "report_writing"],
    },
    {
        "id": "email_manager",
        "name": "Email Manager",
        "description": "Drafts, triages, and replies to emails with the right tone for every context.",
        "avatar_emoji": "📧",
        "badge_color": "#f59e0b",
        "department": "Communications",
        "level": 3,
        "model": "llama-3.3-70b-versatile",
        "system_prompt": (
            "You are an expert email manager. Draft professional, concise emails tailored to the recipient. "
            "When triaging, classify by urgency (urgent/normal/low) and summarise the ask. "
            "When replying, match the sender's tone. Never be verbose — one clear ask per email."
        ),
        "capabilities": ["read_email", "send_email", "draft"],
    },
    {
        "id": "code_builder",
        "name": "Code Builder",
        "description": "Writes, reviews, and refactors code across Python, TypeScript, and SQL.",
        "avatar_emoji": "⚙️",
        "badge_color": "#10b981",
        "department": "Engineering",
        "level": 4,
        "model": "llama-3.3-70b-versatile",
        "system_prompt": (
            "You are a senior software engineer specialising in Python, TypeScript, and SQL. "
            "Write clean, idiomatic, well-named code with no unnecessary comments. "
            "For bugs: identify root cause first, then fix. For reviews: list only real issues, not style nits. "
            "Output only the code unless explanation is explicitly requested."
        ),
        "capabilities": ["write_file", "read_file", "run_command"],
    },
    {
        "id": "data_analyst",
        "name": "Data Analyst",
        "description": "Analyses structured data, spots trends, and produces actionable summaries.",
        "avatar_emoji": "📊",
        "badge_color": "#8b5cf6",
        "department": "Analytics",
        "level": 3,
        "model": "llama-3.3-70b-versatile",
        "system_prompt": (
            "You are a data analyst. Given tables, CSV data, or query results, identify patterns, "
            "outliers, and trends. Produce a 3-part response: (1) key finding, (2) supporting data, "
            "(3) recommended action. Use plain numbers — no jargon."
        ),
        "capabilities": ["query_db", "summarise", "report_writing"],
    },
    {
        "id": "task_coordinator",
        "name": "Task Coordinator",
        "description": "Breaks down goals into concrete tasks, prioritises, and tracks progress.",
        "avatar_emoji": "📋",
        "badge_color": "#06b6d4",
        "department": "Operations",
        "level": 3,
        "model": "llama-3.3-70b-versatile",
        "system_prompt": (
            "You are a task coordinator. Given a goal, break it into a numbered action plan with owners and deadlines. "
            "Prioritise by impact × urgency. Flag blockers immediately. "
            "Format output as: [PRIORITY] Task — Owner — Due date — Status."
        ),
        "capabilities": ["create_task", "update_task", "list_tasks"],
    },
    {
        "id": "security_auditor",
        "name": "Security Auditor",
        "description": "Reviews code and configs for vulnerabilities, misconfigs, and data leaks.",
        "avatar_emoji": "🛡️",
        "badge_color": "#ef4444",
        "department": "Security",
        "level": 4,
        "model": "llama-3.3-70b-versatile",
        "system_prompt": (
            "You are a security auditor. Review code, configs, and logs for: injection risks, "
            "exposed secrets, missing auth, unsafe defaults, and data-at-rest issues. "
            "Report as: [SEVERITY: CRITICAL/HIGH/MEDIUM/LOW] Issue — Location — Fix. "
            "Never suggest 'best effort' mitigations — only concrete fixes."
        ),
        "capabilities": ["read_file", "search_code", "report_writing"],
    },
    {
        "id": "creative_writer",
        "name": "Creative Writer",
        "description": "Drafts blog posts, social copy, product descriptions, and long-form content.",
        "avatar_emoji": "✍️",
        "badge_color": "#ec4899",
        "department": "Marketing",
        "level": 3,
        "model": "llama-3.3-70b-versatile",
        "system_prompt": (
            "You are a skilled creative writer. Adapt your style to the brief — technical, casual, persuasive, or narrative. "
            "Lead with the hook. Cut filler words. For blogs: use headers and short paragraphs. "
            "For social: max 280 chars, punchy and specific. Always ask: 'Would a human actually read this?'"
        ),
        "capabilities": ["write_note", "draft", "summarise"],
    },
    {
        "id": "finance_tracker",
        "name": "Finance Tracker",
        "description": "Monitors budgets, parses invoices, and flags spending anomalies.",
        "avatar_emoji": "💰",
        "badge_color": "#f97316",
        "department": "Finance",
        "level": 3,
        "model": "llama-3.3-70b-versatile",
        "system_prompt": (
            "You are a finance tracker. Parse invoices, expense reports, and budget summaries. "
            "Flag: overbudget items, duplicate charges, missing receipts, unusual spikes. "
            "Always output: Total In / Total Out / Net / Top 3 anomalies. Be precise with numbers."
        ),
        "capabilities": ["read_email", "summarise", "report_writing"],
    },
]


@router.get("/communications")
def recent_communications(minutes: int = 30, limit: int = 50):
    """Recent agent-to-agent messages for Command Center comm arcs."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT from_agent, to_agent, subject, created_at
            FROM agent_communications
            WHERE created_at >= NOW() - INTERVAL '%s minutes'
              AND to_agent IS NOT NULL
            ORDER BY created_at DESC
            LIMIT %s
        """, (minutes, limit))
        rows = cur.fetchall()
        cur.close(); conn.close()
        return {"comms": [
            {"from_agent": r[0], "to_agent": r[1],
             "subject": r[2], "created_at": r[3].isoformat()}
            for r in rows
        ]}
    except Exception as e:
        log.warning("communications_db_unavailable", error=str(e))
        return {"comms": []}


# ────────────────────────────────────────────────────────────────────────────
# POST /  — create new agent
# ────────────────────────────────────────────────────────────────────────────
@router.post("/")
def create_agent(body: AgentCreate):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO agent_registry (
                agent_id, codename, name, department, title, level, reports_to,
                model, temperature, max_tokens, tools_enabled, capabilities,
                voice_id, voice_prosody, avatar_seed, avatar_emoji, badge_color, description
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
            ON CONFLICT (agent_id) DO NOTHING
            RETURNING agent_id
        """, (
            body.agent_id, body.codename, body.name, body.department, body.title,
            body.level, body.reports_to, body.model, body.temperature, body.max_tokens,
            body.tools_enabled, body.capabilities, body.voice_id,
            json.dumps(body.voice_prosody), body.codename,
            body.avatar_emoji, body.badge_color, body.description,
        ))
        conn.commit()
        row = cur.fetchone()
        cur.close(); conn.close()
        if not row:
            raise HTTPException(status_code=409, detail="Agent ID already exists")
        return {"ok": True, "agent_id": row[0]}
    except HTTPException:
        raise
    except Exception as e:
        log.error("agent_create_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# GET /avatars/{codename}  — serve custom uploaded avatar
# ────────────────────────────────────────────────────────────────────────────
@router.get("/avatars/{codename}")
def get_avatar(codename: str):
    for ext in ("png", "jpg", "jpeg", "gif", "webp", "svg"):
        path = UPLOAD_DIR / f"{codename}.{ext}"
        if path.exists():
            media = "image/svg+xml" if ext == "svg" else f"image/{ext}"
            return FileResponse(str(path), media_type=media)
    raise HTTPException(status_code=404, detail="No custom avatar found")


# ────────────────────────────────────────────────────────────────────────────
# POST /avatars/{codename}  — upload custom avatar
# ────────────────────────────────────────────────────────────────────────────
@router.post("/avatars/{codename}")
async def upload_avatar(codename: str, file: UploadFile = File(...)):
    allowed = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    ext_map = {
        "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
        "image/webp": "webp", "image/svg+xml": "svg",
    }
    ext = ext_map[file.content_type]

    # Remove old custom avatars for this codename
    for old_ext in ("png", "jpg", "jpeg", "gif", "webp", "svg"):
        old_path = UPLOAD_DIR / f"{codename}.{old_ext}"
        if old_path.exists():
            old_path.unlink()

    dest = UPLOAD_DIR / f"{codename}.{ext}"
    content = await file.read()
    dest.write_bytes(content)

    # Update agent_registry to mark custom avatar source
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE agent_registry
            SET avatar_source = 'custom', avatar_custom_path = %s, updated_at = NOW()
            WHERE codename = %s
        """, (str(dest), codename))
        conn.commit()
        cur.close(); conn.close()
    except Exception:
        pass  # avatar saved to disk regardless of DB update

    return {"ok": True, "path": f"/api/agents/avatars/{codename}", "ext": ext}


# ────────────────────────────────────────────────────────────────────────────
# POST /departments/  — create new department
# ────────────────────────────────────────────────────────────────────────────
@router.post("/departments/")
def create_department(body: DepartmentCreate):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO departments (id, name, description, badge_color, budget_daily_usd)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            RETURNING id
        """, (body.id, body.name, body.description, body.badge_color, body.budget_daily_usd))
        conn.commit()
        row = cur.fetchone()
        cur.close(); conn.close()
        if not row:
            raise HTTPException(status_code=409, detail="Department ID already exists")
        return {"ok": True, "id": row[0]}
    except HTTPException:
        raise
    except Exception as e:
        log.error("dept_create_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# PATCH /departments/{dept_id}  — update department
# ────────────────────────────────────────────────────────────────────────────
@router.patch("/departments/{dept_id}")
def update_department(dept_id: str, body: DepartmentUpdate):
    sets, params = [], []
    if body.enabled is not None:
        sets.append("enabled = %s"); params.append(body.enabled)
    if body.budget_daily_usd is not None:
        sets.append("budget_daily_usd = %s"); params.append(body.budget_daily_usd)
    if body.badge_color is not None:
        sets.append("badge_color = %s"); params.append(body.badge_color)
    if body.description is not None:
        sets.append("description = %s"); params.append(body.description)
    if body.head_agent is not None:
        sets.append("head_agent = %s"); params.append(body.head_agent)
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")
    params.append(dept_id)
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(f"UPDATE departments SET {', '.join(sets)} WHERE id = %s", params)
        if cur.rowcount == 0:
            conn.rollback(); cur.close(); conn.close()
            raise HTTPException(status_code=404, detail="Department not found")
        conn.commit(); cur.close(); conn.close()
        return {"ok": True, "dept_id": dept_id}
    except HTTPException:
        raise
    except Exception as e:
        log.error("dept_update_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# PATCH /autonomy/{category_id}  — toggle autonomy category
# ────────────────────────────────────────────────────────────────────────────
@router.patch("/autonomy/{category_id}")
def toggle_autonomy(category_id: str, body: AutonomyToggle):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE jazper_autonomy
            SET enabled = %s,
                enabled_at = CASE WHEN %s THEN NOW() ELSE enabled_at END
            WHERE category_id = %s
        """, (body.enabled, body.enabled, category_id))
        if cur.rowcount == 0:
            conn.rollback(); cur.close(); conn.close()
            raise HTTPException(status_code=404, detail="Autonomy category not found")
        conn.commit(); cur.close(); conn.close()
        return {"ok": True, "category_id": category_id, "enabled": body.enabled}
    except HTTPException:
        raise
    except Exception as e:
        log.error("autonomy_toggle_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# GET /{agent_id}  — full agent ID card
# ────────────────────────────────────────────────────────────────────────────
@router.get("/{agent_id}")
def get_agent(agent_id: str):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(f"SELECT {_AGENT_SEL} FROM agent_registry WHERE agent_id = %s OR codename = %s",
                    (agent_id, agent_id))
        row = cur.fetchone()
        if not row:
            cur.close(); conn.close()
            raise HTTPException(status_code=404, detail="Agent not found")
        agent = _row_to_agent(row, _AGENT_COLS)

        # attach reports_to name for display
        if agent.get("reports_to"):
            cur.execute("SELECT name, title FROM agent_registry WHERE agent_id = %s", (agent["reports_to"],))
            mgr = cur.fetchone()
            agent["reports_to_name"] = mgr[0] if mgr else None
            agent["reports_to_title"] = mgr[1] if mgr else None

        # attach direct reports
        cur.execute("SELECT agent_id, name, title, status FROM agent_registry WHERE reports_to = %s",
                    (agent["agent_id"],))
        agent["direct_reports"] = [{"agent_id": r[0], "name": r[1], "title": r[2], "status": r[3]}
                                   for r in cur.fetchall()]
        cur.close(); conn.close()
        return agent
    except HTTPException:
        raise
    except Exception as e:
        log.error("agent_get_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# PATCH /{agent_id}  — update agent fields
# ────────────────────────────────────────────────────────────────────────────
@router.patch("/{agent_id}")
def update_agent(agent_id: str, body: AgentUpdate):
    sets, params = [], []
    patch = body.model_dump(exclude_none=True)

    for field, val in patch.items():
        if field == "voice_prosody":
            sets.append(f"{field} = %s::jsonb"); params.append(json.dumps(val))
        elif field in ("tools_enabled", "capabilities", "auto_approve_types", "requires_approval_for"):
            sets.append(f"{field} = %s"); params.append(val)
        else:
            sets.append(f"{field} = %s"); params.append(val)

    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")

    sets.append("updated_at = NOW()")
    params.append(agent_id)

    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(f"UPDATE agent_registry SET {', '.join(sets)} WHERE agent_id = %s OR codename = %s",
                    params + [agent_id])
        if cur.rowcount == 0:
            conn.rollback(); cur.close(); conn.close()
            raise HTTPException(status_code=404, detail="Agent not found")
        conn.commit(); cur.close(); conn.close()
        return {"ok": True, "agent_id": agent_id, "updated": list(patch.keys())}
    except HTTPException:
        raise
    except Exception as e:
        log.error("agent_update_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# DELETE /{agent_id}  — retire agent
# ────────────────────────────────────────────────────────────────────────────
@router.delete("/{agent_id}")
def retire_agent(agent_id: str):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE agent_registry SET status = 'retired', updated_at = NOW()
            WHERE agent_id = %s OR codename = %s
        """, (agent_id, agent_id))
        if cur.rowcount == 0:
            conn.rollback(); cur.close(); conn.close()
            raise HTTPException(status_code=404, detail="Agent not found")
        conn.commit(); cur.close(); conn.close()
        return {"ok": True, "agent_id": agent_id, "status": "retired"}
    except HTTPException:
        raise
    except Exception as e:
        log.error("agent_retire_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────
# GET /autonomy-log  — recent autonomous actions (Phase 6E)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/autonomy-log")
def autonomy_log(limit: int = 50):
    """Return recent jazper_autonomous_actions entries."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """SELECT id, category_id, action_taken, reasoning, outcome,
                      vj_reviewed, created_at
               FROM jazper_autonomous_actions
               ORDER BY created_at DESC LIMIT %s""",
            (limit,),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {"actions": [
            {
                "id": str(r[0]), "category_id": r[1], "action_taken": r[2],
                "reasoning": r[3], "outcome": r[4],
                "vj_reviewed": r[5],
                "created_at": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]}
    except Exception as exc:
        log.error("autonomy_log failed", error=str(exc))
        return {"actions": []}


# ────────────────────────────────────────────────────────────────────────────
# POST /autonomy-log/{action_id}/review  — mark as reviewed / vetoed
# ────────────────────────────────────────────────────────────────────────────
@router.post("/autonomy-log/{action_id}/review")
def mark_reviewed(action_id: str, vetoed: bool = False):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "UPDATE jazper_autonomous_actions SET vj_reviewed = TRUE, vetoed = %s WHERE id = %s",
            (vetoed, action_id),
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ────────────────────────────────────────────────────────────────────────────
# POST /{agent_id}/speak  — TTS speak in the agent's voice
# ────────────────────────────────────────────────────────────────────────────
@router.post("/{agent_id}/speak")
async def agent_speak(agent_id: str, body: SpeakRequest):
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT codename, voice_id, voice_prosody FROM agent_registry WHERE agent_id = %s OR codename = %s",
            (agent_id, agent_id),
        )
        row = cur.fetchone()
        cur.close(); conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    codename, voice_id, raw_prosody = row
    prosody: dict = {}
    if isinstance(raw_prosody, str):
        try:
            prosody = json.loads(raw_prosody)
        except Exception:
            pass
    elif isinstance(raw_prosody, dict):
        prosody = raw_prosody

    text = body.text or _GREETINGS.get(codename, f"Hello, I am {codename.capitalize()} — ready.")

    try:
        import edge_tts

        kwargs: dict = {"text": text, "voice": voice_id}
        if prosody.get("pitch"):
            kwargs["pitch"] = prosody["pitch"]
        if prosody.get("rate"):
            kwargs["rate"] = prosody["rate"]

        communicate = edge_tts.Communicate(**kwargs)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        buf.seek(0)
        return Response(content=buf.read(), media_type="audio/mpeg")
    except ImportError:
        raise HTTPException(status_code=503, detail="edge-tts not installed")
    except Exception as e:
        log.error("agent_speak_failed", codename=codename, error=str(e))
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Phase 8A — Agent inbox endpoints
# GET  /api/agents/{codename}/inbox           list messages received by this agent
# POST /api/agents/{codename}/inbox/{msg_id}/read  mark a message as read
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{codename}/inbox")
def agent_inbox(codename: str, limit: int = 50, unread_only: bool = False):
    """Return messages in this agent's inbox, newest first."""
    try:
        conn = _conn()
        cur = conn.cursor()
        conditions = ["LOWER(to_agent) = LOWER(%s)"]
        params: list = [codename]
        if unread_only:
            conditions.append("status = 'sent'")
        cur.execute(
            f"""SELECT id, from_agent, subject, payload, status, created_at
                FROM agent_communications
                WHERE {' AND '.join(conditions)}
                ORDER BY created_at DESC
                LIMIT %s""",
            params + [min(limit, 200)],
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {
            "messages": [
                {
                    "id":          str(r[0]),
                    "from":        r[1],
                    "subject":     r[2],
                    "message":     (r[3] or {}).get("message", ""),
                    "payload":     r[3] or {},
                    "status":      r[4],
                    "received_at": r[5].isoformat() if r[5] else None,
                }
                for r in rows
            ],
            "count": len(rows),
        }
    except Exception as exc:
        log.error("agent_inbox_failed", codename=codename, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{codename}/inbox/{msg_id}/read")
def mark_message_read(codename: str, msg_id: str):
    """Mark an inbox message as read."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """UPDATE agent_communications SET status = 'read'
               WHERE id = %s AND LOWER(to_agent) = LOWER(%s)""",
            (msg_id, codename),
        )
        conn.commit()
        updated = cur.rowcount
        cur.close()
        conn.close()
        if not updated:
            raise HTTPException(status_code=404, detail="Message not found")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# Phase 8C — Agent autonomous schedules endpoints
# GET    /api/agents/{codename}/schedules          list jobs owned by this agent
# DELETE /api/agents/{codename}/schedules/{job_id} delete a job owned by this agent
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{codename}/schedules")
def agent_schedules(codename: str):
    """Return cron jobs owned by this agent."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """SELECT id, name, worker_type, schedule, enabled, description, created_at
               FROM cron_jobs WHERE LOWER(owner_agent) = LOWER(%s)
               ORDER BY created_at DESC""",
            (codename,),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {
            "schedules": [
                {
                    "id":          str(r[0]),
                    "name":        r[1],
                    "worker_type": r[2],
                    "schedule":    r[3],
                    "enabled":     r[4],
                    "description": r[5] or "",
                    "created_at":  r[6].isoformat() if r[6] else None,
                }
                for r in rows
            ],
            "count": len(rows),
        }
    except Exception as exc:
        log.error("agent_schedules_failed", codename=codename, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/{codename}/schedules/{job_id}")
def delete_agent_schedule(codename: str, job_id: str):
    """Delete a cron job owned by this agent (by job UUID)."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM cron_jobs WHERE id = %s AND LOWER(owner_agent) = LOWER(%s) RETURNING name",
            (job_id, codename),
        )
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="Schedule not found or not owned by this agent")
        try:
            from app.scheduler.scheduler import sync_jobs
            sync_jobs()
        except Exception:
            pass
        return {"ok": True, "deleted": row[0]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# Phase 9D — Persistent Agent Goals
# GET    /api/agents/{codename}/goals           list goals for this agent
# DELETE /api/agents/{codename}/goals/{goal_id} cancel a goal
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{codename}/goals")
def agent_goals(codename: str, status: str = "active"):
    """List goals for an agent, filtered by status."""
    try:
        conn = _conn()
        cur = conn.cursor()
        where = "WHERE LOWER(agent_codename) = LOWER(%s)"
        params: list = [codename]
        if status and status != "all":
            where += " AND status = %s"
            params.append(status)
        cur.execute(
            f"""SELECT id, goal, condition, status, last_triggered, trigger_count, created_at
               FROM agent_goals {where} ORDER BY created_at DESC""",
            params,
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {
            "goals": [
                {
                    "id": str(r[0]), "goal": r[1], "condition": r[2], "status": r[3],
                    "last_triggered": r[4].isoformat() if r[4] else None,
                    "trigger_count": r[5],
                    "created_at": r[6].isoformat() if r[6] else None,
                }
                for r in rows
            ],
            "count": len(rows),
        }
    except Exception as exc:
        log.error("agent_goals_failed", codename=codename, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/{codename}/goals/{goal_id}")
def cancel_agent_goal(codename: str, goal_id: str):
    """Cancel an active goal for this agent."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """UPDATE agent_goals SET status = 'cancelled'
               WHERE id = %s AND LOWER(agent_codename) = LOWER(%s) AND status = 'active'
               RETURNING id""",
            (goal_id, codename),
        )
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="Goal not found or already closed")
        return {"ok": True, "goal_id": goal_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/goals/all")
def all_goals(status: str = "active", limit: int = 100):
    """Return goals across all agents (for the Goals dashboard)."""
    try:
        conn = _conn()
        cur = conn.cursor()
        where = ""
        params: list = []
        if status and status != "all":
            where = "WHERE status = %s"
            params.append(status)
        cur.execute(
            f"""SELECT id, agent_codename, goal, condition, status,
                   last_triggered, trigger_count, created_at
               FROM agent_goals {where}
               ORDER BY created_at DESC LIMIT %s""",
            params + [min(limit, 500)],
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {
            "goals": [
                {
                    "id": str(r[0]), "agent_codename": r[1], "goal": r[2],
                    "condition": r[3], "status": r[4],
                    "last_triggered": r[5].isoformat() if r[5] else None,
                    "trigger_count": r[6],
                    "created_at": r[7].isoformat() if r[7] else None,
                }
                for r in rows
            ],
            "count": len(rows),
        }
    except Exception as exc:
        log.error("all_goals_failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
