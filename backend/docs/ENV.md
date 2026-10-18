# Environment configuration

COOS uses **three separate env files** — one per layer. Do not put everything in one root `.env`.

## Files

| File | Consumer | Contains |
|------|----------|----------|
| `backend/infra/.env` | Docker Compose | Postgres, Redis, MinIO credentials |
| `backend/python/.env` | FastAPI | AI keys, OAuth, DB connection, app secrets |
| `frontend/.env.local` | Next.js | `NEXT_PUBLIC_*` URLs only |

## First-time setup

```bat
copy backend\infra\.env.example backend\infra\.env
copy backend\python\.env.example backend\python\.env
copy frontend\.env.example frontend\.env.local
```

Edit each file with your real values.

## Rules

1. **Infra ↔ backend DB creds must match**  
   `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` in `backend/infra/.env` must match `backend/python/.env`.  
   `POSTGRES_PORT` in Python is `5433` (Docker maps host 5433 → container 5432).

2. **Never put API secrets in frontend**  
   Only `NEXT_PUBLIC_*` in `frontend/.env.local`. Backend keys stay in `backend/python/.env`.

3. **Docker only reads infra env**  
   `start.bat` runs:  
   `docker compose --env-file backend\infra\.env -f backend\infra\docker-compose.yml up -d`

4. **No root `.env`**  
   Root holds `start.bat` and git config only — not secrets.

## Production

Each host gets its own env injection:

- **Vercel / frontend host** → `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`
- **API host** → full `backend/python/.env` equivalent
- **Docker / infra** → `backend/infra/.env` equivalent (or managed service credentials)
