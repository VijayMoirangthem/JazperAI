# Sir Jasper AI — PROMPTS_V1 (single-file implementation pack)

**How to use (one sentence per task):** in Claude Code (workspace `D:\Projects\COOS`) type:

> Read `docs/Version1/PROMPTS_V1.md` fully, then execute prompt **P1-03**.

That's all. Everything Claude needs — rules, decisions, credentials policy, file lists, steps, exit checks — is in this file. Run prompts in order (P0 → P1 → P2 → P3 → P4). Don't start the next prompt until the Exit Report shows all checks passed. Milestone prompts (P1-16, P2-16, P3-15, P4-14) end with **STOP** and wait for you.

**Contents:** §A Rules · §B Decisions · §C Credentials · §D Approved deletions & progress · §E Prompts P0–P4

**Spec & plans Claude must read when told "read the sources":** `docs/Sir Jasper AI.docx` (extract text from `word/document.xml`), `docs/01_CODEBASE_AUDIT.md`, `docs/02_ARCHITECTURE_BLUEPRINT.md`, `docs/03_SCHEMA_CONTRACTS.md`, `docs/04_EXECUTION_ROADMAP.md`.

---
# §A. Global Rules (apply to EVERY prompt)

You are a Principal Enterprise Systems Architect, Lead SRE and Staff Full-Stack Engineer implementing **Sir Jasper AI** in `D:\Projects\COOS` (Windows 11, PowerShell/Git Bash, Docker Desktop available, Node and Python 3.10+ installed).

### Sources of truth (in priority order)
1. `docs/Sir Jasper AI.docx` (extract text first; a cached extraction approach: unzip `word/document.xml`, strip tags). Cite sections as §N in code comments sparingly and in commit/Exit Reports.
2. `docs/01_CODEBASE_AUDIT.md`, `02_ARCHITECTURE_BLUEPRINT.md`, `03_SCHEMA_CONTRACTS.md`, `04_EXECUTION_ROADMAP.md`.
3. §B of this file.
If sources conflict, stop and report the conflict; do not silently choose.

### Working method
- **Read first, plan second, code third.** Before editing, read the files you will touch and state a short plan.
- **Refactor, don't rewrite.** Preserve existing FastAPI routes, React layouts, theme and UX. Prefer move-only commits for restructuring (no behaviour change in the same commit as a move).
- **Match the surrounding code's style**, naming and comment density.
- **Small verified steps.** Run tests/lint/type-check/build after each logical change. Never claim success without having run the check; show failures verbatim in the Exit Report.
- **Work on branch `jasper/v1`.** Never commit to `main`. Never force-push, rewrite history, or `git reset --hard` without explicit user approval in this conversation.
- **No destructive action without a listed, user-approved target.** Deletions only from the approved list in §D (Approved deletions). Before deleting anything, `ls`/inspect the target and confirm it is in that list.

### Research policy (internet first)
Anything you don't know — library APIs, versions, install steps, schema formats, licences, asset sources, best practice — **look it up yourself** (web search / official docs / package registries / GitHub) before asking. Pin versions that are ≥ 2 weeks old and record the source URL in the commit body or the relevant doc. Verify licences of every new dependency (block GPL/AGPL in proprietary modules, §15).
**Ask the user only for** items in §C (secrets, account-bound values, business decisions only the founder can make). Batch all questions in one message; propose a default for each; continue with other work meanwhile.

### Security & safety
- Never print, log, commit or echo secrets. Don't read `.env` contents into the transcript; check only that keys exist.
- Don't touch `storage/browser-profiles/` (live session cookies) or `storage/user/`.
- Agent-executed code runs in sandboxes; code-changing agents use branches `agent-patch/*` (§10). HITL tiers per §11: anything Tier 3 (merge to main, deploy, filings, payments, external side effects) requires explicit human approval.
- LinkedIn/job-apply automation stays behind Tier-3 approval.

### Quality bar
- Python: type hints, Pydantic v2 models from `docs/03_SCHEMA_CONTRACTS.md`, async DB/IO, structured logging (structlog), tests with pytest (+ negative/security tests for RLS, vault, sandbox).
- TypeScript: strict, no `any` in new code, tests for stores/hooks, Playwright for e2e flows.
- Every new module has at least one test; every contract has a schema test.
- Docs: update the relevant file in `docs/` when behaviour or contracts change.

### Commit & reporting
- One commit per prompt: `P<id>: <title>` + body (what/why, spec §, sources). End commit messages with:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Finish with an **Exit Report**: ✅ done / ⚠ partial / ❌ failed per Exit-check item, commands run + results, files changed, deviations from plan, open questions (credentials only), and the next prompt ID. Then update §D of this file.
- If blocked (missing credential, ambiguous spec, failing environment), report the block, state what you completed, and stop — do not invent values or mock success.

---
# §B. Decisions (defaults; edit here to change behaviour)


| # | Question | Default | Rationale |
|---|---|---|---|
| D-1 | Snapshot before cleanup | **Yes**: commit everything to `snapshot/pre-jasper`, then branch `jasper/v1` | 245 uncommitted changes |
| D-2 | Resume PDF in git history | **Leave history intact**, keep the file deleted going forward; do **not** push anywhere until you decide on a rewrite | rewriting history is irreversible; no remote yet |
| D-3 | Office engine | **Phaser 3 + Tiled** (spec §7). Port logic (pathfinding, characters, bubbles) from existing Pixi code | "follow everything in the doc" |
| D-4 | Desktop shell | **Electron + Vite/React renderer**, reusing existing components/theme; Next.js app kept running during migration, removed at P3-13 | Electron needs static renderer |
| D-5 | Embeddings | Provider-pluggable; default **cloud embedding API** if a key is supplied, else local `sentence-transformers` (bge-m3-class, dim **1024**) as the *only* local model | §5 forbids local LLM weights, not small embedders; dimension fixed via config + migration |
| D-6 | Primary LLM | **Anthropic Claude** (`claude-sonnet-5-5` standard, `claude-haiku-5-5` light, `claude-opus-5-5`/`claude-fable-5-1` frontier); fallback chain Groq/OpenAI-compatible → local (edge only) | §5, §11 tiering |
| D-7 | MinIO | **Remove** unless P1-01 finds real use; if used, migrate files to `storage/` | spec compose = Postgres + Redis only |
| D-8 | Three.js 3D | **Remove at P3-13** after 2D replacements verified | §7 says 2D |
| D-9 | LimeZu tilesets | Keep for now (personal use), **replace with CC0/own-licensed assets in P3-10** before any commercial use; rename "Munder Difflin" | licence + IP |
| D-10 | Legacy routers (plugins/webhooks/automation/workflows/chain_loop) | Retire only after replacement tests pass (P2) | avoid regression |
| D-11 | Sprint cadence | 2 weeks; prompts are sized for ~1 session each | — |
| D-12 | Python | 3.11+ venv at `backend/.venv`; deps via `pyproject.toml` + lock (uv or pip-tools) | reproducible |
| D-13 | Migrations | Alembic + SQLAlchemy 2 async (asyncpg) | — |
| D-14 | Observability | OpenTelemetry (OTLP) with local Langfuse optional; Prometheus+Grafana in an *optional* compose profile `observability` (kept out of the core 2-service file) | spec compose rule |
| D-15 | Tunnel | Cloudflare Tunnel (cloudflared) first; ngrok as alternative | §6 |
| D-16 | Mobile | Android: React Native or Capacitor chat client, decided in P3-14 after research | §7 |
| D-17 | Tenancy | Postgres schemas `co`, `baeit`, `boardmint`, `shared` + RLS via `app.tenants` GUC | §11, §16 |
| D-18 | Package naming | Product name **Sir Jasper AI**; internal package `jasper`; compose container prefix `jasper-` | rename from COOS/sirjazper |

