# Sir Jazper OS — Project Status

**Last updated**: 2026-07-23  
**Current phase**: Phases 12–16 complete — Global Search · Notification Center · Email Composer · NLP Dates · Smart Brief · Keyboard Shortcuts · Habits · Focus Timer · Weekly Review · Smart Suggestions · Proactive Pings · Email Improve · CL Coach · Productivity Score · Onboarding Flow · Activity Timeline · Quick Actions Bar · Export & Backup · **Phase 17 next**

---

## Live Features

### Core Infrastructure
- **FastAPI backend** — port 8000, auto-reload via uvicorn `--reload`
- **Next.js 14 frontend** — port 3000, TypeScript, app router
- **PostgreSQL** — all state persisted, Docker compose
- **Groq AI** — LLM provider (OpenAI-compatible), free tier
- **Structlog** — structured logging with in-memory ring buffer (last 500 entries)

### Agent Fleet (Phase 6A)
- **40 agents** across 16 departments seeded in `agent_registry`
- 13 active, 27 standby — can be activated at any time
- Each agent has: codename, name, title, department, level (L1–L5), model, system_prompt, voice config, badge color, avatar
- Built-in system prompts for all 40 agents synced on startup
- `GET /api/agents` — full registry with live stats

### Agent Performance (Phase 6B)
- `agent_actions` table — every action logged with tokens, duration, cost
- `agent_performance_snapshots` — weekly snapshots per agent
- Health score computed from task completion rate
- Activity logs visible per agent in CommandCenterPanel → Activity tab

### Agent Direct Chat + Tool-Calling (Phase 6I + 6J + 6K)
- `POST /api/direct/agent/{codename}` — SSE stream with full tool-calling loop
- `POST /api/direct/dept/{dept_id}` — multi-agent department chat
- **16 tools** available to every agent (see `agent_tools.py`)
- Tool categories: inspection · agent mutation · department mutation · file system · terminal · web search · memory
- SSE frames: `[TOOL]`, `[TOOL_RESULT]`, `[APPROVAL]`, `[DONE]`, `[ERROR]`, `[META]`
- Tool results rendered inline in chat (colour-coded pills + output preview)
- **Approval gate** for risky tools: `write_file`, `install_package`, `delete_agent`
- Tool history stored in `agent_direct_chats` and `dept_direct_chats`
- Per-agent voice playback with auto-speak toggle

### Self-Evolution System (Phase 6J/6K)
- Agents can modify their own code and the entire OS codebase
- Backend `.py` changes hot-reload via uvicorn. Frontend `.tsx` changes hot-reload via Next.js HMR
- Every mutation logged to `evolution_log` table
- `GET /api/evolution` — filterable audit trail
- **EvolutionPanel** — timeline UI with colour-coded action types, payload expansion
- `_log_evolution()` called automatically in `execute_tool()` for all mutation tools
- **Agent memory** — `save_memory` / `recall_memory` tools write to `agent_memory` table

### Approval System (Phase 6C/Option A)
- `approval_requests` table + asyncio.Event in-memory gate
- `request_approval()` / `wait_for_approval()` / `resolve()` in `approval_service.py`
- `ApprovalOverlay` — global modal that appears when any approval is pending
- `ApprovalsPanel` — full list of pending and historical approvals
- Auto-approve types configurable in Settings
- Wired into agent tool-calling: risky tools pause stream until approved

### IT Auto-Repair (Phase 6F)
- Darwin agent watches log buffer for error-level events
- On error: creates `agent_errors` record, triggers `DarwinAgent.handle_repair()`
- IT department pipeline: Oracle (diagnose) → Forge (fix) → Shield (QA) → Scroll (docs)
- `it_department_log` table tracks all repair tickets
- `ITDepartmentPanel` — view open tickets, diagnoses, proposed fixes

### DB Change Log (Phase 6D)
- `db_change_log` table — records INSERT/UPDATE/DELETE with before/after JSONB
- `GET /api/db-changes` — filterable by time window
- `POST /api/db-changes/{id}/rollback` — rollback any recorded change
- **DBChangeLogPanel** — table view with inline rollback buttons and diff expansion

### Company Dashboard / Command Center (Phase 6G)
- **3D Three.js floor plan** of the entire company (CommandCenterPanel)
- 16 departments rendered as glowing nodes, agents as orbiting particles
- Click dept → DeptDetailPanel (overview, agents, chat)
- Click agent → AgentDetailPanel (overview, chat, activity, settings)
- Real-time agent runtime_status updates via WebSocket

