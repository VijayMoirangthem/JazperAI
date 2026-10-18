# COOS Architecture

> COOS = "Create Origins Operating System" - a personal AI operating system.

## System Overview

COOS is a self-hosted AI operating system where a fleet of AI agents act as
employees across 16 departments, coordinated by **Jazper** (global orchestrator).
It is a single-user, local-first system built on one FastAPI backend and one
Next.js frontend.

```
Browser (Next.js, port 3000)
       | REST + SSE + WebSocket
FastAPI Backend (Python, port 8000)
       | AI layer (Groq / LM Studio / Claude) + tool loop + scheduler
       | Data layer (PostgreSQL + pgvector, Redis, MinIO)
       | Execution layer (filesystem sandbox, terminal, tools, approvals)
       | Hive layer (workspace, mailboxes, board, tasks, fleet, log)
```

## Layers

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Frontend | `frontend/` | UI panels, office floor, chat, voice, IDE |
| Backend | `backend/python/` | All APIs, agent orchestration, tools, workers |
| AI | `app/providers/`, `app/services/model_router.py` | Model routing + fallback |
| Hive | `app/services/hive_service.py`, `storage/hive/` | Per-agent workspace + messaging |
| Runtime | `app/services/agent_runtime.py` | Live agent status/action/activity |
| Data | PostgreSQL, Redis, MinIO | Persistence, cache, files |
| Docs | `docs/` | Architecture, systems, agent, roadmap, status |

## Key Architecture Decisions

- Single backend + single frontend; all features extend the same codebase.
- Python backend for the mature AI ecosystem (pgvector, whisper, playwright).
- PostgreSQL + pgvector for both relational and vector data.
- Agent tools run in-process with an approval gate for risky operations.
- Inter-agent messaging via a pub/sub bus + durable log + on-disk mailboxes.
- The office floor is a Pixi.js 2D scene driven by a Zustand store fed by
  WebSocket events from the backend.

## Repository Map

```
backend/python/          FastAPI app (port 8000)
  app/routes/            ~79 routers (chat, agents, hive, google, jobs, ...)
  app/services/          service layer (bus, runtime, hive, approvals, terminal, ...)
  app/agents/            specialized agent classes (Darwin, Forge, Oracle, ...)
  app/workers/           APScheduler background workers
  app/scheduler/         cron registry
  app/db/                schema + seeds
frontend/                Next.js app (port 3000)
  src/app/               routes + plugin registry + page router
  src/components/        panels, layout, voice, scene
  src/stores/            zustand stores
  src/scene/office/      Pixi office floor
  src/hooks/             react hooks (WS, settings, voice, ...)
storage/                 runtime data (hive workspace, uploads, exports)
docs/                    documentation
```

See `docs/munder-integration/` for the Munder Difflin integration analysis.