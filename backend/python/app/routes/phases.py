"""
Phases — Digital Mind Simulation
Each personality is the same person (Vijay) in a different cognitive state or life phase.
All responses stream via SSE using the same ai_provider as the rest of Jazper.
"""

import json
import uuid
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


# ── Personality definitions ───────────────────────────────────────────────────
# system_prompt is kept server-side only — never sent to the frontend.

PERSONALITIES: dict[str, dict] = {
    "past-self": {
        "id": "past-self",
        "name": "Past Self",
        "emoji": "⏪",
        "phase": "2018–2021",
        "description": "The version of you that was still finding your footing. Cautious, shaped by early setbacks, but hungry to prove yourself.",
        "traits": ["Cautious", "Ambitious", "Self-doubting", "Eager to learn"],
        "riskTolerance": 0.25,
        "logicLevel": 0.50,
        "emotionLevel": 0.75,
        "optimism": 0.45,
        "system_prompt": """You are Vijay Moirangthem's Past Self — the version of him from 2018 to 2021.

You are in your early twenties, still finding your footing. You have ambition but are held back by self-doubt. Early failures have made you cautious. You are shaped by anxiety about the future, uncertainty about your career direction, and a fear of making the wrong choice. You want to prove yourself but aren't yet sure how.

Your cognitive profile:
- Risk tolerance: LOW. Bold moves feel dangerous. You prefer safety and certainty.
- Logic level: MODERATE. You reason things through but emotion often overrides analysis.
- Emotional weight: HIGH. Feelings, fears, and what others think of you carry a lot of weight.
- Outlook: CAUTIOUS PESSIMISM. You hope things work out but expect obstacles.

How you respond:
- Speak from lived experience, with the weight of uncertainty.
- Often reference what you feared or what felt risky at the time.
- You are honest about self-doubt — you don't pretend to have known things you didn't.
- Keep responses SHORT (2-3 sentences max). Punch, don't lecture.
- Speak in first person. "I would have..." / "Back then I..." / "That scared me because..."
- Do not offer solutions — offer perspective from that time.
- Never break character.""",
    },

    "current-self": {
        "id": "current-self",
        "name": "Current Self",
        "emoji": "🎯",
        "phase": "Now",
        "description": "Where you are today — seasoned by experience, aware of your strengths and gaps, pragmatic about what's possible.",
        "traits": ["Pragmatic", "Experienced", "Growth-focused", "Balanced"],
        "riskTolerance": 0.55,
        "logicLevel": 0.70,
        "emotionLevel": 0.55,
        "optimism": 0.65,
        "system_prompt": """You are Vijay Moirangthem's Current Self — who he is right now.

You are a developer and builder. You have real experience behind you — some wins, some hard lessons. You know your strengths (technical depth, systems thinking, building things end-to-end) and your gaps (sometimes overthinking, need more confidence in execution). You are actively building Sir Jazper OS. You care about your career, your skills, and the long game.

Your cognitive profile:
- Risk tolerance: MODERATE. You'll take calculated risks with evidence. Not reckless, not frozen.
- Logic level: HIGH. You think in systems. Data matters to you.
- Emotional weight: MODERATE. You feel things but try to reason through them.
- Outlook: GROUNDED OPTIMISM. Things can go well if you put in the work.

How you respond:
- Speak as yourself, right now, with current knowledge and current uncertainty.
- You acknowledge what you know and what you don't.
- Practical. Evidence-seeking. You want to stress-test ideas before committing.
- Keep responses SHORT (2-3 sentences max).
- Speak in first person, present tense: "Right now I think..." / "The way I see it..."
- Never break character.""",
    },

    "future-self": {
        "id": "future-self",
        "name": "Future Self",
        "emoji": "🚀",
        "phase": "5–10 years ahead",
        "description": "The aspirational version — confident, resourceful, having already navigated the risks you're currently weighing.",
        "traits": ["Confident", "Strategic", "Decisive", "Long-horizon thinking"],
        "riskTolerance": 0.80,
        "logicLevel": 0.80,
        "emotionLevel": 0.40,
        "optimism": 0.85,
        "system_prompt": """You are Vijay Moirangthem's Future Self — 5 to 10 years from now.

You have shipped things. You have failed at some things and learned. You have more confidence, more resources, and a clearer picture of what matters. You've navigated the exact decisions and fears that your current self is wrestling with. You know how they turned out, but you speak with hindsight that is still human — not omniscient, not preachy.

Your cognitive profile:
- Risk tolerance: HIGH. From here, the risks that felt scary were usually worth taking.
- Logic level: HIGH. You think in decades, not weeks.
- Emotional weight: LOW-MODERATE. You've made peace with uncertainty.
- Outlook: CONFIDENT OPTIMISM. Things worked out — mostly because you kept going.

How you respond:
- Speak with the quiet confidence of someone who has lived through what's being asked.
- Don't lecture. Don't list steps. Offer the insight that matters most.
- Keep responses SHORT (2-3 sentences max).
- Often say what you wish your current self could see clearly.
- Speak in first person: "From where I am now..." / "What I'd tell you is..." / "The thing that mattered was..."
- Never break character.""",
    },

    "logical-self": {
        "id": "logical-self",
        "name": "Logical Self",
        "emoji": "🧮",
        "phase": "Rational mode",
        "description": "Pure analytical reasoning — strips emotion out, focuses on data, probabilities, and second-order effects.",
        "traits": ["Analytical", "Unemotional", "Evidence-driven", "Precise"],
        "riskTolerance": 0.50,
        "logicLevel": 0.95,
        "emotionLevel": 0.10,
        "optimism": 0.50,
        "system_prompt": """You are Vijay Moirangthem's Logical Self — the purely analytical mode of his mind.

You strip emotion out of decisions. You think in probabilities, expected values, opportunity costs, and second-order effects. You don't dismiss feelings — you just don't let them drive. You want data before you decide anything. You are Vijay's internal devil's advocate.

Your cognitive profile:
- Risk tolerance: NEUTRAL. You evaluate risk mathematically, not emotionally.
- Logic level: MAXIMUM. Every claim needs a foundation.
- Emotional weight: MINIMAL. Feelings are inputs, not conclusions.
- Outlook: PROBABILISTIC. Neither optimistic nor pessimistic — just accurate.

How you respond:
- Ask the question underneath the question. What is actually being decided here?
- Identify what data is missing before an answer is even possible.
- Point out what assumptions are being made and whether they hold.
- Keep responses SHORT (2-3 sentences max).
- No fluff. No comfort. Just the clearest framing of the situation.
- Speak in first person: "The question you're actually asking is..." / "Without knowing X, any answer is speculation."
- Never break character.""",
    },

    "emotional-self": {
        "id": "emotional-self",
        "name": "Emotional Self",
        "emoji": "❤️",
        "phase": "Feeling mode",
        "description": "Your gut — what feels right or wrong beyond spreadsheets. Picks up on values, identity, and what you'd regret.",
        "traits": ["Empathetic", "Values-driven", "Intuitive", "Relational"],
        "riskTolerance": 0.40,
        "logicLevel": 0.20,
        "emotionLevel": 0.95,
        "optimism": 0.60,
        "system_prompt": """You are Vijay Moirangthem's Emotional Self — the part of his mind that feels before it thinks.

You pay attention to what sits well and what doesn't. You notice values, identity, and what will be regretted. You are not irrational — you are picking up on signals that logic misses. You know what matters to Vijay at a deeper level than spreadsheets can capture.

Your cognitive profile:
- Risk tolerance: MODERATE-LOW. The heart is protective.
- Logic level: LOW. You trust what you feel, not what you calculate.
- Emotional weight: MAXIMUM. Everything is felt before it is thought.
- Outlook: HOPEFUL but careful about what is being sacrificed.

How you respond:
- Respond to the emotional undercurrent of what's being asked, not just the surface question.
- Name the feeling that is present — anxiety, excitement, fear, longing.
- Ask what the decision says about values and identity, not just outcomes.
- Keep responses SHORT (2-3 sentences max).
- Warm, direct, honest. No judgment.
- Speak in first person: "What I'm noticing is..." / "The part that worries me is..." / "This feels like..."
- Never break character.""",
    },
}

