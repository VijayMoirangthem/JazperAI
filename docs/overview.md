# Sir Jazper OS — Technical Overview

> Personal AI operating system for productivity automation.
> Built for resume preparation, interview reference, and project documentation.

---

## Project Overview

**Name:** Sir Jazper OS

**Elevator pitch:** A self-hosted, privacy-first AI operating system that acts as a personal assistant — reading and writing Gmail, searching the web in real-time, automating LinkedIn job applications, managing tasks and memory, and running background cron agents — all driven by a locally-running LLM.

**Problem solved:** Consumer AI tools (ChatGPT, Copilot) are stateless, cloud-dependent, and can't take real actions. Sir Jazper is a local-first system with persistent memory, direct Gmail/LinkedIn integration, and an agentic backend that can act autonomously on your behalf.

**Target user:** A single person (developer / job-seeker) who wants an AI that knows their history, manages their inbox, applies to jobs, and stays running 24/7 — without sending personal data to third-party clouds.

**Main use case:** Daily productivity hub. Open browser → see dashboard stats → ask Jazper anything → let it handle email, job applications, and research while you work.

---

## System Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, Radix UI / shadcn |
| **Backend** | Python 3.11, FastAPI 0.111, Uvicorn (ASGI), Pydantic v2 |
| **LLM Inference** | LM Studio (local), OpenAI-compatible API. Default model: `qwen/qwen3.5-9b` |
| **Embeddings** | sentence-transformers `all-MiniLM-L6-v2`, 384-dim, runs fully local |
| **Speech** | Faster-Whisper (STT, CPU), Edge-TTS (TTS, Microsoft Neural voices) |
| **Database** | PostgreSQL 16 + pgvector extension (vector similarity search) |
| **Cache / Sessions** | Redis 7 |
| **Object Storage** | MinIO (S3-compatible, self-hosted) |
| **Browser Automation** | Playwright (LinkedIn job apply) |
| **Job Scheduler** | APScheduler 3.10 (cron-based background agents) |
| **Logging** | structlog (ring buffer + SSE live stream) |
| **Containerisation** | Docker Compose (Postgres, Redis, MinIO) |
| **Search** | Tavily (primary) → Brave → DuckDuckGo → Wikipedia (fallback chain) |

### End-to-End Flow

```
User types message
  → Next.js ChatPanel (POST /api/chat/stream)
    → FastAPI: load Redis session + core memories + semantic memories (pgvector)
    → Build system prompt (profile + memories + capabilities)
    → If current message triggers search: run Tavily, inject results into prompt
    → If Gmail keywords: include Gmail tools in request
    → Stream LLM response (ai_provider.stream / stream_with_tools)
      → If model calls a tool: execute (Gmail / LinkedIn / search), append result, re-call model
      → Up to 8 ReAct iterations per turn
    → Stream text chunks back as SSE events [SEARCHING] / content / [META] / [DONE]
  → ChatPanel renders tokens in real-time
  → Background task: extract 1 memorable fact → embed → store in semantic_memories
  → Background task: persist conversation turn in semantic_memories (pgvector)
  → Save clean user/assistant history to Redis (24h TTL)
```

---

## Core Features

### 1. Streaming Chat with Memory

**Purpose:** Real-time AI chat that remembers you across sessions.

**How it works:**
- On each request: loads Redis session context (last 20 messages), fetches core memories from Postgres, runs embedding similarity search against `semantic_memories` and `extracted_memories` (top-4, cosine sim > 0.65/0.70), injects all as system context.
- Streams response as SSE — frontend renders tokens as they arrive.
- After response: background task runs LLM extraction prompt to find a memorable fact ("User prefers dark mode"), embeds it with sentence-transformers, stores in `extracted_memories`. The full turn is also stored in `semantic_memories` with vector.
- Session history stored in Redis with clean user/assistant pairs only — tool_calls and tool results are never persisted to avoid confusing the model on the next turn.

**Files:** `app/routes/chat.py`, `app/providers/ai_provider.py`, `app/services/memory_service.py`

**Deps:** openai SDK (LM Studio), redis-py (async), psycopg2, sentence-transformers

---

### 2. Agentic Tool Calling (ReAct Loop)

