# Sir Jazper OS — Master Resumption Prompt

> Use this document to resume any Claude Code session from scratch. Paste the relevant sections as context.

---

## 1. What is This Project?

**Create Origins OS** is a personal AI operating system built by **VJ (Vijay Moirangthem)**. It is a self-operating "company" where AI agents act as employees across departments. VJ is the sole user — no multi-tenant, no public auth.

- **Stack**: FastAPI (Python) backend · Next.js 14 (TypeScript) frontend · PostgreSQL · Groq LLMs (free tier)
- **Repo**: `V:\Projects\SirJazper\`
- **Backend**: `backend/python/` — runs via `uvicorn main:app --reload` on port 8000
- **Frontend**: `frontend/` — runs via `npm run dev` on port 3000
- **DB**: PostgreSQL via Docker, accessed through `app/core/config.py` settings
- **AI Provider**: Groq (OpenAI-compatible), configured in `app/providers/ai_provider.py`

---

## 2. Current Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 6A | Agent Registry (40 agents, 15 departments) | ✅ Done |
| 6B | Agent Performance & Actions | ✅ Done |
| 6C | Agent Communications | ✅ Done |
| 6D | DB Change Log | ✅ Done |
| 6E | Autonomy Log | ✅ Done |
| 6F | IT Auto-Repair (Darwin agent loop) | ✅ Done |
| 6G | Company Dashboard (3D floor plan) | ✅ Done |
| 6H | Pipeline Mind Map | ✅ Done |
| 6I | Direct Agent Chat + Dept Chat | ✅ Done |
| 6J | Agent Tool-Calling (16 tools, self-evolution) | ✅ Done |
| 6K | Evolution Log + Approval Gate | ✅ Done |

**Next logical work**: Phase 7 — Plugin registry, Agent marketplace, expanded autonomy controls.

---

## 3. Key Architecture Decisions

### Agent Tool-Calling (Phase 6J/6K)
- Every agent chat goes through `backend/python/app/routes/agent_chat.py`
- `direct_chat` endpoint uses a **tool-calling loop** (up to 6 rounds)
- Tools are defined in `backend/python/app/routes/agent_tools.py`
- 16 tools: `list_agents`, `get_agent_info`, `list_departments`, `create_agent`, `update_agent_settings`, `update_agent_status`, `delete_agent`, `update_dept_settings`, `list_files`, `read_file`, `write_file`, `run_command`, `install_package`, `web_search`, `save_memory`, `recall_memory`
- SSE frames: `[TOOL]{id,name,args}` · `[TOOL_RESULT]{id,name,preview}` · `[APPROVAL]{id,name,approval_id}` · `[DONE]` · `[ERROR]{error}`
- Risky tools requiring approval: `write_file`, `install_package`, `delete_agent`

### Evolution Log (Phase 6K)
- Table: `evolution_log` — records every agent mutation
- `_log_evolution()` in `agent_tools.py` called after each mutation in `execute_tool()`
- Route: `GET /api/evolution` (filterable by agent, action_type)
- Frontend: `EvolutionPanel.tsx` — timeline with colour-coded entries

### Approval Gate (Phase 6K)
- Risky tools pause the stream and call `approval_service.request_approval()`
- Frontend `ApprovalOverlay` (already wired via `useApprovals` hook) shows the dialog
- Chat bubble shows `⏳ approval needed` inline on the tool pill
- After approve/deny the stream continues or tool result shows "Denied by user"

### DB Change Log (Phase 6D)
- Table: `db_change_log` — records DB mutations with before/after JSON
- Route: `GET /api/db-changes`, `POST /api/db-changes/{id}/rollback`
- Frontend: `DBChangeLogPanel.tsx`

---

## 4. File Map (Critical Files)

```
backend/python/
  main.py                          ← Router registration (all routes)
  app/
    core/config.py                 ← Settings (DB, API keys, model)
    providers/ai_provider.py       ← Groq AI client
    db/init.py                     ← All CREATE TABLE statements, seeds
    routes/
      agent_chat.py                ← Direct agent chat + dept chat + tool loop + approval gate
      agent_tools.py               ← 16 tools, TOOLS list, execute_tool(), _log_evolution()
      evolution.py                 ← GET /api/evolution
      agents.py                    ← CRUD for agent_registry
      approvals.py                 ← Approval SSE stream + resolve endpoint
      db_changes.py                ← DB change log API
      chat.py                      ← Main Jazper chat
    services/
      approval_service.py          ← asyncio.Event approval gate (request/wait/resolve)
      db_change_service.py         ← DB change log writes
    agents/
      darwin_agent.py              ← IT auto-repair loop

