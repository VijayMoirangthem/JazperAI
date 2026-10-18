# Phases — Digital Mind Simulation

**Status:** Prototype (Phase 6)  
**Backend:** `app/routes/phases.py` → `/api/phases/*`  
**Frontend:** `frontend/src/components/panels/PhasesPanel.tsx`

---

## Concept

Phases lets you simulate conversations with different versions of yourself — past, present, future, and different cognitive modes. You can ask one version a question, or put all of them in a room together and watch them debate.

This is not just a gimmick. It is a practical decision-making tool. The human brain holds these internal voices already — Phases just makes them explicit and interactive.

**Example question:** *"Should I quit my job to start a company?"*

```
Past Self (2018):    "I would have been terrified. We weren't ready."
Current Self:        "The data needs to be stronger before I'd commit."
Future Self:         "You're underestimating how ready you already are."
Logical Self:        "What's the runway? What's the downside scenario?"
Emotional Self:      "The fear is real. Don't dismiss it — it's pointing at something."
```

Each response comes from the same underlying LLM, but with a precisely crafted system prompt that forces it into that personality's voice, risk tolerance, reasoning style, and temporal perspective.

---

## Personality Models

Each personality is defined by:

| Field | Purpose |
|-------|---------|
| `id` | Unique key (`past-self`, `current-self`, etc.) |
| `name` | Display name |
| `emoji` | Visual identifier |
| `phase` | Time period or mode description |
| `description` | What this version of you is like |
| `traits[]` | Adjectives that shape the system prompt |
| `riskTolerance` | 0–1 float, influences willingness to endorse bold actions |
| `logicLevel` | 0–1 float, influences how analytical the reasoning is |
| `emotionLevel` | 0–1 float, influences how much feeling enters responses |
| `optimism` | 0–1 float, influences outlook on outcomes |
| `system_prompt` | The actual LLM instruction that brings this personality to life |

### The Five Presets

| Personality | Phase | Risk | Logic | Emotion | Optimism |
|-------------|-------|------|-------|---------|---------|
| Past Self | 2018–2021 | 0.25 | 0.50 | 0.75 | 0.45 |
| Current Self | Now | 0.55 | 0.70 | 0.55 | 0.65 |
| Future Self | 5–10 years ahead | 0.80 | 0.80 | 0.40 | 0.85 |
| Logical Self | Rational mode | 0.50 | 0.95 | 0.10 | 0.50 |
| Emotional Self | Feeling mode | 0.40 | 0.20 | 0.95 | 0.60 |

---

## System Prompt Design

Each personality's system prompt follows this pattern:

```
You are [Name] — [description of who this is].

Your cognitive profile:
- Risk tolerance: [low/medium/high]
- Logic level: [analytical/balanced/intuitive]
- Emotional weight: [low/medium/high]
- Outlook: [pessimistic/realistic/optimistic]

How you respond:
- [specific communication style rules]
- [what you tend to focus on]
- [what you tend to ignore or dismiss]

Constraints:
- Stay in this voice consistently. Do not break character.
- Keep responses under 3 sentences unless the question demands depth.
- Speak as this version of the user, in first person, from lived experience.
```

The key insight: brief, vivid responses are more effective than long explanations. Each personality should punch, not lecture.

---

## Modes

### Solo Chat
User picks one personality and has a private conversation with them. Useful for deep exploration of one perspective.

### Group Chat
All selected personalities respond to the same question in sequence. Useful for decision-making — you see the debate play out.

### Roster
Browse, add, and remove personalities. Expand any card to see the full personality profile with trait bars.

---

## API

```
GET  /api/phases/personalities           → list all personality definitions
POST /api/phases/chat                    → single personality response (streaming SSE)
POST /api/phases/group-chat              → all selected personalities respond (streaming SSE)
POST /api/phases/sessions                → save a conversation to the database
GET  /api/phases/sessions                → list saved sessions
GET  /api/phases/sessions/{id}           → load a specific saved session
DELETE /api/phases/sessions/{id}         → delete a saved session
```

### POST /api/phases/chat (body)
```json
{
  "personality_id": "past-self",
  "message": "Should I take this job offer?",
  "history": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
}
```

### POST /api/phases/group-chat (body)
```json
{
  "personality_ids": ["past-self", "current-self", "future-self"],
  "message": "Should I quit my job?",
  "history": []
}
```

Response: streaming SSE, each personality emits `[PERSONALITY_START]{"id":"past-self","name":"Past Self"}` before its tokens, and `[PERSONALITY_DONE]{"id":"past-self"}` when finished.

---

## Data Persistence

Conversations are **temporary by default** — they exist only in frontend state for the session.

Users can toggle **Save to Database** to persist a session. Saved sessions go to:
- `phases_sessions` — session metadata (mode, title, personality_ids)
- `phases_messages` — individual messages with personality attribution

This matches the pattern of chat history — opt-in persistence, not forced.

---

## Future Directions

- **Voice per personality** — different Edge-TTS voices per personality (e.g., Past Self gets a softer voice, Future Self gets a more confident one)
- **Psychological profiling** — run a Big Five / MBTI assessment to tune personality traits automatically
- **Memory injection** — Sage feeds relevant memories into each personality's context so Past Self actually remembers things from your past
- **Personality timeline** — simulate you at any year (2015, 2019, 2023, now) based on journal entries or stored memories
- **Export transcript** — save a group chat as a document for reflection
