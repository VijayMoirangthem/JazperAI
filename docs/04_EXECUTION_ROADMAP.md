# 04 — Execution Roadmap & Milestone Tracker

Spec refs: §9 (phases), §10–12, §14–25. Sprint length **[assumption]**: 2 weeks, solo founder + Claude Code. Each task has an ID, a testable **Done when**, and its spec anchor. Status column: ☐ todo · ◐ in progress · ☑ done. Nothing below has been started.

## Phase 0 — Safety net (precondition, ~1 day)
| ID | Task | Done when | § |
|---|---|---|---|
| 0.1 | Snapshot branch: commit all current work (`snapshot/pre-jasper`) | `git status` clean; branch pushed/backed up | audit §2 |
| 0.2 | Decide history rewrite for tracked resume PDF | decision recorded; PDF removed from future commits | audit §2 |
| 0.3 | Approve/modify the deletion list (audit §9) | signed-off list in this file | brief |
| 0.4 | Characterization tests for chat, approvals, memory, credentials routes | `pytest` green, ≥ 1 test per router group kept | §9 P1 |
| 0.5 | CI: lint + pytest + `tsc` + license/SBOM job (report-only) | pipeline green on snapshot | §15 |

## Phase 1 — Foundation & Infrastructure (Sprints 1–2) · §9 P1, §4–6, §11–12
| ID | Task | Done when |
|---|---|---|
| 1.1 | Move compose to `infra/docker-compose.yml`: **postgres(pgvector/pg16) + redis only**, healthchecks, volumes under `storage/`-adjacent dir; remove MinIO/nginx | `docker compose up` healthy; `docker ps` shows exactly 2 services |
| 1.2 | `.env` isolation: single `infra/.env.example`, no secrets committed; remove `changeme` defaults | startup fails fast if secret missing |
| 1.3 | `.gitignore`: add `storage/` wholesale (keep `.gitkeep`), `*.tsbuildinfo`, `munder-web/dist` | `git check-ignore storage/hive/x` true |
| 1.4 | Re-layout backend into `api/ agents/ core/ memory/ mcp/` via move-only commits (no behavior change); update imports | all existing tests still pass; app boots; route table identical (snapshot test of `app.routes`) |
| 1.5 | Router consolidation map implemented as `api/<domain>/` packages; personal features under `api/personal/` | OpenAPI diff = only path-prefix aliases kept for frontend |
| 1.6 | Alembic baseline from current `init.sql` + new schemas `co, baeit, boardmint, shared` | `alembic upgrade head` on empty DB reproduces schema |
| 1.7 | Tenant tables + **RLS policies** + `app.tenants` session setter middleware | test: tenant A principal cannot select tenant B rows (negative tests per table) |
| 1.8 | Directory tables: principals, memberships, roles, permissions; seed Founder + current 21 personas as bots | `GET /api/directory` returns humans+bots |
| 1.9 | Async DB layer (asyncpg/SQLAlchemy 2) replacing `psycopg2` in `memory_service` & friends | no blocking DB call on event loop (lint test) |
| 1.10 | Memory service: pgvector HNSW, per-tenant namespace, **PII sanitizer** pre-ingestion (regex + Presidio; Aadhaar/PAN patterns) | unit tests with seeded PII fixtures: 0 leaks into `memory_chunks` |
| 1.11 | Redis layer: pub/sub bus wrapper, session locks, scratchpads w/ TTL, namespaced keys | pub/sub round-trip < 10 ms p95 local |
| 1.12 | Vault: `keyring`/DPAPI backend; migrate `credentials_service`; remove password-derived Fernet | no plaintext tokens in DB or env; migration script re-encrypts existing creds |
| 1.13 | Provider layer: Claude primary, fallback chain, rate-limit handling, retry/backoff, **default flipped from LM Studio to cloud**; local only behind `EDGE_MODE` | chaos test: 429 → fallback model within 1 call |
| 1.14 | Audit log: hash-chained insert-only table + writer | tamper test detects modified row |
| 1.15 | Storage consolidation: migrate `storage/hive` tasks/board to PG; keep export | tasks identical pre/post; hive dir ignored |
| 1.16 | Backup: nightly `pg_dump` + WAL archive + Redis RDB to `storage/backups` (encrypted); restore script | restore drill on clean machine passes |
| **M1** | **Exit:** fresh clone → `scripts/dev.ps1` → UI loads on new layout; RLS tests, PII tests, vault tests green | |

