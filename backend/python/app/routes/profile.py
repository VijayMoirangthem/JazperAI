from fastapi import APIRouter
from pydantic import BaseModel
import psycopg2.extras
import structlog

from app.services.memory_service import _pg

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