### Pipeline Mind Map (Phase 6H)
- React Flow canvas visualising multi-agent pipeline runs
- Nodes per agent, edges for data flow, live status colours
- Stored in Zustand `pipelineStore`

### Navigation (all panels)

| View key | Panel |
|----------|-------|
| `dashboard` | Multi-pane with Chat, Tasks, Dashboard |
| `chat` | Main Jazper chat |
| `agents` | Agent registry + management |
| `command_center` | 3D company floor + agent/dept chat |
| `phases` | Digital Mind Simulation |
| `roadmap` | Roadmap viewer + notes |
| `plans` | Agent plans |
| `it_dept` | IT Department repair tracker |
| `approvals` | Approval requests |
| `voice_profile` | Voice settings |
| `pipeline` | Pipeline mind map |
| `company` | Company dashboard |
| `ide` | In-browser IDE |
| `control_tower` | Control Tower |
| `evolution` | Evolution log timeline |
| `db_changes` | DB change log + rollback |
| `calendar` | Google Calendar week view |
| `settings` | App settings |

---

## Database Tables (all created on startup via `db/init.py`)

| Table | Purpose |
|-------|---------|
| `agent_registry` | 40 agents with full config |
| `departments` | 16 departments |
| `agent_actions` | Every agent action with tokens/cost |
| `agent_performance_snapshots` | Weekly per-agent snapshots |
| `agent_direct_chats` | Per-agent chat history |
| `dept_direct_chats` | Per-dept multi-agent chat history |
| `agent_memory` | Per-agent persistent key-value memory |
| `evolution_log` | Agent mutation audit trail |
| `approval_requests` | Approval request records |
| `db_change_log` | DB INSERT/UPDATE/DELETE with rollback |
| `agent_errors` | IT error reports |
| `it_department_log` | IT repair tickets |

---

### Agentic Chain Loop (July 2026)

Multi-step ReAct execution for complex queries ("find X then do Y"):

- **Two-path routing**: `simple` → pre-fetch path (unchanged speed). `chain` → `run_chain_loop()` async generator
- **Intent classifier** (`_classify_intent` in `chat.py`): runs in parallel with memory/profile lookups — zero perceived latency
  - Fast-path rules: `≤5 words → simple`, `"and then / and apply / if found…" → chain`, `question words → simple`
  - Fallback to LLM (max_tokens=5, 3s timeout) for ambiguous cases
- **Plan step**: LLM generates a numbered plan before acting — shown as live checklist (`[CHAIN_PLAN]`)
- **Step streaming**: each tool call emits `[CHAIN_STEP]` events with status icons (thinking/running/done/error)
- **Approval gate**: destructive tools (send_email, trash_email, forward_email, create_event, run_script) pause the stream — user sees `ApprovalModal` overlay; `POST /api/chat/approve/{session_id}` resumes it
- **Error state**: `[CHAIN_ERROR]` marks pending steps as failed and shows a red banner on the plan card
- **Token usage**: chain loop accumulates usage across all internal calls and emits `{"__usage__": ...}` in `finally` — always surfaces in `[META]`
- **Memory safety**: `try/finally` in `run_chain_loop` guarantees `_approval_events[session_id]` is cleaned up even on crash or timeout — no dict growth
- **Tools**: `read_email`, `send_email`, `trash_email`, `web_search`, `write_note`, `done`

**SSE events**: `[CHAIN_PLAN]`, `[CHAIN_STEP]`, `[APPROVAL_NEEDED]`, `[CHAIN_ERROR]`, `[CHAIN_DONE]`

---

### Phase 7A — Plugin Registry (July 2026)

Single source of truth for all panels in Sir Jazper OS:

- `frontend/src/app/plugin-registry.ts` — every panel defined once: id, label, icon, group, badge, title
- `Sidebar.tsx` fully driven by registry — `SIDEBAR_MAIN`, `SIDEBAR_AGENT_OS`, `SIDEBAR_BOTTOM`
- `page.tsx` derives `View`, `VALID_VIEWS`, and `TITLES` from registry
- **Adding a new panel**: create component + add entry to registry + add line in `singlePanel`

### Phase 7B — Agent Marketplace (July 2026)

In-OS template library for creating specialist agents without touching code:

- `GET /api/agents/templates` — 8 curated templates (research, email, code, data, task, security, creative, finance)
- `AgentMarketplacePanel.tsx` — template gallery + create form (codename, system prompt, model, level, badge colour)
- Created agents land in `agent_registry` immediately; navigate to Agents panel to activate
- Accessible via `marketplace` view, icon in sidebar (Agent OS group)

