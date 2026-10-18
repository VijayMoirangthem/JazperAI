# COOS Business Platform — Entities

Living reference for every business-ops entity: its schema, its registered tools, and
its build status. Update this file the same day an entity is built or changed — this
is the doc that must never go stale the way `docs/project_status.md` did for the
personal-OS track (see the architecture assessment, Gap C).

---

## Clients

**Status:** ✅ Built 2026-07-26 (Phase B proof-of-concept entity)
**Files:** `app/business/db.py`, `app/business/client_service.py`, `app/business/tools.py`, `app/business/routes/clients.py`

**Table `biz_clients`:**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `uuid_generate_v4()` |
| `name` | TEXT NOT NULL | company or individual name |
| `contact_name` | TEXT | primary contact, optional |
| `contact_email` | TEXT | optional |
| `phone` | TEXT | optional |
| `status` | TEXT NOT NULL DEFAULT `'prospect'` | enum: `prospect` \| `active` \| `paused` \| `churned` |
| `notes` | TEXT | free-form |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Registered tools** (`BUSINESS_TOOLS` in `app/business/tools.py`):
`create_client`, `list_clients` (optional status filter), `get_client`, `update_client`
(partial update, validates status enum), `delete_client`.

**REST routes** (`/api/business/clients`): `POST /`, `GET /`, `GET /{id}`,
`PATCH /{id}`, `DELETE /{id}`.

**Chat entry point:** `POST /api/business/chat` — e.g. "add a client called Acme Corp,
contact Jane at jane@acme.com", "show me my active clients", "move Acme to churned."

---

## Projects

**Status:** ✅ Built and verified 2026-07-26
**Files:** `app/business/project_service.py`, `app/business/routes/projects.py`; table
added to existing `app/business/db.py`; tools added to existing `app/business/tools.py`

**Table `biz_projects`:**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `uuid_generate_v4()` |
| `client_id` | UUID NOT NULL | FK → `biz_clients(id)`, `ON DELETE CASCADE` |
| `title` | TEXT NOT NULL | |
| `description` | TEXT | optional |
| `status` | TEXT NOT NULL DEFAULT `'planning'` | enum: `planning` \| `active` \| `on_hold` \| `completed` \| `cancelled` |
| `start_date` / `due_date` | DATE | optional, ISO `YYYY-MM-DD` |
| `notes` | TEXT | free-form |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Indexes on `client_id` and `status`.

**Registered tools:** `create_project` (requires `client_id` + `title`; its
description explicitly tells the LLM to call `list_clients`/`get_client` first if it
only has a client name, not an id — this is what makes multi-step chat requests like
"create a project for Acme called Website Redesign" actually work), `list_projects`
(optional `client_id`/`status` filters), `get_project`, `update_project`,
`delete_project`.

**Error handling:** `create_project` catches `psycopg2.errors.ForeignKeyViolation`
and re-raises as `ValueError(f"No client found with id '{client_id}'.")` — so a bad
client reference reads as a clean message through both the REST 400 path and the LLM
tool-error path, not a raw Postgres trace.

**REST routes** (`/api/business/projects`): `POST /`, `GET /` (`?client_id=`,
`?status=`), `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`.

**Verified:** `BUSINESS_TOOLS` registry confirmed at 10 total tools (5 client + 5
project), all import cleanly, `main.py` imports without error.

---

## Team / Employees / Freelancers

**Status:** ✅ Built and verified 2026-07-26
**Files:** `app/business/team_service.py`, `app/business/routes/team.py`; two tables
added to existing `app/business/db.py`; tools added to existing `app/business/tools.py`;
one additive endpoint in `app/business/routes/projects.py`

**Table `biz_team_members`:**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | |
| `email` / `role` | TEXT | optional |
| `member_type` | TEXT NOT NULL DEFAULT `'employee'` | enum: `employee` \| `freelancer` \| `intern` \| `contractor` |
| `rate` | FLOAT DEFAULT 0 | |
| `rate_unit` | TEXT NOT NULL DEFAULT `'hourly'` | enum: `hourly` \| `daily` \| `monthly` \| `fixed` |
| `status` | TEXT NOT NULL DEFAULT `'active'` | enum: `active` \| `on_leave` \| `inactive` |
| `start_date` / `end_date` | DATE | optional |
| `notes` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Indexes on `status` and `member_type`.

**Table `biz_project_assignments`** (many-to-many join, Projects ↔ Team Members):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `project_id` | UUID NOT NULL | FK → `biz_projects(id)`, `ON DELETE CASCADE` |
| `team_member_id` | UUID NOT NULL | FK → `biz_team_members(id)`, `ON DELETE CASCADE` |
| `role_on_project` | TEXT | optional, e.g. "lead developer" |
| `assigned_at` | TIMESTAMPTZ | |

`UNIQUE(project_id, team_member_id)` — a member can't be double-assigned to the same
project.

