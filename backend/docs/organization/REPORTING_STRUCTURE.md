# Reporting Structure

## Default chain

```
Division (floor)
  └── Department (wing)
        └── Team (room)
              └── Agent / Employee
```

## Head fields

- `departments.head_agent` — department head codename
- Team lead (future: `teams.lead_agent`)
- Jazper reports to owner; all department heads implicitly roll up through Jazper for orchestration

## UI

- **Agent profile** — shows department, team, floor, reports-to when available from API.
- **Flow org chart** — interactive SVG; click node focuses floor and selects agent.
- **Breadcrumbs** — `Floor › Department › Team › Agent` in nav bar.

## Reorg

Changing `team_id` via reassign triggers avatar walk to new desk on next store sync.