### Phase 7C — Agent-to-Agent Delegation (July 2026)

Chain loop can now delegate sub-tasks to any COOS fleet agent:

- New `delegate_to_agent` tool in `_CHAIN_TOOLS` — args: `agent` (codename), `task` (description)
- Looks up agent from `agent_registry` by codename, uses their `system_prompt` and configured model
- Calls `ai_provider.chat()` directly (non-streaming, no HTTP overhead)
- Result returned as `[AgentName]: <response>` — used by the chain loop in subsequent steps
- Example: "Find the Python job emails and draft a response" → Scout reads emails → Hermes drafts reply

### Phase 7D — File Watcher (July 2026)

Automatic dependency install on file change:

- `backend/python/app/system/file_watcher.py` — watchdog observer in a daemon thread
- `requirements.txt` changed → pip install auto-triggered via CommanderAgent
- `package.json` changed → npm install auto-triggered
- All file events (create/modify/delete/move) emitted to IDE bus for live monitoring
- Watcher started in FastAPI lifespan; non-fatal if watchdog unavailable

### Phase 8A — Agent-to-Agent Messaging Bus (July 2026)

Agents can now send async messages to each other — coordination without human involvement:

- **Infrastructure**: `agent_communications` table + `agent_bus.py` pub/sub already existed; added `to_agent` index for fast inbox queries
- **Tools** (in `agent_tools.py`):
  - `send_agent_message(to_agent, subject, message)` — persists to DB, verifies recipient exists
  - `read_messages(limit, unread_only)` — returns inbox, newest first
- **REST API** (in `agents.py`):
  - `GET /api/agents/{codename}/inbox` — full inbox with read/unread state
  - `POST /api/agents/{codename}/inbox/{msg_id}/read` — mark as read
- **Frontend**: "Inbox" tab added to `AgentModal` — shows messages grouped by read/unread, mark-read button, unread badge on tab; empty state with usage hint

### Phase 8C — Autonomous Scheduling (July 2026)

Agents can register, list, and cancel their own recurring cron jobs without human setup:

