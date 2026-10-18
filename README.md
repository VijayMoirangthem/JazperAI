# Sir Jasper AI

Personal-to-enterprise agentic OS: **Sir Jasper** (L1 orchestrator) → executives → sub-crews, with HITL tiers, tenant isolation (RLS), vault-held secrets and an audited event trail. Specs and plans live in [docs/](docs/): `Sir Jasper AI.docx`, `01_CODEBASE_AUDIT.md` … `04_EXECUTION_ROADMAP.md`, and the step-by-step build log in [docs/Version1/PROMPTS_V1.md](docs/Version1/PROMPTS_V1.md).

## Layout

```
backend/python/   FastAPI app (main.py)
  api/            routers (api.routes.*), /api/v1 aliases (api/versioning.py)
  agents/         roster/ (persona agents), workers/
  core/           config, vault, audit, tenancy, directory, llm/ (providers), services/
  memory/         db/ (asyncpg pool, legacy psycopg2 helper), redis/ (bus, locks), sanitizer
  mcp/            tools/ (registry/supervisor arrive in P2-11)
infra/            docker-compose.yml (Postgres+pgvector, Redis), migrations/ (Alembic)
frontend/         Next.js UI (to be replaced by Electron + Vite in P3)
scripts/          dev.ps1, backup.ps1, restore.ps1, vault_set.ps1, audit_verify.py, license_scan.ps1 …
storage/          runtime data — git-ignored
```

## Quick start (Windows, PowerShell)

1. `copy infra\.env.example infra\.env` and set strong passwords; mirror them in `backend\python\.env` (`POSTGRES_*`, `REDIS_PASSWORD`; see `.env.example`).
2. `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`
3. `py -3.11 -m venv backend\.venv; backend\.venv\Scripts\pip install -r backend\python\requirements.txt pytest pytest-asyncio httpx respx`
4. `cd backend\python; ..\.venv\Scripts\python -m alembic upgrade head` (existing DB: `alembic stamp 0001` first)
5. Secrets go in the OS vault, never in files: `scripts\vault_set.ps1 ANTHROPIC_API_KEY`
6. `scripts\dev.ps1` (backend :8000, frontend :3001). Tests: `cd backend\python; ..\.venv\Scripts\python -m pytest -q` (DB/Redis tests need step 2).

Without `ANTHROPIC_API_KEY` the new `core.llm` layer answers from a stub; legacy chat still uses the OpenAI-compatible `AI_*` settings.

## Status

Milestone M1 (foundation) — see the tracker in `docs/Version1/PROMPTS_V1.md` §D for what is done, partial or blocked.
