"""Global search — ILIKE across tasks, applications, contacts, knowledge, notifications."""
from fastapi import APIRouter
import psycopg2.extras

from memory.db.legacy_pg import _pg

router = APIRouter()


@router.get("")
def global_search(q: str = ""):
    q = q.strip()
    if not q or len(q) < 2:
        return {"query": q, "tasks": [], "applications": [], "contacts": [], "knowledge": [], "notifications": []}

    pat = f"%{q}%"
    out: dict = {"query": q, "tasks": [], "applications": [], "contacts": [], "knowledge": [], "notifications": []}

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT id::text, title, status, priority,
                           CASE WHEN due_at IS NOT NULL THEN due_at::text ELSE NULL END AS due_at
                    FROM tasks WHERE title ILIKE %s OR notes ILIKE %s
                    ORDER BY created_at DESC LIMIT 5
                """, (pat, pat))
                out["tasks"] = [dict(r) for r in cur.fetchall()]

                cur.execute("""
                    SELECT id::text, company, title, status,
                           CASE WHEN applied_at IS NOT NULL THEN applied_at::text ELSE NULL END AS applied_at
                    FROM job_applications WHERE company ILIKE %s OR title ILIKE %s OR notes ILIKE %s
                    ORDER BY applied_at DESC LIMIT 5
                """, (pat, pat, pat))
                out["applications"] = [dict(r) for r in cur.fetchall()]

                cur.execute("""
                    SELECT id::text, name, company, title, email, relationship_type
                    FROM contacts WHERE name ILIKE %s OR company ILIKE %s OR email ILIKE %s OR notes ILIKE %s
                    ORDER BY created_at DESC LIMIT 5
                """, (pat, pat, pat, pat))
                out["contacts"] = [dict(r) for r in cur.fetchall()]

                cur.execute("""
                    SELECT id::text, title, source_type, tags
                    FROM knowledge_items WHERE title ILIKE %s OR content ILIKE %s
                    ORDER BY created_at DESC LIMIT 5
                """, (pat, pat))
                out["knowledge"] = [dict(r) for r in cur.fetchall()]

                cur.execute("""
                    SELECT id::text, title, body, type, read,
                           CASE WHEN created_at IS NOT NULL THEN created_at::text ELSE NULL END AS created_at
                    FROM notifications WHERE title ILIKE %s OR body ILIKE %s
                    ORDER BY created_at DESC LIMIT 5
                """, (pat, pat))
                out["notifications"] = [dict(r) for r in cur.fetchall()]
    except Exception:
        pass

    return out
