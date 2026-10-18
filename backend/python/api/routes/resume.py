"""Resume Manager — store and retrieve user's resume text."""
from __future__ import annotations
import io
import structlog
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


def _get_resume() -> dict:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT resume_text, resume_filename, resume_updated_at
                FROM user_profile WHERE id = 1
            """)
            row = cur.fetchone()
    if not row:
        return {"resume_text": "", "resume_filename": None, "resume_updated_at": None}
    return {
        "resume_text":       row[0] or "",
        "resume_filename":   row[1],
        "resume_updated_at": row[2].isoformat() if row[2] else None,
    }


def _save_resume(text: str, filename: str | None = None) -> None:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE user_profile
                SET resume_text = %s,
                    resume_filename = COALESCE(%s, resume_filename),
                    resume_updated_at = NOW()
                WHERE id = 1
            """, (text, filename))
        conn.commit()


@router.get("")
def get_resume():
    return _get_resume()


class ResumePasteRequest(BaseModel):
    text: str


@router.post("/text")
def save_resume_text(body: ResumePasteRequest):
    if not body.text.strip():
        raise HTTPException(400, "Resume text is empty")
    _save_resume(body.text.strip(), filename=None)
    return {"ok": True, "chars": len(body.text)}


@router.post("/upload")
async def upload_resume(file: UploadFile = File(...)):
    filename = file.filename or "resume"
    content = await file.read()

    if filename.lower().endswith(".pdf"):
        text = _extract_pdf(content)
    elif filename.lower().endswith((".txt", ".md")):
        text = content.decode("utf-8", errors="replace")
    else:
        raise HTTPException(400, "Unsupported file type. Upload PDF, TXT, or MD.")

    text = text.strip()
    if not text:
        raise HTTPException(422, "Could not extract text from file")

    _save_resume(text, filename=filename)
    return {"ok": True, "filename": filename, "chars": len(text)}


def _extract_pdf(content: bytes) -> str:
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(content))
        parts = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                parts.append(t)
        return "\n".join(parts)
    except ImportError:
        raise HTTPException(500, "pypdf not installed — run: pip install pypdf")
    except Exception as e:
        log.warning("PDF extraction failed", error=str(e))
        raise HTTPException(422, f"PDF parse error: {e}")


@router.delete("")
def delete_resume():
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE user_profile
                SET resume_text = '', resume_filename = NULL, resume_updated_at = NOW()
                WHERE id = 1
            """)
        conn.commit()
    return {"ok": True}