**Purpose:** Let the model take real actions — read email, search the web, apply to jobs.

**How it works:**
- `stream_with_tools()` in `ai_provider.py` uses OpenAI tool-calling format.
- `reasoning_effort: "none"` is forced for tool calls (extended thinking causes models to reason their way out of calling tools).
- ReAct loop in `chat.py` runs up to 8 iterations: stream → detect tool_call sentinel → execute tool → append result → re-stream.
- Tool selection is intent-based: Gmail tools only added when email keywords detected; web search only when message matches real-time triggers.
- Web search is pre-executed (not left to model) to prevent history contamination: query is built from current message only, results injected into user message as grounded context.

**Files:** `app/providers/ai_provider.py` (stream_with_tools), `app/routes/chat.py` (generate(), _dispatch_tool())

---

### 3. Gmail Integration (10 Tools)

**Purpose:** Full inbox management via natural language.

**How it works:**
- OAuth 2.0 flow via `/api/google/oauth/authorize` → callback → token stored in `gmail_tokens` table.
- `gmail_service.py` wraps Gmail REST API with 3-tier Redis cache: list (3 min TTL), body (24h), profile (10 min).
- Incremental sync via Gmail History API — only fetches deltas since last `historyId`.
- Email context resolution: follow-ups like "that email", "the first one", "from Render" are resolved from session-scoped Redis cache (`email_ctx:{sessionId}`) before calling any tool.
- 10 distinct tools: `read_email`, `send_email`, `create_draft`, `forward_email`, `trash_email`, `archive_email`, `mark_email`, `bulk_email_action`, `summarize_thread`, `find_unsubscribe`.

**Files:** `app/routes/google.py`, `app/services/gmail_service.py`, `app/routes/chat.py` (tool definitions)

---

### 4. Web Search with Fallback Chain

**Purpose:** Real-time information retrieval for current events, software versions, prices, news.

**How it works:**
- `should_search()` checks message against a trigger word set (today, latest, version, news, price, etc.).
- `_build_search_query()` transforms natural language into a tight search query — detects language/version patterns and appends the current year (e.g. "python latest version 2026 new features").
- `run_search()` tries providers in order: **Tavily** (purpose-built AI search, returns pre-synthesized answer) → **Brave Search** → **DuckDuckGo** (with `timelimit="y"` for version queries) → **Wikipedia**.
- Results injected directly into user message as `[Live search results — use these to answer, ignore your training data]`.

**Files:** `app/services/search_service.py`, `app/routes/chat.py` (_build_search_query)

**Keys needed:** `TAVILY_API_KEY` (free: 1000/month), `BRAVE_API_KEY` (free: 2000/month)

---

### 5. LinkedIn Job Apply Automation

**Purpose:** Automated job search and Easy Apply on LinkedIn — zero manual effort.

**How it works:**
- Uses Playwright with user's Chrome profile (cookie-based auth, no credential exposure).
- `LinkedInTool` searches jobs by title/location/remote filter, filters out blacklisted companies, identifies Easy Apply positions.
- `job_screening_answers` table holds pre-stored Q&A pairs (pre-filled into LinkedIn form pages automatically).
- Two modes: `AUTO` (apply immediately) / `PROPOSE` (present matches, wait for approval via `/api/jobs/{job_id}/approve/{run_id}`).
- All applications logged to `job_applications` table with status tracking (applied → viewed → interview → rejected).
- Runs as a cron job via APScheduler with configurable daily limit.

**Files:** `app/tools/linkedin_tool.py`, `app/workers/job_apply_worker.py`, `app/services/linkedin_service.py`, `app/routes/apply.py`

---

### 6. Background Agents (Cron Jobs)

**Purpose:** Autonomous actions that run on a schedule without user interaction.

**How it works:**
- `cron_jobs` table stores job definitions (name, worker_type, schedule, config JSONB, enabled flag).
- APScheduler loads jobs at startup, triggers workers on schedule.
- Each run creates a `job_runs` record; worker updates status (pending → running → success/failed), appends to `run_log`, stores result JSONB.
- On completion, creates a `notifications` entry so the user sees what happened.
- Workers: `JobApplyWorker`, `EmailSyncWorker`, `FollowUpWorker`, `InterviewPrepWorker`, `SalaryResearchWorker`.
- Jobs can be triggered manually via `/api/jobs/{job_id}/run`.

