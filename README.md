# CREATE ORIGINS OS (COOS)

A modular AI operating system for automation, memory, multi-agent orchestration, and browser control.

## Project layout

```
COOS/
├── frontend/          Next.js UI (port 3001)
├── backend/
│   ├── python/      FastAPI API + agents (port 8000)
│   ├── munder-web/  Office floor renderer → /munder/*
│   ├── infra/       Docker Compose, Postgres init, nginx
│   ├── docs/        Documentation
│   └── scripts/     watchdog.py
├── storage/         Runtime data (hive, uploads, browser profiles)
├── start.bat        Local dev launcher (Windows)
└── README.md

Env files (not at root — see `backend/docs/ENV.md`):
  backend/infra/.env      Docker (Postgres, Redis, MinIO)
  backend/python/.env     FastAPI secrets
  frontend/.env.local     Next.js public URLs
```

## Quick start (Windows)

Double-click **`start.bat`** or run manually:

```bat
copy backend\infra\.env.example backend\infra\.env
copy backend\python\.env.example backend\python\.env
copy frontend\.env.example frontend\.env.local

docker compose --env-file backend\infra\.env -f backend\infra\docker-compose.yml up -d
cd backend\python && uvicorn main:app --reload --port 8000
cd frontend && npm run dev
```

Open **http://localhost:3001**

## Services

| Service    | Port |
|------------|------|
| Frontend   | 3001 |
| FastAPI    | 8000 |
| PostgreSQL | 5433 |
| Redis      | 6379 |
| MinIO      | 9000 / 9001 |
