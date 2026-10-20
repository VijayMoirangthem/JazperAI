# Disaster recovery (Plan V3 W7) — measured 2026-10-21

Scope: Postgres (all schemas) and Redis on this PC, with MinIO as the object store. Procedures also in `docs/ops/backup_restore.md`.

## What runs now
| Piece | How | Evidence |
|---|---|---|
| Encrypted dump | `scripts/backup.ps1` (AES-256-GCM) | unchanged |
| Backup to MinIO | `scripts/backup_minio.py`: dump, upload to the object-locked `backups` bucket (30-day governance retention), verify size, download + hash the main dump, write `manifest.json` | 6 files, ~1 MB, verified, 44.7 s under load |
| **Schedule** | Windows task "Jasper Backup", daily 03:00, runs as soon as possible if the PC was off (`scripts/schedule_backups.ps1`) | next run 2026-10-21 03:00 |
| **WAL archive** | Postgres archives WAL to a volume; the `wal-shipper` container copies new segments to the MinIO `wal` bucket every 20 s | 14+ segments shipped, still shipping |
| Restore from MinIO | `scripts/restore_from_minio.py`: download, hash-check against the manifest, restore into a scratch DB | live 125 tables / 3 policies = scratch 125 / 3; download+verify 0.9 s, restore 20.8 s, total 21.7 s |
| **Point-in-time recovery drill** | `scripts/pitr_drill.py`: pg_basebackup, probe row A, target time, probe row B, restore from MinIO base + WAL to the target time | **PASS**: scratch DB has A and not B; restore 65.8 s (18 WAL segments), whole drill 124.8 s |

## Objectives
| | Target | Status |
|---|---|---|
| RPO | 15 min | **Met for the database**: `archive_timeout=60` plus a 20-second shipper means at most about 80 seconds of data at risk. Files and Redis: daily |
| RTO | 30 min | **Met**: 21.7 s logical restore, 65.8 s PITR on today's data size (about 11 MB base, 18 WAL segments). Will grow with data |

## Where the data physically lives
| Data | Location |
|---|---|
| Code, docs, `storage\` (worktrees, backup folders, uploads), encrypted backup copies | `D:\Projects\COOS` |
| MinIO objects (attachments, backups, WAL archive) | `D:\Projects\COOS\data\minio` (bind mount, git-ignored) |
| Postgres and Redis data, the WAL staging volume | **Docker volumes inside Docker's disk image on C:** (`C:\Users\vijay\AppData\Local\Docker\wsl\disk\docker_data.vhdx`). Postgres cannot use a Windows bind mount (it needs Linux file ownership). To move them to D: use Docker Desktop > Settings > Resources > Advanced > Disk image location. Until then the daily backup and the WAL copy in `data\minio` are what protect it |
| Old unused volumes from earlier project names (`coos_*`, `createorigins_*`, `infra_*`, `sirjazper_*`, `jasper_minio_data`) | still in Docker; I did not delete them (they may hold old data). `docker volume ls` shows them; remove after you confirm |

## Still not covered (honest)
- **Offsite copy.** MinIO is on this same PC and disk. Losing the machine loses the backups. Next step: replicate the `backups` and `wal` buckets to Cloudflare R2 or Backblaze B2 with client-side encryption (needs your account and keys).
- **Vault passphrase and OS-vault keys are not in the backup.** Without this PC's credential store the encrypted dumps cannot be decrypted. Keep an offline copy of `BACKUP_PASSPHRASE`.
- `archive_timeout=60` is now set, so an idle system still ships WAL at least every minute.
- **Redis** is volatile by design (caches, live state, SLO counters). A daily `SAVE` is included in `backup.ps1`; nothing in Redis is the only copy of anything.
- The PITR drill restores into a scratch container; it was not run on a different machine.

## Re-run
```
backend\.venv\Scripts\python.exe scripts\backup_minio.py          # backup + verify
backend\.venv\Scripts\python.exe scripts\restore_from_minio.py    # restore drill into a scratch DB
backend\.venv\Scripts\python.exe scripts\pitr_drill.py            # point-in-time recovery drill
Unregister-ScheduledTask -TaskName "Jasper Backup" -Confirm:$false   # remove the schedule
```
