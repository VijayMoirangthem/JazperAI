# COOS Organization Model

COOS models a **virtual company** as a hierarchy of execution units with two parallel views:

1. **Master catalogue** — all possible positions, roles, and agent templates (up to ~500 slots).
2. **Active organization** — the subset currently deployed on floors (~20–50 agents typical).

## Core entities

| Entity | Purpose | DB / API |
|--------|---------|----------|
| Division | Physical floor (map theme, order) | `divisions`, `/api/org/divisions` |
| Department | Functional wing on a floor | `departments`, `/api/org/departments` |
| Team | Execution group inside a department | `teams`, `/api/org/teams` |
| Agent | AI worker with codename, status, desk | `agents`, `/api/agents/live` |
| Position | Catalogue slot (standby agent) | registry + `/api/org/catalogue` |

## Placement rules

- `floor_id` → which division map the agent appears on.
- `department_id` → wing zone color and label.
- `team_id` → sub-room within the wing; desk slot within room.
- `desk_slot` → persistent home desk index.

## Orchestration

- **Jazper** (god agent) sits at the command center; routes work across departments.
- **Hive** routes messages; floor shows envelopes and cross-team walks.
- **Org admin UI** (Manage org) creates floors, departments, teams, reassigns agents, activates catalogue positions.

## India + global

Titles, compliance roles, and currency are modeled as data—not hard-coded US defaults. Departments may use Indian or global naming via `departments.name` and agent `title` fields.

See also: `COOS_CURRENT_STRUCTURE.md`, `ORGANIZATIONAL_CATALOGUE.md`.
