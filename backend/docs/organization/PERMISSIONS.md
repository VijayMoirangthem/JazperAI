# Permissions

Authority in COOS is layered:

| Layer | Capabilities |
|-------|----------------|
| Owner (human) | Full org CRUD, activate catalogue, system config |
| Jazper | Route tasks, message any agent, trigger workflows |
| Department head | Manage team within department (future fine-grained) |
| Team lead | Assign tasks within team |
| Agent | Execute tools scoped to role |
| Read-only | View floor, profiles, traces |

## API enforcement

Org mutations require authenticated backend (`/api/org/*`). Agent profile edits use `PATCH /api/agents/{id}`.

## Floor UI

Manage org panel gated to COOS HQ mode; destructive actions confirm before DELETE.