**Files:** `app/scheduler/scheduler.py`, `app/workers/`, `app/routes/jobs.py`

---

### 7. Voice Interface (STT + TTS)

**Purpose:** Fully offline voice input and output.

**How it works:**
- **STT:** Browser records audio → POST `/api/voice/transcribe` → Faster-Whisper (CPU, `base` model) → transcript text.
- Streaming variant (`/api/voice/transcribe-stream`) returns word-level segments as SSE.
- **TTS:** POST `/api/voice/speak` (text + voice name) → Edge TTS → MP3 bytes streamed back → frontend plays.
- Sentence-by-sentence TTS queuing in `ChatPanel`: as assistant response streams in, sentences are enqueued for playback so speech starts before the full response is done.
- 400+ voices available (`/api/voice/voices`).

**Files:** `app/routes/voice.py`, `frontend/src/components/panels/ChatPanel.tsx`

---

### 8. Persistent Memory System

**Purpose:** Jazper remembers you across sessions, learns from conversations.

**Architecture (4 tiers):**

| Tier | Store | TTL | Purpose |
|------|-------|-----|---------|
| Short-term | Redis | 24h | Session context (last 20 turns) |
| Core | PostgreSQL | Permanent | Manually curated facts always injected |
| Extracted | PostgreSQL + pgvector | Permanent | LLM-extracted facts (auto, per turn) |
| Semantic | PostgreSQL + pgvector | Permanent | Full conversation turns (vector search) |

**Semantic search:**
- `all-MiniLM-L6-v2` embeds query message locally (384-dim).
- IVF-flat index on `semantic_memories.embedding` and `extracted_memories.embedding` (lists=50).
- Top-4 results above cosine similarity threshold (0.65 / 0.70) injected into system prompt.

**Files:** `app/services/memory_service.py`, `app/services/embedding_service.py`, `app/routes/memory.py`

---

### 9. Dashboard & Observability

**Purpose:** Real-time system health at a glance.

**How it works:**
- `/api/dashboard/stats` aggregates: task counts (pending/done/overdue), memory counts (core/extracted/semantic), chat session count, service health (Postgres/Redis/LM Studio ping), uptime.
- Frontend polls every 30s.
- `/api/logs/stream` SSE endpoint streams structlog entries from in-memory ring buffer (500 entries) in real-time.

**Files:** `app/routes/dashboard.py`, `app/routes/logs.py`, `frontend/src/components/panels/DashboardPanel.tsx`

---

### 10. Notifications System

**Purpose:** Async job results surface as actionable notifications.

**How it works:**
- Any background worker can call `create_notification()` on completion.
- `/api/notifications/unread-count` polled by Sidebar every 30s — shows red badge.
- Full CRUD: mark read, mark all read, delete, clear all.
- Linked to `job_runs` via FK for full context.

**Files:** `app/routes/notifications.py`

---

## AI/ML Components

### LLM (Language Model)

| | |
|-|-|
| **Provider** | LM Studio (local, OpenAI-compatible API) |
| **Default model** | `qwen/qwen3.5-9b` (configurable via `AI_MODEL` env var) |
| **Previously tested** | `google/gemma-4-e2b` |
| **reasoning_effort** | `"none"` for tool calls, `"low"` for thinking-enabled chat |
| **Streaming** | Yes — SSE token-by-token |
| **Think-tag stripping** | Regex strips `<think>...</think>` blocks from visible output |

### Embeddings

| | |
|-|-|
| **Model** | `all-MiniLM-L6-v2` (sentence-transformers) |
| **Dimensions** | 384 |
| **Runtime** | Fully local (CPU), no LM Studio needed |
| **Used for** | Long-term memory storage + retrieval, extracted fact indexing |

### RAG (Retrieval-Augmented Generation)

Context assembly order per turn:
1. System prompt (role + capabilities)
2. User profile text (if populated)
3. Core memories (always)
4. Semantic memories (top-4 cosine sim ≥ 0.65)
5. Extracted facts (top-4 cosine sim ≥ 0.70)
6. Live web search results (if triggered)
7. Resolved email context (if follow-up)

