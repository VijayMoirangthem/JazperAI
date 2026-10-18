# Organizational Catalogue

The master catalogue defines **all possible positions** without deploying every agent.

## Structure

```
Department
  → Functions (sub-domains)
    → Positions (title + level)
      → Roles (responsibilities)
        → Example agents (codename templates)
```

## API

- `GET /api/org/catalogue` — standby / non-deployed agents
- `POST /api/org/activate-agent` — promote to active org with team/floor/desk

## Do not overcreate

Per `CurrentUpgrade.md`: seed ~40 agents for dev; expand by activation—not bulk insert of 500 rows.

## Example position record (conceptual)

```json
{
  "department": "finance",
  "team": "accounts",
  "title": "Accounts Executive",
  "level": "IC",
  "example_agent": "ledger",
  "responsibilities": ["AP/AR", "reconciliation", "GST filings"]
}
```

Indian positions (GST, TDS, company secretary) sit alongside global equivalents in the same catalogue schema.
