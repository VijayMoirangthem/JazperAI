# COOS x Munder Difflin — Proposed Unified Architecture

> Companion to `ANALYSIS.md`. Date: 2026-08-20

---

## 6. Proposed Unified Architecture

```
COOS
│
├── Jazper / Global Orchestrator (GOD role)
│
├── Departments (16) - heads + agents (agent_registry)
│
├── Hive Layer (NEW)
│   ├── Workspace (storage/hive/agents/<id>/) - identity, memory, inbox, outbox
│   ├── Router (outbox -> inbox) + agent_bus (pub/sub) + DB log
│   ├── Board + Tasks (kanban)
│   └── Fleet + Event log
│
├── Agent Runtime (NEW)
│   ├── Live status/action per agent
│   ├── Activity stream (WS: AGENT_STATUS/AGENT_ACTION/AGENT_MESSAGE)
│   └── Per-agent terminal (terminal_service + workspace cwd)
│
├── Execution Layer (reuse)
│   ├── Tool loop (16 tools), filesystem sandbox, terminal_sandbox
│   ├── Git / browser / docker (existing capabilities)
│   └── Approvals + audit (evolution_log, approval_requests)
│
├── AI Model Layer (reuse)
│   ├── Groq / LM Studio / Claude + model_router
│   └── Agent models from agent_registry
│
├── COOS Systems (all existing panels unchanged)
│   ├── Personal / Career / Communications / Intelligence
│   ├── Productivity / Creative / Business / Agent OS
│
└── Data/Memory Layer (reuse)
    └── PostgreSQL + pgvector + Redis + MinIO
```

Everything communicates through controlled services/APIs. No uncontrolled direct
access. Jazper is the human's interface to the whole system (the GOD role), and
department heads coordinate their teams.

---

## 7. Proposed Folder Structure (deltas only)

### Backend (new files)

```
backend/python/app/
  services/
    hive_service.py        # on-disk hive: workspace, mailboxes, board, tasks, fleet, log
    agent_runtime.py       # live status/action/activity registry + WS fan-out
  routes/
    hive.py                # /api/hive/* - state, inbox, send, board, tasks, activity, terminal
    ws.py                  # (refactor) real event broadcaster
  main.py                  # (edit) register hive router, start runtime task
  agents/orchestrator.py   # (edit) Jazper GOD dispatch helper (optional small additions)
```

### Frontend (new files)

```
frontend/src/
  scene/office/            # pixi office floor (ported architecture, new art)
    OfficeFloor.tsx        # React shell + scene + directors (status->pose mapping)
    Character.ts           # walk/sit/bubble/glyph state machine
    CharacterSprite.ts     # AnimatedSprite rows (down/up/right x walk/idle)
    pathfinding.ts         # BFS on walkability grid
    MessageEnvelope.ts     # flying envelope + arrival burst
    ThoughtBubble.ts       # pixel speech cloud
    officeMap.ts           # procedural tile grid + rooms + desks + walkability
    pixelAvatar.ts         # procedural 16x32 avatar painter (canvas -> pixi textures)
    Camera.ts              # fit-to-screen lerp camera + drag pan + wheel zoom
  components/
    panels/
      CommandCenterPanel.tsx   # (edit) tabbed hub: Floor / 3D / Terminals / Messages / Activity / Tasks
      OfficeTerminalPanel.tsx  # xterm.js per-agent terminal
      HiveMessagesPanel.tsx    # inbox/outbox viewer + composer
      HiveActivityPanel.tsx    # live activity feed
      HiveTasksPanel.tsx       # kanban from hive tasks.json
  hooks/
    useHive.ts             # WS subscriptions (AGENT_STATUS/AGENT_ACTION/AGENT_MESSAGE) -> store
  stores/
    agentStore.ts          # (edit) add live action + hive message handling
  app/
    plugin-registry.ts     # (edit) keep command_center entry, add sidebar visibility
```

---

## 8. Required Dependencies

| Package | Where | Why |
|---------|-------|-----|
| `pixi.js` | frontend | 2D office floor renderer (replaces none - additive) |
| `@xterm/xterm` + `@xterm/addon-fit` | frontend | authentic per-agent terminal |
| (backend) none new | backend | reuse `asyncio`, `terminal_service`, `agent_bus` |

No new Python packages. No node sidecar (COOS backend is pure Python; the
terminal-equivalent is the existing subprocess `terminal_service` streamed to xterm).

---

## 9. Migration Plan

1. Backend hive service + runtime manager (no UI dependency).
2. Backend WS event plane + wire agent chat/tool-loop + scheduler/workers to report.
3. Backend `/api/hive/*` routes.
4. Frontend deps (`pixi.js`, `@xterm/*`).
5. Frontend office floor scene (standalone, testable).
6. Frontend Command Center hub integration (Floor default + tabs, detail panels kept).
7. Registry/sidebar wiring, docs update.
8. Typecheck backend (py_compile/import) + frontend (`tsc`), fix.
9. Manual smoke test against running services.

---

## 10. Risks / Compatibility Issues

| Risk | Mitigation |
|------|------------|
| Pixi + React 19 strict mode double-mount | Single-useEffect construction with proper teardown + mount-id guard (as Munder does) |
| Next.js CSP blocks Pixi `new Function` | Import `pixi.js/unsafe-eval` (Munder does the same for Electron) |
| WS never emitted events before | Implement broadcaster in `ws.py` (pattern already scaffolded) |
| Backend agents are async tasks, not real PTYs | Acceptable equivalent: agent "terminal" = workspace cwd + subprocess terminal_service + live tool activity; no `claude` CLI dependency |
| `floor_position` ignored / QA dept missing from 3D map | New floor reads DB `floor_position`; QA added |
| Large 3D scene coexists with new 2D floor | 3D preserved as a tab; floor is default |
| Asset licensing (Munder's Office cast is non-commercial) | We draw our own procedural avatars from COOS agent data (badge_color, avatar_emoji, seed) |
| No agent activity source data yet | Runtime manager becomes the single source; chat/tool-loop + workers push into it |

---

## 11. Security Foundation (Phase 1 scope)

- Keep the existing approval gate for risky tools (`write_file`, `install_package`,
  `delete_agent`).
- Agent workspace stays sandboxed under `storage/hive/`; agent terminals run with
  the existing `terminal_sandbox` guardrails.
- All inter-agent messaging is logged (DB + hive log) for audit.
- No broad filesystem/OS access is granted beyond existing tool permissions.