### Memory Extraction

After each assistant response, a background task sends a small extraction prompt to the LLM:
```
"If there's one notable fact worth remembering about the user, reply with ONE sentence starting with 'User'. Otherwise: NONE"
```
Extracted facts are embedded and stored in `extracted_memories` with session ID.

### Speech Processing

- **STT:** Faster-Whisper `base` model, CPU inference. Returns word-level timestamps.
- **TTS:** Microsoft Edge TTS (edge-tts). 400+ neural voices. Streams MP3 audio back to browser.

---

## Data Flow (Detailed)

### Chat turn with web search

```
1. User: "What's the current Python version?"
   → ChatPanel builds POST /api/chat/stream

2. FastAPI chat_stream():
   → Parallel: load Redis session, email context, user profile, core memories, semantic search
   → should_search("current Python version") → True ("current", "version" triggers)
   → _build_search_query() → "python latest version 2026 new features"
   → run_search() → Tavily returns Python 3.14.5 with release notes
   → Results injected into user message: "[Live search results...]"

3. build_messages() assembles:
   [system]: profile + core_memories + semantic_memories
   [history]: previous turns (clean user/assistant pairs only)
   [user]: original message + injected search results

4. ai_provider.stream() streams response tokens
   → yield [SEARCHING] "python latest version..." to frontend
   → yield text chunks as they arrive
   → yield [META] {duration_ms, tokens}
   → yield [DONE]

5. Background (asyncio.create_task):
   → save_history_sync() → PostgreSQL chat_messages
   → embed turn → store_memory_sync() → semantic_memories
   → LLM extraction → store_extracted_sync() → extracted_memories
   → update Redis session (clean history only)
```

### Job apply automation run

```
1. APScheduler fires cron job OR user POSTs /api/jobs/{id}/run
2. job_runs record created (status: pending)
3. JobApplyWorker.run() in thread pool:
   → Open Playwright with user's Chrome profile
   → LinkedIn job search (title, location, filters)
   → Filter blacklisted companies
   → For each Easy Apply job:
     → Click "Easy Apply"
     → Fill form pages with screening_answers
     → Submit
     → Record to job_applications
4. job_runs updated (status: success, result JSONB, run_log)
5. Notification created → user sees result badge
```

---

## API Reference (Summary)

| Prefix | Endpoints | Purpose |
|--------|-----------|---------|
| `/health` | GET / | Health check |
| `/api/chat` | POST /, POST /stream | Chat (non-streaming + SSE) |
| `/api/memory` | 12 endpoints | CRUD core/extracted/semantic memories + search |
| `/api/tasks` | 5 endpoints | Task CRUD + stats |
| `/api/history` | 4 endpoints | Session history |
| `/api/voice` | 4 endpoints | STT + TTS |
| `/api/models` | 2 endpoints | LM Studio model list + load |
| `/api/jobs` | 12 endpoints | Cron jobs, runs, credentials |
| `/api/apply` | 8 endpoints | Screening answers, cover letters, applications |
| `/api/google` | 15 endpoints | OAuth + Gmail CRUD |
| `/api/profile` | 2 endpoints | User profile |
| `/api/dashboard` | 1 endpoint | Aggregated stats |
| `/api/notifications` | 7 endpoints | Notification CRUD |
| `/api/logs` | 2 endpoints | Log history + SSE stream |
| `/ws` | WS / | WebSocket (bidirectional) |

---

## Database Design

### Tables

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `chat_sessions` | Conversation sessions | id, title, expires_at |
| `chat_messages` | Per-message history | session_id FK, role, content, meta JSONB |
| `core_memories` | Always-injected facts | content |
| `extracted_memories` | Auto-extracted facts | content, embedding VECTOR(384), session_id |
| `semantic_memories` | Conversation turn vectors | content, embedding VECTOR(384), metadata JSONB |
| `user_profile` | User identity | full_name, email, resume_text, skills[], sections JSONB |
| `tasks` | Task management | title, priority, status, due_at |
| `notifications` | Job/event notifications | title, body, type, read, job_run_id FK |
| `cron_jobs` | Scheduled agents | name, worker_type, schedule (cron), config JSONB |
| `job_runs` | Execution history | cron_job_id FK, status, result JSONB, log |
| `credentials` | Encrypted portal tokens | portal PK, token_data JSONB |
| `gmail_tokens` | Gmail OAuth tokens | email PK, token_data JSONB |
| `job_apply_profile` | LinkedIn apply config | target_roles[], skills[], blacklist[], daily_limit |
| `job_screening_answers` | LinkedIn form Q&A | question, answer, category |
| `job_cover_letters` | Cover letter templates | name, content, is_default |
| `job_applications` | Applied job records | company, title, url, status, applied_at |
| `job_apply_runs` | Apply session logs | jobs_found, applied, skipped, run_log |