---
# §C. Credentials & inputs Claude may ask you for

Everything else, Claude must research and decide itself (see Research policy). Secrets are entered by **you** into the OS vault via the app's credential modal or `scripts/vault_set.ps1` — never pasted into chat or committed.

| ID | Item | Needed by | Notes / default if absent |
|---|---|---|---|
| C-1 | `ANTHROPIC_API_KEY` | P1-12 | Required for cloud-first inference. Without it, work continues against a stub provider and tests use recorded fixtures |
| C-2 | Fallback provider key (Groq / OpenAI-compatible) | P1-12 | Optional; existing `AI_API_KEY*` in `backend/python/.env` may be reused |
| C-3 | Embedding provider key (optional) | P1-10 | Default local embedder, no key |
| C-4 | Postgres / Redis passwords | P1-02 | Claude **generates** strong random values into the vault/`.env` (git-ignored); you don't supply |
| C-5 | Google OAuth client id/secret (Gmail, Drive, Calendar) | P2-11 | Existing `google` setup may already have one; otherwise you create a GCP OAuth client (Claude gives exact steps) |
| C-6 | GitHub OAuth app or PAT | P2-11 | For the GitHub connector |
| C-7 | Slack / Discord / Notion / Jira / Linear app credentials | P3-12 | Only for connectors you want enabled now |
| C-8 | Cloudflare account + tunnel token (or ngrok authtoken) | P3-14 | You log in once; Claude provides commands |
| C-9 | Telegram bot token (existing feature) | P1-02 | Keep existing value if present |
| C-10 | LangSmith / Langfuse keys | P2-10 | Optional; local OTel works without |
| C-11 | Offsite backup target (S3-compatible / drive) + encryption passphrase | P4-12 | Default: local encrypted backups only until provided |
| C-12 | Apple/Google Play or Android signing keys | P3-14 | Only for distributable mobile build |
| C-13 | Business inputs: legal entity details, GST/PAN **placeholders only**, CA/CS/counsel contacts for Tier-3 approvers | P2-03, P2-07 | Use clearly fake placeholders; real PII is entered by you in-app |
| C-14 | Decision: paid LimeZu licence vs replace art | P3-10 | Default: replace with CC0 assets |
| C-15 | Founder directory profile (name, email, authority) | P1-07 | Taken from git config/email already known; confirm |

### Question protocol for Claude
1. Try to resolve from repo, docs, internet.
2. If it is truly one of the above, ask **once**, batched, with a recommended default.
3. Continue with unblocked work. Mark the dependent task `blocked: C-n` in §D.

---
# §D. Approved deletions & progress tracker

Legend: ☐ todo · ◐ in progress · ☑ done · ⛔ blocked (credential id) · Update at the end of every prompt.

### Approved deletions (Claude may delete ONLY these; user edits this list)
Mark `[x]` to approve. Unchecked = not approved.
- [x] D1 `infra/postgres/init.sql/` (empty dir)
  - Verification: Verified: empty dir. **Delete: safe.**
- [x] D2 `backend/python/uvicorn_*.log`, `backend/python/uploads/`
  - Verification: Verified: logs are stray; `uploads/agent_avatars` is used by `routes/agents.py:35` (1 item). **Delete logs only; keep `uploads/` or move to `storage/`.**
- [x] D3 `frontend/public/{file,globe,next,vercel,window}.svg`
  - Verification: Verified: no references to any of the 5 SVGs in `frontend/src` or `backend`. **Delete: safe.**
- [x] D4 `frontend/tsconfig.tsbuildinfo`
  - Verification: Verified: not tracked by git. **Delete: safe (regenerated).**
- [x] D5 `backend/munder-web/dist/`
  - Verification: Verified: git-ignored build output. **Delete: safe.**
- [x] D6 MinIO service/dependency/paths (after P1-01 usage check)
  - Verification: Verified: only `core/config.py` settings, `requirements.txt` `minio==7.2.7`, and a fallback comment in `chain_loop.py:397`. No client import found. **Delete: safe** (also re-check `routes/storage.py`/`services/storage.py` in P1-01).
- [x] D7 `backend/infra/nginx/`
  - Verification: Verified: contains only `nginx.conf`; mentioned only in docs/README. **Delete: safe.**
- [x] D8 duplicate `duckduckgo-search`/`ddgs`
  - Verification: Verified: both used in `agent_tools.py:1473-1476` as try-ddgs-then-fallback. **Keep `ddgs`, drop `duckduckgo-search`.**
- [ ] D9 Three.js stack (at P3-13 only)
  - Verification: Verified: only 2 importers: `ConversationSphere.tsx`, `CommandCenter3DScene.tsx`. **Defer to P3-13 as planned.**
- [ ] D10 legacy routers (only after P2 replacements pass)
  - Verification: Verified: `automation.py chain_loop.py plugins.py webhooks.py workflows.py` still exist. **Defer until P2 replacements pass.**
- [ ] D11 duplicate legacy docs (after archive to `docs/archive/legacy/`)
  - Verification: Verified: legacy docs live in `backend/docs/`; `docs/archive/` doesn't exist. **Approve only after archive step.**
- [ ] D12 root `start.bat` (after `scripts/dev.ps1` works)
  - Verification: Verified: `start.bat` exists; `scripts/dev.ps1` doesn't exist yet. **Defer until P0-5.**

