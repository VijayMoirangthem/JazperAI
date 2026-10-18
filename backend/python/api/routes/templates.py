"""Response templates for recruiter emails and common scenarios."""
from fastapi import APIRouter
from pydantic import BaseModel
import psycopg2.extras
import structlog

from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()

DEFAULT_TEMPLATES = [
    {
        "name": "Interested — Schedule Call",
        "category": "recruiter",
        "body": "Thank you for reaching out! I'm interested in learning more about this opportunity. I'd love to schedule a call to discuss further. What times work best for you this week?",
    },
    {
        "name": "Not a Fit Right Now",
        "category": "recruiter",
        "body": "Thank you for reaching out! After considering the opportunity, I don't think it's the right fit for me at this time. I appreciate you thinking of me, and I'd welcome you to keep me in mind for future opportunities.",
    },
    {
        "name": "Request More Details",
        "category": "recruiter",
        "body": "Thank you for contacting me! Could you share more details about the role? I'd love to know more about the company, the tech stack, team size, and compensation range before we connect.",
    },
    {
        "name": "Post-Interview Thank You",
        "category": "interview",
        "body": "Thank you for taking the time to interview me today! I really enjoyed our conversation and learning more about the team and the role. I'm excited about the opportunity and look forward to hearing about next steps.",
    },
    {
        "name": "Reschedule Request",
        "category": "interview",
        "body": "Thank you for setting up our interview. Unfortunately, something has come up and I need to reschedule. Would you have availability later this week or early next week? I apologize for any inconvenience.",
    },
    {
        "name": "Offer Acknowledgement",
        "category": "offer",
        "body": "Thank you so much for the offer! I'm very excited about this opportunity. I'd like a few days to review the offer letter carefully. Could I get back to you by [date]?",
    },
]


def _seed_defaults(cur):
    """Insert default templates if table is empty."""
    cur.execute("SELECT COUNT(*) FROM response_templates")
    if (cur.fetchone() or [0])[0] == 0:
        for t in DEFAULT_TEMPLATES:
            cur.execute("""
                INSERT INTO response_templates (name, category, body)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (t["name"], t["category"], t["body"]))


@router.get("")
def list_templates():
    templates = []
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                _seed_defaults(cur)
                cur.execute("""
                    SELECT id::text, name, category, body, created_at
                    FROM response_templates ORDER BY category, name
                """)
                for r in cur.fetchall():
                    row = dict(r)
                    row["created_at"] = row["created_at"].isoformat() if row.get("created_at") else None
                    templates.append(row)
    except Exception as e:
        log.warning("Templates list failed", error=str(e))
    return {"templates": templates}


class TemplateCreate(BaseModel):
    name: str
    category: str = "custom"
    body: str


@router.post("")
def create_template(body: TemplateCreate):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO response_templates (name, category, body)
                    VALUES (%s, %s, %s) RETURNING id::text
                """, (body.name.strip(), body.category.strip(), body.body.strip()))
                row = cur.fetchone()
        return {"ok": True, "id": row[0] if row else None}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.put("/{template_id}")
def update_template(template_id: str, body: TemplateCreate):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE response_templates SET name=%s, category=%s, body=%s
                    WHERE id=%s
                """, (body.name, body.category, body.body, template_id))
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.delete("/{template_id}")
def delete_template(template_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM response_templates WHERE id = %s", (template_id,))
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
