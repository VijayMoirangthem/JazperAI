# Sir Jazper OS — Roadmap Status

Last Updated: 2026-07-12

---

## Current Phase: Phase 6K — Evolution Log + Approval Gate ✅

Build order: **B ✅ → A ✅ → C ✅ → D ✅ → 6A ✅ → 6B ✅ → 6C ✅ → 6D ✅ → 6E ✅ → 6F ✅ → 6G ✅ → 6H ✅ → 6I ✅ → 6J ✅ → 6K ✅**

Next candidates:
- Phase 7A — Plugin registry: dynamic panel loading from filesystem
- Phase 7B — Agent marketplace: create agents from templates via UI
- Phase 7C — Expanded autonomy: agent-to-agent task delegation
- Phase 7D — File watcher: auto-trigger install on requirements.txt change (partially exists)

---

## What's Done

### Phase 1 — Foundation ✅
- FastAPI backend, Next.js frontend, Docker Compose
- PostgreSQL + pgvector + Redis + MinIO
- Streaming chat with SSE (token-by-token)
- 4-tier memory system (Redis + PostgreSQL + pgvector)
- BaseAgent, AgentRegistry, agent SSE events
- Keyword-based routing + LLM fallback routing

### Phase 2 — Full Agent Roster ✅
- All 6 agents: Scout, Hermes, Sage, Lens, Atlas, Phantom
- Parallel agent execution (asyncio.gather)
- Per-agent settings (model, temp, max tokens, priority, system prompt override)
- Agent trace drawer per chat message
- Observatory panel (live feed, agent cards, session view)

### Phase 3 — Background Intelligence ✅
- HermesMonitorWorker — inbox scan every 30min, smart notifications
- AtlasScheduledWorker — daily digest 8:30 AM IST, weekly career report
- ScoutMonitorWorker — saved topic monitoring every 6 hours
- SageConsolidationWorker — weekly memory dedup (Sunday 2 AM UTC)
- All workers in APScheduler, notifications system live

### Phase 3.5 — UI + Features ✅
- Gmail full integration (OAuth, 10 tools, 3-tier cache)
- LinkedIn job apply automation (Playwright, screening answers, cover letters)
- Voice (Faster-Whisper STT, Edge-TTS TTS, sentence-by-sentence queuing)
- Web search fallback chain (Tavily → Brave → DuckDuckGo → Wikipedia)
- Agents panel (registry view, department grouping, search, toggles)
- Phases panel (Digital Mind Simulation — real AI streaming, save/load sessions)

### Phase 4 — Infrastructure & Cleanup ✅
- `app/routes/phases.py` — real AI streaming, 5 personality models with full system prompts
- `app/routes/agents.py` — clean `/api/agents` endpoint, split from models.py
- `app/db/init.py` — DB init extracted from main.py, phases tables added
- Sidebar — Agents + Phases pinned at bottom, hydration errors resolved permanently
- Docs restructured: `architecture/`, `features/`, `roadmap/` hierarchy
- `restart.bat` — kill-first order, dependency auto-install, health check loops, browser --disable-cache
- `next.config.ts` — no-store in dev mode, immutable in production only

### Roadmap Panel ✅
- Full-page status view accessible via Map icon below Settings in sidebar
- Collapsible sections: Build Phases, Features (14 items), Agents, Next Up, Issues, Upcoming
- Live stats bar queried from DB on mount (agents, panels, sessions, memories, jobs, errors)
- Mini-chat (right panel) — Ask Jazper anything about the platform
  - SSE streaming from `/api/roadmap/chat` with full platform context injected server-side
  - Per-session by default (temporary), optional save to `roadmap_notes` table
  - Saved notes list with delete, auto-save toggle (BookmarkPlus icon)
- Backend: `app/routes/roadmap.py` — stats, context, chat, notes endpoints
- DB: `roadmap_notes` table in `app/db/init.py`

### Option B — Phase 5 Prerequisites ✅
- **Pytest test suite** (`backend/python/tests/`)
  - `conftest.py` — shared fixtures (null_emit, mock_ai, mock_search, mock_gmail)
  - `test_routing.py` — 20 routing tests covering high-confidence, low-confidence, no-agent, multi-agent cases
  - `test_agents.py` — smoke test per agent (Scout, Hermes, Sage, Lens, Atlas, Phantom) + registry tests
  - `pytest.ini` — configured with asyncio_mode=auto
- **Structured error store** (`app/services/error_store.py`)
  - `error_store.record()` / `record_sync()` — async + sync variants
  - `consecutive_failures(agent)` — Sentry reads this to decide when to wake Darwin
  - `capture_current_exception()` — convenience helper for except blocks
  - Persists to `agent_errors` DB table asynchronously
