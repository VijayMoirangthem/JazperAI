# COOS — Architecture Assessment & Migration Roadmap

**Date:** 2026-07-26 (last status update: 2026-07-26, same day — build in progress)
**Author:** Claude (acting as Lead Architect per `docs/prompt.md`)
**Status:** Decisions confirmed (§6). Execution underway — see
`docs/business/README.md` and `docs/business/entities.md` for live build status and
technical detail on what's actually been built. This document stays the strategic
reference; those two are the living, day-to-day source of truth for the business
track and must be kept in sync (see Gap C below for why that discipline matters).

This is the "understand first" deliverable requested in `docs/prompt.md` before any
further restructuring happens. It covers: what actually exists today, how far that is
from the COOS/Jazper vision, the technical debt that's accumulated, what's missing
entirely, and a phased plan to close the gap.

---

## 1. What Actually Exists Today

Numbers, not vibes:

| Metric | Count |
|---|---|
| Backend route files (`app/routes/`) | **80** |
| Frontend panel components | **70** |
| Registered agents (`agent_registry`) | **6** (Scout, Hermes, Sage, Lens, Atlas, Phantom) |
| Agent-fleet "employee" records (`agents` table, mostly dormant) | 40 |
| `main.py` size | 293 lines, flat list of 70+ `include_router()` calls |
| `db/init.py` size | 1,958 lines, one giant migration file |
| Doc files under `docs/` | 15+, several stale or duplicate |

**What's actually been built, in one sentence:** a large, fast-growing collection of
independent CRUD mini-apps (job hunting, productivity, wellness) sitting behind a
FastAPI backend and a Next.js panel switcher — plus a *separate*, mostly-idle 6-agent
chat orchestrator that doesn't talk to any of them.

### The last several sessions' work (Phases 18–24)
16 new subsystems were added: Voice Journal, Recruiter Templates, Email Analytics,
Reminders, QA Center, Application Funnel, Networking, Sage Memory Viewer, Interview
Prep, Focus/Deep Work, Goals/OKRs, Weekly Digest, Email Triage, Mood Log, Task
Priority AI, Follow-Up Automator, Reading List, Sprint Planner, Offer Evaluator,
Portfolio, Salary Coach, Daily Standup. Every one of them is: one route file, one DB
table (or two), one frontend panel, wired into a sidebar. Each is well-built in
isolation — clean React, real Postgres tables, real Groq calls, 0 TypeScript errors
maintained throughout. **The pattern itself is the problem, not the code quality.**

---

## 2. Target Vision (from `docs/prompt.md`)

> Jazper is the brain of COOS... Jazper should reason → choose systems → choose tools
> → collect information → make decisions → coordinate work → return results. Jazper
> should behave like a CEO. Every subsystem works under Jazper.

> Current highest priority: **Business Operations Management** — Client Management,
> Project Management, Task Management, Employee/Freelancer/Intern Management,
> Documentation, Knowledge Management, Finance Tracking, Communication, Scheduling,
> Reporting.

Two very specific claims are being made here, and it's worth being blunt about both:

1. **Jazper should be able to *do* everything through one conversational interface**,
   not just display it in a panel you have to click into.
2. **The current build priority should be business operations** — clients, projects,
   employees, finances — not job-search productivity tooling.

---

## 3. Gap Analysis — Current State vs. Vision

### Gap A: Jazper doesn't know 74 of the 80 subsystems exist

`agent_registry._ensure_loaded()` hardcodes exactly 6 agents. The orchestrator
(`orchestrator.py`) does keyword-matching against those 6 agent names only. There is
**no tool-calling bridge** between Jazper's chat loop and `goals.py`, `digest.py`,
`triage.py`, `mood.py`, `task_priority.py`, `followup.py`, `reading_list.py`,
`sprints.py`, `offer_eval.py`, `portfolio.py`, `salary_coach.py`, `standup.py`, or any
of the Phase 18–20 features either.

A separate tool-calling system *does* exist — `agent_tools.py` (1,721 lines) — but
it's scoped entirely to **managing the 40-agent fleet itself** (create/delete agents,
read/write files, run shell commands, send agent-to-agent messages, schedule tasks).
It has zero tools for "create a goal," "log my mood," "evaluate this offer," "generate
today's standup." Two completely separate function-calling surfaces exist and neither
talks to the other.