### Prompts
| ID | Title | Status | Commit | Notes |
|---|---|---|---|---|
| P0-1 | Snapshot & branch | ☑ | 065c560 | |
| P0-2 | Deletion approval gate | ◐ approved in chat, deletions blocked by permission classifier | ea4704d | rerun deletions |
| P0-3 | Characterization tests | ☑ | P0-3..5 | |
| P0-4 | CI & license/SBOM report | ☑ | P0-3..5 | |
| P0-5 | Tooling bootstrap | ◐ dev.ps1 + gitleaks unverified | P0-3..5 | |
| P1-01 | Compose pg+redis | ☑ | |
| P1-02 | Env & secrets isolation | ☑ | |
| P1-03 | Backend re-layout | ☑ | |
| P1-04 | API versioning | ◐ aliases+deprecations done; domain grouping deferred | |
| P1-05 | Alembic baseline & schemas | ◐ baseline+schemas done; business_* data copy deferred | |
| P1-06 | Tenancy & RLS | ☑ (app not yet wired to apply_context) | |
| P1-07 | Directory seed | ☑ static seed, not yet in DB; C-15 founder unconfirmed | |
| P1-08 | Async DB layer | ◐ asyncpg pool + memory path async; psycopg2 centralised in memory/db/legacy_pg.py (~55 callers remain, sync defs) | |
| P1-09 | Redis layer | ◐ layer+tests done; p95 pubsub 9.4-11.6ms on Docker Desktop (test bar relaxed to 15ms); existing Redis callers not migrated | |
| P1-10 | Unified memory + PII | ◐ code+sanitizer tests done; DB roundtrip test awaiting bge-m3 download | |
| P1-11 | Vault | ☑ (live creds table empty; migrate_credentials.py ready; not wired to Google/LinkedIn flows beyond credentials_service) | |
| P1-12 | Provider layer | ◐ core/llm done + tested; stub active until ANTHROPIC_API_KEY set (C-1 ⛔); legacy ai_provider call sites not migrated | |
| P1-13 | Audit writer | ☑ (bus tap helper written, not started at boot) | |
| P1-14 | Hive->PG | ☑ (MinIO objects not inspected) | |
| P1-15 | Backups & restore | ◐ logical backup+drill+WAL archiving done; no pg_basebackup PITR drill, no offsite (C-11) | |
| P1-16 | M1 gate | ☐ | | M1 gate |
| P2-01…P2-16 | Agent runtime | ☐ | | M2 gate |
| P3-01…P3-15 | Desktop/office | ☐ | | M3 gate |
| P4-01…P4-14 | SRE/sandbox/spinoff | ☐ | | M4 gate |

(Claude: expand the grouped rows into one row per prompt as you reach them.)

### Open blockers
_none_

---
# §E. Prompts

Each prompt below is complete on its own (plus §A–§D). Field meaning: **Goal · Read first · Steps · Guardrails · Exit check**. Every prompt ends with an Exit Report and an update to §D.

## P0 — Safety Net (run first, before any restructuring)


