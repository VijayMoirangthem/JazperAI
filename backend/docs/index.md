# Sir Jazper OS — Documentation Index

> Personal AI operating system. Local-first. Multi-agent. Self-hosted.  
> **Current phase**: 6K complete. Stack: FastAPI · Next.js 14 · PostgreSQL · Groq.

---

## Start Here

| Doc | What's inside |
|-----|--------------|
| [Master Resumption Prompt](prompt.md) | Paste this to orient a new Claude session instantly — phase table, file map, security constraints, common commands |
| [Project Status](project_status.md) | Every live feature, all database tables, full panel inventory, known limitations |
| [Roadmap Status](roadmap/status.md) | Phase-by-phase build log (6A → 6K), upcoming Phase 7 candidates |

---

## Architecture

| Doc | What's inside |
|-----|--------------|
| [Architecture Overview](architecture/overview.md) | System design, end-to-end data flow, stack decisions |
| [Tech Stack](architecture/tech_stack.md) | Every layer explained — why each choice was made |
| [Multi-Agent System](architecture/agents.md) | Agent roster, routing strategy, orchestration design |
| [Database Design](architecture/database.md) | Schema, vector indexes, migration strategy |

---

## Features

| Doc | What's inside |
|-----|--------------|
| [AI-Native IDE Architecture](agent-os/IDE_ARCHITECTURE.md) | High-level system design, data flow, & component interaction |
| [AI-Native IDE Roadmap](agent-os/IDE_ROADMAP.md) | 11-phase development roadmap for the COOS IDE |
| [AI-Native IDE Audit & Status](agent-os/IDE_CURRENT_STATUS.md) | Codebase audit, existing APIs, gap analysis |
| [AI-Native IDE Tech Stack](agent-os/IDE_TECH_STACK.md) | Technology choices (Monaco, xterm.js, Playwright, FastAPI) |
| [AI-Native IDE Security](agent-os/IDE_SECURITY.md) | 7-level permission hierarchy, path traversal & command safeguards |
| [AI-Native IDE Agent Roster](agent-os/IDE_AGENT_SPEC.md) | 7 specialized engineering agents (Architect, Dev, QA, Review, UI, DevOps, Research) |
| [AI-Native IDE Tools](agent-os/IDE_TOOL_SPEC.md) | Controlled tool contracts for file ops, code search, git, execution |
| [AI-Native IDE UI/UX](agent-os/IDE_UX_SPEC.md) | Multi-pane IDE layout, AI modes (Ask, Plan, Edit, Execute, Debug, Review) |
| [Self-Evolution System](features/self_evolution.md) | Agent tool-calling, 16 tools, approval gate, evolution log, security model |
| [Agents](features/agents.md) | Full agent roster, departments, level system, per-agent config |
| [Chat & Memory](features/chat.md) | Streaming, RAG, tool calling, memory tiers |
| [Phases — Digital Mind Simulation](features/phases.md) | Personality simulation, Big Five profiling, voice, timeline |
| [Jobs & Apply](features/jobs.md) | LinkedIn automation, apply pipeline, screening answers |
| [Memory System](features/memory.md) | 4-tier memory architecture, semantic search |

---

## Roadmap

| Doc | What's inside |
|-----|--------------|
| [Roadmap Status](roadmap/status.md) | What's done (6A–6K), what's next (Phase 7 candidates) |
| [IDE System Roadmap](agent-os/IDE_ROADMAP.md) | Full 11-phase AI-Native IDE development plan |

---

## Research & Learning

| Doc | What's inside |
|-----|--------------|
| [Agentic AI Index](AgenticAI/00-index.md) | Study notes on agentic AI systems |

---

## Quick Reference

### Panels (sidebar navigation)

| View key | Panel | Phase |
|----------|-------|-------|
| `dashboard` | Multi-pane dashboard (Chat + Tasks + Dashboard) | Phase 1 |
| `chat` | Main Jazper chat | Phase 1 |
| `agents` | Agent registry, create/retire, departments | Phase 6A / 6H |
| `command_center` | 3D company floor, agent/dept direct chat + tool-calling | Phase 6B / 6I / 6J |
| `company` | Company dashboard — KPIs, dept scorecards, autonomy log | Phase 6F |
| `evolution` | Evolution log timeline (agent mutation audit trail) | Phase 6K |
| `db_changes` | DB change log with rollback | Phase 6D |
| `approvals` | Pending and historical approval requests | Option A |
| `plans` | Multi-step agent plan tracker | Option A |
| `it_dept` | IT Department — error feed, repair tickets, create-feature form | Option C |
| `phases` | Digital Mind Simulation — 5 personalities, voice, Big Five | Option D |
| `voice_profile` | Voice recording, AI profiling, personality timeline | Option D |
| `pipeline` | Pipeline mind map (React Flow) | Phase 6H |
| `roadmap` | Roadmap viewer + Jazper mini-chat | Phase 4 |
| `observatory` | Live agent feed and session log | Phase 2 |
| `ide` | In-browser IDE | Phase 6 |
| `control_tower` | Control Tower panel | Phase 6 |
| `settings` | App settings, auto-approve types | Phase 1 |

### Key Backend Files

```
backend/python/
  main.py                    ← all router registrations
  app/
    core/config.py           ← Settings (DB URL, API keys, model)
    providers/ai_provider.py ← Groq client with fallback
    db/init.py               ← all CREATE TABLE + seed data
    routes/
      agent_chat.py          ← direct agent chat, tool loop, approval gate
      agent_tools.py         ← 16 tools, execute_tool(), _log_evolution()
      evolution.py           ← GET /api/evolution + /stats
      agents.py              ← agent_registry CRUD
      approvals.py           ← approval SSE stream + resolve
      db_changes.py          ← DB change log API + rollback
      chat.py                ← main Jazper chat
    services/
      approval_service.py    ← asyncio.Event gate (request/wait/resolve)
      db_change_service.py   ← db_change_log writes
```

### Security Constraints (permanent)

- Never commit `.env` — API keys stay in `.env.local` only
- Agent `write_file` cannot touch `.env`, `.env.local`, `.env.production`
- Agent `delete_agent` cannot delete Jazper (`codename=jazper`)
- `run_command` blocks: `rm -rf`, `rmdir /s`, `format`, `shutdown`, `reboot`, fork bombs
- Personal use only — never expose to public

---

*Single backend: `backend/python/` (FastAPI, port 8000). Single frontend: `frontend/` (Next.js, port 3000).*  
*All new features extend the same codebase — one API, one DB.*
