"""Voice Journal — record, transcribe and store voice memos."""
from fastapi import APIRouter, UploadFile, File, Form
import psycopg2.extras
import structlog
import datetime
import tempfile
import os

from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


@router.get("")
def list_entries(limit: int = 50):
    entries = []
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT id::text, transcription, duration_seconds, created_at
                    FROM voice_journal
                    ORDER BY created_at DESC LIMIT %s
                """, (limit,))
                for r in cur.fetchall():
                    row = dict(r)
                    row["created_at"] = row["created_at"].isoformat() if row.get("created_at") else None
                    entries.append(row)
    except Exception as e:
        log.warning("Voice journal list failed", error=str(e))
    return {"entries": entries}


@router.post("/record")
async def record_and_transcribe(
    audio: UploadFile = File(...),
    duration: float = Form(0.0),
):
    """Receive audio blob, transcribe with Whisper, store in DB + knowledge_items."""
    transcription = ""

    # Transcribe using Whisper if available
    try:
        import whisper  # type: ignore
        audio_bytes = await audio.read()
        suffix = ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        try:
            model = whisper.load_model("base")
            result = model.transcribe(tmp_path)
            transcription = result.get("text", "").strip()
        finally:
            os.unlink(tmp_path)
    except ImportError:
        # Whisper not installed — fall back to placeholder
        transcription = "(Whisper not available — install openai-whisper to enable transcription)"
    except Exception as e:
        log.warning("Whisper transcription failed", error=str(e))
        transcription = f"(Transcription failed: {e})"

    # Store in voice_journal + knowledge_items
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO voice_journal (transcription, duration_seconds)
                    VALUES (%s, %s) RETURNING id::text, created_at
                """, (transcription, duration))
                row = cur.fetchone()
                entry_id = row[0] if row else None

                # Also store in knowledge_items if transcription is meaningful
                if transcription and not transcription.startswith("("):
                    today = datetime.date.today().strftime("%b %d, %Y")
                    cur.execute("""
                        INSERT INTO knowledge_items (title, source_type, tags)
                        VALUES (%s, 'voice_journal', ARRAY['voice','journal'])
                        RETURNING id
                    """, (f"Voice Journal — {today}",))
                    ki_row = cur.fetchone()
                    if ki_row:
                        # Store transcription as the content via update
                        cur.execute(
                            "UPDATE knowledge_items SET source_url = %s WHERE id = %s",
                            (transcription[:500], ki_row[0])
                        )
    except Exception as e:
        log.warning("Voice journal store failed", error=str(e))
        return {"transcription": transcription, "saved": False, "error": str(e)}

    return {"transcription": transcription, "saved": True}


@router.delete("/{entry_id}")
def delete_entry(entry_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM voice_journal WHERE id = %s", (entry_id,))
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