**Practical consequence:** you cannot say "Jazper, log a 4/5 energy day" or "Jazper,
what's my sprint velocity" in chat. You have to know the panel exists and click into
it. This is the opposite of "Jazper as single interface."

### Gap B: Business Operations Management — the stated #1 priority — doesn't exist

Grepped the entire route tree for client/employee/invoice/finance concepts. Zero real
hits (the `agents` table is an internal AI-agent roster, not an HR/freelancer system;
there is no client table, no project-with-client-billing concept, no invoice/expense
tracking, no time-tracking-for-billing). Everything built across 24 phases has been
**personal job-search and productivity tooling** — valuable, but it is a different
product than what `docs/prompt.md` names as the current highest priority.

This is the single biggest strategic gap: **the last several phases moved away from,
not toward, the stated priority.**

### Gap C: Documentation has drifted from reality

- `docs/project_status.md` — last updated 2026-07-23, says "Phase 17 next." We are
  at Phase 24. Seven phases undocumented there (tracked instead in this session's
  Claude memory file, which isn't part of the repo).
- `docs/master_prompt.md` (330 lines, generic "Sir Jazper" branding, no business-ops
  priority) and `docs/prompt.md` (the new COOS master prompt you just wrote) are two
  different, partially-conflicting "master prompt" documents living side by side.
  Nothing in the repo says which one governs.
- Branding itself is inconsistent: `main.py` titles the FastAPI app `"Sir Jazper OS"`,
  the plugin registry file is headed `"COOS Plugin Registry"`, and `docs/prompt.md`
  defines the project name as `COOS (Create Origins Operating System)`. Three names,
  one app.

### Gap D: Structural/technical debt in the code itself

- **`main.py` is an un-scalable flat list.** 70+ `include_router()` calls with manual
  prefix/tag strings, hand-maintained. No grouping by domain, no versioning, adding
  route #81 means editing a monolithic file that's already hard to scan.
- **`db/init.py` is a 1,958-line single migration file.** Every phase appends more
  `CREATE TABLE IF NOT EXISTS` blocks to the end. No migration versioning, no rollback
  path, no per-feature ownership — just permanent append-only growth.
- **No API layer for cross-subsystem consistency.** Reminders, Notifications,
  Alert Config, Email Triage, and Email Analytics are five separate route files that
  all touch overlapping "what should I know about my inbox" territory, built in
  different phases without reconciling with each other.
- **No tests.** Scribe (the test-generation agent) exists and fires on new Forge-created
  files, but the 24 phases of manually-agent-built routes in this session were not
  routed through Forge, so none of them have generated tests. Verification has been
  "does it import" + "does `tsc` pass," never "does the endpoint behave correctly."
- **Frontend has 70 flat panel files with no shared data layer.** Every panel does its
  own `fetch(`${API}/...`)` calls inline, no shared API client, no shared React Query
  /SWR caching layer, no shared type definitions between backend Pydantic models and
  frontend TS interfaces (they're hand-duplicated per panel).

### What's actually solid and shouldn't be thrown out
- Postgres + pgvector RAG pipeline, the automation-rules engine, the Telegram
  notification pipe, the scheduler, and the IT auto-repair loop (Darwin/error_store)
  are real infrastructure wins — genuinely reusable primitives for whatever comes next.
- Code quality per-file is consistently good: typed, 0 TS errors maintained, sensible
  fallbacks on LLM parse failures, toast feedback, consistent design system
  (`sj-panel`, CSS vars). The problem is entirely at the *architecture* level, not
  the line level.

---

## 4. What's Missing Entirely (vs. the stated business-ops priority)

None of the following exist in any form:
- Client/customer records (contact info, relationship, active engagements)
- Projects-for-clients (distinct from personal task tracker) with milestones/billing
- Employee / freelancer / intern roster with roles, rates, contracts, time tracking
- Finance tracking (expenses, invoices, revenue, runway)
- A generic "Jazper can call any registered business function" tool bridge

---

## 5. Recommended Phased Migration

Ordered by leverage — each phase leaves the system in a stable, usable state, per
`docs/prompt.md`'s own "never partially implement a system" rule.

### Phase A — Stop the bleeding (docs + naming, ~1 session)
- Pick **one name** (COOS, per `docs/prompt.md`) and rename the FastAPI app title,
  update stale branding in `main.py`, plugin registry header comment.
- Retire `docs/master_prompt.md` in favor of `docs/prompt.md` as the single governing
  doc (or explicitly merge anything still valuable from the old one into it, then
  delete). Update `docs/project_status.md` to reflect reality through Phase 24, or
  replace it with a pointer to this document + the memory-file roadmap so it stops
  silently rotting again.
- No feature work. This phase exists so the next CTO conversation doesn't start from
  a stale map.

### Phase B — Build the Jazper tool bridge (the actual "Jazper as CEO" fix)
This is the highest-leverage engineering phase available: a generic tool registry
that exposes *every* existing subsystem (goals, mood, sprints, followups, standup,
tasks, contacts, etc.) as callable functions Jazper's chat loop can invoke — the same
pattern `agent_tools.py` already proves out for agent-fleet management, generalized to
product features. Concretely:
  - Define a `FEATURE_TOOLS` registry (name, description, JSON schema, handler) —
    one entry per meaningful action (`create_goal`, `log_mood`, `get_sprint_velocity`,
    `generate_standup`, `draft_followup`, ...).
  - Wire it into the existing orchestrator/agent chat loop as an additional tool
    source alongside the current agent-fleet tools.
  - This alone converts "70 panels you have to click into" into "one conversation
    that can act on all of them" — the actual product vision — without rewriting a
    single existing route.

### Phase C — Business Operations Management (the stated priority, built for real)
Only after A and B, per "understand first, don't rewrite everything":
  - `clients` table + CRUD + panel (name, org, contact, relationship stage, notes)
  - `projects` table linked to clients (distinct from personal `tasks`), with
    milestones and status
  - `team_members` table (employee/freelancer/intern roster — rate, role, contract
    dates) — separate from the internal AI-agent roster, which is infrastructure,
    not headcount
  - Basic finance tracking (expenses, invoices, simple revenue/runway view)
  - All four wired into the Phase B tool bridge from day one — no new subsystem
    should ship "Jazper-blind" again.

### Phase D — Structural debt paydown (can run in parallel with C, lower urgency)
  - Split `db/init.py` into per-domain migration files with a simple version table
    (even a minimal `schema_migrations(id, applied_at)` beats 1,958 lines of
    append-only SQL).
  - Group `main.py`'s router includes by domain (`register_job_search_routes(app)`,
    `register_business_ops_routes(app)`, `register_agent_os_routes(app)`) so the file
    stays scannable past route #100.
  - Reconcile the inbox-related five-way split (reminders / notifications /
    alert_config / triage / email_analytics) into one coherent "inbox intelligence"
    story before adding a sixth angle on the same data.
  - Introduce a shared typed API client on the frontend (even a thin
    `lib/api.ts` with per-domain typed functions) so panels stop hand-rolling
    `fetch()` + duplicated interfaces.

### Explicitly not recommended right now
- Do not keep adding job-search feature panels (Phase 25+ in the old cadence) until
  Phase B (tool bridge) exists — every new panel added before that widens the gap
  between "what Jazper can do" and "what the product can do."
- Do not do a big-bang rewrite of `main.py`/`init.py` — Phase D is incremental
  cleanup, not a rewrite, consistent with `docs/prompt.md`'s explicit instruction.

---

## 6. Decisions (confirmed 2026-07-26)

1. **Naming**: **COOS is the product** (Create Origins Operating System). **Jazper is
   the AI** inside it. "Sir Jazper OS" (current FastAPI app title) is legacy and
   should be retired in favor of this split.
2. **Doc scope**: The existing personal-life-OS documentation and the 24 phases of
   job-search/productivity features built so far **stay exactly as-is, untouched**.
   They are not being repositioned or folded into the business platform. New
   documentation and new build priority target the **business SaaS platform**
   framing from `docs/prompt.md` as a separate track. Practical rule going forward:
   don't edit or delete existing personal-OS docs/panels; add new business-ops docs
   and code alongside them.
3. **Sequencing**: **Tool bridge first.** Phase B (generic Jazper tool-calling bridge)
   is built before Phase C (Business Operations tables). Every new business-ops
   subsystem is wired into the tool bridge from day one — nothing ships
   "Jazper-blind" again.

This repositions Phase A slightly: naming cleanup applies to the **product/company
identity** (COOS branding, FastAPI app title, new business-facing docs), not to the
existing personal-OS panels, which keep their current "Sir Jazper OS" internal
framing untouched per decision #2.