### Vector Indexes
```sql
CREATE INDEX idx_semantic_emb ON semantic_memories
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX idx_extracted_emb ON extracted_memories
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
```

---

## Scalability Design

| Concern | Approach |
|---------|---------|
| **LLM streaming** | SSE (Server-Sent Events) — no polling, no websocket overhead for text |
| **Blocking I/O** | `ThreadPoolExecutor(max_workers=4)` for all sync ops (Postgres, Gmail, search) |
| **Async-first** | All FastAPI routes are `async def`; Redis, LLM calls all awaited |
| **Tool loop cap** | `MAX_STEPS = 8` prevents infinite ReAct loops |
| **Session cache** | Redis TTL 24h, last 20 messages only — bounded context window usage |
| **Vector search** | IVF-flat index (lists=50) — sub-millisecond cosine search at millions of vectors |
| **Email caching** | 3-tier Redis cache (3min list / 24h body) — Gmail API quota protection |
| **Background work** | `asyncio.create_task(_background_work())` after `[DONE]` — user sees response, memory persists async |
| **Incremental sync** | Gmail History API — only fetches deltas, not full inbox on every sync |
| **Search fallback** | 4-tier chain (Tavily → Brave → DDG → Wikipedia) — zero single point of failure |

---

## Technical Decisions

### Why LM Studio (local LLM) instead of OpenAI API?
Privacy — personal emails, job history, and memories never leave the machine. LM Studio exposes an OpenAI-compatible API so the same `openai` SDK works. Tradeoff: inference is slower on CPU/consumer GPU.

### Why FastAPI + Python instead of Node?
Python ecosystem dominates AI/ML: sentence-transformers, Faster-Whisper, Playwright, psycopg2+pgvector all have mature Python libraries. FastAPI provides async ASGI performance comparable to Node for I/O-bound workloads.

### Why PostgreSQL + pgvector instead of a dedicated vector DB (Pinecone/Chroma)?
Simplicity — one database handles relational data AND vector search. pgvector with IVF-flat indexes matches Chroma's performance at this scale. Avoids running another service.

### Why inject web search results into the prompt instead of tool-calling?
Tool-calling via `tool_choice="auto"` allowed the model to pick queries based on conversation history, not the current question — leading to wrong searches. Pre-executing the search and injecting results gives full control over query construction and guarantees the model always gets fresh context.

### Why sentence-transformers locally instead of LM Studio embeddings?
LM Studio's embedding endpoint is slow and requires a loaded model. `all-MiniLM-L6-v2` via sentence-transformers runs in ~10ms on CPU, is always available, and produces consistent 384-dim vectors regardless of which LLM is loaded.

### Why APScheduler instead of Celery?
Single-user system — Celery's broker infrastructure (RabbitMQ/Redis queues + worker processes) is overkill. APScheduler runs in-process, stores job state in PostgreSQL, and handles all requirements with zero additional infrastructure.