frontend/src/
  app/page.tsx                     ← Top-level routing, View type, panel registry
  components/
    layout/
      Sidebar.tsx                  ← Nav icons (all views)
    panels/
      CommandCenterPanel.tsx       ← 3D company floor + agent/dept chat with tool rendering
      EvolutionPanel.tsx           ← Evolution log viewer
      DBChangeLogPanel.tsx         ← DB change log + rollback UI
      AgentsPanel.tsx              ← Agent registry management
      ITDepartmentPanel.tsx        ← IT dept error tracker
      ApprovalsPanel.tsx           ← Approval requests list
      PipelinePanel.tsx            ← Pipeline mind map
      CompanyDashboardPanel.tsx    ← Company overview
    ApprovalOverlay.tsx            ← Global approval modal
  hooks/
    useApprovals.ts                ← Subscribes to approval SSE stream
    useSettings.ts                 ← localStorage-backed settings
  stores/
    agentStore.ts                  ← Zustand agent/dept live state
    pipelineStore.ts               ← Pipeline run state

docs/
  prompt.md                        ← THIS FILE — master resumption prompt
  project_status.md                ← Current feature state (detailed)
  index.md                         ← Navigation index
  roadmap/status.md                ← Phase-by-phase roadmap
  features/
    self_evolution.md              ← Tool-calling / self-evolution system docs
    agents.md                      ← Agent roster and capabilities
```

---

## 5. Security Constraints (Permanent)

- Personal use only — never expose to public
- Groq free tier — never use paid models without explicit permission
- **Never commit `.env`** — API keys stay in `.env.local` only
- Agent `write_file` cannot touch `.env`, `.env.local`, `.env.production`
- Agent `delete_agent` cannot delete Jazper (codename `jazper`)
- `run_command` blocks: `rm -rf`, `rmdir /s`, `format`, `shutdown`, `reboot`, fork bombs

---

## 6. How to Start a New Session

Paste this prompt to orient Claude:

```
We're working on Sir Jazper OS — a personal AI operating system.
Read docs/prompt.md for full context, then docs/project_status.md for current state.
The stack is FastAPI + Next.js + PostgreSQL + Groq.
Backend: backend/python/ (port 8000), Frontend: frontend/ (port 3000).
Current completed phase: 6K (Evolution Log + Approval Gate).
```

Then describe what you want to build next.

---

## 7. Common Commands

```bash
# Backend (PowerShell — from backend/python/)
uvicorn main:app --reload --port 8000

# Frontend (from frontend/)
npm run dev

# DB (Docker)
docker-compose up -d postgres

# Install new Python package
pip install <package> && add to requirements.txt

# Check evolution log (browser)
http://localhost:3000/#evolution

# Check DB changes (browser)
http://localhost:3000/#db_changes
```

---

## 8. Current Agent Roster (summary)

**Active agents (13)**: jazper, sage, scout, lens, hermes, voice, phantom, atlas, darwin, oracle, forge, shield, scroll

**Standby agents (27)**: chronos, habit, lore, quill, echo, beacon, pixel, hawk, pitch, pipeline, coffer, audit, taxman, warden, mentor, clerk, sentinel, analyst, prophet, compass, archivist, nexus, muse, aria, probe, pulse, verdict

**Departments (16)**: executive, intelligence, communications, operations, it, security, personal, marketing, sales, finance, hr, analytics, research, relations, creative, quality_assurance

---

## 9. What "Self-Evolution" Means

When you chat with any agent (e.g. Jazper), the agent can:
1. **Read files** — `read_file`, `list_files` — understand the codebase
2. **Write files** — `write_file` — create/modify backend routes, frontend panels, any code
3. **Run commands** — `run_command` — git, tests, scripts
4. **Install packages** — `install_package` — pip or npm
5. **Manage agents** — `create_agent`, `update_agent_settings`, `delete_agent`
6. **Search the web** — `web_search` — look up docs, APIs, anything
7. **Remember** — `save_memory`, `recall_memory` — persistent per-agent memory

Every mutation is logged to `evolution_log`. Risky operations (write_file, install_package, delete_agent) require your approval via the `ApprovalOverlay`.

Because uvicorn runs with `--reload` and Next.js uses HMR, file writes by agents trigger live reloads automatically — true self-modification in real time.
