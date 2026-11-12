<#
  Starts Jasper's backend at Windows sign-in, hidden, so the phone works after the PC restarts without anyone running start.bat.
  Registered as the scheduled task "Jasper Backend (autostart)" (see docs/OPERATIONS.md). Remove it with:
    Unregister-ScheduledTask -TaskName "Jasper Backend (autostart)" -Confirm:$false

  Order: wait for Docker Desktop (it starts at sign-in) -> make sure the database containers are up -> run scripts\run_backend.bat,
  which restarts the backend by itself if it ever crashes. Tailscale is a Windows service and needs nothing from here.
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$env:PATH += ';C:\Program Files\Docker\Docker\resources\bin'
$log = Join-Path $Root 'storage\remote\autostart.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 's'), $m) }

function Test-Port($p) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); $true } catch { $false } }

Log 'autostart: begin'
for ($i = 0; $i -lt 60; $i++) {            # up to 3 minutes for Docker Desktop
  cmd /c 'docker info >nul 2>&1'
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep 3
}
if (-not (Test-Port 5433)) {
  Log 'database not up: docker compose up -d'
  cmd /c "docker compose --env-file ""$Root\backend\infra\.env"" -f ""$Root\backend\infra\docker-compose.yml"" up -d >nul 2>&1"
  for ($i = 0; $i -lt 30; $i++) { if (Test-Port 5433) { break }; Start-Sleep 2 }
}
Log ("database port 5433 open: {0}" -f (Test-Port 5433))
try { if ((Invoke-WebRequest 'http://localhost:8000/health/' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { Log 'a backend already answers on :8000: nothing to start'; exit 0 } } catch { }
Log 'starting backend supervisor'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$Root\scripts\run_backend.bat`"" -WindowStyle Hidden -Wait
Log 'supervisor exited'
