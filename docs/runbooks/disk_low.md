# Low disk space

Less than 10 GB free on the project drive.

## Steps
1. Delete old files in `storage/worktrees`, `storage/demo`, old `storage/backups` folders (keep the newest 3).
2. Docker: `docker system prune` (check what it will remove first).
3. Docker's data lives on C: (docker_data.vhdx); check that drive too.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
