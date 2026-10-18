# COOS Roadmap

## Current Phase

**Phase 1 - Munder Difflin Integration** (in progress)

Goal: integrate the Munder Difflin architecture (office floor UI/UX, hive
workspace, messaging, terminals, task board, agent runtime) into COOS as ONE
unified application.

Scope (Phase 1 only):

- Hive workspace (identity, memory, inbox/outbox, board, tasks, fleet, log)
- Agent runtime manager + live WebSocket event plane
- Per-agent terminals
- Office floor (Pixi.js) as the default Command Center view
- Command Center hub (Floor / 3D / Terminals / Messages / Activity / Tasks)
- Reuse all existing COOS functionality; no feature deletion

After Phase 1 is stable we stop and design the next generation (Phase 2+):

- dynamic departments and agent creation
- agent marketplace
- self-improvement and self-fixing
- software development factory
- browser automation, voice, vision
- AI model routing and cloud integration
- autonomous workflows
- business and personal management
- advanced IDE
- mobile access

## Completed Phases (prior)

- Phase 1: Foundation (FastAPI, Next.js, streaming chat, memory, agents)
- Phase 2: Full agent roster (6 core agents, observatory)
- Phase 3: Background intelligence (Hermes, Atlas, Scout, Sage workers)
- Phase 4: Infrastructure & cleanup, roadmap panel
- Option A: Advanced orchestration (approvals, plans, messaging, workflows)
- Phase 6A-6K: Agent registry, performance, comms, DB change log, autonomy log,
  IT auto-repair, company dashboard, pipeline, direct chat, tool-calling,
  evolution log + approval gate
- Phase 7A-7D: Plugin registry, marketplace, delegation, file watcher
- Phase 8A-8E: Agent messaging bus, calendar, scheduling, voice chains, plugins
- Phase 12-16: Search, notifications, composer, NLP dates, briefings, shortcuts,
  habits, focus, weekly review, suggestions, pings, email improve, CL coach,
  productivity score, onboarding, activity timeline, quick actions, export
- Phase 17: (was next - superseded by Munder Integration)

## Phase 1 Status Board

- [ ] Pre-coding analysis (ANALYSIS.md, PROPOSED_ARCHITECTURE.md)
- [ ] Hive service (backend)
- [ ] Agent runtime + WS event plane
- [ ] Hive API routes
- [ ] Office floor (frontend Pixi)
- [ ] Command Center hub + terminals + messages + activity + tasks
- [ ] Registry/sidebar wiring
- [ ] Typecheck + smoke test
- [ ] Docs + status update