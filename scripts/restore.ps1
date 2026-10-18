# Restore an encrypted full dump into a SCRATCH database (never overwrites the live DB) and compare.
# Usage: scripts\restore.ps1 -Backup storage\backups\<stamp> [-Scratch jasper_restore_drill]
param([Parameter(Mandatory)][string]$Backup, [string]$Scratch = 'jasper_restore_drill')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
$tmp = Join-Path $env:TEMP "jasper_restore_$([guid]::NewGuid().ToString('N')).dump"
& $py (Join-Path $PSScriptRoot 'backup_crypt.py') decrypt (Join-Path $Backup 'full.dump.enc') $tmp
docker cp $tmp jasper-postgres:/tmp/restore.dump
Remove-Item $tmp
# SQL goes through stdin: PowerShell 5.1 mangles embedded double quotes in native-command arguments
"DROP DATABASE IF EXISTS $Scratch;" | docker exec -i jasper-postgres sh -c 'psql -q -U $POSTGRES_USER -d postgres'
"CREATE DATABASE $Scratch;" | docker exec -i jasper-postgres sh -c 'psql -q -U $POSTGRES_USER -d postgres'
docker exec -e SCRATCH=$Scratch jasper-postgres sh -c 'pg_restore -U $POSTGRES_USER -d $SCRATCH --no-owner /tmp/restore.dump; rm -f /tmp/restore.dump'
$q = "select (select count(*) from information_schema.tables where table_schema in ('public','co','shared')) as tables, (select count(*) from pg_policies) as policies;"
Write-Host 'live   :'; $q | docker exec -i jasper-postgres sh -c 'psql -tA -U $POSTGRES_USER -d $POSTGRES_DB'
Write-Host 'scratch:'; $q | docker exec -i -e SCRATCH=$Scratch jasper-postgres sh -c 'psql -tA -U $POSTGRES_USER -d $SCRATCH'
