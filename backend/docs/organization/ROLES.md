# Roles

A **role** describes what someone *does*—independent of org chart level.

## Role types in COOS

| Type | Examples |
|------|----------|
| Orchestrator | Jazper — routes tasks, escalates to human |
| Department head | Leads a wing; owns KPIs for that function |
| Team lead | Coordinates a team room on the floor |
| Individual contributor | Agent at a desk; executes tasks |
| Human employee | Same placement model; may lack PTY terminal |
| Freelancer | External; often project-scoped, not on floor by default |

Roles map to agent fields: `title`, `system_prompt`, skills, and tool permissions.

## Indian + global titles

Support both generic (e.g. "Finance Manager") and India-specific (e.g. "Company Secretary", "GST Consultant") via catalogue entries—not enum locks.