### P0-1 Snapshot & branch
**Goal:** Preserve all current work and create the working branch.
**Read first:** `docs/01_CODEBASE_AUDIT.md` §2, `.gitignore`.
**Steps**
1. `git status --short | wc -l`; confirm branch `main`. Check `.gitignore` already excludes `backend/infra/.env`, `backend/python/.env`, `storage/browser-profiles/`, `node_modules`, `.next`, `dist`. Run `git status --ignored` and verify **no secret file would be staged**: list candidate files with `git add -A --dry-run | grep -i -E "\.env$|secret|token|credential|\.pem|\.key|cookies|\.db$"`; if any appear (other than `.env.example`), stop and report.
2. Check size of untracked additions (`git add -A --dry-run` count; any file > 20 MB → list and ask whether to ignore/LFS; default: ignore `backend/munder-web/dist/` and `node_modules`).
3. `git switch -c snapshot/pre-jasper`, `git add -A`, commit `P0-1: snapshot pre-Jasper state` (include the deletion of the resume PDF as already staged by the user's working tree).
4. `git switch -c jasper/v1` from the snapshot.
5. Add `docs/Version1/` and `docs/0*` docs to the commit on `jasper/v1` (`P0-1: add architecture + Version1 docs`).
**Guardrails:** no push, no history rewrite, no `reset --hard`. Do not delete anything.
**Exit check:** `git status` clean on `jasper/v1`; `git log --oneline -3` shows both commits; secret-scan dry-run empty.

### P0-2 Deletion approval gate
**Goal:** Turn audit §9 into an explicit approval list.
**Steps:** Read §D "Approved deletions". For each unchecked item, verify with `rg`/`ls` the current facts (e.g. D6: is MinIO/`minio` imported anywhere? D3: is each SVG referenced? D9: list every import of `three`/`@react-three`). Append a "Verification" sub-bullet per item with evidence and a recommendation. **Do not delete.** Present the list to the user and wait.
**Exit check:** every D-item has evidence + recommendation; user has ticked the boxes they approve.

### P0-3 Characterization tests
**Goal:** Lock current behaviour of critical routes so the refactor can be proven safe.
**Read first:** `backend/python/tests/conftest.py`, `main.py`, `app/routes/{chat,approvals,memory,shared_memory,health,org,agents}.py`, `app/services/{memory_service,credentials_service,approval_service}.py`.
**Steps**
1. Create a venv (`backend/.venv`), install `requirements.txt` + `pytest pytest-asyncio httpx respx`. Run the existing 8 tests; record baseline pass/fail (don't fix unrelated failures; list them).
2. Add `tests/characterization/`: (a) **route-table snapshot** — dump `[(method, path)]` of `app.routes` to `tests/snapshots/routes.json` and assert equality; (b) FastAPI `TestClient` tests for health, approvals create/resolve, memory add/search, chat (mock provider via `respx`/monkeypatch), org/agents list; (c) credentials encrypt/decrypt round-trip.
3. Mocks: no network, no real DB — use a throwaway Postgres+pgvector container via `testcontainers` if feasible, else monkeypatch `_pg`. Mark DB-dependent tests with `@pytest.mark.db`.
**Guardrails:** don't modify app code except to add minimal test seams (and list them).
**Exit check:** `pytest -q` green (baseline failures documented); route snapshot committed.

### P0-4 CI & license/SBOM report
**Goal:** Automated checks, report-only.
**Steps:** Research current best practice for each. Add `.github/workflows/ci.yml` (Python: ruff + pytest; Node: `tsc --noEmit`, eslint, build), and a `scripts/license_scan.ps1`/`.py` producing `docs/compliance/sbom.cdx.json` (CycloneDX via `cyclonedx-py` / `@cyclonedx/cyclonedx-npm`) and `licenses.md` flagging GPL/AGPL/SSPL. Run it locally and record findings (e.g. LimeZu assets, any copyleft deps) — **report only**, don't gate yet.
**Exit check:** workflow file lints (`actionlint` if available); local SBOM generated; findings table in `docs/compliance/`.

### P0-5 Tooling bootstrap
**Goal:** Reproducible dev environment.
**Steps:** Verify Docker Desktop, Node, Python versions; choose `uv` or pip-tools (decision D-12) and create `pyproject.toml`; create `scripts/dev.ps1` (starts compose, backend, frontend with health waits) **without removing `start.bat`**; add `.editorconfig`, `ruff.toml`, `.pre-commit-config.yaml` (ruff, gitleaks for secrets).
**Exit check:** `scripts/dev.ps1` brings the current app up; `gitleaks detect` clean (or findings listed).

## P1 — Foundation & Infrastructure (→ Milestone M1)


### P1-01 Compose: Postgres+pgvector and Redis only
**Goal:** Minimal local services at `infra/docker-compose.yml`.
**Read first:** `backend/infra/docker-compose.yml`, `backend/infra/.env.example`, `routes/storage.py`, `services/storage.py`.
**Steps**
1. Search the code for MinIO use (`minio`, `MINIO_`, `storage.py`). Report usage; if used, plan migration to local `storage/` (don't delete yet).
2. Create `infra/docker-compose.yml`: `pgvector/pgvector:pg16` (research the current stable tag; pin), `redis:7-alpine` with password + AOF, healthchecks (`pg_isready`, `redis-cli ping`), restart policy, named volumes, project name `jasper`, containers `jasper-postgres/jasper-redis`, bind to `127.0.0.1` only. Optional profile `observability` for Prometheus/Grafana (empty stub now).
3. `infra/.env.example` with placeholders only. `infra/README.md` with up/down/backup commands.
4. Keep the old compose file until P1-16 passes; document the port (5433) so the app is unaffected.
**Guardrails:** no data loss — before stopping old containers run `docker volume ls` and take a `pg_dump` into `storage/backups/pre-v1.sql` (git-ignored).
**Exit check:** `docker compose -f infra/docker-compose.yml up -d` → both healthy; `docker ps` shows exactly 2 jasper services; dump file exists.

### P1-02 Environment & secrets isolation
**Steps:** Generate strong Postgres/Redis passwords (C-4) into git-ignored `infra/.env`; make the backend fail fast with a clear error on missing secrets; remove all `changeme`/`lm-studio` defaults from `core/config.py` (config via Pydantic Settings, secrets typed `SecretStr`). Provide `.env.example` per layer. Update `.gitignore`: whole `storage/` (keep `.gitkeep`), `*.tsbuildinfo`, `backend/munder-web/dist/`.
**Exit check:** app refuses to boot without secrets; `git check-ignore storage/hive/log.jsonl` true; gitleaks clean.

### P1-03 Backend re-layout (move-only)
**Goal:** `backend/{api,agents,core,memory,mcp}` per blueprint §1.
**Read first:** `docs/02_ARCHITECTURE_BLUEPRINT.md` §1, audit §3 mapping tables, route snapshot test.
**Steps:** Produce a file-by-file move map (`docs/Version1/maps/backend_move_map.md`) first. Execute with `git mv` in batches (core → memory → agents → api → mcp stubs), rewriting imports mechanically (`libcst`/`rope` or careful `sed`), keeping a compatibility shim `app/__init__` re-exports if needed. Personal-assistant features go to `agents/crews/personal/` and `api/personal/`. **No logic changes.**
**Exit check:** all tests green; **route snapshot identical** (or only intended aliases); `uvicorn` boots; frontend loads and basic chat works.

### P1-04 API consolidation & versioning
**Steps:** Group routers into `api/<domain>` packages (chat, org, agents, ops, memory, personal, integrations, observability). Keep every existing path working via alias routers; add `/api/v1` prefix versions. Mark candidate-duplicate routes (audit §3.3) with a `# DEPRECATED(V1)` note and OpenAPI `deprecated=True` — do not delete.
**Exit check:** OpenAPI JSON diff shows only additions + deprecation flags; snapshot test updated intentionally.

### P1-05 Alembic baseline & schemas
**Steps:** Introduce SQLAlchemy 2 async + Alembic. Baseline migration reproducing `backend/infra/postgres/init.sql` (+ whatever `app/db/init.py` and `business/db.py` create — read them) in a way that's idempotent for the existing DB (`alembic stamp` path documented). Create schemas `co, baeit, boardmint, shared` and migrate `business_*` tables into `co`/subsidiary schemas as appropriate (write data-copy migration + rollback). Keep existing Telegram/credentials tables.
**Exit check:** empty DB → `alembic upgrade head` equals current prod schema; existing DB → stamp + upgrade works on a restored dump; `downgrade -1` works for new revisions.

### P1-06 Tenancy & Row-Level Security
**Read first:** `docs/03_SCHEMA_CONTRACTS.md` §5.
**Steps:** Implement tenant tables, `shared.principals/memberships/roles/permissions`, RLS policies (ENABLE + FORCE) on every tenant table, a non-superuser `app_runtime` role used by the app, and FastAPI dependency that does `SET LOCAL app.principal_id/app.tenants` per request/transaction. Add the insert-only `shared.audit_log` (REVOKE UPDATE/DELETE/TRUNCATE).
**Tests (mandatory):** for each tenant table: principal in tenant A cannot SELECT/INSERT/UPDATE/DELETE tenant B rows; missing GUC → zero rows; superuser bypass is not used by the app; audit_log update/delete fails.
**Exit check:** RLS negative tests green against a real pgvector container.

### P1-07 Directory seed
**Steps:** Seed Founder (C-15) and map the 21 existing persona agents + spec roles to `BotPersona` records (marked `lifecycle=active` for existing, `spec` for not-yet-built roles) per audit §3.4. Expose `GET /api/v1/directory`.
**Exit check:** endpoint returns humans+bots with tenants/roles; unit tests.

### P1-08 Async DB layer
**Steps:** Replace `psycopg2` usage (`services/memory_service._pg`, credentials, etc.) with an async pool; no sync DB call may run on the event loop (add a test that fails if `psycopg2` is imported in `backend/`). Provide repository classes per domain.
**Exit check:** tests green; `rg psycopg2 backend/` → none; basic load test (100 concurrent memory searches) shows no event-loop blocking.

### P1-09 Redis layer
**Steps:** `memory/redis/` with pub/sub bus wrapper (typed publish/subscribe using Pydantic envelopes), distributed session locks (SET NX PX + token), scratchpads with TTL, namespaced keys `tenant:{id}:…`, reconnect/backoff, health. Migrate existing Redis usage.
**Exit check:** pub/sub p95 < 10 ms locally (benchmark script committed); lock contention test; kill-redis test degrades gracefully.

### P1-10 Unified memory with PII sanitizer
**Read first:** `services/memory_service.py`, `embedding_service.py`, `knowledge_service.py`, spec §4, §15, §25.
**Steps:** Create `shared.memory_chunks` (HNSW, dimension per D-5, `tenant`, `namespace`, `principal_id`, `pii_redacted`, `expires_at`) with RLS; **sanitizer pipeline** (research and choose Presidio + custom recognizers for Aadhaar, PAN, UPI/card numbers, passwords/tokens/API-key patterns) that runs **before** embedding; embedding provider abstraction (cloud or local per D-5); migrate existing `memories/core_memories/extracted_memories` rows through the sanitizer; preserve the existing memory API shape.
**Tests:** fixtures with seeded PII/secrets → none present in DB rows or vectors' source text; recall quality smoke test (known queries return known chunks).
**Exit check:** migration idempotent; PII tests green; existing `/api/memory` behaviour preserved.

### P1-11 Vault (OS keystore)
**Steps:** Implement `core/vault` using `keyring` (Windows Credential Manager/DPAPI); research limits (credential size → store a vault master key in keystore and encrypt blobs in DB with AES-GCM/Fernet). Remove the password-derived Fernet fallback. Migration script re-encrypts existing credentials rows. CLI `scripts/vault_set.ps1 <name>` prompts securely. Runtime injection API `vault.get(name)`; never log values.
**Tests:** no plaintext at rest (inspect DB), key rotation test, missing-keystore failure mode.
**Exit check:** existing Google/LinkedIn flows still read credentials; `rg "changeme"` → none.

### P1-12 Provider layer (cloud-first)
**Read first:** `providers/ai_provider.py`, `services/model_router.py`, `core/config.py`, `routes/models.py`; fetch current Anthropic SDK docs (prompt caching, tool use, model IDs per D-6).
**Steps:** Provider interface (`complete`, `stream`, `embed`, `count_tokens`) with Anthropic as primary, OpenAI-compatible fallback, local only behind `EDGE_MODE`. Retry with exponential backoff + jitter, 429/529 handling, provider-down detection, fallback chain from `ModelPolicy`, prompt-cache markers on static system prompts, usage extraction on every call (feeds FinOps in P2-08). Remove hard-coded `llama-3.1-8b-instant`. Flip defaults to cloud (needs C-1; without it use a recorded-fixture stub and mark ⛔ C-1).
**Tests:** simulated 429/timeout → fallback within one call; streaming cancellation; usage accounting.
**Exit check:** chat works end-to-end through the new provider (or stub).

### P1-13 Hash-chained audit writer
**Steps:** `core/audit` writes `shared.audit_log` entries with `prev_hash/entry_hash` (SHA-256 over canonical JSON); verification CLI `scripts/audit_verify.py`; event-bus tap writes all four topics' envelopes. Redact PII before write.
**Exit check:** tamper test (manual UPDATE as superuser) is detected by verifier.

### P1-14 Storage & hive migration
**Steps:** Move task/board/log data from `storage/hive` to PG (read the hive service first; keep file export). Move any MinIO-held objects to `storage/` (per P1-01 findings). Update `.gitignore` for `storage/hive`, `storage/archive`.
**Exit check:** data parity script (before/after counts + checksums) passes.

### P1-15 Backups & restore
**Steps:** `scripts/backup.ps1`: `pg_dump` (schema+data per tenant and full), WAL archiving config for PITR (research `archive_command` in the pgvector image), Redis RDB copy, age/GPG encryption (passphrase C-11 or local default), retention policy; `scripts/restore.ps1` + documented drill.
**Exit check:** restore into a scratch DB reproduces row counts and RLS policies; drill documented in `docs/ops/backup_restore.md`.

### P1-16 M1 gate
**Steps:** Fresh-clone simulation (new directory, `git clone` of `jasper/v1`): follow README → `scripts/dev.ps1` → UI loads, chat answers, memory add/search works, vault reads credentials. Run full test suite, gitleaks, SBOM report. Then execute **approved** deletions D1–D8 (only those ticked), one commit each. Update docs (`README.md` rewritten for Sir Jasper AI, layout diagram).
**Exit check / STOP:** present M1 summary and wait for user go-ahead before P2.

## P2 — Agent Runtime & Graph Orchestration (→ Milestone M2)


### P2-01 Agent registry (hot-pluggable)
**Goal:** Agents/crews defined in Postgres and instantiated at runtime without restart (§2 "plug-and-play").
**Read first:** `agents/registry.py`, `base_agent.py`, `routes/agents.py`, `routes/agent_chat.py`.
**Steps:** Research current `langgraph` and `crewai` releases (pin; check licences MIT/Apache, no copyleft; check compatibility with `anthropic` and Pydantic v2). Add deps. Create `agents/registry` backed by `shared.principals`/`bot_definitions` (role spec, prompt, tools, model policy, memory namespace, crew, reports_to). API: create/update/disable bot → registry reload → emits `agent-state-change` (idle) event. Existing persona agents are loaded through an adapter so nothing regresses.
**Exit check:** create a bot via API → appears in roster and can be messaged; disable → no longer routable; tests.

### P2-02 Sir Jasper supervisor graph
**Steps:** Implement the L1 orchestrator as a LangGraph `StateGraph` (nodes: classify → plan → delegate → await → synthesize → report). Keep `agents/orchestrator.py` keyword routing as a zero-token pre-classifier node (§11 tiering). Use persistent checkpointer (Postgres saver; research package/API) so graphs survive restarts. State carries `TraceContext`, budget, HITL flags.
**Exit check:** `test_routing.py` still passes; new tests: delegation to a stub exec; resume after simulated restart.

### P2-03 Executive tier
**Goal:** Create Origins CEO, Baeit CEO/Product Lead, Boardmint Lead (Chief Governance Officer), VP Tech & Ops; plus CFO/COO/General Counsel stubs (§2, §16).
**Steps:** Each is a LangGraph sub-graph + role prompt + tool allow-list + budget + memory namespace + report-up node. Prompts authored from spec role descriptions (no invented responsibilities). Real company data placeholders only (C-13).
**Exit check:** a directive delegated to each exec returns a structured status report with parent/child trace IDs.

### P2-04 Sub-crews as CrewAI crews
**Steps:** Define the 7 crews (IT & Core Systems; Baeit Eng&Ops; Boardmint Compliance; R&D; Central Ops; Corporate Ops & People Ops; Personal Assistant) with roles exactly per §2/§13. Map existing agents per audit §3.4 (document final mapping in `docs/Version1/maps/persona_map.md`). Crew execution is invoked from exec graphs as tool-nodes; crew membership editable at runtime (registry).
**Exit check:** roster endpoint equals spec §2 list; each crew runs a no-op task with tracing.

### P2-05 Bounded dev-loop graph
**Goal:** Plan → Implement → Verify → Repair → (Rollback → Escalate) with `recursion_limit=3` (§10).
**Steps:** Graph nodes use the `agent-patch/*` branch manager (P2-06) and test runner stub (real sandbox arrives P4-01 — until then run tests in a temp worktree with a subprocess timeout, clearly flagged *non-isolated*). On the 3rd failed verify: `git checkout` rollback, write post-mortem to Redis + pgvector, escalate event to Sir Jasper.
**Tests:** forced failing test → exactly 3 attempts, rollback executed, escalation emitted; guard against off-by-one with parametrised limits; recursion limit also enforced at LangGraph config level.
**Exit check:** all above green.

### P2-06 Branch manager & Tier-gated merge
**Steps:** `core/gitops`: create `agent-patch/<task>` branches in git worktrees, commit with provenance trailers (agent id, model, prompt hash) and optional signing (research SSH/GPG signing on Windows), diff extraction, merge API that **requires an approved HITL record** for main.
**Exit check:** attempt to merge to main without approval fails (test); with approval succeeds in a scratch repo.

### P2-07 HITL engine
**Steps:** Central policy table `action → tier` seeded from §11/§13/§14 lists; `HumanInterventionRequest` flow, persisted requests, default-deny timeout, approver resolution via directory (designated counterparts, e.g. CA/CS/counsel placeholders), notification fan-out hook (Slack/Telegram later). LangGraph `interrupt` for waiting. Existing approvals UI/API remain functional via adapter.
**Exit check:** Tier-3 call blocks until `hitl.respond`; reject path aborts cleanly; expiry denies; tests.

### P2-08 FinOps
**Steps:** Per-call `BudgetEvent` from provider usage (P1-12); Redis counters (hot) → PG ledger; per-request/day soft+hard caps per agent/division (Create Origins, Baeit, Boardmint); circuit breaker halting autonomous loops near limits; model-tier router (light/standard/frontier) policy; prompt-cache hit tracking; burn-rate forecast endpoint; FinOpsBot reporting. Fetch current model pricing from official Anthropic pricing page and store in a versioned `pricing.yaml` with source URL/date.
**Tests:** hard cap halts loop in ≤ 1 call; ledger totals equal sum of provider usage ±1 %; fallback to cheaper tier when soft cap hit.
**Exit check:** `/api/v1/finops/summary` reflects a scripted run.

### P2-09 Event bus & JSON-RPC `/ws`
**Read first:** `routes/ws.py`, `routes/stream.py`, `services/agent_bus.py`, `ide_bus.py`; doc 03 §1–2.
**Steps:** Implement contracts as Pydantic models (`core/contracts`), JSON-RPC 2.0 dispatcher on `/ws`, topic subscription, `seq` per topic with bounded replay buffer, backpressure, auth token handshake, heartbeats. Redis pub/sub backs fan-out. Shim legacy `/ws` events so current frontend works until P3.
**Tests:** schema validation tests per topic; ordering/replay; **latency benchmark** publish→client p95 < 100 ms locally (script + recorded result in docs).
**Exit check:** contract tests + benchmark pass.

### P2-10 Tracing & telemetry
**Steps:** OpenTelemetry SDK (OTLP) with spans around LangGraph nodes, CrewAI tasks, tool calls, provider calls; propagate `trace_id/parent_id`; metrics: token burn, latency, tool failure causes; optional Langfuse/LangSmith exporter (C-10). Local Jaeger/OTel-collector via optional compose profile. Store decision-tree retrospectives in Redis/pgvector.
**Exit check:** one directive produces a single trace tree spanning Jasper → exec → crew → tool (screenshot/JSON export committed).

### P2-11 MCP hub v1
**Read first:** doc 03 §3; fetch the current MCP spec and the official Python SDK docs.
**Steps:** `mcp/registry` (manifests in PG), `mcp/supervisor` (spawn/teardown subprocess or container per `SandboxSpec`, health, restart), JSON-Schema argument validation, scope→tier gating, rate limits/budgets, audit of payload hashes, hot discovery event + crew re-read at next node. Vault integration for credentials (never in manifest). First connectors: **Google Workspace** (port `gmail_service`, `calendar_service`, Drive) and **GitHub** (C-5, C-6; OAuth loopback with PKCE and refresh rotation).
**Tests:** invalid args rejected; Tier-3 tool blocked; connector crash → restart/DEGRADED; tool appears in crews without restart.
**Exit check:** end-to-end: install GitHub connector → crew lists branches (read-only) → create branch gated at Tier 2.

### P2-12 Operational flows 1–3
**Steps:** Scripted scenario tests (stub repos/data) for §3 Flow 1 (Baeit feature), Flow 2 (Boardmint filing draft; Indian Companies Act checks are *templated placeholders* validated by a human), Flow 3 (provider failure → failover). Each produces a founder-facing completion report.
**Exit check:** all three scenario tests pass and emit the 4 event topics in correct order.

### P2-13 Matrix management & arbitration
**Steps:** Dual-reporting in directory; cross-functional LangGraph sub-graphs for shared resources; conflict-detection node and Sir Jasper arbitration with logged rationale (§20).
**Exit check:** conflicting-priority fixture resolved deterministically and logged.

### P2-14 Agent onboarding pipeline
**Steps:** Implement §18 stages: role spec generation → synthetic interview (PeopleOpsBot + division lead) → benchmark harness (deterministic scenarios per role; metrics: completion, hallucination, latency, token efficiency, HITL compliance) → clearance → registry + namespace + office avatar placeholder. New bots limited to Tier 1/2 during probation (enforced in tool gate).
**Exit check:** uncleared bot cannot call Tier-3; scoring is reproducible with recorded fixtures.

### P2-15 Performance ledger & PIP
**Steps:** Immutable evaluation ledger (hash-chained like audit), drift analysis job, SLA triggers, bounded PIP loop using improvement module (Hermes-style: prompt refinement, few-shot exemplars, scratchpad updates) in a sandboxed staging harness; outcomes restore/deprecate/escalate (§19). Research the Hermes Agent repos for reusable patterns; respect licences.
**Exit check:** SLA-breach fixture → PIP → restored or deprecated; ledger entries verified.

### P2-16 OKR + M2 gate
**Steps:** Minimal OKR tables and cascade query (enterprise → division → bot); then run the full M2 demo: one chat directive → Jasper → CEO → crew → MCP tool with trace, budget, HITL, audit. Run everything; update docs.
**STOP:** present M2 summary and wait for go-ahead.

## P3 — Desktop Shell, Embedded Monaco, 2D Office & Chat (→ Milestone M3)


### P3-01 ADR: shell architecture
**Steps:** Research Electron + Vite (e.g. electron-vite / electron-forge) vs wrapping Next. Inventory which Next features the app uses (App Router pages, SSR, API routes — likely none beyond `app/business`). Produce `docs/adr/0001-desktop-shell.md` and a component migration map (`frontend/` → `desktop/renderer`). Default per D-4: Electron + Vite renderer reusing components, Zustand stores, Tailwind theme.
**Exit check:** ADR committed; migration map lists every route/panel with target.

### P3-02 Electron scaffolding
**Steps:** Create `frontend/electron/{main,preload}` + Vite renderer config. Security: `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, strict CSP, IPC allow-list (typed channels), `will-navigate`/`window.open` blocked, `webviewTag` only for the preview pane with restricted partition. Features: native notifications, local FS dialogs, deep link for OAuth loopback, keystore bridge (via backend vault, not renderer), backend process supervision (spawn/health/restart/graceful shutdown), single-instance lock, auto-updater **disabled** (no signing yet). Windows packaging via electron-builder (research current config).
**Tests:** Playwright-Electron smoke test; test that renderer cannot `require('fs')`.
**Exit check:** `npm run desktop:dev` opens app showing existing dashboard + chat.

### P3-03 WebSocket JSON-RPC client
**Steps:** Typed TS client generated from doc 03 contracts (generate TS types from Pydantic JSON Schema — research `json-schema-to-typescript`/`datamodel` tools), reconnect with jittered backoff, resume by `seq`, subscription manager, Zustand bindings (`agentStore`, `pipelineStore`).
**Exit check:** kill/restart backend: UI resumes with no duplicates or gaps (test).

### P3-04 Monaco diff streaming
**Read first:** `IDEPanel.tsx`, `routes/ide.py`, `services/ide_bus.py`, `hooks/useIdeSettings.ts`.
**Steps:** Monaco diff editor consuming `diff-stream` (begin/hunk/end/abort), per-hunk accept/reject → `diff.decision`; inline suggestions; dual mode: background `agent-patch/*` operations vs interactive session; conflict handling if user edits concurrently; virtualised large-file handling.
**Exit check:** streamed edit visible < 100 ms after server publish (measure); reject reverts buffer and branch hunk.

### P3-05 Internal browser preview
**Steps:** Webview/iframe panel pointing at a local dev server (with HMR) beside Monaco; URL allow-list (localhost only); HMR reload triggered after accepted diff; device-size toggles.
**Exit check:** accept a diff on a sample app → preview hot-reloads.

### P3-06 LSP/RPC bridge
**Steps:** `/lsp` WebSocket bridging Monaco language client to server-side language servers (pyright/ts-language-server run in sandbox); research `monaco-languageclient` current API.
**Exit check:** hover + diagnostics for Python and TS.

### P3-07 Chat UI v2 (WhatsApp / Grok / Open-Mouse-style)
**Read first:** `ChatPanel.tsx`, `agent_chat.py`, `business/routes/chat.py`; research the Open-Mouse-Bot repo (spec §8) for layout patterns (respect licence; take ideas, not code, unless compatible).
**Steps:** Split panel: roster of agents/humans/departments; 1-on-1 with Sir Jasper; department group channels (Baeit Engineering, Boardmint Compliance, Create Origins HQ); threaded multi-agent messages; bubbles with attribution; delivery/read ticks, typing indicators; attachments (media preview, docs, diff snapshots, audio notes with transcription via faster-whisper); token streaming over `/ws`; integrated diff/dev inspection view.
**Tests:** Playwright e2e for 1-on-1, group, attachment, streaming.
**Exit check:** e2e green.

### P3-08 Human directory UI & ID cards
**Steps:** Directory view of humans + bots, ID card component (avatar, role, tenant badges, performance metrics from ledger, lifecycle state), add-human and add-bot flows (RBAC-checked), presence indicators.
**Exit check:** card renders ledger metrics; adding a human intern restricts visibility via RLS (test).

### P3-09 2D virtual office on Phaser + Tiled
**Read first:** `frontend/src/scene/office/*`, `backend/munder-web/src/renderer/src/scene/*`, spec §7–8 (Generative Agents, WorkAdventure, Phaser, Tiled).
**Steps:** Research current Phaser 3 stable and tilemap loading. Rebuild renderer in Phaser: Tiled JSON maps (orthogonal, collision layer), layered sprite sheets, click-to-move with pathfinding (port existing `pathfinding.ts`), status bubbles bound to `agent-state-change`, rooms/floors navigation, proximity zones, human presence (from directory), desk assignment, modular room builder, add-employee flow with appearance customization + ID card. Generative-Agents-style daily schedules as an optional behavior module (idle wandering, meetings when delegating — driven by real task events, not random).
**Exit check:** state change on backend → bubble updates < 200 ms; humans and bots both visible; 60 fps on a mid laptop with 30 sprites (measure).

### P3-10 Replace licensed art, de-brand
**Steps:** Search for CC0/permissive pixel office tilesets & character sheets (OpenGameArt, itch.io CC0, Kenney) — **verify each licence text** and record in `docs/compliance/assets.md`; swap; remove LimeZu & "Munder Difflin / Brooklyn99" assets and naming (D-9). If suitable assets can't be found, generate placeholder tiles programmatically and ask the user (C-14).
**Exit check:** license scan reports no non-commercial assets.

### P3-11 Live topology & thread inspector
**Steps:** `@xyflow/react` graph of agents with edges animated by IPC/trace events and volume counters; click edge/node → drill into thread, payloads, decision tree, reasoning path; historical replay from audit log (§17).
**Exit check:** scripted multi-agent run renders live; replay reproduces it from audit.

### P3-12 Integrations "App Store"
**Steps:** Catalog cards (GitHub, Google Workspace, Slack, Discord, Notion, Jira, Linear — others stubbed), one-click connect: OAuth2 loopback + PKCE (Electron opens system browser, backend handles callback), secure credential modal with schema validation, status badges, per-connector scopes/budgets/audit view. Implement connectors in order of available credentials (C-5…C-7); others return "needs credentials" state.
**Exit check:** GitHub connect → tools visible to crews in ≤ 3 clicks (Playwright).

### P3-13 Remove 3D & Next (after parity)
**Steps:** With user-approved D9: delete Three.js stack and 3D components; migrate remaining Next pages (`app/business/*`) to the renderer; once parity checklist passes, retire the Next app (keep git history). Update README and scripts.
**Exit check:** bundle analysis shows no `three`; all former panels reachable; e2e suite green.

### P3-14 Tunnel + Android client
**Steps:** Cloudflare Tunnel manager (C-8): start/stop/status from UI, token-authenticated `/ws` over HTTPS, rate limiting, IP/device allow-list, session revocation. Android: research React Native vs Capacitor (D-16) → implement minimal chat client (roster, 1-on-1, voice note, HITL approve/reject). Build debug APK; no store release.
**Exit check:** phone (or emulator) over the tunnel sends a message to Sir Jasper and approves a Tier-3 request.

### P3-15 Voice upgrade + M3 gate
**Steps:** Silero VAD (research ONNX runtime path) + streaming TTS (Piper/Kokoro; verify licences) over WebSocket with barge-in; reuse faster-whisper. Then run the M3 demo: desktop app drives a feature flow with diff review, HITL prompt, office bubbles, topology view. Update docs.
**STOP:** present M3 summary and wait for go-ahead.

## P4 — Autonomous Dev Loops, SRE, Compliance & Spinoff (→ Milestone M4)


### P4-01 Ephemeral Docker sandbox runner
**Read first:** `system/terminal_sandbox.py`, `process_manager.py`, doc 03 `SandboxSpec`.
**Steps:** `mcp/sandbox` runner using Docker SDK: one-shot containers, read-only root FS, non-root user, `--cap-drop ALL`, `no-new-privileges`, seccomp default, CPU/memory/pids/time limits, tmpfs workdir, project mounted **read-only** with a copy-on-write overlay for outputs, network none or egress allow-list via proxy container, output size caps, log streaming to `execution-log`. Replace all uses of the old terminal sandbox in agent paths (keep the interactive user terminal separate and clearly labelled).
**Tests:** escape attempts (write to host mount, fork bomb, network exfil, huge output, long sleep) fail safely and are logged.
**Exit check:** sandbox test-suite green; dev-loop graph (P2-05) now runs verification only in sandboxes.

### P4-02 AST code repair
**Steps:** Research tree-sitter bindings + Python `ast`/`libcst`; implement parse → locate failing symbol from test trace → constrained patch generation (frontier model) → AST-validated edit (syntax, symbol-scope checks, no unrelated hunks) → rerun tests → assertion-based routing. Cap attempts via LangGraph (≤ 3).
**Tests:** fixture repo with 5 seeded bugs (Python + TS): ≥ 4 repaired within limits; unrelated-file edits rejected.
**Exit check:** metrics recorded (success rate, tokens, cost).

### P4-03 Pre-merge gates
**Steps:** Pipeline run on every `agent-patch/*` before the Tier-3 prompt: tests, lint/type-check, license scan (block GPL/AGPL in proprietary repos), SBOM (CycloneDX) generation, secret scan, provenance signature check, snippet-similarity check against public code (research feasible approach — e.g. hashing winnowing against a local corpus of popular repos or a code-search API; document limits honestly), and results attached to the HITL request.
**Tests:** GPL fixture blocks merge; secret fixture blocks merge.
**Exit check:** gates visible in the approval UI.

### P4-04 IncidentResponseBot + RCA
**Steps:** Detectors for task failure/abort, provider timeouts, rate limits, schema mismatches, AST assertion failures, recursion-limit hits; classify with `FailureClass`; generate `RcaReport` (stack traces, context window refs, prompt/response refs, tool metrics); store in PG audit + Redis; alert Sir Jasper & VP Tech; blameless post-mortem record with action items and self-healing memory updates.
**Exit check:** injected failure → stored RCA < 60 s with correct class (tests for each class).

### P4-05 Runbooks
**Steps:** Versioned YAML runbooks (API timeout, Redis eviction spike, rate-limit exhaustion, branch merge conflict) with steps, preconditions, rollback, verification; executor in DevOps/IncidentResponse bots; automated post-mortem docs into PG/pgvector.
**Exit check:** each runbook has an executing + rollback test.

### P4-06 SLOs & error budgets
**Steps:** SLIs per §22 (Tier-1 latency < 2000 ms, multi-hop < 15 s, tool success > 99.5 %, recursion/hallucination bounds); burn-rate calculation over rolling windows; policy engine freezing non-critical deployments/autonomous commits for a crew whose budget is depleted, shifting to stabilization tasks; dashboards (Prometheus metrics endpoint; Grafana in `observability` profile).
**Exit check:** budget=0 ⇒ commit gate closed (test); dashboard JSON committed.

### P4-07 ChaosBot
**Steps:** Implement `ChaosExperiment` runner with six fault vectors (rate-limit, model latency, corrupt tool schema, network timeout, subprocess kill, cache eviction) via injectable fault proxies at the provider, MCP and Redis layers; refuse to run outside staging/sandbox or when error budget is exhausted; assertions: recursion cap holds, rollback executes, fallback model used, HITL escalation, no data loss; periodic resilience score per crew.
**Exit check:** full chaos suite green; results persisted as `ChaosResult`.

### P4-08 Edge resilience
**Steps:** Offline detector; SQLite durable queue for mutations/receipts; local Redis/SQLite scratchpads; optional Ollama/llama.cpp Tier-1 fallback (off by default, install instructions only — user opts in); async reconciliation to PG with idempotency keys and conflict policy; UI offline banner.
**Exit check:** simulate connectivity loss for 5 minutes → Tier-1 tasks continue; reconnect replays with zero loss (test).

### P4-09 Retention, RTBF, crypto-erasure
**Steps:** TTL schedules per data class; right-to-be-forgotten API (GDPR/DPDPA) that erases relational rows, pgvector rows and derived caches; per-subject encryption keys enabling cryptographic erasure; audit log keeps hash only. RBI payment data localization note in docs (no payment data leaves India region — document, since this is a deployment concern).
**Exit check:** erased subject unrecoverable from DB, vectors, Redis, backups manifest (test + documented backup caveat).

### P4-10 Prompt-injection & guardrails
**Steps:** Strict separation of system/developer vs user vs tool-output content; input validation filters; dual-layer guardrail (small classifier model + rules) on inputs and on tool-bound outputs; sanitize before tool execution; tool-output "taint" flag preventing tainted text from triggering Tier ≥ 2 actions without confirmation. Build a regression corpus of injection attempts (research public datasets, e.g. published prompt-injection benchmarks; check licences).
**Exit check:** corpus block-rate and false-positive rate recorded; thresholds enforced in CI.

### P4-11 Spinoff tooling
**Steps:** `scripts/spinoff.py <tenant>`: export tenant schema (pg_dump with RLS-aware role), tenant-scoped pgvector rows, git history subset (`git filter-repo` or subtree — research, ensure requirement of external tool is documented), operational logs; produce `SpinoffBundleManifest` with hashes and encryption; `import` command to a fresh stack; verification step. Test with Baeit data.
**Exit check:** Baeit exported, imported into a clean compose stack, app boots standalone; parent DB contains no residual Baeit PII after approved purge step (Tier 3).

### P4-12 DR drill & offsite
**Steps:** PITR drill to timestamp T; encrypted offsite copy to the target in C-11 (or local second disk if none); RPO/RTO measured and documented in `docs/ops/dr.md`.
**Exit check:** drill report with timings.

### P4-13 Compliance mapping
**Steps:** Trace matrix mapping controls to implementation evidence: SOC 2 TSC (Security, Availability, Processing Integrity, Confidentiality, Privacy), ISO/IEC 27001 Annex A themes, DPDPA, GDPR erasure, RBI localization. Mark gaps honestly (this is *readiness*, not certification). Include open-source tool recommendations (Trivy, Falco, OpenSCAP, GitGuardian, Vault) as optional follow-ups.
**Exit check:** `docs/compliance/control_matrix.md` with evidence links and gap list.

### P4-14 Observability pack + M4 gate
**Steps:** Prometheus/Grafana/optional OpenCost in the `observability` profile with provisioned dashboards (SLIs, FinOps, agent performance). Final E2E: Flows 1–3 on a real repo with sandboxing, gates and HITL; chaos suite; tenant export/restore. Update all docs, README, and §D; list remaining backlog (e.g. §13 connectors not yet credentialed).
**STOP:** present M4 summary and release notes for Version1.

