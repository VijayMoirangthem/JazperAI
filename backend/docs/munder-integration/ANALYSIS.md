# COOS x Munder Difflin — Pre-Coding Analysis

> Prepared before implementation of the Munder Integration Phase.
> Date: 2026-08-20

---

## 1. COOS Current Architecture

**COOS ("Create Origins Operating System")** is a self-hosted personal AI operating
system. The user (VJ) is the sole user. A fleet of AI agents act as employees across
16 departments, coordinated by **Jazper** (global orchestrator / Chief of Staff).

### Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (app router), React 19, TypeScript, Tailwind v4 |
| State | Zustand (`frontend/src/stores/`) |
| 3D | Three.js + React Three Fiber + drei (`CommandCenter3DScene.tsx`) |
| Editor | Monaco (`@monaco-editor/react`, `IDEPanel.tsx`) |
| Backend | Single FastAPI service (`backend/python/`, port 8000) |
| DB | PostgreSQL + pgvector (Docker), Redis (sessions/cache), MinIO (files) |
| AI | Groq (primary, OpenAI-compatible), LM Studio local fallback, optional Claude |
| Search | Tavily -> Brave -> DuckDuckGo -> Wikipedia fallback chain |
| Scheduling | APScheduler in-process + background asyncio tasks |

### Backend layout

```
backend/python/
  main.py                  <- all router registrations, lifespan, log ring buffer
  app/
    core/config.py         <- pydantic Settings (.env)
    providers/ai_provider.py
    db/init.py             <- all CREATE TABLE + seeds (agents, departments, ...)
    routes/                <- ~79 routers
      chat.py              <- main Jazper chat + chain loop (ReAct)
      agent_chat.py        <- direct agent chat + 16-tool tool loop + approval gate
      agent_tools.py       <- tool definitions + execute_tool() + evolution log
      agents.py            <- /api/agents/live, CRUD, comms, schedules
      ws.py                <- WebSocket (broadcast() exists but never called)
      ... (calendar, voice, jobs, phases, business, ...)
    services/              <- agent_bus, approval_service, terminal_service, ...
    agents/                <- BaseAgent + specialized agents (Darwin, Forge, ...)
    workers/               <- APScheduler workers (Hermes, Atlas, Sentry, ...)
    scheduler/scheduler.py <- cron job registry
    system/                <- process_manager, terminal_sandbox, file_watcher
```

### Data model highlights

- `agent_registry` - 40 agents, 16 departments, each with codename, department,
  level, model, system_prompt, badge_color, avatar (DiceBear/emoji/custom).
- `departments` - id (slug), name, head_agent, enabled, budget, **`floor_position`
  JSONB `{x,y,w,h}` (2D grid cell)** - currently never read by the UI.
- `agent_communications` - inter-agent message log (written by `agent_bus`).
- `agent_actions` / `agent_performance_snapshots` - telemetry.
- `agent_direct_chats` / `dept_direct_chats` - chat history.
- `evolution_log`, `approval_requests`, `db_change_log`, `agent_errors`,
  `it_department_log` - governance/audit.

### Command Center today

- `CommandCenterPanel.tsx` (2137 lines) - header stats, a **3D Three.js floor**
  (`CommandCenter3DScene.tsx`, 986 lines), `AgentContextMenu` (right-click),
  `DeptDetailPanel` (floating, tabs: overview/agents/chat), `AgentDetailPanel`
  (floating, tabs: overview/chat/activity/settings).
- Driven by `useAgentStore` (`selectedAgentId`, `selectedDeptId`, `contextMenu`).
- Polling: `/api/agents/live` every 30s, `/api/agents/communications` every 15s.
- WebSocket connected to `/ws/` but the backend never emits `AGENT_STATUS` or
  `CHAT_REPLY` - runtime status is effectively stale between polls.

### Strengths to preserve

- Huge feature surface (Personal/Career/Comms/Intelligence/Productivity/Creative/
  Business/Agent OS systems) all on one API + one DB.
