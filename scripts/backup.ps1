# Full + per-tenant logical backups, Redis RDB, encrypted (AES-GCM), with retention.  Usage: scripts\backup.ps1 [-KeepDays 14]
param([int]$KeepDays = 14)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dir = Join-Path $root "storage\backups\$stamp"
New-Item -ItemType Directory -Force $dir | Out-Null
# dumps are written inside the container and copied out (PowerShell 5.1 corrupts binary stdout redirects)
docker exec jasper-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -f /tmp/full.dump "$POSTGRES_DB"'
docker cp jasper-postgres:/tmp/full.dump "$dir\full.dump"
foreach ($s in 'co','baeit','boardmint','shared') {
  docker exec jasper-postgres sh -c "pg_dump -U `"`$POSTGRES_USER`" -Fc -n $s -f /tmp/t_$s.dump `"`$POSTGRES_DB`""
  docker cp "jasper-postgres:/tmp/t_$s.dump" "$dir\tenant_$s.dump"
}
docker exec jasper-postgres sh -c 'rm -f /tmp/*.dump'
docker exec jasper-redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning SAVE' | Out-Null
docker cp jasper-redis:/data/dump.rdb "$dir\redis.rdb"
Get-ChildItem $dir -File | ForEach-Object {
  & $py (Join-Path $PSScriptRoot 'backup_crypt.py') encrypt $_.FullName "$($_.FullName).enc"
  Remove-Item $_.FullName   # plaintext copies created above, inside this backup folder only
}
Get-ChildItem (Join-Path $root 'storage\backups') -Directory | Where-Object { $_.Name -match '^\d{8}-\d{6}$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Recurse -Force
Write-Host "backup written: $dir"
