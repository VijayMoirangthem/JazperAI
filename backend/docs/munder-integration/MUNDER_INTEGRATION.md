# COOS x Munder Difflin — Integration Guide

> How the Munder Difflin architecture is reproduced inside COOS for Phase 1.
> Reference clone: `C:\Users\vijay\AppData\Local\Temp\opencode\munder-difflin`

---

## 1. The Hive Layer (backend)

Munder's hive is a plain-file workspace + router. COOS keeps its relational DB as
the system of record and adds a **disk hive** for the concepts that need a
per-agent workspace: identity, memory, inbox/outbox.

### Workspace layout (created under `storage/hive/`)

```
storage/hive/
  agents/<codename>/
    identity.md        # who this agent is (from agent_registry, regenerated)
    memory.md          # append-only long-term notes (human/agent readable)
    inbox/             # incoming JSON messages (one file per message)
    outbox/            # outgoing JSON messages (router moves them)
  board.md             # narrative plan (Jazper = scribe)
  tasks.json           # structured kanban {todo, doing, blocked, done}
  fleet.json           # live fleet telemetry (regenerated on demand)
  log.jsonl            # append-only event log
```

### Router

- `send_message(from, to, subject, body, act)` writes a JSON file into the
  recipient's `inbox/` (and a copy stays in sender `outbox/`), persists to
  `agent_communications` (existing table), and broadcasts `AGENT_MESSAGE`.
- Speech acts mirror Munder: `request | inform | propose | query | agree | refuse | done`.

### Task board

- `tasks.json` mirrors Munder's kanban. Endpoints to list/create/advance tasks.
- Jazper (GOD) can assign tasks via the existing chain-loop delegation.

---

## 2. Agent Runtime Manager (backend)

`app/services/agent_runtime.py` is an in-memory registry of *live* agent state.
It is the single source of truth for the floor's animation.

Per agent it tracks:

```
agent_id, codename, status (idle/thinking/working/blocked/error/compacting),
action (current activity text), activity[] (ring buffer of recent lines),
last_active, stream (asyncio queue of terminal lines), workspace cwd
```

Key API:

- `set_status(agent_id, status, action=None)` -> updates state + broadcasts
  `AGENT_STATUS` over WS.
- `push_activity(agent_id, text, kind='log')` -> appends to ring buffer + streams
  to the agent's terminal queue + broadcasts `AGENT_ACTION`.
- `report_tool(agent_id, tool, args)` -> shorthand for "using tool X".

### Producers (who writes into the runtime)

- `agent_chat.py` tool loop -> `working`/`thinking`/`idle` + action text.
- `agent_tools.execute_tool()` -> `push_activity` for each tool invocation.
- Scheduler workers / background tasks -> status on start/stop.
- Chain loop in `chat.py` -> Jazper's status/action.

### Consumers (who reads)

- WS (`AGENT_STATUS`, `AGENT_ACTION`, `AGENT_MESSAGE`) -> frontend store -> floor.
- `/api/hive/state` -> full snapshot for initial render + polls.
- Per-agent terminal stream -> xterm.js panel.

---

## 3. WebSocket Event Plane

`ws.py` gets a real broadcaster: a module-level set of connected sockets + a
`broadcast()` that fans out `{"event": ..., "payload": ...}`. Events this phase:

| Event | Payload | Meaning |
|-------|---------|---------|
| `AGENT_STATUS` | `{agent_id, status, action, ts}` | pose + thought bubble change |
| `AGENT_ACTION` | `{agent_id, text, kind, ts}` | activity feed line + terminal line |
| `AGENT_MESSAGE` | `{from, to, act, subject, ts}` | envelope flight + messages tab |

The frontend `useHive` hook subscribes and updates the store.

---

## 4. Office Floor (frontend)

A Pixi.js scene mirroring Munder's architecture, adapted to COOS data.

### Map

A procedural tile grid generated from the DB: departments are rooms placed using
the **`floor_position`** JSONB (grid cell), each room gets a desk per agent, a
walkable central aisle, a "HQ" desk for Jazper, and a door/entrance. Tiles are
drawn as flat-color pixel rectangles (16px) - no external tileset images needed,
so there are no asset-licensing issues.

### Avatars

Procedurally painted 16x32 pixel characters from COOS agent data:

- Body color = agent `badge_color`
- Head/face seeded from `avatar_seed` (deterministic) or emoji
- Frames: down/up/right rows x walk/idle columns (left = flipped right)
- Painted to an offscreen canvas -> Pixi textures at runtime

### Movement

BFS pathfinding on the walkability grid (ported from Munder's `pathfinding.ts`).
Agents:

- spawn at the door and walk to their room's desk
- sit at their desk when idle/working (with a leg-crop mask)
- walk to a waiting spot near HQ when blocked
- walk to the board room when given a task (ambient)
- wander when idle (light ambient life)

### Thought bubbles

Pixel speech cloud above the avatar showing `action` (or fallback text). Status
glyphs: working glow (accent color pulse), thinking "..." , blocked "!", error red
flash, success sparkle.

### Envelopes

On `AGENT_MESSAGE`, a small pixel envelope flies from sender's desk to recipient's
desk along an arc, tinted by speech act, with an arrival burst (ported from
Munder's `MessageEnvelope.ts`).

### Camera

Fit-to-screen on load, drag to pan, wheel to zoom, click avatar to select (opens
the existing `AgentDetailPanel`), click room to open `DeptDetailPanel`.

---

## 5. Command Center Hub (frontend)

The existing `CommandCenterPanel` becomes a tabbed hub. All existing detail
panels, context menu, and the 3D scene are preserved.

| Tab | Content |
|-----|---------|
| **Floor** (default) | Office floor scene + roster strip |
| **3D** | Existing `CommandCenter3DScene` (unchanged) |
| **Terminals** | Per-agent xterm.js terminals streaming live activity + workspace command exec |
| **Messages** | Hive inbox/outbox viewer + composer |
| **Activity** | Live agent activity feed |
| **Tasks** | Hive kanban board |

---

## 6. GOD Role for Jazper

Jazper is the orchestrator. This phase adds:

- A dedicated seat on the floor (HQ desk) with a distinct aura.
- Reading the hive board and tasks (its scribe duties).
- The ability to dispatch work to agents via the existing chain-loop
  `delegate_to_agent` tool and via hive messaging.
- Escalation to the human only when an approval is required (existing approval
  overlay).

---

## 7. What is NOT in Phase 1

- Real PTY spawning of external CLIs (no `claude`/`codex` process dependency).
- Git worktrees / per-agent git isolation.
- Circuit breaker / budget enforcement.
- Voice orchestration of the floor.
- Dynamic department/agent creation UX (foundation only).

These are deferred to later phases by design.