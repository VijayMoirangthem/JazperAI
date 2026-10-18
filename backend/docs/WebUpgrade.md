# COOS Web Upgrade & Repo Reorganization Plan

**Platform:** CREATE ORIGINS OS (COOS)  
**Status:** Root restructure complete (2026-08-23)

---

## 1. Current layout (implemented)

```
COOS/
├── frontend/                 # Next.js app (port 3001)
├── backend/
│   ├── python/             # FastAPI — agents, hive, API (port 8000)
│   ├── munder-web/         # Office floor renderer → /munder/*
│   ├── infra/
│   │   ├── docker-compose.yml
│   │   ├── postgres/init.sql
│   │   └── nginx/nginx.conf
│   ├── docs/               # All documentation
│   └── scripts/
│       └── watchdog.py
├── storage/                  # All runtime / local data
│   ├── hive/               # Agent identity, memory, board, tasks
│   ├── uploads/
│   ├── browser-profiles/   # Chrome + LinkedIn automation (gitignored)
│   ├── archive/munder/     # Legacy Munder Difflin roster backups
│   ├── user/               # Personal files (resume, etc.)
│   └── logs/               # watchdog.log
├── start.bat               # Local dev launcher — stays at root
└── README.md

Env (split by layer — see backend/docs/ENV.md):
  backend/infra/.env        Docker only
  backend/python/.env       API secrets
  frontend/.env.local       NEXT_PUBLIC_* only
```

**Root rule:** Only `frontend/`, `backend/`, `storage/` as top-level folders (+ config files and `start.bat`).

---

## 2. What moved where

| Was (root) | Now |
|------------|-----|
| `infra/` | `backend/infra/` |
| `docker-compose.yml` | `backend/infra/docker-compose.yml` |
| `docs/` | `backend/docs/` |
| `watchdog.py` | `backend/scripts/watchdog.py` |
| `MunderDifflin/` | `storage/archive/munder/` |
| `chrome-profile/` | `storage/browser-profiles/coos/` |
| `linkedin-profile/` | `storage/browser-profiles/linkedin/` |
| `VijayMoirangthem/` | `storage/user/vijay/` |
| `frontend/public/munder/` | **Deleted** (stale; use `backend/munder-web/dist`) |

---

## 3. Dev vs production

### Local (`start.bat`)
1. Docker: `backend/infra/docker-compose.yml`
2. FastAPI: `backend/python`
3. Next.js: `frontend`
4. Watchdog: `backend/scripts/watchdog.py`

### Production (later)
Same three services — deployed with env vars, no `.bat` file:
- Next.js → Vercel / Railway / VPS
- FastAPI → Railway / Fly / ECS
- Postgres + Redis + S3 → managed cloud

**First deploy target:** `coos.createorigins.com` (subdomain, separate from marketing site).

---

## 4. Storage strategy

| Type | Location | Cloud later |
|------|----------|-------------|
| Structured data | Postgres (`coos` DB) | Managed Postgres (Neon/Supabase) |
| Agent markdown | `storage/hive/` | S3 sync |
| Uploads / files | `storage/uploads/` | S3 / R2 |
| Browser profiles | `storage/browser-profiles/` | Local only (never cloud) |

**Do not migrate to MongoDB** — Postgres + pgvector is the right stack. Abstract DB access over time; keep Postgres as source of truth.

---

## 5. Create Origins website integration

- Keep COOS and Create Origins marketing site as **separate repos**
- Link via subdomain: `coos.createorigins.com`
- Shared auth later (Clerk / Auth0 / custom JWT)
- Do **not** merge Next.js apps until COOS has auth + stable deploy

---

## 6. Naming

| Entity | Name |
|--------|------|
| Platform | **CREATE ORIGINS OS** |
| Company | Create Origins |
| Primary AI | **Jazper** (Chief of Staff — keep) |
| DB | `coos` |
| Docker containers | Rename `sirjazper-*` → `coos-*` when recreating volumes |

---

## 7. Roadmap

### Phase 0 — Done
- [x] 3-folder root layout
- [x] Move infra, docs, scripts into `backend/`
- [x] Consolidate runtime data under `storage/`
- [x] Update `start.bat`, paths, README

### Phase 1 — Now (build COOS)
- [ ] Finish visible rename: UI strings "Sir Jazper OS" → "CREATE ORIGINS OS"
- [ ] Fix remaining bugs (OfficeFloor, onboarding DB errors)
- [ ] Env-based URLs (no hardcoded localhost in panels)
- [ ] Auth skeleton

### Phase 2 — Web beta
- [ ] Production Docker compose
- [ ] Deploy to `coos.createorigins.com`
- [ ] Managed Postgres + S3

### Phase 3 — Later
- [ ] Subscriptions / paid tiers
- [ ] Desktop app (premium only)

---

## 8. Direct answers

**Is it too early for web hosting?**  
Yes to deploy, no to plan. Build locally first; deploy when auth + env config are ready.

**Should file storage be one place?**  
Yes — `storage/` for files, Postgres for structured data. Done.

**MongoDB for cloud?**  
No. Use managed Postgres.

**Focus this week:** Features + Phase 1 rename pass. Hosting can wait.

---

*Last updated: 2026-08-23*
