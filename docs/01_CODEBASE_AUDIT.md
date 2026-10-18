# 01 — Codebase Audit (COOS → Sir Jasper AI)

Spec reference: `docs/Sir Jasper AI.docx` (cited as §N). Audit date: 2026-10-18. Method: directory/size inspection, `main.py` router wiring, `requirements.txt`, `package.json`, compose + SQL, config and credential code. **Individual route/service bodies were not read line by line**; classifications below are based on names, sizes, wiring and the earlier internal docs. Items marked ⚠ need a human look before action.

## 1. Reality vs. the brief

| Brief / spec assumes | What is actually in the repo |
|---|---|
| `backend/` split into `api/ agents/ core/ memory/ mcp/` | `backend/python/app/{agents,routes,services,workers,tools,system,scheduler,business,db,core,providers}`; plus `backend/{munder-web,infra,docs,scripts}`. No `mcp/` layer. |
| React + **Electron** shell (§7) | Frontend is **Next.js 16 / React 19** (port 3001). **No Electron anywhere** (no `electron` dep, no main/preload). |
| **Phaser** + Tiled office (§7) | Office is **Pixi.js 8** (`frontend/src/scene/office/*`) and a separate Vite app `backend/munder-web` (Pixi + Tiled `.tmj`) served at `/munder`. No Phaser. |
| Monaco with diff streaming (§7) | Monaco present (`@monaco-editor/react`, `IDEPanel.tsx`, `routes/ide.py`, `services/ide_bus.py`). Diff-stream protocol not confirmed ⚠. |
| LangGraph + CrewAI (§2) | **Neither is installed or referenced.** Custom keyword-router `agents/orchestrator.py` + 21 persona agents. |
| Cloud-first Claude inference (§5) | `AI_BASE_URL` defaults to **LM Studio** (`localhost:1234`, `qwen/qwen3.5-9b`); Groq as primary per internal docs; `CLAUDE_API_KEY` + `anthropic` dep exist but are secondary. Router hard-codes `llama-3.1-8b-instant`. |
| Postgres+pgvector, Redis (§4); no extra containers | Compose in `backend/infra` also runs **MinIO** (not in spec) and an `nginx` config. Root `infra/postgres/init.sql` is an **empty directory** (Docker bind-mount artifact). |
| Multi-tenant schema + RLS (§11, §25) | `init.sql` has 7 flat tables (`users, conversations, messages, tasks, memories, core_memories, extracted_memories`). **No tenants, no RLS, no audit tables.** Business routes use their own `business/db.py`. |
| Encrypted keystore / DPAPI (§11, §14) | `credentials_service.py` uses Fernet, but when `FERNET_KEY` is unset the key is **derived from `POSTGRES_PASSWORD` (default `"changeme"`)**. Not an OS vault. |
| JSON-RPC event topics (§12) | `routes/ws.py` is a single broadcast WebSocket (`broadcast(event, payload)`); `stream.py`, `agent_bus.py`, `ide_bus.py` are separate ad-hoc buses. No JSON-RPC, no topic contract. |
| OTel / LangSmith / Langfuse (§12) | None present. `model_costs.py` + `error_store.py` are the nearest equivalents. |
| `storage/` ignored (§2 brief) | `.gitignore` covers `uploads, artifacts, sessions, user, logs, browser-profiles` but **not** `storage/hive/` or `storage/archive/`. |

## 2. Repository state hazards (act before any cleanup)

1. **245 uncommitted changes.** Only 122 files tracked; `agents/`, `business/`, `db/`, ~70 route files, `backend/docs`, `backend/infra`, `backend/munder-web` are all **untracked**. 22 tracked files show as deleted (old root `docs/`, `docker-compose.yml`, `.env.example`, resume PDF). A single bad cleanup command could destroy unrecoverable work.
   **Recommendation: commit a snapshot on a branch (`git switch -c snapshot/pre-jasper && git add -A && git commit`) before anything else.** (Not done — awaiting your go-ahead.)
