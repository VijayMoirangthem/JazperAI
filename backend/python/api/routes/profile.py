from fastapi import APIRouter
from pydantic import BaseModel
import psycopg2.extras
import structlog
import json

from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()

SECTION_KEYS = ["bio", "work", "goals", "preferences", "context", "notes"]


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    location: str | None = None
    email: str | None = None
    phone: str | None = None
    current_role: str | None = None
    experience_years: str | None = None
    availability: str | None = None
    work_type: str | None = None
    salary_expectation: str | None = None
    skills: list[str] | None = None
    sections: dict | None = None


def _empty_profile() -> dict:
    return {
        "full_name": "", "location": "", "email": "", "phone": "",
        "current_role": "", "experience_years": "", "availability": "",
        "work_type": "", "salary_expectation": "", "skills": [],
        "sections": {k: "" for k in SECTION_KEYS},
    }


@router.get("/")
def get_profile():
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT full_name, location, email, phone, current_role,
                           experience_years, availability, work_type,
                           salary_expectation, skills, sections, updated_at
                    FROM user_profile LIMIT 1
                """)
                row = cur.fetchone()
        if not row:
            return _empty_profile()
        data = dict(row)
        # Ensure all section keys exist
        sections = data.get("sections") or {}
        data["sections"] = {k: sections.get(k, "") for k in SECTION_KEYS}
        data["skills"] = data.get("skills") or []
        return data
    except Exception as e:
        log.warning("Failed to get profile", error=str(e))
        return _empty_profile()


@router.put("/")
def update_profile(body: ProfileUpdate):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT id FROM user_profile LIMIT 1")
                row = cur.fetchone()

            updates = body.model_dump(exclude_none=True)
            if not updates:
                return {"ok": True}

            import json
            set_clauses = []
            values = []
            for key, val in updates.items():
                set_clauses.append(f"{key} = %s")
                if key in ("skills",):
                    values.append(val)
                elif key == "sections":
                    values.append(json.dumps(val))
                else:
                    values.append(val)

            set_clauses.append("updated_at = NOW()")

            with conn.cursor() as cur:
                if row:
                    sql = f"UPDATE user_profile SET {', '.join(set_clauses)} WHERE id = %s"
                    values.append(row["id"])
                    cur.execute(sql, values)
                else:
                    # No row yet — insert
                    cols = list(updates.keys())
                    placeholders = ["%s"] * len(cols)
                    sql = f"INSERT INTO user_profile ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
                    cur.execute(sql, values[:-1] if not row else values)
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to update profile", error=str(e))
        return {"ok": False, "error": str(e)}


def get_profile_sync() -> dict | None:
    """Called from chat.py to inject profile into system prompt."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT full_name, location, email, phone, current_role,
                           experience_years, availability, work_type,
                           salary_expectation, skills, sections
                    FROM user_profile LIMIT 1
                """)
                row = cur.fetchone()
        if not row:
            return None
        data = dict(row)
        # Only return profile if at least name or role is filled
        if not data.get("full_name") and not data.get("current_role"):
            return None
        return data
    except Exception:
        return None


def format_profile_for_prompt(profile: dict) -> str:
    """Format profile as a clean system prompt block."""
    lines = ["[About the user]"]

    structured = [
        ("Name",               profile.get("full_name")),
        ("Location",           profile.get("location")),
        ("Role",               profile.get("current_role")),
        ("Experience",         profile.get("experience_years")),
        ("Availability",       profile.get("availability")),
        ("Preferred work type",profile.get("work_type")),
        ("Salary expectation", profile.get("salary_expectation")),
        ("Email",              profile.get("email")),
        ("Phone",              profile.get("phone")),
    ]
    for label, val in structured:
        if val and val.strip():
            lines.append(f"- {label}: {val.strip()}")

    skills = profile.get("skills") or []
    if skills:
        lines.append(f"- Skills: {', '.join(skills)}")

    section_labels = {
        "bio":         "Background",
        "work":        "Work & Experience",
        "goals":       "Goals & Ambitions",
        "preferences": "Preferences & Working Style",
        "context":     "Current Focus",
        "notes":       "Always remember",
    }
    sections = profile.get("sections") or {}
    for key, label in section_labels.items():
        val = sections.get(key, "").strip()
        if val:
            lines.append(f"\n[{label}]\n{val}")

    return "\n".join(lines)


# ── Load profile from a filled questionnaire doc ─────────────────────────────

class LoadDocRequest(BaseModel):
    path: str = "docs/my_profile_questionnaire.md"


@router.post("/load-doc")
async def load_profile_from_doc(body: LoadDocRequest):
    """
    Read a filled questionnaire markdown doc, extract structured profile data
    using an LLM, and write it into user_profile.
    Returns a summary of what was stored.
    """
    import pathlib
    from core.providers.ai_provider import ai_provider
    from core.config import settings

    # Resolve path relative to the repo root (two levels up from backend/python/app/routes/)
    _repo_root = pathlib.Path(__file__).parent.parent.parent.parent.parent
    doc_path = (_repo_root / body.path).resolve()

    if not doc_path.exists():
        return {"ok": False, "error": f"File not found: {body.path}"}

    raw = doc_path.read_text(encoding="utf-8")

    # Strip unanswered lines (lines where the answer block is empty)
    filled_lines = []
    for line in raw.splitlines():
        # Keep section headers and non-empty answer lines
        if line.startswith("#") or line.startswith("*") or line.startswith("---"):
            filled_lines.append(line)
        elif line.startswith("> "):
            answer = line[2:].strip()
            if answer:
                filled_lines.append(line)
        else:
            filled_lines.append(line)

    filled_doc = "\n".join(filled_lines)

    extraction_prompt = f"""You are extracting structured data from a personal profile questionnaire.

