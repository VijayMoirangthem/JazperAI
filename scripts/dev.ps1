# Starts backend (uvicorn) + frontend (next dev); waits for health. start.bat is kept.
$root = Split-Path $PSScriptRoot -Parent
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" }
$old = Join-Path $root 'backend\infra\docker-compose.yml'
$new = Join-Path $root 'infra\docker-compose.yml'
$compose = if (Test-Path $new) { $new } else { $old }
docker compose -f $compose up -d
Start-Process $py -WorkingDirectory (Join-Path $root 'backend\python') -ArgumentList 'run_server.py','--reload','--port','8000'
Start-Process npm.cmd -WorkingDirectory (Join-Path $root 'frontend') -ArgumentList 'run','dev'
foreach ($u in 'http://localhost:8000/health/','http://localhost:3001') {
  $ok = $false
  1..60 | ForEach-Object { if (-not $ok) { try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true } catch { Start-Sleep 2 } } }
  Write-Host "$u -> $(if ($ok) {'UP'} else {'TIMEOUT'})"
}