2. `VijayMoirangthem/VijayMoirangthemResume.pdf` (PII) is in git history; deletion is staged but history still has it. Decide whether to rewrite history before any remote push.
3. `storage/browser-profiles/linkedin` = **261 MB of live session cookies** (gitignored, correct). Keep out of every backup/export bundle except encrypted ones.
4. `backend/infra/.env` exists locally (ignored). Not read. Rotate if it ever left the machine.

## 3. Backend inventory

Scale: ~34.5k lines Python. Largest: `routes/chat.py` 2257, `routes/agent_tools.py` 1910, `routes/agents.py` 1110, `services/gmail_service.py` 870, `routes/agent_chat.py` 867, `agents/darwin_agent.py` 743, `services/linkedin_service.py` 697.

### 3.1 KEEP — matches spec; refactor into target layers (§ in brackets)
| Current | Target | Spec |
|---|---|---|
| `main.py` (app factory, router wiring, `/munder` mount) | `api/app.py` | §6 |
| `routes/ws.py`, `routes/stream.py`, `services/agent_bus.py`, `services/ide_bus.py` | merge into `core/event_bus` + `api/ws` JSON-RPC | §12, §17 |
| `routes/chat.py`, `agent_chat.py` (incl. dept chat), `business/routes/chat.py` | `api/chat` (threaded channels, streaming) | §7 |
| `routes/org.py`, `agents.py`, `phases.py`, `roadmap.py`, `sprints.py`, `plans.py`, `service_registry.py`, `it_department.py`, `control_tower.py` | `api/org`, `api/agents`, `api/ops` | §2, §20 |
| `agents/orchestrator.py`, `registry.py`, `base_agent.py` | `agents/jasper/` (keep router as cheap pre-classifier feeding LangGraph) | §2, §11 model-tier |
| `agents/commander_agent.py`, `pulse`, `probe`, `verdict`, `shield`, `sage`, `scribe`, `scroll`, `forge` | map to Core Ops / QA / DevOps / Archival bots (see §3.4) | §2 L3 |
| `agents/hermes_agent.py`, `darwin_agent.py`, `routes/evolution.py`, `hermes_drafts.py`, `workers/hermes_monitor_worker.py`, `sage_consolidation_worker.py` | `agents/improvement/` (PIP, self-improving memory) | §19 |
| `routes/approvals.py`, `services/approval_service.py`, frontend `ApprovalOverlay`, `ApprovalsPanel` | HITL tiers 1–3 | §11 |
| `routes/model_costs.py`, `services/model_router.py`, `providers/ai_provider.py` | `core/finops` + provider abstraction | §11, §23 |
| `services/memory_service.py`, `embedding_service.py`, `knowledge_service.py`, `routes/memory.py`, `shared_memory.py`, `knowledge.py` | `memory/` (pgvector + Redis) | §4 |
| `services/credentials_service.py` | `core/vault` (**rewrite key handling**) | §11, §14 |
| `workers/sentry_worker.py`, `warden_worker.py`, `error_store.py`, `scripts/watchdog.py`, `routes/health.py`, `logs.py` | SRE/IncidentResponseBot seeds | §21–22 |
| `services/code_index_service.py`, `system/terminal_sandbox.py`, `process_manager.py`, `file_watcher.py`, `routes/ide.py`, `tools/filesystem_tool.py` | dev-loop + sandbox (`terminal_sandbox` ⚠ audit: must become Docker-isolated) | §7, §10 |
| `services/gmail_service.py`, `calendar_service.py`, `routes/google.py`, `calendar.py`, `tools/email_tool.py`, `calendar_tool.py`, `sheets_tool.py` | become **MCP connectors** (Google Workspace) | §14 |
| `routes/voice*.py`, `voice_profile_service.py` | voice pipeline (STT=faster-whisper already present; add Silero VAD, Piper/Kokoro) | §23 |
| `services/telegram_service.py`, `tools/whatsapp_tool.py` | alt. mobile/notify channels → connectors | §6–7 |
| `scheduler/scheduler.py` (APScheduler) | keep for cron-style jobs; LangGraph for durable flows | §12 |
| `business/*` (clients, finance, projects, team) | seed for Create Origins / subsidiary tenant tables | §16 |
| `tests/` (8 files) | keep, extend | — |

