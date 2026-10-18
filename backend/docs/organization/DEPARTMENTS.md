# Departments

Departments are **functional wings** on a COOS HQ floor. Each wing is a colored zone with:

- Label and badge color (`badge_color`)
- Optional head agent (`head_agent`)
- Floor placement (`floor_id`, `floor_position` JSON for zone order)
- Link to division (`division_id`)

## Standard catalogue (examples)

| Department | Typical functions |
|------------|-------------------|
| Engineering | Product, platform, QA, DevOps |
| Marketing | Brand, content, social, growth |
| Finance | Accounting, FP&A, payroll, tax |
| HR | Recruiting, people ops, L&D |
| Operations | Supply chain, facilities, vendor mgmt |
| Sales | Pipeline, account mgmt, partnerships |
| Legal & Compliance | Contracts, regulatory (incl. Indian compliance roles) |
| Customer Success | Support, onboarding, retention |
| Data & Analytics | BI, data engineering, research |
| Security | InfoSec, audit, incident response |
| Executive | CEO office, strategy, board liaison |
| IT | Internal systems, helpdesk |
| Product | PM, design, UX research |
| R&D | Innovation, prototypes |
| Admin | Office admin, procurement |
| Communications | PR, internal comms |

Departments are created via **Manage org → Depts** or `POST /api/org/departments`. Merge via `POST /api/org/merge-departments`.
