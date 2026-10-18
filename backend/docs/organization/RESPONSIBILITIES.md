# Responsibilities

Each org unit owns outcomes—not just tasks.

## Department responsibilities (examples)

| Department | Owns |
|------------|------|
| Engineering | Ship product, reliability, technical debt |
| Marketing | Pipeline influence, brand, campaigns |
| Finance | Books, cash, compliance filings |
| HR | Hiring, policies, employee experience |
| Operations | Day-to-day business operations |
| Sales | Revenue, accounts, forecasts |
| Legal | Contracts, risk, regulatory |
| Security | Threat model, access control |
| Customer Success | Retention, NPS, support SLAs |

## Agent responsibilities

Stored as:

- `system_prompt` — behavioral contract
- **Goals** — `GET /api/agents/{id}/goals`
- **Schedules** — `GET /api/agents/{id}/schedules`
- Active **tasks** on kanban / hive

## KPIs (roadmap)

Department `health_score` drives wing heatmap tint on the floor (low health → red overlay).