### 3.2 RELOCATE — valid features, not core to spec → "Personal Assistant Sub-Crew" (§2 L1)
`routes/{apply, jobs, job_radar, cover_letter, resume, interview_prep, offer_eval, salary_coach, portfolio, reading_list, mood, habits, focus, goals, planner, standup, task_priority, reminders, digest, briefings, followup, triage, compose, email_analytics, contacts, templates, voice_journal}.py`, `services/linkedin_service.py`, `tools/linkedin_tool.py`, `tools/browser_tool.py`, `tools/scraper_tool.py`, workers `job_apply, salary_research, scout_monitor, follow_up, email_sync, gmail_reply_monitor, interview_prep, atlas_scheduled`. Move under `agents/personal_assistant/` + `api/personal/`; do not delete — they are the founder's daily-use features. Job-application automation touches LinkedIn ToS ⚠ (Tier-3 side-effect → must be approval-gated).

### 3.3 REVIEW — flag for deletion/merge after confirmation
| Item | Why |
|---|---|
| `routes/plugins.py`, `webhooks.py`, `automation.py`, `workflows.py`, `chain_loop.py` (659 loc) | Overlap with LangGraph + MCP hub. Merge or retire once equivalent exists. |
| `routes/suggestions`, `timeline.py`, `activity.py`, `history.py`, `search.py`, `stats.py`, `onboarding.py`, `export_data.py`, `db_changes.py`, `alert_config.py`, `notifications.py`, `dashboard.py`, `company_dashboard.py` | Likely overlapping dashboards/feeds; consolidate into `api/observability`. |
| `routes/voyager.py`, `agents/voyager_agent.py`, `phantom_agent.py`, `atlas_agent.py`, `scout_agent.py`, `lens_agent.py`, `aria_agent.py`, `oracle_agent.py`, `scroll_agent.py` | Persona agents with no direct spec counterpart; remap or retire per §3.4. |
| `routes/tasks.py` vs `business` projects vs `hive` tasks | Three task models. Pick one (Postgres) and migrate `storage/hive/tasks.json`. |
| `routes/storage.py` + MinIO | MinIO is not in spec; `storage/` local path is. Drop MinIO unless a use is confirmed ⚠. |
| `uvicorn_err.log`, `uvicorn_out.log`, `uploads/` (empty) | Runtime litter in `backend/python/`. |
| Root `infra/postgres/init.sql/` (empty dir) | Docker artifact; delete. |
| `start.bat` (14 KB) | Large launcher; replace with compose + short script. |

### 3.4 Persona → spec role mapping (proposed; unverified against each agent's prompt)
| Existing | Spec role |
|---|---|
| Jazper (global orchestrator) | **Sir Jasper** L1 |
| Commander, Pulse | Task Dispatcher Bot, Fast Cache & State Router Bot |
| Sentry/Warden workers, Shield | Incident Response Bot, Infrastructure & DevOps Bot |
| Probe, Verdict | QA & Simulation Bot |
| Forge | Backend Services Bot / Prototyping Bot |
| Scribe, Scroll, Sage | Corporate Secretary / Document Archival Bot |
| Hermes, Darwin | AI Tool Discovery & Benchmark Bot / Algorithmic Experimentation Bot; PIP engine |
| Aria, Atlas, Scout, Lens, Oracle, Phantom, Voyager | Personal Assistant sub-crew (research, travel→TravelOpsBot, vision) |
**Missing entirely:** Create Origins CEO, Baeit CEO/Product Lead, Boardmint Lead, VP Tech & Ops, Mobile App Dev Bot, Partner Ops Bot, Legal & Compliance Bot, Enterprise Architect Bot, Desktop Shell & UI Bot, TravelOpsBot, PeopleOpsBot, FinOpsBot, ChaosBot, CFO/COO/General Counsel (§16).