- Real agent orchestration: tool loop, approvals, evolution log, direct chat.
- Good visual identity (dark glassmorphism + neon) and a proven Three.js pipeline.
- Self-healing IT department (Darwin pipeline), scheduler workers, file watcher.

### Weaknesses / gaps for a "living office"

- No real-time agent **action** stream (only coarse `runtime_status`).
- No notion of an agent *workspace* / mailbox / shared board on disk.
- No terminal-per-agent experience (terminal_service exists but is IDE-scoped).
- No game-like floor (current floor is a static 3D diorama, no movement/pathing).
- Department `floor_position` is ignored by the renderer; 3D layout is hardcoded
  and even omits `quality_assurance`.

---

## 2. Munder Difflin Architecture

Munder Difflin is an Electron desktop app that wraps real terminal-agent CLIs
(`claude`, `codex`, `grok`, `opencode`, ...) as agents on a shared "office floor".

### Stack

| Layer | Tech |
|-------|------|
| Shell | Electron + electron-vite |
| Renderer | React 19 + TypeScript |
| Graphics | **Pixi.js** (2D office floor, avatars, envelopes) |
| Terminal | **node-pty** + **xterm.js** |
| Editor | Monaco (built-in IDE + git rails) |
| State | Zustand (`src/renderer/src/store/store.ts`) |
| Persistence | SQLite (durable ledger) + filesystem "hive" + local git |

### Core concepts

1. **The hive** - a plain-file, git-committed workspace:
   - `agents/<id>/identity.md`, `memory.md`, `inbox/`, `outbox/`
   - `board.md` (narrative plan - GOD is the sole scribe)
   - `tasks.json` (structured kanban: todo/doing/blocked/done)
   - `fleet.json` (live fleet telemetry), `log.jsonl` (append-only event log)
   - **Single-committer design** - only the harness runs git (avoids index.lock).
2. **Message router** - agents write JSON messages to their own `outbox/`; the
   harness moves them to the recipient's `inbox/`. Speech acts:
   `request | inform | propose | query | agree | refuse | done`.
3. **GOD agent (Michael)** - the orchestrator/supervisor the human talks to; seats
   in the CEO office, routes tasks, adjudicates, escalates only critical items.
4. **Agent runtime** - each agent is a real `node-pty` PTY running a CLI (Claude
   Code etc.); output streamed to xterm.js; hooks post lifecycle payloads
   (`PreToolUse -> working`, `Stop -> idle`, `Notification -> blocked`, ...).
5. **The floor** - a Pixi.js tiled scene: avatars walk (BFS pathfinding), sit at
   desks, show thought bubbles, send **envelopes** desk-to-desk, run coffee
   errands, cheer on task completion, and react to the boss's aura.
6. **Circuit breaker + budgets** - steer -> constrain -> stop ladder, per-agent
   token budgets, real cost from transcripts.
7. **Human gates** - approvals for spend/destructive ops; `/remote-control`.

### Renderer contract (the part we reproduce)

The floor subscribes once to a Zustand store; every agent needs only:

```
id, status, action, carrying?, lastPrompt?, accent, character, isGod?, archived?
```

The floor maps: `status -> pose+glyph`, `action -> thought bubble`, `accent -> glow`,
`character -> sprite frames`, `id -> envelope routing + selection`.

Key files (cloned at `C:\Users\vijay\AppData\Local\Temp\opencode\munder-difflin`):

```
src/renderer/src/scene/office/
  OfficeFloor.tsx      1761 lines - React shell + full Pixi scene + directors
  Character.ts          883 lines - walk/sit/bubble/glyph/fx state machine
  CharacterSprite.ts   115 lines - AnimatedSprite (down/up/right x walk/idle/...)
  pathfinding.ts        66 lines - BFS on a walkability grid
  MessageEnvelope.ts   146 lines - flying envelope + arrival burst
  ThoughtBubble.ts      - pixel speech cloud
  cast.ts               - procedural character recipes (no sprite sheets!)
  portraitArt.ts        - paints 18x32 character frames at runtime
  themeRegistry.ts      - map/tileset/desk/errand/spawn-point config
  TiledMapRenderer.ts   - draws Tiled JSON maps + collision grid
  Camera.ts             - fit-to-screen lerp camera + selection nudge
```

