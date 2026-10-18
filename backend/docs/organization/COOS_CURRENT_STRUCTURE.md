# COOS Current Structure (runtime)

As implemented in COOS HQ (2026-08-23).

## Entry

`http://localhost:3001/#cooshq` → iframe `http://localhost:8000/munder/index.html` (COOS mode).

## Data flow

1. Postgres: `divisions`, `departments`, `teams`, agent floor/team/desk columns
2. `GET /api/agents/live` — agents + org metadata for bridge
3. `bridge.ts` — seeds zustand store, WebSocket sync
4. `OfficeFloor.tsx` — Pixi rendering, movement, envelopes

## UI surfaces

| Surface | Purpose |
|---------|---------|
| Floor map | Wings, team rooms, desks, conference room |
| Nav bar | Floors, breadcrumbs, go-to, org chart toggle |
| Sidebar | Profile, messages, traces, settings |
| Manage org | Floors, depts, teams, reassign, activate, layout |
| Conference panel | Multi-agent meeting + hive broadcast |

## Phases completed

Phases 0–6 (floor scale, LOD, org chart) + Phase 7 polish (scroll fix, profiles, org admin, animations).

See `backend/docs/CurrentUpgrade.md` for task checklist.