- **DB migration**: `owner_agent TEXT` and `description TEXT` columns added to `cron_jobs` (idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS`)
- **Tools** (in `agent_tools.py`):
  - `schedule_task(name, cron_expression, worker_type, description, config)` — inserts job with `owner_agent = caller`, validates 5-part cron, calls `sync_jobs()` to hot-register in APScheduler
  - `cancel_task(name)` — deletes only jobs owned by the caller, calls `sync_jobs()`
  - `list_my_schedules()` — returns all cron jobs owned by this agent
- **REST API** (in `agents.py`):
  - `GET /api/agents/{codename}/schedules` — list agent's schedules
  - `DELETE /api/agents/{codename}/schedules/{job_id}` — remove (UI delete button)
- **Frontend**: "Schedule" tab added to `AgentModal` — shows job name, cron expression, worker type, enabled/disabled badge, description, delete button; count badge on tab

### Phase 8B — Google Calendar Integration (July 2026)

Full Google Calendar read/write via the same OAuth token as Gmail:

- **`calendar_service.py`** — pure-Python service layer
  - `get_today()`, `get_week(start_date)`, `get_events(start, end, max)` — fetch events
  - `check_free_busy(start_iso, end_iso)` — freebusy endpoint, returns `{free, conflicts}`
  - `create_event(title, start, end, ...)` — creates Google Calendar event with optional attendees, location, Meet link
  - `format_events_for_context(events)` — LLM-readable text block
  - `CalendarNotAuthorized` exception — triggered when calendar scope is missing
- **`calendar.py`** — REST endpoints at `/api/calendar/`
  - `GET /today`, `GET /week`, `GET /events`, `GET /free-busy`, `GET /status`
  - `POST /events`, `DELETE /events/{id}`
  - 401 with clear message when not authorised
- **Chain loop tools**: `read_calendar` and `create_event` wired into `_execute_tool` — chain AI can check and create events autonomously (create_event behind approval gate)
- **Pre-fetch in chat.py**: calendar keywords trigger `_get_calendar_ctx()` in the `asyncio.gather` — today's events injected as `[REAL GOOGLE CALENDAR DATA]` context before the LLM call (zero extra latency)
- **CalendarPanel.tsx** — full week view with navigation, event cards (expandable with Meet link, attendees, location), create-event modal, delete, auth error banner
- **Plugin registry** — `calendar` entry added between Gmail and Job Apply; `CalendarDays` icon
- **OAuth scope** — `https://www.googleapis.com/auth/calendar` added to `_OAUTH_SCOPES` and `SCOPES`; user needs one re-auth via Settings → Google

### Token Usage — Full Chain Loop Coverage (July 2026)

- `stream_with_tools` now emits `{"__usage__": ...}` after every call (previously 0)
  - Added `stream_options: include_usage: True` to kwargs
  - Continues iterating after tool-call sentinel to capture Groq's trailing usage chunk
- Chain loop `finally` block yields accumulated usage; `_generate_inner` merges it into `[META]`

---

### Phase 8D — Voice Command Chains (July 2026)

Voice mode now routes multi-step commands through the full agentic chain loop:

- **Detection**: `_is_voice_chain(text)` in `voice.py` — checks for signals like "and then", "after that", "then send" across a 14-pattern tuple; skips short utterances (≤5 words)
- **Routing**: `converse()` dispatches to `_voice_chain_stream()` when a chain is detected
- **Chain SSE passthrough**: `[CHAIN_PLAN]`, `[CHAIN_STEP]`, `[APPROVAL_NEEDED]`, `[CHAIN_DONE]`, `[CHAIN_ERROR]` forwarded to frontend
- **TTS narration**: key moments are spoken aloud — plan summary, step results on completion, approval prompts, error messages
- **Frontend**: `useVoiceConversation.ts` handles chain SSE events; `chainSteps` state tracks each step's status (`thinking/running/done/error`)
- **UI**: `VoiceModePanel.tsx` shows a compact "Executing chain" overlay with per-step icons (spinner/check/X) and truncated results; state color changes to amber during chaining

### Phase 8E — Plugin Hot-Loading (July 2026)

Drop a `.tsx` file in `frontend/src/plugins/` and it appears in the sidebar without a restart:

- **`_manifest.json`** — JSON list of registered plugin metadata (id, label, group, icon, description)
- **`_loader.ts`** — auto-generated Next.js dynamic import map; file watcher appends new entries when a plugin is detected; HMR propagates to the browser
- **`ExamplePlugin.tsx`** — starter plugin with `pluginMeta` export showing the convention
- **File watcher** (`file_watcher.py`): `on_created` detects new `.tsx` in `src/plugins/`, regex-parses `pluginMeta`, updates `_manifest.json` + `_loader.ts`, emits IDE bus event
- **Backend API** (`plugins.py`): `GET /api/plugins` returns manifest; `POST /api/plugins/register` allows manual registration; `DELETE /api/plugins/{id}` removes an entry
- **Sidebar**: fetches `/api/plugins` on mount; renders dynamic plugin buttons with `DYNAMIC_ICON_MAP` lookup (Puzzle fallback); live section visible immediately after registration
- **page.tsx**: `PLUGIN_COMPONENTS` from `_loader.ts` spread into `singlePanel`; plugin IDs merged into `VALID_VIEWS` so hash routing works
- **`DYNAMIC_ICON_MAP`** in `plugin-registry.ts` — maps icon name string → LucideIcon component

## Phases 12–16 — Feature Completions (2026-07)

- **Phase 12**: Global Search (SearchPanel), Notification Center (NotificationCenterPanel)
- **Phase 13**: Email Composer (EmailComposerPanel), Task Quick-Add, Hermes Reply
- **Phase 14**: NLP Dates, Smart Brief (BriefingsPanel), Keyboard Shortcuts, Habits (HabitsPanel), Focus Timer, Weekly Review
- **Phase 15**: Smart Suggestions, Proactive Pings, Email Improve, CL Coach, Productivity Score
- **Phase 16**: Onboarding Flow, Activity Timeline (ActivityTimelinePanel), Quick Actions Bar, Export & Backup
- **TypeScript**: 0 errors from our code — all 4 panel type errors fixed (ApprovalsPanel, StudioLayout, ITDepartmentPanel, WebhooksPanel)

## Phase 17 — Next

TBD

## Known Limitations

- `run_command` approval gate not added (only write_file, install_package, delete_agent)
- Groq free tier: tool calls accumulate deltas (no native streaming tool calls on all models)
- Chain loop token counts cover the plan step and any `stream()` calls; `stream_with_tools()` steps not yet counted (requires adding `stream_options: include_usage` to that method)
- Dynamic plugins need a `pluginMeta` export to be auto-detected; icon must be a key in `DYNAMIC_ICON_MAP`
