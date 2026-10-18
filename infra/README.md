# Jasper infra (Postgres+pgvector, Redis)
Copy `.env.example` to `.env` (git-ignored) and set strong passwords.

- Up:     `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`
- Down:   `docker compose -f infra/docker-compose.yml down`
- Backup: `docker exec jasper-postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > storage/backups/backup.sql`
- Restore: `docker exec -i jasper-postgres psql -U $POSTGRES_USER $POSTGRES_DB < storage/backups/backup.sql`

Postgres listens on 127.0.0.1:5433 (same port as the legacy `backend/infra` compose, which is kept until P1-16; do not run both).
Observability profile (Prometheus) is an optional stub.
