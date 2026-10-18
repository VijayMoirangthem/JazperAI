"""
Voice Profile — Option D (Phases Advanced).

Routes for:
  - Recording analysis (pitch → gender/age/voice suggestions)
  - Manual gender+age selection (when librosa unavailable)
  - Saving voice assignments per personality
  - Saving Big Five psychological profile
  - Retrieving current config
"""

import json
import psycopg2
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.config import settings as s
from app.services.voice_profile_service import (
    analyze_audio,
    build_voice_assignment,
    build_age_variants,
    apply_prosody,
    big_five_to_traits,
    PERSONALITY_VOICES,
    AGE_VARIANTS,
)

router = APIRouter()


# ── DB helpers ──────────────────────────────────────────────────────────────────

def _conn():
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


# ── Schemas ─────────────────────────────────────────────────────────────────────

class ManualProfileRequest(BaseModel):
    gender: str        # "male" | "female"
    age_range: str     # "teen" | "young_adult" | "adult" | "mature" | "elder"

class VoiceAssignment(BaseModel):
    personality_id: str
    voice_id:       str
    prosody:        str = ""

class SaveVoicesRequest(BaseModel):
    assignments: list[VoiceAssignment]

class BigFiveRequest(BaseModel):
    openness:          int  # 0-100
    conscientiousness: int
    extraversion:      int
    agreeableness:     int
    neuroticism:       int

class PreviewRequest(BaseModel):
    voice: str
    prosody: str = ""
    text: str = "Hello, I'm a different version of you. What would you like to know?"


# ── Analysis ────────────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_voice(file: UploadFile = File(...)):
    """
    Accept an audio file upload (webm/wav/mp3), analyze pitch, return:
      - analysis results (pitch Hz, gender, age range)
      - recommended voice per personality
      - age/gender variants for preview
    """
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    result = analyze_audio(audio_bytes)

    gender = result.get("gender", "male")
    assignments = build_voice_assignment(gender)
    base_voice  = assignments.get("current-self", "en-US-DavisNeural")
    variants    = build_age_variants(base_voice, gender)

    return {
        "analysis":    result,
        "assignments": assignments,   # {personality_id: voice_id}
        "base_voice":  base_voice,
        "variants":    variants,
        "manual_mode": not result.get("analyzed", False),
    }


@router.post("/manual")
async def manual_profile(req: ManualProfileRequest):
    """
    Fallback when librosa is not installed — user self-selects gender and age.
    Returns voice assignments and variants matching that profile.
    """
    gender = req.gender if req.gender in ("male", "female") else "male"
    assignments = build_voice_assignment(gender)
    base_voice  = assignments.get("current-self", "en-US-DavisNeural")
    variants    = build_age_variants(base_voice, gender)

    return {
        "assignments": assignments,
        "base_voice":  base_voice,
        "variants":    variants,
    }


# ── Save voice config ───────────────────────────────────────────────────────────

@router.post("/voices")
async def save_voices(req: SaveVoicesRequest):
    """Save per-personality voice assignments to DB."""
    try:
        conn = _conn()
        cur = conn.cursor()
        for a in req.assignments:
            cur.execute(
                """INSERT INTO phases_voice_config (personality_id, voice_id, prosody, updated_at)
                   VALUES (%s, %s, %s, NOW())
                   ON CONFLICT (personality_id) DO UPDATE
                   SET voice_id = EXCLUDED.voice_id, prosody = EXCLUDED.prosody, updated_at = NOW()""",
                (a.personality_id, a.voice_id, a.prosody),
            )
        conn.commit()
        cur.close()
        conn.close()
        return {"saved": len(req.assignments)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Big Five ────────────────────────────────────────────────────────────────────

@router.post("/big-five")
async def save_big_five(req: BigFiveRequest):
    """Save Big Five scores and return computed personality trait overrides."""
    scores = req.model_dump()
    trait_overrides = big_five_to_traits(scores)

    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """UPDATE phases_profile SET
               openness=%s, conscientiousness=%s, extraversion=%s,
               agreeableness=%s, neuroticism=%s, updated_at=NOW()
               WHERE singleton=TRUE""",
            (scores["openness"], scores["conscientiousness"], scores["extraversion"],
             scores["agreeableness"], scores["neuroticism"]),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass   # DB unavailable — still return trait overrides

    return {"saved": True, "trait_overrides": trait_overrides}


# ── Get current config ──────────────────────────────────────────────────────────

@router.get("/config")
async def get_config():
    """Return current voice assignments, Big Five scores, and detected profile."""
    voices: dict = {}
    profile: dict = {}

    try:
        conn = _conn()
        cur = conn.cursor()

        cur.execute("SELECT personality_id, voice_id, prosody FROM phases_voice_config")
        for row in cur.fetchall():
            voices[row[0]] = {"voice_id": row[1], "prosody": row[2]}

        cur.execute(
            """SELECT detected_gender, detected_pitch_hz, detected_age_range, base_voice,
                      openness, conscientiousness, extraversion, agreeableness, neuroticism
               FROM phases_profile WHERE singleton=TRUE LIMIT 1"""
        )
        row = cur.fetchone()
        if row:
            profile = {
                "detected_gender":    row[0], "detected_pitch_hz": row[1],
                "detected_age_range": row[2], "base_voice":        row[3],
                "openness":           row[4], "conscientiousness": row[5],
                "extraversion":       row[6], "agreeableness":     row[7],
                "neuroticism":        row[8],
            }

        cur.close()
        conn.close()
    except Exception:
        pass

    return {"voices": voices, "profile": profile}


@router.post("/profile")
async def save_profile(body: dict):
    """Save detected voice analysis result to DB."""
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """UPDATE phases_profile SET
               detected_gender=%s, detected_pitch_hz=%s,
               detected_age_range=%s, base_voice=%s, updated_at=NOW()
               WHERE singleton=TRUE""",
            (
                body.get("gender", ""),
                body.get("mean_f0_hz", 0),
                body.get("age_range", ""),
                body.get("base_voice", ""),
            ),
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"saved": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Voice preview ───────────────────────────────────────────────────────────────

@router.post("/preview")
async def preview_voice(req: PreviewRequest):
    """
    Generate a short TTS sample for any voice + prosody combination.
    Returns MP3 audio.
    """
    import edge_tts

    text = apply_prosody(req.text.strip()[:200] or "Hello, I am your voice.", req.prosody)

    communicate = edge_tts.Communicate(text, req.voice)
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])

    if not chunks:
        raise HTTPException(status_code=500, detail=f"No audio for voice {req.voice!r}")

    return Response(content=b"".join(chunks), media_type="audio/mpeg",
                    headers={"Cache-Control": "no-cache"})


# ── Metadata ────────────────────────────────────────────────────────────────────

@router.get("/voice-sets")
async def get_voice_sets():
    """Return the full voice assignment tables for male/female."""
    return {
        "voice_sets": PERSONALITY_VOICES,
        "age_variants": {
            k: {"label": v["label"], "emoji": v["emoji"],
                "prosody": v.get("prosody", ""),
                "voice_override": v.get("voice_override")}
            for k, v in AGE_VARIANTS.items()
        },
    }