- **DB tables** (`app/db/init.py`)
  - `agent_errors` — structured error log with traceback, context, resolved flag
  - `it_department_log` — full IT ticket audit trail (diagnosis, proposed changes, test results, approval)
- **Filesystem tool** (`app/tools/filesystem_tool.py`)
  - `read_codebase_file(path)` — safe read with path validation
  - `list_codebase_files(dir)` — explore codebase structure
  - `backup_file(path)` — timestamped .bak before any write
  - `write_codebase_diff(path, old, new)` — targeted replacement only, never full overwrite
  - `create_codebase_file(path, content)` — new files only, Self-Create workflow
  - `restore_backup(bak_path)` — rollback if Shield says FAIL
  - Hard safety rules: allowlist of roots, forbidden files, extension filter, path traversal blocked

---

### Option A — Advanced Orchestration ✅

- **Approval system** (`app/services/approval_service.py`, `app/routes/approvals.py`)
  - Agents call `request_approval()` before irreversible actions — waits via asyncio.Event
  - SSE stream `/api/approvals/stream` — frontend gets real-time approval events
  - Claude Code-style floating overlay (`ApprovalOverlay.tsx`) — stacks up to 3 cards
  - Per-card: Approve / Deny buttons + "Always allow this action" toggle
  - Auto-approve: global kill-switch + per-action-type list saved in Settings → Approvals tab
- **Multi-step plan tracker** (`app/routes/plans.py`, `PlansPanel.tsx`)
  - `agent_plans` DB table — title, agent, steps (JSONB), status, timestamps
  - Plans panel in sidebar (GitBranch icon) — Active / History sections, collapsible steps
  - Step statuses: pending → running → done / failed / skipped with progress dots
  - Filter by status, delete plans, auto-open active plans
- **Inter-agent messaging** (`app/services/agent_bus.py`)
  - `agent_bus.publish(from, to, subject, payload)` — in-process pub/sub
  - `agent_bus.subscribe(agent_name)` → asyncio.Queue for any agent to listen
  - `agent_bus.broadcast(from, subject)` — send to all agents
- **Voice-triggered workflows** (`app/services/workflow_service.py`, `app/routes/workflows.py`)
  - 4 built-in workflows: Apply to Jobs, Check Email, Deep Web Research, Send Email
  - Trigger detection: pure regex, zero LLM cost, runs on every voice transcript
  - `POST /api/workflows/detect` — check if text matches a workflow
  - `POST /api/workflows/trigger` — create plan + optional approval request
  - Voice transcribe endpoint now returns `workflow` key when a match is found

### Phase 6B — Command Center ✅

- **`CommandCenterPanel.tsx`** — full 3D isometric floor plan with 15 department rooms
- **`CommandCenter3DScene.tsx`** — React Three Fiber; agent spheres with state animations (idle bob, working pulse, error glow)
- **`agentStore.ts`** — Zustand store; polls `/api/agents/live` every 30s, WebSocket for real-time AGENT_STATUS events
- **`/api/agents/live`** — returns agents (with `tasks_completed`, `tasks_failed`, `last_active`) + departments + autonomy map
- **Comm arcs** — `CommArcs` component polls `/api/agents/communications` every 15s; renders animated traveling-dot bezier arcs between dept rooms
- **Click interactions** — agent sphere → Agent detail sidebar (spring animation); room floor → Dept detail sidebar with enable/disable toggle

### Phase 6C — Agent Performance & Metrics ✅

- **DB tables** (`app/db/init.py`): `agent_communications`, `agent_actions`, `agent_performance_snapshots`
- **`agent_bus.publish()`** — now persists every inter-agent message to `agent_communications` (fire-and-forget background thread)
- **`/api/agents/communications`** — returns last N minutes of agent comms for comm arc rendering
- **`_record_agent_run()`** (`base_agent.py`) — fixed bug (was querying non-existent `agents` table → now `agent_registry`); now also inserts a row in `agent_actions` with duration_ms, input/output tokens
- **Warden worker** (`app/workers/warden_worker.py`) — weekly scan (Sunday 02:30 UTC); recomputes health scores, writes `agent_performance_snapshots`, pushes notification for critical/degraded agents
- **Warden registered** in `scheduler.py` via `_schedule_warden()`
- **Tests**: `test_darwin_helpers.py` — 15 tests for `_detect_project_root`, `_detect_app_type`, `_launch_and_verify` (all passing); full suite 138/138

### Phase 6D — Pipeline Bug Fixes (End-to-End Verification) ✅