---

## 3. Feature-by-Feature Comparison

| Capability | COOS (today) | Munder Difflin | Verdict |
|-----------|--------------|----------------|---------|
| Agent roster | 40 agents / 16 depts (DB) | Few agents, spawned per session | Reuse COOS roster |
| Orchestrator | Jazper (chat orchestrator, chain loop) | GOD agent (Michael) | **Adapt** Jazper as GOD |
| Agent chat | Direct chat + dept chat (SSE) | Type into agent's TUI | Reuse chat; add terminal view |
| Agent tools | 16-tool loop + approvals | CLI-native tools + hooks | Reuse tool loop |
| Inter-agent messaging | `agent_bus` + DB log | File-based inbox/outbox | **Integrate**: add hive mailboxes |
| Memory | 4-tier DB memory | Markdown memory + semantic recall | Keep COOS memory; add `memory.md` |
| Task board | `tasks` tables + pipeline | `tasks.json` kanban | **Integrate**: hive board |
| Event/log | DB tables + ring buffer | `log.jsonl` | Reuse; add hive log |
| Terminals | IDE-scoped `terminal_service` | Per-agent PTY + xterm | **Add** per-agent terminal |
| Workspace | None per agent | `agents/<id>/` dirs | **Add** hive workspace |
| Visualization | 3D static diorama | 2D living office floor | **Replace default** with floor |
| Git/worktrees | No agent isolation | Per-agent worktrees | Defer (post-Phase-1) |
| Auth/security | None (personal) | BYOK + approvals + breaker | Keep COOS approvals |
| AI provider | Groq/LM Studio/Claude | Many CLIs + BYOK | Reuse COOS model layer |

---

## 4. Reuse vs Replace vs Integrate

### Reuse as-is

- Backend: `agent_registry`, departments, tool loop (`agent_tools.py`),
  approvals, evolution log, agent chat, scheduler, workers, memory, model router.
- Frontend: `useAgentStore`, `AgentDetailPanel`, `DeptDetailPanel`,
  `AgentContextMenu`, Sidebar/Topbar navigation, design tokens (`sj-*`).

### Replace (default view only - nothing deleted)

- `CommandCenter3DScene` becomes a secondary "3D" tab; the **2D office floor**
  becomes the default Command Center view.

### Integrate (new, built this phase)

- **Hive workspace** on disk (`storage/hive/`) - identity, memory, inbox/outbox,
  board, tasks, fleet, log.
- **Agent runtime manager** - live `status` + `action` + activity stream.
- **WS event plane** - real `AGENT_STATUS` / `AGENT_ACTION` / `AGENT_MESSAGE`
  broadcasts from the backend (fixes the dead `broadcast()` in `ws.py`).
- **Per-agent terminal** - commands run in the agent's workspace via
  `terminal_service`, streamed to an xterm.js panel.
- **Office floor** - Pixi.js tiled scene with procedural avatars, BFS walking,
  thought bubbles, envelopes, status glyphs, camera (pan/zoom).
- **Command Center hub** - tabs: Floor / 3D / Terminals / Messages / Activity /
  Tasks.

---

## 5. What Must Be Refactored

1. **`ws.py`** - expose a working event broadcaster (module-level async queue fan-out).
2. **`agent_chat.py` / `agent_tools.py`** - report status/action transitions into
   the runtime manager so the floor reflects real activity.
3. **`CommandCenterPanel.tsx`** - introduce a tabbed hub; extract the header; keep
   detail panels/context menu intact.
4. **Frontend store** - extend `AgentLive` with live `action` + status plumbing;
   subscribe to the new WS event names.
5. **Agent route/registry docs** - document the GOD role for Jazper.