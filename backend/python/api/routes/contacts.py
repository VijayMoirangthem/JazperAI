"""LinkedIn CRM — track recruiters and professional contacts."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.services.memory_service import _pg

router = APIRouter()


def _fmt(row, cols) -> dict:
    r = dict(zip(cols, row))
    r["id"] = str(r["id"])
    for k in ("last_contact_at", "created_at", "updated_at"):
        if r.get(k):
            r[k] = r[k].isoformat()
    return r


@router.get("")
def list_contacts(q: str = "", limit: int = 100):
    with _pg() as conn:
        with conn.cursor() as cur:
            if q:
                cur.execute("""
                    SELECT id, name, company, title, email, linkedin_url,
                           phone, relationship_type, last_contact_at, notes, tags, created_at, updated_at
                    FROM contacts
                    WHERE name ILIKE %s OR company ILIKE %s OR email ILIKE %s
                    ORDER BY created_at DESC LIMIT %s
                """, (f"%{q}%", f"%{q}%", f"%{q}%", limit))
            else:
                cur.execute("""
                    SELECT id, name, company, title, email, linkedin_url,
                           phone, relationship_type, last_contact_at, notes, tags, created_at, updated_at
                    FROM contacts ORDER BY created_at DESC LIMIT %s
                """, (limit,))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
    return {"contacts": [_fmt(r, cols) for r in rows]}


class ContactCreate(BaseModel):
    name: str
    company: str = ""
    title: str = ""
    email: str = ""
    linkedin_url: str = ""
    phone: str = ""
    relationship_type: str = "recruiter"
    notes: str = ""
    tags: list[str] = []


class ContactUpdate(BaseModel):
    name: str | None = None
    company: str | None = None
    title: str | None = None
    email: str | None = None
    linkedin_url: str | None = None
    phone: str | None = None
    relationship_type: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    last_contact_at: str | None = None


@router.post("")
def create_contact(body: ContactCreate):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO contacts
                    (name, company, title, email, linkedin_url, phone,
                     relationship_type, notes, tags)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (body.name, body.company, body.title, body.email,
                  body.linkedin_url, body.phone, body.relationship_type,
                  body.notes, body.tags))
            contact_id = cur.fetchone()[0]
        conn.commit()
    return {"id": str(contact_id), "name": body.name}


@router.patch("/{contact_id}")
def update_contact(contact_id: str, body: ContactUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No updates provided")
    parts = [f"{k} = %s" for k in updates]
    vals = list(updates.values()) + [contact_id]
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE contacts SET {', '.join(parts)}, updated_at = NOW() WHERE id = %s",
                vals,
            )
        conn.commit()
    return {"ok": True}


@router.delete("/{contact_id}")
def delete_contact(contact_id: str):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM contacts WHERE id = %s", (contact_id,))
        conn.commit()
    return {"ok": True}


@router.get("/networking")
def get_networking():
    """Contacts suitable for outreach — recruiters, hiring managers, or anyone with active outreach."""
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, company, title, email, linkedin_url,
                       phone, relationship_type, last_contact_at, notes, tags,
                       outreach_status, outreach_notes, outreach_at,
                       created_at, updated_at
                FROM contacts
                WHERE relationship_type IN ('recruiter', 'hiring_manager')
                   OR outreach_status IS DISTINCT FROM 'none'
                ORDER BY outreach_at DESC NULLS LAST
            """)
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()

    contacts = []
    for r in rows:
        row = dict(zip(cols, r))
        row["id"] = str(row["id"])
        for k in ("last_contact_at", "outreach_at", "created_at", "updated_at"):
            if row.get(k):
                row[k] = row[k].isoformat()
        contacts.append(row)

    pipeline: dict[str, int] = {"none": 0, "contacted": 0, "replied": 0, "warm": 0, "referred": 0}
    for c in contacts:
        status = c.get("outreach_status") or "none"
        if status in pipeline:
            pipeline[status] += 1

    return {"contacts": contacts, "pipeline": pipeline}


class OutreachUpdate(BaseModel):
    outreach_status: str  # none | contacted | replied | warm | referred
    outreach_notes: str = ""


@router.patch("/{contact_id}/outreach")
def update_outreach(contact_id: str, body: OutreachUpdate):
    """Update the outreach status and notes for a contact."""
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE contacts
                SET outreach_status = %s,
                    outreach_notes  = %s,
                    outreach_at     = NOW(),
                    updated_at      = NOW()
                WHERE id = %s
            """, (body.outreach_status, body.outreach_notes, contact_id))
        conn.commit()
    return {"ok": True}


@router.post("/{contact_id}/touch")
def touch_contact(contact_id: str):
    """Record that we contacted this person today."""
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE contacts SET last_contact_at = NOW(), updated_at = NOW() WHERE id = %s",
                (contact_id,),
            )
        conn.commit()
    return {"ok": True}
