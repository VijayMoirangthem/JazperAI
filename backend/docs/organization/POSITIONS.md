# Positions

A **position** is a slot in the master catalogue: department + team + title + optional agent template.

## Lifecycle

1. **Catalogue** — position exists; agent in `standby` / registry only (`GET /api/org/catalogue`).
2. **Activated** — `POST /api/org/activate-agent` sets `deployed`, assigns team/floor/desk.
3. **Reassigned** — `POST /api/org/reassign-agent` moves team, department, floor, or desk.
4. **Deactivated** — agent removed from active floor roster (future: archive position).

## Desk slots

Each team room has ordered desk tiles. `desk_slot` is the persistent index; reassignment triggers avatar walk animation on the floor.

## Scale

Master catalogue may list ~500 positions; only activated agents render as sprites (with LOD/clustering beyond ~50 on screen).
