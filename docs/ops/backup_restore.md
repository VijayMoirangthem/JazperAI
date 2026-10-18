# Backup & restore (P1-15)

**Backup:** `scripts\backup.ps1 [-KeepDays 14]` → `storage\backups\<stamp>\` with `full.dump.enc`, `tenant_{co,baeit,boardmint,shared}.dump.enc`, `redis.rdb.enc`.
Encryption: AES-256-GCM, scrypt-derived key; passphrase from `JASPER_BACKUP_PASSPHRASE` or the OS-vault entry `BACKUP_PASSPHRASE` (auto-generated on first run — **back it up separately**, without it backups are unreadable). Offsite copy: not configured (C-11).
Retention: backup folders older than `-KeepDays` are removed.

**Restore drill (never touches the live DB):** `scripts\restore.ps1 -Backup storage\backups\<stamp>` restores `full.dump.enc` into scratch DB `jasper_restore_drill` and prints table/policy counts for live vs scratch.
Drill result 2026-10-19: live 104 tables / 3 policies; scratch 104 / 3 (identical).

**PITR:** `infra/docker-compose.yml` enables `archive_mode=on` with `archive_command` copying segments to the `wal_archive` volume (verified: `pg_stat_archiver` archived=1, failed=0). Point-in-time replay = restore a base backup into a new data dir, set `restore_command='cp /wal_archive/%f %p'` and `recovery_target_time`, then start. A full PITR drill with timings is scheduled for P4-12. Note: a `-Fc` logical dump is not a base backup; for true PITR take `pg_basebackup` (P4-12).

**Redis:** `SAVE` then copy `dump.rdb` (AOF also persisted in the `redis_data` volume).
