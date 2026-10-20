# Backup older than 26 hours

The daily job did not run or failed.

## Steps
1. Run `backend\.venv\Scripts\python.exe scripts\backup_minio.py` and read the output.
2. Check the scheduled task: `Get-ScheduledTaskInfo -TaskName "Jasper Backup"`.
3. If MinIO is down see `minio_down`.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
