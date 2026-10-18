# COOS Business Platform — Overview

**Status:** Active build. Started 2026-07-26.
**Scope:** A separate, additive track from the existing personal-life-OS ("Sir Jazper
OS") documented elsewhere in `docs/`. Do not fold this into, or read this as
replacing, the personal-OS docs — see [Track Separation](#track-separation) below.

This is the business SaaS platform being built for a real market launch (not a soft
launch — see `docs/prompt.md` for the founding mandate). It is expected to eventually
feel corporate and production-grade, not like a hobby project, because the plan is to
market it seriously once ready.

---

## Track Separation

Two products live in this one repository right now:

| | Personal-OS track | Business platform track |
|---|---|---|
| Internal name | "Sir Jazper OS" | COOS (Create Origins Operating System) |
| AI identity | Jazper (6-agent orchestrator: Scout, Hermes, Sage, Lens, Atlas, Phantom) | Jazper (single tool-calling chat loop) |
| Docs | `docs/*.md` (existing, pre-2026-07-26) | `docs/business/*.md` (this folder) |
| Backend code | `app/routes/*.py` (80 files), `app/agents/*.py` | `app/business/*.py` (new, isolated) |
| Frontend | `frontend/src/components/panels/*.tsx` (70 files) | not yet built |
| Audience | Vijay, personal daily-driver | External customers, commercial launch |
| Routing strategy | Pre-fetch before LLM call (see `docs/COOSVsOpenClawAI.md`) | Real LLM tool-calling (see [Architecture](#why-tool-calling-here-not-pre-fetch)) |

**Rule going forward:** personal-OS docs, routes, and panels are not edited, deleted,
or repurposed for this track. New business-platform work is additive, in its own
files, documented in this folder. See memory note `project_coos_business_pivot` for
the full decision record (naming, doc scope, sequencing — confirmed 2026-07-26).

---

## Why tool-calling here, not pre-fetch?

The personal-OS track deliberately avoids LLM tool-calling in favor of pre-fetching
data before the LLM is ever called — see `docs/COOSVsOpenClawAI.md` for the full
argument (small local models like Gemma 4B handle tool-calling unreliably; pre-fetch
sidesteps that entirely, and its intent surface is fixed and small: Gmail, LinkedIn,
web search).

The business platform's tool surface is different in kind, not just degree: it needs
to keep growing indefinitely (clients today, projects/team/finance next, more after
launch) with genuinely dynamic, multi-step actions ("create a client, then a project
under it, then assign it to a team member") that can't be pre-fetched because the
next step depends on the result of the last one. Real tool-calling is the right
architecture for that shape of problem, and it's assumed to run against capable
models (Groq-hosted 70B-class, not a local 4B), where tool-calling is reliable — this
mirrors the "Agentic Chain Loop" idea already scoped for the personal-OS track in
`docs/COOSVsOpenClawAI.md`'s closing section, just applied here from day one instead
of as a later upgrade.

---

## Architecture

```
User (chat)
   │
   ▼
POST /api/business/chat
   │
   ▼
Tool-calling loop (max 4 iterations)
ai_provider.stream_with_tools(messages, tools=BUSINESS_TOOLS)
   │
   ├─ no tool call → return final answer
   │
   └─ tool call → execute_business_tool(name, args)
                       │
                       ▼
              app/business/<entity>_service.py
              (plain sync functions, _pg() → Postgres)
                       │
                       ▼
              same functions also power
              REST routes for a future UI panel
```

Every business entity follows the same pattern, established with Clients (Phase B,
2026-07-26) and repeated for each new entity:

1. **`<entity>_service.py`** — plain sync CRUD functions, the single source of truth.
   Used by both the tool bridge and the REST routes — no logic duplicated between
   "what Jazper can do" and "what the API can do."
2. **`db.py`** — `CREATE TABLE IF NOT EXISTS` for the entity's table(s), appended to
   the same `ensure_business_tables()` bootstrap.
3. **`tools.py`** — OpenAI-format tool specs (`BUSINESS_TOOLS`) + the dispatcher
   (`execute_business_tool`). Every new entity's CRUD functions get registered here
   the same day they're built — the explicit rule from the architecture assessment
   is that nothing ships "Jazper-blind" (a working feature the AI can't act on).
4. **`routes/<entity>.py`** — thin FastAPI router, for a future frontend panel.

See `docs/business/entities.md` for the current list of entities, their schema, and
their registered tools.

---

## Roadmap

Full assessment and phased plan: `docs/COOS_ASSESSMENT_AND_ROADMAP.md`.

- **Phase A** — naming/doc cleanup. Confirmed: COOS = product, Jazper = AI. Personal-OS
  docs untouched (see Track Separation above).
- **Phase B** — Jazper tool bridge. ✅ Built 2026-07-26, proven with the Clients entity.
- **Phase C** — Business Operations entities, each wired into the tool bridge from
  day one:
  - ✅ **Clients** — done (2026-07-26)
  - ✅ **Projects** — done (2026-07-26), linked to Clients via `client_id` FK
  - ✅ **Team / Employees / Freelancers** — done (2026-07-26), many-to-many with
    Projects via `biz_project_assignments`
  - ✅ **Finance** (invoices, line items, expenses, revenue summary) — done
    (2026-08-09)

  **Initial four-entity buildout complete.** 28 tools total across Clients,
  Projects, Team, and Finance — all chat-operable via `POST /api/business/chat`,
  all with REST routes, all cross-checked param-for-param against their handlers.
  Next up: a frontend for this track, and/or further entities as the business
  actually needs them (see Decision Needed below).
- **Phase D** — structural debt paydown (main.py grouping, db migration versioning).
  Not urgent; can run in parallel with Phase C.

- **Phase E — Frontend.** 🚧 In progress, started 2026-08-09.

## Frontend

`frontend/src/app/business/` is a new, isolated Next.js App Router route segment —
deliberately not wired into the personal-OS single-page app (`page.tsx` +
`plugin-registry.ts` + the `sj-*` class system in `globals.css`). It has its own:

- **Design system** (`business.css`) — a distinct corporate-SaaS look (deep slate
  surfaces, one confident indigo accent, card-based layout) rather than the
  personal-OS monochrome dashboard aesthetic. Scoped under a `.biz-root` wrapper so
  it can't leak into or be affected by the rest of the app. Class reference: page
  shell (`.biz-page`, `.biz-page-header`), cards (`.biz-card`), stat tiles
  (`.biz-stat-grid`/`.biz-stat`), buttons (`.biz-btn` + variants), inputs
  (`.biz-input`/`.biz-select`/`.biz-textarea`), badges (`.biz-badge` + status-color
  variants), list rows (`.biz-row`), empty states (`.biz-empty`).
- **Layout** (`layout.tsx`) — top nav with the COOS wordmark + links to Chat/Clients/
  Projects/Team/Finance. No sidebar, no shared chrome from the personal-OS app.
- **Chat page** (`page.tsx`, route `/business`) — ✅ built 2026-08-09. The flagship
  surface: a conversational UI against `POST /api/business/chat`, with starter
  prompts on empty state and small tool-use pills (e.g. "create client") shown under
  Jazper's replies so the user can see what actions were actually taken, not just
  read a text answer.
- **Entity pages** (`/business/clients`, `/business/projects`, `/business/team`,
  `/business/finance`) — 🚧 building, started 2026-08-09. Each is a standard
  list/create/edit/delete screen against the matching REST routes, for when driving
  the platform by clicking is more natural than typing (bulk review, browsing, a
  reporting-style view of finance) — a second way to do what Jazper can already do
  by chat, not a replacement for it.
  - ✅ **Clients** (`clients/page.tsx`) — done, verified 2026-08-09. Stat tiles per
    status, clickable status filters, inline create/edit (no native modals), delete
    with confirm. Correctly handles the REST layer's actual response shapes (bare
    array from `GET /`, `204 No Content` from `DELETE`).
  - ✅ **Projects** (`projects/page.tsx`) — done, verified 2026-08-09. Client +
    status filters, expandable rows showing description/notes/status-changer and
    the assigned team (lazy-fetched via `GET /{id}/team`, degrades gracefully to
    "Could not load team" instead of crashing on a bad response).
  - ✅ **Team** (`team/page.tsx`) — done, verified 2026-08-09. Stat tiles per
    member_type, type + status filters, inline create/edit, and a scoped "Assign to
    Project" action (project picker + role text + assign button) — deliberately
    does not attempt to also *display* existing assignments (that's the Projects
    page's job via `GET /{id}/team`), keeping each page's responsibility clear.
  - ✅ **Finance** (`finance/page.tsx`) — done, verified 2026-08-09. Persistent
    summary strip (5 stat tiles, optional client filter) above an Invoices/Expenses
    tab switcher. Invoice rows expand to full line-item detail + inline "add line
    item" + status changer, all refetching in sync so the computed `total` never
    goes stale. Correctly consumes the finance API's nested response shape
    (`total` on list rows, `line_items[].line_total` on detail).

**All four entity pages + the chat page are built and verified 2026-08-09** —
`npx tsc --noEmit` is clean project-wide, and `next build` compiles every
`/business/*` route successfully (see note below on an unrelated pre-existing
build issue).

**Note (2026-08-09):** a full `next build` currently fails, but not because of
anything under `/business` — it fails prerendering Next's own `/404` page due to a
stray `frontend/src/pages/_app.tsx` (a leftover `create-next-app` demo/counter
component, unrelated to either product track) coexisting with the App Router
without a `_document.tsx`. This predates all business-platform work this session
(confirmed via git — already committed, untouched). Verification for this whole
session has always been `tsc --noEmit`, which is clean; this is a separate,
pre-existing structural-debt item, not a regression from this work.

Every business-platform page is a client component (`"use client"`) hitting
`http://localhost:8000` directly with plain `fetch` — no shared API client library
yet (see Phase D in the roadmap for that kind of structural cleanup; not urgent for
a 5-page frontend).
