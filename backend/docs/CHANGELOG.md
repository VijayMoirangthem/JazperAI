# COOS Changelog

## 2026-08-20 - Phase 1: Munder Difflin Integration (in progress)

### Added

- `docs/munder-integration/` - analysis, proposed architecture, integration guide
- `docs/ARCHITECTURE.md`, `docs/SYSTEMS.md`, `docs/AGENT_ARCHITECTURE.md`,
  `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`
- Backend:
  - `app/services/hive_service.py` - per-agent workspaces (identity/memory/inbox/outbox),
    shared board, task kanban, fleet snapshot, append-only event log, singleton `hive` facade
  - `app/services/agent_runtime.py` - live status/action/activity registry, terminal
    subscriber queues, lazy WS fan-out (`AGENT_STATUS` / `AGENT_ACTION` / `AGENT_ACTIVITY`)
  - `app/routes/hive.py` - `/api/hive/*` endpoints (state, route, board, tasks, activity,
    inbox, terminal SSE stream + exec, Jazper dispatch)
  - `app/routes/ws.py` - broadcaster now prunes dead sockets + exposes `client_count`
  - `app/routes/agent_chat.py` - tool loop reports status/tool activity into the runtime
- Frontend:
  - Dependencies: `pixi.js`, `@xterm/xterm`, `@xterm/addon-fit`
  - `src/scene/office/*` - types, procedural pixel avatars (seed+accent → 16x24 sprite),
    BFS pathfinding, map builder from dept `floor_position` (7x3 city grid), Character
    (walking/animation/status ring/thought bubble), MessageEnvelope (arc + ACT_COLOR tint),
    fit-to-screen lerp camera, Pixi `OfficeFloor`
  - `src/hooks/useHive.ts` - state/tasks/activity polling + route/board/task/message/dispatch/terminal actions
  - `src/stores/agentStore.ts` - handles `AGENT_STATUS` / `AGENT_ACTION` / `AGENT_MESSAGE` /
    `AGENT_ACTIVITY` WS events; messages + activities arrays
  - `CommandCenterPanel.tsx` - tabbed hub: Floor (default) / 3D / Activity / Messages /
    Tasks / Terminals; existing AgentDetailPanel, DeptDetailPanel, AgentContextMenu preserved
  - `CommandCenterViews.tsx` - FloorView (floor + fleet rail + legend), ActivityView
    (live feed + mission board + Jazper dispatch), MessagesView (mailbox + composer),
    TasksView (kanban + add), TerminalsView (agent picker + live stream + exec input)

### Fixed

- `hive_service` no longer calls `asyncio.get_event_loop().run_until_complete()` from within
  a running loop — replaced with a safe `_fire()` helper (`create_task` in-loop, `asyncio.run` otherwise)
- Removed stray pages-router demo artifacts (`src/pages/_app.tsx`,
  `src/components/CounterApp.tsx`) that forced the Pages Router and broke `next build`

### Verification

- Backend imports clean; hive + runtime smoke-tested in an async loop
- Frontend `tsc --noEmit` clean
- Frontend `next build` succeeds (full route set prerendered)

## Prior history

See `docs/project_status.md` and `docs/roadmap/status.md` for the phase-by-phase
build log (Phases 1-16).