**Registered tools:** `create_team_member`, `list_team_members`, `get_team_member`,
`update_team_member`, `delete_team_member`, `assign_team_member_to_project`,
`list_project_team`, `unassign_team_member_from_project`. The last three map to
differently-named service functions (`assign_to_project`, `list_project_assignments`,
`unassign_from_project`) — verified param-for-param against the actual handler
signatures, no mismatches.

**Error handling:** `assign_to_project` catches `UniqueViolation` → "This team member
is already assigned to this project." and `ForeignKeyViolation` → "Project or team
member not found — check both IDs." `list_project_assignments` JOINs
`biz_team_members` and aliases `name`/`email`/`role` as `member_name`/`member_email`/
`member_role` to avoid colliding with the assignment row's own `role_on_project`.

**REST routes:** `/api/business/team` (member CRUD + `POST/DELETE .../{id}/assignments`);
additive `GET /api/business/projects/{project_id}/team` to view a project's roster
from the project side.

**Verified:** `BUSINESS_TOOLS` at 18 total (5 client + 5 project + 8 team). Every
tool's JSON-schema parameter names were cross-checked programmatically against its
handler's real Python signature (via `inspect.signature`) — zero mismatches, including
the three renamed-handler cases above.

---

## Finance (expenses, invoices, revenue)

**Status:** ✅ Built and verified 2026-08-09
**Files:** `app/business/finance_service.py`, `app/business/routes/finance.py`; three
tables added to existing `app/business/db.py`; tools added to existing
`app/business/tools.py`

**Table `biz_invoices`:**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `client_id` | UUID NOT NULL | FK → `biz_clients(id)`, `ON DELETE CASCADE` |
| `project_id` | UUID | optional, FK → `biz_projects(id)`, `ON DELETE SET NULL` |
| `invoice_number` | TEXT NOT NULL | |
| `status` | TEXT NOT NULL DEFAULT `'draft'` | enum: `draft` \| `sent` \| `paid` \| `overdue` \| `cancelled` |
| `issue_date` / `due_date` / `paid_date` | DATE | optional |
| `notes` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Table `biz_invoice_line_items`** (one-to-many, Invoice → line items):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `invoice_id` | UUID NOT NULL | FK → `biz_invoices(id)`, `ON DELETE CASCADE` |
| `description` | TEXT NOT NULL | |
| `quantity` | FLOAT DEFAULT 1 | |
| `unit_price` | FLOAT DEFAULT 0 | |

An invoice's `total` is **never stored** — always computed on read as
`SUM(quantity * unit_price)` across its line items (`COALESCE(..., 0)` when there are
none). `list_invoices` computes it via `LEFT JOIN` + `GROUP BY`; `get_invoice`
computes it the same way and also returns a nested `line_items` array (each with a
computed `line_total`).

**Table `biz_expenses`:**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `project_id` | UUID | optional, FK → `biz_projects(id)`, `ON DELETE SET NULL` |
| `description` | TEXT NOT NULL | |
| `amount` | FLOAT NOT NULL DEFAULT 0 | |
| `category` | TEXT DEFAULT `'other'` | enum: `software` \| `contractor` \| `travel` \| `office` \| `other` |
| `expense_date` | DATE | optional |
| `notes` | TEXT | |

**Registered tools:** `create_invoice`, `add_invoice_line_item`, `list_invoices`,
`get_invoice`, `update_invoice_status`, `delete_invoice`, `create_expense`,
`list_expenses`, `delete_expense`, `get_finance_summary`.

**Notable behavior:** `update_invoice_status(..., "paid")` sets
`paid_date = COALESCE(paid_date, CURRENT_DATE)` — stamps today's date only if one
isn't already set — then returns the full `get_invoice()` result so the caller gets
the recomputed total in the same response. `get_finance_summary(client_id?)` returns
`{total_invoiced, total_paid, total_outstanding, total_expenses, invoice_count}`;
when scoped to a client, expenses are matched by joining `biz_expenses → biz_projects`
on `client_id` (an expense is "the client's" if it's on one of their projects).
Non-cancelled invoices count toward `total_invoiced`; `total_paid` filters to
`status = 'paid'` specifically.

**REST routes** (`/api/business/finance`): `POST/GET /invoices`,
`GET /invoices/{id}`, `POST /invoices/{id}/items`, `PATCH /invoices/{id}/status`,
`DELETE /invoices/{id}`, `POST/GET /expenses`, `DELETE /expenses/{id}`,
`GET /summary` (optional `?client_id=`).

**Verified:** `BUSINESS_TOOLS` at 28 total (18 existing + 10 finance). Every tool's
JSON-schema parameter names cross-checked via `inspect.signature` against its real
handler — zero mismatches. `main.py` imports cleanly end-to-end.

---

**This closes the initial four-entity buildout** (Clients → Projects → Team →
Finance) recommended in `docs/COOS_ASSESSMENT_AND_ROADMAP.md` § Phase C. All four are
chat-operable via `POST /api/business/chat` and have REST routes for a future UI.
