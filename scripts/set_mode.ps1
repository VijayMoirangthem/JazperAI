# Usage: scripts\set_mode.ps1 dev|prod   (takes effect the next time Jazper.exe starts)
param([Parameter(Mandatory)][ValidateSet('dev', 'prod')][string]$Mode)
$f = Join-Path (Split-Path $PSScriptRoot -Parent) 'storage\launcher-mode.txt'
New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null
Set-Content $f $Mode
Write-Host "Jazper will start in $Mode mode. $(if ($Mode -eq 'dev') { 'Code edits show instantly (hot reload).' } else { 'Faster start; the UI rebuilds automatically when app/src changes.' })"