Ran the full Darwin Self-Create pipeline end-to-end (React counter app). Fixed 10 bugs discovered:

- **`ai_provider.py`**: `_call_with_fallback` now catches `APIConnectionError`/`APIStatusError` and falls back to local. Empty-content check retries via local and raises on failure (no more silent empty returns).
- **`scroll_agent.py`**: Replaced JSON output format with `FILE:/ENDFILE` delimiter format — avoids all JSON encoding of file content (newlines, quotes, braces). Strips markdown code fences from extracted content.
- **`darwin_agent.py` `_upsert_ticket`**: Normalizes `affected_files` to Python list before DB insert (was passing `"[]"` string to `TEXT[]` column → `malformed array literal` error — tickets never written to DB).
- **`filesystem_tool.py`**: `_PROJECT_ROOT` was going 5 levels up (to `v:\Projects\`) instead of 4 (to project root). Added `frontend/public` to `ALLOWED_ROOTS`. Added `.html` and `.js` to `ALLOWED_EXTENSIONS`.
- **`probe_agent.py`**: `_BACKEND_ROOT` now points to `backend/python` (2 levels up, not 4). Replaced `asyncio.create_subprocess_exec` with `subprocess.run` via `run_in_executor` — Windows SelectorEventLoop doesn't support async subprocesses.
- **`shield_agent.py`**: Same `_PROJECT_ROOT` and subprocess fixes as Probe.

Pipeline fully verified: Scroll → Aria Gate 1 → Forge (3 files created) → Probe tests → resolved.

### Phase 6D — DB Change Protocol ✅

- **`db_change_service.py`** — `record_change()` (fire-and-forget), `get_recent_changes()`, `rollback_change()` (UPDATE/INSERT/DELETE strategies)
- **`db_change_log` table** — UUID PK, agent_name, table_name, operation, before/after JSONB snapshots, rollback tracking columns
- **`GET /api/db-changes`** — lists changes in past N hours; **`POST /api/db-changes/{id}/rollback`** — best-effort 24h rollback
- INTERVAL SQL parameterisation fix: `(%s || ' hours')::INTERVAL` pattern throughout

### Phase 6E — Autonomy Logging Panel ✅

- **`vetoed` column** added to `jazper_autonomous_actions` via `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
- **`GET /api/agents/autonomy-log`** — returns recent actions with `category_id`, `action_taken`, `reasoning`, `outcome`, `vj_reviewed`
- **`POST /api/agents/autonomy-log/{id}/review`** — marks `vj_reviewed = TRUE`, sets `vetoed` flag
- Autonomy log viewer embedded in Company Dashboard panel (Review/Veto buttons per unreviewed action)

### Phase 6F — Company Dashboard ✅

- **`company_dashboard.py`** — 4 endpoints: `/api/company/kpis`, `/api/company/departments`, `/api/company/kill-switch`, `/api/company/departments/{id}/toggle`
- **`CompanyDashboardPanel.tsx`** — KPI cards (active agents, tasks today, errors, open tickets), department scorecard table with health bars + per-dept enable/standby toggle, embedded autonomy log
- **Kill switch** — sets all L2+ agents to standby/active with confirmation dialog
- Sidebar: Building2 icon added above Settings divider

### Phase 6H — Agent Registry: Create, Retire, Create Department ✅

- **`POST /api/agents/departments/`** — new backend endpoint to create departments (id slug, name, description, badge_color)
- **`CreateAgentModal`** — full form: codename → auto-generates AGT-XXXXXX ID, name, title, department select, level L1–L5, model picker with info card, temperature slider, description, emoji + badge color picker
- **`CreateDepartmentModal`** — id slug, name, description, badge color
- **`RetireButton`** — two-step confirm + `DELETE /api/agents/{id}` (marks status = retired, reversible)
- **`+ New Agent`** button in Agents panel header → opens `CreateAgentModal`
- **`+ New Department`** button in Departments tab → opens `CreateDepartmentModal`
- **Retire** option in lifecycle tab of agent ID card (only shown when status ≠ retired)
- `POST /api/agents/departments/` added to backend docstring header

### Phase 6G — Company Dashboard UI/UX Polish + Graceful Degradation ✅

- **`CompanyDashboardPanel.tsx`** — full rewrite to use platform CSS class system (`sj-panel`, `sj-panel-header`, `sj-panel-body`, `sj-metric-card`, `sj-card`, `sj-feed-item`, `sj-bar`, `sj-badge`, `sj-dot`, `sj-btn-*`); removed all raw inline styles and hardcoded hex colors
- **`/api/agents/live`** — graceful degradation: returns `{"agents":[],"departments":[],"autonomy":{}}` with 200 when DB is unavailable instead of raising HTTP 500
- **`/api/agents/communications`** — same fix: returns `{"comms":[]}` instead of 500 on DB error
- **`agentStore.ts`** — downgraded `console.error` to `console.warn` for DB-unavailable fetch failures

### Phase 6I — Direct Agent Chat + Department Chat ✅

- **`POST /api/direct/agent/{codename}`** — SSE stream to chat directly with any individual agent; streams tokens as `data: <token>` and ends with `data: [DONE]`
- **`POST /api/direct/dept/{dept_id}`** — multi-agent department chat: all active agents in the department respond in parallel; each agent's response streamed with `[META]{codename}` frames
- **`agent_direct_chats`** table — persists per-agent chat history (messages as JSONB)
- **`dept_direct_chats`** table — persists per-department multi-agent chat sessions
- **CommandCenterPanel** — agent/dept detail sidepanels embed the direct chat UI; click agent sphere or department room → chat panel slides in

### Phase 6J — Agent Tool-Calling (16 Tools, Self-Evolution) ✅

- **`agent_tools.py`** — full 16-tool implementation:
  - Inspection: `list_agents`, `get_agent_info`, `list_departments`
  - Agent mutation: `create_agent`, `update_agent_settings`, `update_agent_status`, `delete_agent`
  - Department mutation: `update_dept_settings`
  - File system: `list_files`, `read_file`, `write_file`
  - Terminal: `run_command`, `install_package`
  - Web: `web_search` (DuckDuckGo via `ddgs`)
  - Memory: `save_memory`, `recall_memory`
- **`execute_tool()`** — central dispatcher; routes each tool call, returns structured result + `_make_preview()` summary for frontend display
- **`_resolve_safe()`** — path sandboxing: blocks all traversal outside `PROJECT_ROOT`
- **`_BLOCKED_PATTERNS`** — regex safety check on `run_command`: blocks `rm -rf`, `rmdir /s`, `shutdown`, `reboot`, fork bombs
- Tool-calling loop in `agent_chat.py`: up to 6 rounds; accumulates Groq `delta.tool_calls` deltas, executes on `finish_reason == "tool_calls"`, feeds results back as tool messages
- SSE frames: `[TOOL]{id,name,args}` · `[TOOL_RESULT]{id,name,preview}` · `[DONE]`
- Frontend tool pills in `CommandCenterPanel.tsx`: colour-coded by category (amber=write/delete/install, green=terminal, blue=search, purple=create), collapsible JSON output
- uvicorn `--reload` + Next.js HMR: agent file writes trigger live backend/frontend reloads automatically

### Phase 6K — Evolution Log + Approval Gate ✅

- **`evolution_log` table** — audit trail for every agent mutation: `agent_codename`, `action_type`, `target`, `description`, `payload` (JSONB, content omitted), `outcome`, `created_at`
- **`_MUTATION_TOOLS`** set + `_log_evolution()` helper in `agent_tools.py` — fire-and-forget logging called in `execute_tool()` after each mutation; never blocks caller
- **`_evolution_target()`** — derives human-readable target string per tool (path for file tools, codename for agent tools, command string for terminal)
- **`evolution.py`** route:
  - `GET /api/evolution` — filterable by `agent`, `action_type`, `limit` (max 200)
  - `GET /api/evolution/stats` — total count, breakdown by type and by agent
- **`EvolutionPanel.tsx`** — timeline UI with coloured action-type dots, filter by agent/type, expand/collapse payload JSON per entry
- **Approval gate** in `agent_chat.py`:
  - `_APPROVAL_REQUIRED = {"write_file", "install_package", "delete_agent"}`
  - Before risky tool execution: calls `approval_service.request_approval()`, emits `[APPROVAL]{id,name,approval_id}` SSE frame
  - Stream pauses at `asyncio.Event` until VJ approves/denies via `ApprovalOverlay`
  - On deny: returns `{"error": "Action denied by user"}` to agent; stream continues
- **`approvalPending`** field on `ToolCall` interface — chat bubble shows `⏳ approval needed` inline; cleared when `[TOOL_RESULT]` arrives
- **`DBChangeLogPanel.tsx`** — table view of `db_change_log` with INSERT/UPDATE/DELETE colour badges, before/after diff, inline Undo buttons
- Registered in `main.py`: `app.include_router(evolution_route.router)`

---

## Upcoming

### Option C — IT Department (Self-Repair + Self-Create) ✅

- **Stage 0: SentryWorker** (`app/workers/sentry_worker.py`)
  - APScheduler job every 30s — checks `error_store.consecutive_failures()` per agent
  - Threshold: 3 consecutive failures → wakes Darwin (1-hour cooldown per agent)
  - Pushes notification on Darwin completion

- **Stage 1: Repair workflow** (`darwin_agent.py`, `oracle_agent.py`, `forge_agent.py`, `shield_agent.py`)
  - Oracle: extracts broken file from traceback, asks LLM for exact old_string/new_string fix
  - Forge: applies targeted string replacement (backup-first), can restore on failure
  - Shield: runs full pytest suite, returns pass/fail counts
  - Darwin: orchestrates Oracle → approval → Forge → Shield → rollback if tests fail

- **Stage 2: Self-Create workflow** (`scroll_agent.py`)
  - Scroll: turns feature description into full spec + file contents
  - Darwin: Scroll → approval → Forge creates files → Shield validates
  - UI: "Create Feature" form in IT Department panel

- **Stage 3: Autonomous repairs**
  - `IndentationError`, `TabError` with confidence ≥ 0.88 auto-applied, no approval needed
  - All other error types still request human approval via overlay

- **IT Department panel** (`ITDepartmentPanel.tsx`, sidebar: Cpu icon)
  - Tickets tab: active/history split, full detail per ticket (diagnosis, diff, test output)
  - Errors tab: live error_store feed, consecutive failure counters, manual "Fix" button
  - Create Feature form triggers Scroll + Darwin workflow

- **Routes**: `GET/POST /api/it/tickets`, `POST /api/it/repair`, `POST /api/it/create`, `GET /api/it/errors`

### Option D — Phases Advanced ✅

- **Voice per personality** (`app/routes/phases.py` → `POST /api/phases/speak`)
  - Each personality speaks with a distinct Edge-TTS voice (Past=younger, Future=confident, Logical=neutral, Emotional=warm)
  - Auto-play toggle in Phases panel header — plays TTS after each personality_done event
  - Voice config stored in `phases_voice_config` DB table

- **Voice recording + AI profiling** (`app/routes/voice_profile.py`, `app/services/voice_profile_service.py`)
  - User records ~10s voice sample in browser → sent to `/api/voice-profile/analyze`
  - librosa extracts mean F0 (fundamental frequency) → classifies gender + age range
  - Auto-suggests best Edge-TTS voice per personality based on detected profile
  - Falls back to manual gender/age picker when librosa unavailable
  - Age/gender variants with preview: Child (AnaNeural + prosody pitch+25%), Teen (+12%), Mature (-10%), Elder (-22%), Opposite gender
  - SSML `<prosody>` tags for pitch + rate adjustments without changing voice model
  - `/api/voice-profile/preview` — test any voice + prosody before saving
  - Saved to `phases_voice_config` table

- **Big Five psychological profiling** (`VoiceProfilePanel.tsx` → Big Five tab)
  - 10-question TIPI questionnaire, rated 1–7
  - Live trait bars update as user answers
  - Scores auto-tune each personality's riskTolerance, logicLevel, emotionLevel, optimism
  - Trait overrides returned immediately and previewed per personality
  - Saved to `phases_profile` table (singleton row)

- **Memory injection** (`app/routes/phases.py` → `/chat` + `/timeline`)
  - Before each personality responds, keyword-matches user message against `extracted_memories`
  - Up to 4 relevant memories injected into system prompt as context
  - Personality can reference actual past events, not just simulated timeline
  - `inject_memories: bool` flag on request — opt-out per call

- **Personality timeline** (`VoiceProfilePanel.tsx` → Timeline tab, `POST /api/phases/timeline`)
  - Year slider 2010–2040 — any point in Vijay's life
  - Interpolates riskTolerance, logicLevel, emotionLevel, optimism between past/current/future anchors
  - Generates a custom system prompt for that era (describes life context, cognitive profile)
  - Full SSE streaming chat — same infrastructure as Phases solo mode
  - `GET /api/phases/timeline/persona?year=N` — preview interpolated traits without chatting

- **UI** (`VoiceProfilePanel.tsx`, sidebar: Mic2 icon)
  - Three tabs: Voice Profile / Big Five / Timeline
  - Voice Profile: record → analyze → age variants → per-personality assignment → save
  - Big Five: TIPI questionnaire → live bars → apply
  - Timeline: year slider with trait preview → chat with that version of yourself

---

## How to run tests

```bash
cd backend/python
pip install pytest pytest-asyncio
pytest
```

Expected: all routing tests pass immediately (no external deps).
Agent smoke tests need mock fixtures — they pass with mocked AI.
