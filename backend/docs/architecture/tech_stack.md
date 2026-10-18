# Sir Jazper OS — Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | Next.js (App Router), React, TypeScript, Tailwind CSS | Fast, typed, SSE-capable |
| **Backend** | Python 3.11, FastAPI, Uvicorn (ASGI), Pydantic v2 | AI ecosystem, async performance |
| **Primary AI (agents)** | Groq API — Llama 4 Scout 17B, Llama 3.1 8B | Fast cloud inference, free tier generous |
| **Local AI (chat/privacy)** | LM Studio — Qwen3 9B (OpenAI-compatible) | Personal data stays local |
| **Embeddings** | sentence-transformers `all-MiniLM-L6-v2` (384-dim) | Fully local, ~10ms CPU |
| **Speech-to-Text** | Faster-Whisper `base` model | Local, word-level timestamps |
| **Text-to-Speech** | Edge-TTS (Microsoft Neural) | 400+ voices, streams MP3 |
| **Database** | PostgreSQL 16 + pgvector | Relational + vector in one |
| **Cache / Sessions** | Redis 7 | 24h session context, API caching |
| **Object Storage** | MinIO (S3-compatible) | Resumes, screenshots, artifacts |
| **Browser Automation** | Playwright + Chrome profile | LinkedIn apply, scraping |
| **Job Scheduler** | APScheduler 3.10 | In-process cron, no broker needed |
| **Web Search** | Tavily → Brave → DuckDuckGo → Wikipedia | 4-tier fallback |
| **Logging** | structlog + in-memory ring buffer + SSE | Live log streaming to UI |
| **Containerisation** | Docker Compose | Postgres, Redis, MinIO isolated |

---

## AI Model Assignments

| Role | Model | Provider | Tokens/Day (free) |
|------|-------|----------|-------------------|
| Orchestrator (Jazper) | llama-4-scout-17b-16e | Groq | 500,000 |
| Research (Scout) | llama-3.1-8b-instant | Groq | 500,000 |
| Email (Hermes) | llama-3.1-8b-instant | Groq | 500,000 |
| Memory (Sage) | llama-3.1-8b-instant | Groq | 500,000 |
| Vision (Lens) | llama-4-scout-17b-16e | Groq | 500,000 |
| Jobs (Atlas) | llama-3.1-8b-instant | Groq | 500,000 |
| Browser (Phantom) | llama-3.1-8b-instant | Groq | 500,000 |
| Phases (personalities) | llama-3.1-8b-instant | Groq | 500,000 |
| Personal chat | qwen/qwen3.5-9b | LM Studio (local) | unlimited |
| Embeddings | all-MiniLM-L6-v2 | Local CPU | unlimited |

**70B note:** `llama-3.3-70b-versatile` = only 100k tokens/day free. Reserved as optional override only.

---

## Environment Variables

```
# AI
AI_BASE_URL=http://localhost:1234/v1     # LM Studio
AI_API_KEY=lm-studio
AI_MODEL=qwen/qwen3.5-9b

GROQ_API_KEY=...

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=jazper
POSTGRES_PASSWORD=...
POSTGRES_DB=jazper

REDIS_URL=redis://localhost:6379

# Storage
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...

# Search
TAVILY_API_KEY=...
BRAVE_API_KEY=...

# Google / Gmail
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# App
FRONTEND_URL=http://localhost:3000
ENV=development
```