## 4. Dependencies (`requirements.txt`)
- **Add (spec):** `langgraph`, `crewai`, `opentelemetry-*` (or `langfuse`), `mcp`, `asyncpg`/`sqlalchemy[asyncio]`+`alembic`, `silero-vad`, a PII library (e.g. `presidio-analyzer`), `keyring` (DPAPI/Windows Credential Manager).
- **Orphan/suspect:** `psycopg2-binary` (sync; pick asyncpg/psycopg3), `ddgs` **and** `duckduckgo-search` (duplicate), `minio` (see above), `sentence-transformers` (heavy; keep only if embeddings stay local — §5 says local compute is orchestration only ⚠ decide), `openai` used as generic client (keep but also route Claude via `anthropic`). Versions are pinned inconsistently (`playwright`, `cryptography`, google-* unpinned).
- **Licence scan needed (§15):** none run yet.

## 5. Frontend inventory
- **Stack:** Next.js 16.2.6 (App Router), React 19.2, Tailwind 4, Zustand, Radix/shadcn, `@xyflow/react`, framer-motion, `@react-three/fiber`+`three`, `pixi.js`, `@xterm/xterm`, `@monaco-editor/react`. 75 panels in `components/panels`.
- **KEEP (spec match):** `ChatPanel` (→ WhatsApp/Grok-style threaded UI, §7), `IDEPanel` (Monaco), `ApprovalOverlay`/`ApprovalsPanel` (HITL), `MemoryPanel`/`MemoryGraphPanel`/`SharedMemoryPanel` (§4, §17 topology), `ControlTowerPanel`, `ObservatoryPanel`, `ModelCostsPanel` (FinOps), `AgentsPanel`/`AgentMarketplacePanel` (dynamic bot creation, §18), `PhasesPanel`/`RoadmapPanel`/`SprintsPanel`, `src/scene/office/*` (2D office: pathfinding, Character, ThoughtBubble, MessageEnvelope), `VoiceModePanel`/`voice/*`, theme (`globals.css`, `useTheme`), `Sidebar`/`Topbar`, `CommandPalette`, `plugins/`.
- **RELOCATE (personal):** Job*/Resume*/Salary*/OfferEval/Interview*/Portfolio/Habits/Mood/Reading/Voice Journal/Focus/Goals/Planner/Standup panels → "Personal" section.
- **REVIEW:** `CommandCenter3DScene` + `ConversationSphere` + `three`/`@react-three/*` (spec says explicitly 2D, "rather than heavy 3D" §7 — ~3 large deps for a feature the spec rejects); `MunderPanel`, `MunderDifflinPanel`, `StudioLayout`; `public/*.svg` (Next template leftovers); `public/index.html` ⚠; `frontend/AGENTS.md`/`CLAUDE.md` (keep only if accurate); `tsconfig.tsbuildinfo` (build artifact).
- **Gaps:** no Electron shell, no WebSocket JSON-RPC client, no diff-stream consumer, no human-directory/ID-card UI, no integrations "App Store", no topology live graph (§17).

## 6. `backend/munder-web` (vendored Vite app)
- 16 MB `dist/` (committed? untracked) + 2.5 MB src; includes Monaco language bundles, Pixi, xterm, Tiled maps (`office/lobby/brooklyn99.tmj`).
- Contains **Electron-oriented code** (`window.api`-style renderer, PTY terminals, freeflow recorder, updater toasts) taken from `shahar061/the-office` (ISC). That is the nearest thing to the spec's Electron/office shell, and the best donor for Phase 3.
- **⚠ Licence blocker (§15, §16):** tilesets and base character sheets are **LimeZu FREE — non-commercial only, no commercial edits** (`ATTRIBUTION.md`). Spec envisions subsidiaries spinning out into incorporated companies → these assets must be replaced (or a paid LimeZu licence bought) before any commercial use. `brooklyn99.tmj` / "Munder Difflin / Dunder Mifflin" naming is third-party IP; rename.
- **Recommendation:** keep as the *source* for a new `frontend/office` module; do not ship `dist/` in git; rebuild from source.