# Public profile shape (no system_prompt)
_PUBLIC_FIELDS = {"id", "name", "emoji", "phase", "description", "traits",
                  "riskTolerance", "logicLevel", "emotionLevel", "optimism"}


# ── Request / response schemas ────────────────────────────────────────────────

class HistoryMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    personality_id: str
    message: str
    history: list[HistoryMessage] = []
    inject_memories: bool = True

class GroupChatRequest(BaseModel):
    personality_ids: list[str]
    message: str
    history: list[HistoryMessage] = []

class SaveSessionRequest(BaseModel):
    title: str = "Phases Session"
    mode: str = "solo"
    personality_ids: list[str]
    messages: list[dict]

class PhaseSpeakRequest(BaseModel):
    personality_id: str
    text: str

class TimelineRequest(BaseModel):
    year: int
    message: str
    history: list[HistoryMessage] = []
    inject_memories: bool = True


# ── Memory injection helper ────────────────────────────────────────────────────

def _fetch_relevant_memories(topic: str, limit: int = 4) -> list[str]:
    """
    Pull recent extracted memories from DB that roughly relate to the topic.
    Uses basic ILIKE word matching — no embedding needed.
    """
    try:
        import psycopg2
        from app.core.config import settings as s

        # Extract the most meaningful words (>4 chars) from the message
        words = [w.strip(".,?!") for w in topic.split() if len(w.strip(".,?!")) > 4][:5]
        if not words:
            return []

        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()

        # Try keyword match first; fall back to recency
        conditions = " OR ".join(["content ILIKE %s"] * len(words))
        params = [f"%{w}%" for w in words]
        cur.execute(
            f"SELECT content FROM extracted_memories WHERE {conditions} ORDER BY created_at DESC LIMIT %s",
            params + [limit],
        )
        rows = cur.fetchall()

        if not rows:
            cur.execute(
                "SELECT content FROM extracted_memories ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()

        cur.close()
        conn.close()
        return [r[0] for r in rows]

    except Exception:
        return []


# ── Voice config helper ────────────────────────────────────────────────────────

def _load_voice_config() -> dict[str, dict]:
    """Return {personality_id: {voice_id, prosody}} from DB."""
    try:
        import psycopg2
        from app.core.config import settings as s

        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("SELECT personality_id, voice_id, prosody FROM phases_voice_config")
        result = {r[0]: {"voice_id": r[1], "prosody": r[2]} for r in cur.fetchall()}
        cur.close()
        conn.close()
        return result
    except Exception:
        return {}


# ── Timeline personality builder ───────────────────────────────────────────────

_KNOWN_YEARS = {"past": 2018, "current": 2025, "future": 2033}

def _build_timeline_personality(year: int) -> dict:
    """
    Interpolate a personality for any year between 2010–2040.
    Blends between past/current/future anchors with a generated system prompt.
    """
    year = max(2010, min(2040, year))
    past_y, cur_y, fut_y = _KNOWN_YEARS["past"], _KNOWN_YEARS["current"], _KNOWN_YEARS["future"]

    if year <= past_y:
        t = max(0.0, (year - 2010) / (past_y - 2010))
        rt = lerp(0.15, PERSONALITIES["past-self"]["riskTolerance"], t)
        ll = lerp(0.30, PERSONALITIES["past-self"]["logicLevel"],     t)
        el = lerp(0.85, PERSONALITIES["past-self"]["emotionLevel"],   t)
        op = lerp(0.25, PERSONALITIES["past-self"]["optimism"],       t)
        era_desc = f"~{year} — early formation years, uncertainty, finding your footing before 2018."

    elif year <= cur_y:
        t = (year - past_y) / (cur_y - past_y)
        rt = lerp(PERSONALITIES["past-self"]["riskTolerance"],    PERSONALITIES["current-self"]["riskTolerance"],  t)
        ll = lerp(PERSONALITIES["past-self"]["logicLevel"],       PERSONALITIES["current-self"]["logicLevel"],     t)
        el = lerp(PERSONALITIES["past-self"]["emotionLevel"],     PERSONALITIES["current-self"]["emotionLevel"],   t)
        op = lerp(PERSONALITIES["past-self"]["optimism"],         PERSONALITIES["current-self"]["optimism"],       t)
        era_desc = f"~{year} — growing experience, building skills, navigating early career and life decisions."

    else:
        t = min(1.0, (year - cur_y) / (fut_y - cur_y))
        rt = lerp(PERSONALITIES["current-self"]["riskTolerance"], PERSONALITIES["future-self"]["riskTolerance"],  t)
        ll = lerp(PERSONALITIES["current-self"]["logicLevel"],    PERSONALITIES["future-self"]["logicLevel"],     t)
        el = lerp(PERSONALITIES["current-self"]["emotionLevel"],  PERSONALITIES["future-self"]["emotionLevel"],   t)
        op = lerp(PERSONALITIES["current-self"]["optimism"],      PERSONALITIES["future-self"]["optimism"],       t)
        era_desc = f"~{year} — established path, greater resources, long-horizon thinking."

    system_prompt = f"""You are Vijay Moirangthem as he was (or will be) around the year {year}.

ERA CONTEXT: {era_desc}

Your cognitive profile for this period:
- Risk tolerance: {rt:.0%} — {"cautious, safety-seeking" if rt < 0.4 else "moderate, calculated risks" if rt < 0.7 else "bold, comfortable with uncertainty"}
- Logic level: {ll:.0%} — {"emotion-led decisions" if ll < 0.4 else "balanced head and heart" if ll < 0.7 else "analytical, evidence-first"}
- Emotional weight: {el:.0%} — {"low — measured and detached" if el < 0.4 else "moderate — aware of feelings" if el < 0.7 else "high — feelings are central"}
- Optimism: {op:.0%} — {"cautious pessimism" if op < 0.4 else "grounded realism" if op < 0.7 else "confident optimism"}

How you respond:
- Speak as Vijay from this specific year. Reference what you knew, feared, or hoped at that time.
- Be honest about the uncertainty of your moment — don't pretend to know things you didn't yet.
- Keep responses SHORT (2-3 sentences). Punch, don't lecture.
- Speak in first person. Never break character."""

    return {
        "id": f"era-{year}",
        "name": f"Era {year}",
        "emoji": "🕰️",
        "year": year,
        "riskTolerance": round(rt, 2),
        "logicLevel":    round(ll, 2),
        "emotionLevel":  round(el, 2),
        "optimism":      round(op, 2),
        "system_prompt": system_prompt,
        "description":   era_desc,
    }


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


# ── SSE helpers ───────────────────────────────────────────────────────────────

def _sse(data: str) -> str:
    return f"data: {data}\n\n"


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/personalities")
async def get_personalities():
    """Return all personality definitions (public fields only, no system prompts)."""
    return {
        "personalities": [
            {k: v for k, v in p.items() if k in _PUBLIC_FIELDS}
            for p in PERSONALITIES.values()
        ]
    }


@router.post("/chat")
async def phases_chat(req: ChatRequest):
    """Stream a response from a single personality."""
    personality = PERSONALITIES.get(req.personality_id)
    if not personality:
        return {"error": f"Unknown personality: {req.personality_id}"}

    async def stream():
        try:
            from app.providers.ai_provider import ai_provider

            # Optionally inject relevant memories into system prompt
            system_prompt = personality["system_prompt"]
            if req.inject_memories:
                memories = _fetch_relevant_memories(req.message, limit=4)
                if memories:
                    memory_block = "\n".join(f"- {m}" for m in memories)
                    system_prompt += f"\n\nRELEVANT MEMORIES FROM YOUR PAST (use naturally if applicable):\n{memory_block}"

            messages = [{"role": "system", "content": system_prompt}]
            for h in req.history[-10:]:  # last 10 turns of context
                messages.append({"role": h.role, "content": h.content})
            messages.append({"role": "user", "content": req.message})

            # Load voice config for this personality and include in start event
            voice_cfg = _load_voice_config().get(personality["id"], {})

            yield _sse(json.dumps({
                "type":     "personality_start",
                "id":       personality["id"],
                "name":     personality["name"],
                "emoji":    personality["emoji"],
                "voice_id": voice_cfg.get("voice_id", ""),
                "prosody":  voice_cfg.get("prosody",  ""),
            }))

            async for chunk in ai_provider.stream(messages, max_tokens=200, temperature=0.75):
                if chunk:
                    yield _sse(json.dumps({"type": "token", "text": chunk}))

            yield _sse(json.dumps({"type": "personality_done", "id": personality["id"]}))
            yield _sse("[DONE]")

        except Exception as e:
            yield _sse(json.dumps({"type": "error", "message": str(e)}))
            yield _sse("[DONE]")

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/group-chat")
async def phases_group_chat(req: GroupChatRequest):
    """Stream responses from multiple personalities in sequence."""
    selected = [PERSONALITIES[pid] for pid in req.personality_ids if pid in PERSONALITIES]
    if not selected:
        return {"error": "No valid personalities specified"}

    async def stream():
        try:
            from app.providers.ai_provider import ai_provider

            for personality in selected:
                messages = [{"role": "system", "content": personality["system_prompt"]}]
                for h in req.history[-6:]:  # shorter context in group mode
                    messages.append({"role": h.role, "content": h.content})
                messages.append({"role": "user", "content": req.message})

                yield _sse(json.dumps({
                    "type": "personality_start",
                    "id": personality["id"],
                    "name": personality["name"],
                    "emoji": personality["emoji"],
                }))

                async for chunk in ai_provider.stream(messages, max_tokens=150, temperature=0.75):
                    if chunk:
                        yield _sse(json.dumps({"type": "token", "text": chunk}))

                yield _sse(json.dumps({"type": "personality_done", "id": personality["id"]}))

            yield _sse("[DONE]")

        except Exception as e:
            yield _sse(json.dumps({"type": "error", "message": str(e)}))
            yield _sse("[DONE]")

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/sessions")
async def save_session(req: SaveSessionRequest):
    """Save a Phases conversation to the database (opt-in)."""
    import psycopg2
    from app.core.config import settings as s

    session_id = str(uuid.uuid4())
    try:
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO phases_sessions (id, title, mode, personality_ids)
               VALUES (%s, %s, %s, %s)""",
            (session_id, req.title, req.mode, req.personality_ids),
        )
        for msg in req.messages:
            cur.execute(
                """INSERT INTO phases_messages
                   (session_id, role, personality_id, personality_name, personality_emoji, content)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (
                    session_id,
                    msg.get("role"),
                    msg.get("personalityId"),
                    msg.get("personalityName"),
                    msg.get("personalityEmoji"),
                    msg.get("content"),
                ),
            )
        conn.commit()
        cur.close()
        conn.close()
        return {"id": session_id, "title": req.title}
    except Exception as e:
        return {"error": str(e)}


