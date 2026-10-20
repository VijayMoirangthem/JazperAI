# Object store (MinIO) not reachable

Backups, attachments and the WAL archive are affected.

## Steps
1. `docker ps` should show jasper-minio and jasper-wal-shipper; if not run `docker compose up -d minio wal-shipper` in `infra/`.
2. Check disk space (`disk_low`).
3. After recovery run a backup and confirm WAL segments are shipping.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