## 7. `backend/docs` (≈75 files, untracked)
Superseded by the four new specs. Keep as `docs/archive/legacy/` (do not delete: `organization/*`, `munder-integration/*`, `COOS_ASSESSMENT_AND_ROADMAP.md` contain the only description of the 16-department model). Duplicates to merge: `ARCHITECTURE.md` / `architecture/overview.md` / `overview.md`; `ROADMAP.md` / `roadmap/*` / `organization/ROADMAP.md`; `documentation.md` / `index.md`; `prompt.md` / `prompts.md` / `master_prompt.md`. `my_profile_questionnaire.md` is personal (PII) — keep out of any shared bundle.

## 8. Infra & storage
- `backend/infra/docker-compose.yml`: Postgres (pgvector/pg16, port 5433), Redis 7 (password), **MinIO**. Container names `sirjazper-*`. → Move to root `infra/`, drop MinIO, add healthchecks, named volumes under `storage/`-adjacent path, `.env.example`.
- `backend/infra/nginx/nginx.conf` — no nginx service in compose; orphan ⚠.
- `backend/infra/postgres/init.sql` → replace with Alembic migrations (see doc 03).
- `storage/hive/*` (board.md, log.jsonl, tasks.json, 24 agent dirs) = file-based agent memory/tasks; migrate to Postgres, then keep as export format. `storage/archive/munder/*` = legacy roster backups. Add `storage/hive/` and `storage/archive/` to `.gitignore`.
- No Redis/Postgres Docker images for local LLMs exist (nothing to remove) — but LM Studio/Ollama paths are in config as default; flip default to cloud (§5) and keep local only as the §23 edge fallback.

## 9. Proposed deletion list (NOTHING executed — awaiting confirmation)
| # | Path | Reason | Risk |
|---|---|---|---|
| D1 | `infra/postgres/init.sql/` (empty dir) | Docker artifact | none |
| D2 | `backend/python/uvicorn_err.log`, `uvicorn_out.log`, `backend/python/uploads/` | runtime litter (already ignored) | none |
| D3 | `frontend/public/{file,globe,next,vercel,window}.svg` | create-next-app leftovers | none |
| D4 | `frontend/tsconfig.tsbuildinfo` | build artifact | none |
| D5 | `backend/munder-web/dist/` | 16 MB build output; reproducible | none |
| D6 | MinIO service + `minio` dep + `routes/storage.py` MinIO paths | not in spec | **medium** — check uploads usage |
| D7 | `backend/infra/nginx/` | no nginx service | low |
| D8 | `duckduckgo-search` or `ddgs` (one) | duplicate dep | low |
| D9 | `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three`, `CommandCenter3DScene.tsx`, `ConversationSphere.tsx` | spec mandates 2D | **medium** — UI regression, confirm |
| D10 | `routes/{plugins,webhooks,automation,workflows,chain_loop}.py` | superseded by LangGraph/MCP | **high** — do only after replacement exists (Phase 2) |
| D11 | Legacy duplicate docs listed in §7 | merged into new docs | low (after archive) |
| D12 | Root `start.bat` | replace with `scripts/dev.ps1` | low |
Everything else is **relocate/refactor, not delete**.

## 10. Test coverage
8 test files (`agents, darwin_helpers, error_store, probe_pulse, routing, verdict_agent, workers, workflows`). Nothing for routes, memory, credentials, WebSocket, or HITL. No frontend tests. CI absent. Needed before refactor: characterization tests for chat, approvals, memory, credentials.
