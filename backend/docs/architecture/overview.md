# Sir Jazper OS — Architecture Overview

**Type:** Personal AI Operating System  
**Backend:** Single FastAPI service (`backend/python/`)  
**Frontend:** Single Next.js app (`frontend/`)  
**Rule:** All features — chat, agents, phases, jobs, memory — go through the same backend.

---

## What This System Is

Sir Jazper is not a chatbot. It is a modular AI operating system that:

- Executes tasks autonomously via specialized agents
- Remembers everything across sessions (4-tier memory)
- Reads and writes Gmail, applies to LinkedIn jobs, searches the web in real-time
- Simulates multiple versions of you for decision-making (Phases)
- Runs background agents on cron schedules without user interaction

**Core design principle:** The user opens a browser, talks to Jazper, and Jazper handles everything else. The system should feel like a capable colleague, not a chat window.

---

## High-Level Architecture

```
Browser (Next.js)
       ↓ REST + SSE + WebSocket
FastAPI Backend (Python)
       ↓
┌──────────────────────────────────────────────┐
│  AI Layer                                     │
│  Groq API (cloud) ← primary for agents       │
│  LM Studio (local) ← fallback / personal use │
└──────────────────────────────────────────────┘
       ↓
┌──────────────────────────────────────────────┐
│  Data Layer                                   │
│  PostgreSQL + pgvector  ← long-term storage  │
│  Redis                  ← sessions + cache   │
│  MinIO                  ← files + artifacts  │
└──────────────────────────────────────────────┘
       ↓
┌──────────────────────────────────────────────┐
│  External Integrations                        │
│  Gmail API, LinkedIn (Playwright)            │
│  Tavily, Brave, DuckDuckGo (web search)      │
└──────────────────────────────────────────────┘
```

---

## Request Flow — Chat Turn

```
1. User types message
   → ChatPanel POST /api/chat/stream

2. FastAPI chat_stream():
   → Load Redis session (last 20 turns)
   → Load core memories + semantic search (pgvector)
   → Check if web search needed → run Tavily if yes
   → Keyword-route to relevant agents (Scout, Hermes, Atlas, etc.)
   → Each agent runs with its own model + tools
   → Agents emit SSE events: [AGENT_START], [AGENT_DONE], [AGENT_TOOL]
   → Jazper assembles final response → stream tokens

3. Background (after [DONE]):
   → Save turn to chat_messages (PostgreSQL)
   → Embed turn → semantic_memories (pgvector)
   → LLM extract 1 memorable fact → extracted_memories
   → Update Redis session (clean history only)
```

---

## Backend Route Map

| Prefix | File | Purpose |
|--------|------|---------|
| `/health` | `routes/health.py` | Health check |
| `/api/chat` | `routes/chat.py` | Streaming chat + tool loop |
| `/api/agents` | `routes/agents.py` | Agent registry + metadata |
| `/api/phases` | `routes/phases.py` | Digital Mind Simulation |
| `/api/memory` | `routes/memory.py` | Memory CRUD + search |
| `/api/tasks` | `routes/tasks.py` | Task management |
| `/api/history` | `routes/history.py` | Chat session history |
| `/api/voice` | `routes/voice.py` | STT + TTS |
| `/api/models` | `routes/models.py` | LM Studio model loading |
| `/api/jobs` | `routes/jobs.py` | Cron jobs + runs |
| `/api/apply` | `routes/apply.py` | LinkedIn apply pipeline |
| `/api/google` | `routes/google.py` | Gmail OAuth + operations |
| `/api/profile` | `routes/profile.py` | User profile |
| `/api/dashboard` | `routes/dashboard.py` | Aggregated stats |
| `/api/notifications` | `routes/notifications.py` | Notification CRUD |
| `/api/logs` | `routes/logs.py` | Log stream (SSE) |
| `/ws` | `routes/ws.py` | WebSocket bidirectional |

---

## Scalability Design

| Concern | Approach |
|---------|----------|
| LLM streaming | SSE token-by-token — no polling |
| Blocking I/O | `ThreadPoolExecutor(max_workers=4)` |
| Async-first | All FastAPI routes are `async def` |
| Tool loop cap | `MAX_STEPS = 8` per ReAct loop |
| Session cache | Redis TTL 24h, last 20 messages |
| Vector search | IVF-flat index (lists=50) — sub-ms at millions of vectors |
| Email caching | 3-tier Redis cache — Gmail API quota protection |
| Background work | `asyncio.create_task()` after `[DONE]` |
| Search fallback | Tavily → Brave → DuckDuckGo → Wikipedia |

---

## Key Design Decisions

**Why local LLM (LM Studio) + cloud (Groq)?**
Local = privacy for personal data (emails, memories). Cloud = speed and quality for agent tasks that don't involve sensitive data.

**Why FastAPI + Python, not Node?**
Python AI ecosystem (sentence-transformers, Faster-Whisper, psycopg2+pgvector, Playwright) is far more mature.

**Why PostgreSQL + pgvector, not a dedicated vector DB?**
One database for relational + vector = simpler ops. pgvector IVF-flat matches Chroma at this scale.

**Why pre-execute web search instead of tool-calling?**
Tool-calling let the model pick queries from conversation history (wrong queries). Pre-executing with controlled query construction guarantees fresh, accurate context.

**Why APScheduler, not Celery?**
Single-user. Celery's broker infrastructure is overkill. APScheduler runs in-process, stores state in Postgres.

See [Tech Stack](tech_stack.md) for the full stack breakdown.