## Phase 2 — Agent Runtime & Graph Orchestration (Sprints 3–5) · §9 P2, §2, §3, §10–11, §18–20, §23
| ID | Task | Done when |
|---|---|---|
| 2.1 | Add `langgraph`, `crewai`; agent registry persisted in PG (hot add/remove w/o restart) | create bot via API → appears in registry & event emitted |
| 2.2 | Sir Jasper supervisor graph; existing keyword router retained as cheap pre-classifier | routing tests (existing `test_routing.py`) pass + new graph test |
| 2.3 | Executive tier agents: Create Origins CEO, Baeit CEO/PL, Boardmint Lead, VP Tech&Ops (+ CFO/COO/GC stubs) | each answers via delegation chain; trace shows parent/child IDs |
| 2.4 | Map/port existing personas into sub-crews (audit §3.4); define 7 crews as CrewAI crews | crew roster endpoint matches §2 |
| 2.5 | **Dev-loop graph** (Plan→Implement→Verify→Repair→Rollback→Escalate) with `recursion_limit=3` guard | forced-failing test: exactly 3 attempts, `git checkout` rollback, escalation event |
| 2.6 | `agent-patch/*` branch manager; Tier gating of merges | merge to main without `hitl.respond` impossible (test) |
| 2.7 | HITL engine: action→tier policy table, `human-intervention-request`, timeout default-deny | Tier-3 call blocks; approve/reject paths tested |
| 2.8 | FinOps: token meter per call, Redis counters, PG ledger, soft/hard caps, circuit breaker, model-tier router, prompt caching | exceeding hard cap halts loop in < 1 call; ledger sums == provider usage ±1 % |
| 2.9 | Event bus + **JSON-RPC `/ws`** with 4 topics & contracts from doc 03; legacy `ws.py` shimmed | contract tests; p95 publish→client < 100 ms (local) |
| 2.10 | Trace IDs end-to-end; OpenTelemetry spans for graph nodes + crew tasks; optional Langfuse exporter | one directive yields a single trace tree |
| 2.11 | MCP hub v1: manifest registry, supervisor, JSON-Schema arg validation, scope gates, audit; port Google Workspace + GitHub as first connectors | connector install → tools discoverable by crews without restart |
| 2.12 | Flow 1/2/3 end-to-end on stub data (Baeit feature, Boardmint filing draft, failover) | scripted scenario tests pass |
| 2.13 | Matrix-management dual reporting & conflict arbitration node in Sir Jasper graph | conflicting-priority fixture resolved + logged |
| 2.14 | Agent onboarding pipeline (spec→interview→benchmark→clearance) incl. probation restrictions | new bot cannot call Tier-3 until cleared |
| 2.15 | Performance ledger + PIP loop (bounded) using improvement module | SLA-breach fixture triggers PIP, re-eval, restore/deprecate |
| 2.16 | OKR tables & cascade (minimal) | OKR tree query returns enterprise→bot |
| **M2** | **Exit:** one directive from chat flows Jasper→CEO→crew→tool with trace, budget, HITL; recursion/rollback proven | |

## Phase 3 — Desktop Shell, Monaco, 2D Office, Chat (Sprints 6–8) · §9 P3, §7, §17, §25
| ID | Task | Done when |
|---|---|---|
| 3.1 | Decide: Electron wrapper around existing Next app (static export / local server) vs port to Vite renderer; recommended: **Vite+Electron renderer reusing components**, keep Next only if SSR needed | ADR committed |
| 3.2 | Electron main/preload, `contextIsolation`, IPC allow-list, OS notifications, keystore bridge, auto-start backend | app launches; renderer has no Node access (test) |
| 3.3 | WebSocket JSON-RPC client lib + reconnect/replay by `seq` | kill/restart backend: UI resumes without duplicates |
| 3.4 | Monaco diff editor consuming `diff-stream`; accept/reject per hunk → `diff.decision` | streamed edit visible < 100 ms; reject reverts |
| 3.5 | Internal browser preview (webview/iframe → local dev server w/ HMR) beside editor | HMR reload visible after accepted diff |
| 3.6 | LSP/RPC bridge `/lsp` for Monaco | hover/diagnostics from backend language server |
| 3.7 | Chat UI v2: roster/department panel, threaded multi-agent channels, ticks/receipts, typing, attachments, audio notes, token streaming | e2e (Playwright) covers 1-on-1 Jasper + group channel |
| 3.8 | Human directory UI + ID cards (humans & bots, metrics from ledger) | card shows score history |
| 3.9 | Office module: port from `munder-web` (Pixi/Tiled) or adopt Phaser per spec — **decision needed**; presence, desks, status bubbles from `agent-state-change` | bubble updates on state change |
| 3.10 | **Replace LimeZu assets** (or buy licence) + de-brand "Munder Difflin" | licence scan clean |
| 3.11 | Live topology map (xyflow) with edges from trace/IPC events + drill-down thread inspector | click edge → payload view |
| 3.12 | Integrations "App Store" panel: catalog cards, OAuth loopback, secure credential modal | GitHub connect in ≤ 3 clicks |
| 3.13 | Remove Three.js stack (audit D9) after 2D replacements verified | bundle size reduced; no import of `three` |
| 3.14 | Cloudflare/ngrok tunnel manager + token auth + rate limit; minimal Android client (chat only) | phone sends message to Jasper over tunnel |
| 3.15 | Voice: add Silero VAD + Piper/Kokoro streaming over WS (faster-whisper exists) | barge-in test passes |
| **M3** | **Exit:** desktop app drives full flow incl. diff review, HITL prompts, office view | |

