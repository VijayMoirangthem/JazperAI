# Disaster recovery drill (Plan V2 G4)

Scope: Postgres (all schemas) and Redis on this PC. Procedures: `docs/ops/backup_restore.md`. Drill run **2026-10-20** with `scripts/backup.ps1` and `scripts/restore.ps1`.

## Objectives
| | Target | Measured / status |
|---|---|---|
| **RTO** (time to restore data) | 15 min | **5.8 s** to restore `full.dump.enc` (433 KB) into a scratch DB, decryption included. Backup took **12.3 s**. |
| **RPO** (acceptable data loss) | 24 h | **Not yet met automatically**: backups are run by hand. Effective RPO today = time since the last manual backup. |

## Drill result
Backup `20261020-132043`: `full.dump.enc` 433 KB, four tenant dumps (shared 74 KB, co 6 KB, baeit 1 KB, boardmint 1 KB), `redis.rdb.enc`.
Restore into scratch DB `jasper_restore_drill`: live 121 tables / 3 RLS policies, scratch 121 / 3 (identical). The live database was only read.

## What this does and does not prove
- Proves: the encrypted backup decrypts, restores cleanly, and schema, tables and row-level-security policies match.
- Does not prove: restore time at larger data volumes (the dump is under 1 MB, so 5.8 s will grow), restore on a different machine, or recovery of the vault.
  **The backup passphrase and the OS-vault master keys are not in the backup**; losing this PC's credential store makes encrypted data unreadable.
- Point-in-time recovery: WAL archiving is on (`infra/docker-compose.yml`), but no replay drill has been run. Treat PITR as unproven.

## Gaps to close (in order)
1. Schedule a daily backup (Windows Task Scheduler running `scripts\backup.ps1 -KeepDays 14`) so the 24 h RPO becomes real.
2. Offsite copy of `storage\backups` (not configured).
3. Back up the vault passphrase separately from the machine.
4. Run the PITR replay drill and record its RTO.

## Re-running the drill
```
scripts\backup.ps1
scripts\restore.ps1 -Backup storage\backups\<stamp>      # prints live vs scratch table/policy counts
```