The document:
{filled_doc[:6000]}

Extract all available information and return ONLY a JSON object with these exact keys
(use null for fields not answered, empty array for unanswered list fields):

{{
  "full_name": "string or null",
  "location": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "current_role": "string or null",
  "experience_years": "string or null",
  "availability": "string or null",
  "work_type": "string or null",
  "salary_expectation": "string or null",
  "skills": ["list", "of", "skills"],
  "sections": {{
    "bio": "1-3 sentence bio from Who Are You + Background sections",
    "work": "work experience and skills summary",
    "goals": "goals from 30-day, 6-month, long-term answers",
    "preferences": "communication style and working preferences",
    "context": "current focus — job search status, blockers, what they're building",
    "notes": "anything Jazper should always remember (technical prefs, pet peeves, etc)"
  }}
}}

Return ONLY the JSON. No preamble, no explanation."""

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": extraction_prompt}],
            model=settings.AI_MODEL,
            temperature=0.1,
            max_tokens=1500,
            enable_thinking=False,
        )
        raw_json = result.content.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        extracted: dict = json.loads(raw_json)
    except Exception as e:
        log.warning("Profile extraction failed", error=str(e))
        return {"ok": False, "error": f"LLM extraction failed: {e}"}

    # Build update — only include non-null / non-empty fields
    update: dict = {}
    scalar_fields = [
        "full_name", "location", "email", "phone", "current_role",
        "experience_years", "availability", "work_type", "salary_expectation",
    ]
    for f in scalar_fields:
        v = extracted.get(f)
        if v and str(v).strip() and str(v).strip().lower() != "null":
            update[f] = str(v).strip()

    skills = extracted.get("skills") or []
    if skills:
        update["skills"] = [s for s in skills if s and str(s).strip()]

    sections_raw = extracted.get("sections") or {}
    sections_clean = {
        k: str(v).strip()
        for k, v in sections_raw.items()
        if v and str(v).strip() and str(v).strip().lower() not in ("null", "n/a", "not answered")
    }
    if sections_clean:
        update["sections"] = sections_clean

    if not update:
        return {"ok": False, "error": "No filled answers detected in the document."}

    # Write to DB
    try:
        _update_profile_dict(update)
    except Exception as e:
        log.warning("Profile write failed", error=str(e))
        return {"ok": False, "error": f"DB write failed: {e}"}

    stored_fields = list(update.keys())
    log.info("Profile loaded from doc", fields=stored_fields, path=body.path)
    return {
        "ok": True,
        "stored": stored_fields,
        "summary": (
            f"Profile updated from {body.path}. "
            f"Stored: {', '.join(stored_fields)}."
        ),
    }


def _update_profile_dict(updates: dict):
    """Write a dict of profile fields to the DB (upsert)."""
    if not updates:
        return

    set_clauses = []
    values = []
    for key, val in updates.items():
        set_clauses.append(f"{key} = %s")
        if key == "skills":
            values.append(val)
        elif key == "sections":
            values.append(json.dumps(val))
        else:
            values.append(val)
    set_clauses.append("updated_at = NOW()")

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id FROM user_profile LIMIT 1")
            row = cur.fetchone()
        with conn.cursor() as cur:
            if row:
                sql = f"UPDATE user_profile SET {', '.join(set_clauses)} WHERE id = %s"
                cur.execute(sql, values + [row["id"]])
            else:
                cols = list(updates.keys())
                placeholders = ["%s"] * len(cols)
                sql = f"INSERT INTO user_profile ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
                cur.execute(sql, values)
        conn.commit()