## Phase 4 — Autonomous Dev Loops, SRE & Spinoff Decoupling (Sprints 9–12) · §9 P4, §10, §15, §21–23
| ID | Task | Done when |
|---|---|---|
| 4.1 | Ephemeral Docker sandbox runner (CPU/mem/time limits, no host write, egress allow-list); replace `terminal_sandbox.py` use | escape-attempt tests fail safely |
| 4.2 | AST code-repair: parse (tree-sitter/ast), targeted patch, test re-run, verified by assertion routing | seeded bug repaired within 3 attempts on fixture repo |
| 4.3 | Pre-merge gates: tests, license scan (block GPL/AGPL), SBOM, provenance signature, similarity check | merge blocked by GPL fixture |
| 4.4 | IncidentResponseBot: detectors, failure taxonomy, `RcaReport` generation, alerts to Jasper/VP Tech | injected failure yields stored RCA < 60 s |
| 4.5 | Runbooks as versioned YAML (API timeout, Redis eviction, rate limit, merge conflict) w/ rollback | each runbook has an executing test |
| 4.6 | SLO/error-budget tracker; auto-freeze of non-critical autonomous commits when depleted | budget=0 ⇒ commit gate closed |
| 4.7 | ChaosBot with all 6 fault vectors in staging only; resilience score | recursion cap & rollback assertions hold under chaos |
| 4.8 | Edge mode: SQLite queue, Ollama/llama.cpp Tier-1 fallback, async reconcile | offline → online replay loses no mutations |
| 4.9 | Retention/TTL jobs, RTBF hook, cryptographic erasure across PG+vectors | erased subject unrecoverable (test) |
| 4.10 | Prompt-injection guard: input filters, dual-layer guardrail model, output sanitization before tool exec | injection corpus blocked ≥ target rate |
| 4.11 | Spinoff tooling: tenant export (pg_dump schema, vector rows, git bundle, logs) + import into empty stack | Baeit exported & booted standalone; manifest hashes verify |
| 4.12 | DR drill: PITR to timestamp, encrypted offsite copy | RPO/RTO documented and met |
| 4.13 | Compliance mapping docs (SOC 2, ISO 27001 controls, DPDPA, GDPR, RBI localization) → evidence checklist | traceability matrix committed |
| 4.14 | Observability stack (Prometheus/Grafana/optional OpenCost) dashboards for SLIs | dashboards show SLIs live |
| **M4** | **Exit:** end-to-end Flows 1–3 on real repos with sandboxing; chaos suite green; one tenant exported & restored | |

## Cross-phase risks
| Risk | Mitigation |
|---|---|
| Large uncommitted tree; refactor loses work | Phase 0 snapshot; move-only commits |
| LimeZu non-commercial assets vs spinoff | Task 3.10 gate before any commercial use |
| Scope vs solo capacity (spec ≈ 25 sections) | Milestone exits are shippable; defer §13 TravelOps/PeopleOps MCP connectors and §23 voice upgrades if M2/M3 slip |
| LinkedIn automation ToS exposure | Keep behind Tier-3 approval; relocate to personal crew |
| Cost drift when switching to cloud | FinOps (2.8) lands before bulk agent runs |
| Next.js→Electron migration churn | ADR 3.1 before build-out |

## Decisions needed from you
1. Approve Phase 0 snapshot commit (and history rewrite for resume PDF?).
2. Approve/trim the deletion list in `01_CODEBASE_AUDIT.md` §9 (esp. D6 MinIO, D9 Three.js, D10 legacy routers).
3. Phaser (spec) vs keep Pixi (already integrated) for the office.
4. Electron: wrap Next, or move to a Vite renderer.
5. Embedding model/dimension (affects pgvector schema) and whether embeddings stay local (`sentence-transformers`) given §5.