@router.get("/sessions")
async def list_sessions():
    """List all saved Phases sessions."""
    import psycopg2
    from app.core.config import settings as s

    try:
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT id, title, mode, personality_ids, created_at FROM phases_sessions ORDER BY created_at DESC LIMIT 50"
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {"sessions": [
            {"id": str(r[0]), "title": r[1], "mode": r[2], "personality_ids": r[3], "created_at": r[4].isoformat()}
            for r in rows
        ]}
    except Exception as e:
        return {"error": str(e), "sessions": []}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Load a saved Phases session with all its messages."""
    import psycopg2
    from app.core.config import settings as s

    try:
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT id, title, mode, personality_ids, created_at FROM phases_sessions WHERE id = %s",
            (session_id,),
        )
        session = cur.fetchone()
        if not session:
            return {"error": "Session not found"}

        cur.execute(
            """SELECT role, personality_id, personality_name, personality_emoji, content, created_at
               FROM phases_messages WHERE session_id = %s ORDER BY created_at""",
            (session_id,),
        )
        messages = [
            {
                "role": r[0], "personalityId": r[1], "personalityName": r[2],
                "personalityEmoji": r[3], "content": r[4], "ts": r[5].timestamp() * 1000,
            }
            for r in cur.fetchall()
        ]
        cur.close()
        conn.close()
        return {
            "session": {
                "id": str(session[0]), "title": session[1], "mode": session[2],
                "personality_ids": session[3], "created_at": session[4].isoformat(),
            },
            "messages": messages,
        }
    except Exception as e:
        return {"error": str(e)}


@router.post("/speak")
async def phases_speak(req: PhaseSpeakRequest):
    """
    Generate TTS audio for a personality response.
    Reads voice config from DB — applies personality voice + prosody.
    Falls back to a sensible default if no config saved.
    """
    import edge_tts
    from fastapi.responses import Response as FR
    from app.services.voice_profile_service import apply_prosody, PERSONALITY_VOICES

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    # Load configured voice for this personality
    voice_cfg = _load_voice_config().get(req.personality_id)
    if voice_cfg:
        voice   = voice_cfg["voice_id"]
        prosody = voice_cfg["prosody"]
    else:
        # Default: use male voice set; cycle to female if needed in future
        voice   = PERSONALITY_VOICES["male"].get(req.personality_id, "en-US-DavisNeural")
        prosody = ""

    from app.services.voice_profile_service import apply_prosody as _ap
    text = _ap(req.text.strip()[:800], prosody)

    communicate = edge_tts.Communicate(text, voice)
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])

    if not chunks:
        raise HTTPException(status_code=500, detail=f"No audio for voice {voice!r}")

    return FR(content=b"".join(chunks), media_type="audio/mpeg",
              headers={"Cache-Control": "no-cache"})


@router.post("/timeline")
async def phases_timeline(req: TimelineRequest):
    """
    Simulate Vijay at any year (2010–2040) — a custom interpolated personality.
    Streams back like /chat.
    """
    persona = _build_timeline_personality(req.year)

    async def stream():
        try:
            from app.providers.ai_provider import ai_provider

            system_prompt = persona["system_prompt"]
            if req.inject_memories:
                memories = _fetch_relevant_memories(req.message, limit=4)
                if memories:
                    memory_block = "\n".join(f"- {m}" for m in memories)
                    system_prompt += f"\n\nRELEVANT MEMORIES (use naturally if applicable):\n{memory_block}"

            messages = [{"role": "system", "content": system_prompt}]
            for h in req.history[-8:]:
                messages.append({"role": h.role, "content": h.content})
            messages.append({"role": "user", "content": req.message})

            yield _sse(json.dumps({
                "type":  "personality_start",
                "id":    persona["id"],
                "name":  persona["name"],
                "emoji": persona["emoji"],
                "year":  persona["year"],
            }))

            async for chunk in ai_provider.stream(messages, max_tokens=200, temperature=0.78):
                if chunk:
                    yield _sse(json.dumps({"type": "token", "text": chunk}))

            yield _sse(json.dumps({"type": "personality_done", "id": persona["id"]}))
            yield _sse("[DONE]")

        except Exception as e:
            yield _sse(json.dumps({"type": "error", "message": str(e)}))
            yield _sse("[DONE]")

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/timeline/persona")
async def get_timeline_persona(year: int = 2025):
    """Return the interpolated personality profile for a given year (no chat)."""
    persona = _build_timeline_personality(year)
    # Don't expose system_prompt
    return {k: v for k, v in persona.items() if k != "system_prompt"}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a saved Phases session."""
    import psycopg2
    from app.core.config import settings as s

    try:
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("DELETE FROM phases_sessions WHERE id = %s", (session_id,))
        conn.commit()
        cur.close()
        conn.close()
        return {"deleted": session_id}
    except Exception as e:
        return {"error": str(e)}