### Why Playwright (browser automation) for LinkedIn instead of API?
LinkedIn's official API is restricted and doesn't support job apply. Playwright with a real Chrome profile (user's existing session cookies) is the only reliable approach.

---

## Resume Extraction

### Resume Bullet Points

- **Built a self-hosted personal AI operating system** (Sir Jazper OS) using Python/FastAPI and Next.js, integrating local LLM inference (LM Studio), real-time web search, Gmail automation, and LinkedIn job-apply bots in a unified streaming interface.
- **Designed a 4-tier memory architecture** combining Redis short-term context, PostgreSQL core facts, and pgvector semantic search (384-dim embeddings, IVF-flat index, cosine similarity) to give an LLM persistent cross-session memory with RAG retrieval.
- **Implemented an agentic ReAct loop** supporting up to 8 tool-call iterations per turn with 10 Gmail tools, web search, and LinkedIn automation — dispatched via OpenAI tool-calling format against locally-hosted models.
- **Engineered a streaming SSE pipeline** from LLM token generation through FastAPI async generators to browser rendering — achieving real-time text and voice output (Faster-Whisper STT + Edge TTS) with sentence-level TTS queuing.
- **Built an automated LinkedIn job-apply system** using Playwright browser automation, pre-stored screening answers, and cover letter templates — capable of finding and applying to Easy Apply jobs on a configurable daily schedule via APScheduler cron agents.
- **Integrated a multi-provider search fallback chain** (Tavily → Brave → DuckDuckGo → Wikipedia) with smart query construction (year-aware version queries, intent-based trigger detection) to ground LLM responses in live data.
- **Developed full Gmail inbox management** via OAuth 2.0 + Gmail History API with 3-tier Redis caching, incremental sync, natural-language email context resolution, and 10 distinct tool actions callable by the LLM.
- **Designed a background job framework** with APScheduler + PostgreSQL-backed job_runs, notification system, and a REST API for creating/triggering/monitoring async agents (email sync, job apply, research workers).

### Skills Extracted

**Languages:** Python 3.11, TypeScript 5, SQL, JavaScript

**Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI / shadcn, Web Audio API (VAD), SSE client, WebSocket

**Backend:** FastAPI, Uvicorn (ASGI), Pydantic v2, APScheduler, psycopg2, redis-py (async), httpx, structlog, OpenAI SDK

**AI/ML:** LLM inference (OpenAI-compatible, local), sentence-transformers, Faster-Whisper, Edge-TTS, pgvector, IVF-flat indexing, RAG, ReAct agent loop, prompt engineering, memory extraction, tool use / function calling

**Databases:** PostgreSQL 16, pgvector, Redis 7, MinIO (S3-compatible)

**Cloud/APIs:** Gmail API (OAuth 2.0, History API), Google OAuth, Tavily, Brave Search, DuckDuckGo, LinkedIn (via Playwright)

**DevOps:** Docker Compose, environment-based config (Pydantic settings), structured logging, SSE observability, hot-reload dev server

**Architecture:** RAG, agentic ReAct loop, event-driven SSE streaming, multi-tier memory, fallback chain design, background workers, cron scheduling, async-first I/O

---

## Interview Questions

### Architecture
1. How does the memory system decide what context to inject into each prompt — and what's the tradeoff between injecting too much vs. too little?
2. Walk through a full chat turn that involves a web search and a Gmail tool call. What happens at each layer?
3. Why store session history in Redis rather than PostgreSQL, and how do you handle Redis going offline?
4. The system strips `tool_calls` messages from Redis history. Why? What breaks if you don't?

### Design
5. You chose to pre-execute web searches instead of letting the model call the tool. What was the bug that drove that decision and why is the new approach more reliable?
6. How did you design the email context resolution system — resolving "that email" or "the first one" to a specific message ID across multi-turn conversations?
7. How would you extend the memory system to handle forgetting (e.g., user says "forget everything about X")?

### AI Workflows
8. What is the ReAct loop and why cap it at 8 iterations? What happens when you hit the cap?
9. Why force `reasoning_effort: "none"` during tool calls? What behavior did you observe without this?
10. How does the memory extraction prompt work? What makes a good extraction prompt and what did you tune it for?

### Tradeoffs
11. Local LLM vs. cloud API — what are the concrete tradeoffs you encountered, not just theoretical ones?
12. pgvector vs. a dedicated vector database — when would pgvector not be sufficient and what would you migrate to?
13. APScheduler in-process vs. Celery — when would the current approach break down and what would you change?

### Scalability
14. The system uses `ThreadPoolExecutor(max_workers=4)` for blocking I/O. What's the risk and how would you scale this?
15. How does the IVF-flat index on pgvector work and when does it become inaccurate? How do you mitigate that?
16. The Gmail cache uses Redis with TTL keys. What happens under a cache stampede (many cache misses simultaneously)?

---

*Generated from codebase analysis — 2026-05-27*
