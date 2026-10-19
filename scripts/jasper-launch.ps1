# Sir Jasper AI launcher: Docker -> database/redis -> backend (auto-reload) -> renderer (hot reload) -> desktop window.
# Edit backend .py files: the API reloads itself. Edit app/src files: the window updates instantly (Vite HMR).
# Edit desktop/*.js: close and reopen the app. Closing the window stops the backend and renderer this script started.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $root 'storage\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'launcher.log'
function Log($m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Add-Content $log }
function Up($url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2).StatusCode -lt 500 } catch { $false } }
function Wait-Up($url, $sec) { for ($i = 0; $i -lt $sec; $i++) { if (Up $url) { return $true }; Start-Sleep 1 }; return $false }

# one instance only
$mutex = New-Object System.Threading.Mutex($false, 'Global\SirJasperAI-Launcher')
if (-not $mutex.WaitOne(0)) { exit 0 }
Set-Content $log "launcher started $(Get-Date)"

$started = @()
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
$electron = Join-Path $root 'desktop\node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { Log 'electron missing: run npm install in desktop/'; exit 1 }

# 1) the window opens immediately with a splash; it waits for the services below
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$win = Start-Process $electron -ArgumentList "`"$(Join-Path $root 'desktop')`"" -WorkingDirectory (Join-Path $root 'desktop') -PassThru
Log "electron pid $($win.Id)"

# 2) Docker Desktop + containers
$env:Path += ";C:\Program Files\Docker\Docker\resources\bin"
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Log 'starting Docker Desktop'
  Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  for ($i = 0; $i -lt 150; $i++) { docker info *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }
}
docker compose -f (Join-Path $root 'infra\docker-compose.yml') --env-file (Join-Path $root 'infra\.env') up -d *>> $log
Log "containers up (exit $LASTEXITCODE)"

# 3) backend with auto-reload
if (-not (Up 'http://localhost:8000/health/')) {
  $b = Start-Process $py -ArgumentList 'run_server.py', '--reload' -WorkingDirectory (Join-Path $root 'backend\python') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'backend.out.log') -RedirectStandardError (Join-Path $logDir 'backend.err.log')
  $started += $b.Id; Log "backend pid $($b.Id)"
}

# 4) renderer dev server (hot module reload)
if (-not (Up 'http://localhost:5173/')) {
  $v = Start-Process 'npm.cmd' -ArgumentList 'run', 'dev' -WorkingDirectory (Join-Path $root 'app') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'renderer.out.log') -RedirectStandardError (Join-Path $logDir 'renderer.err.log')
  $started += $v.Id; Log "renderer pid $($v.Id)"
}
Log ("backend up: " + (Wait-Up 'http://localhost:8000/health/' 120) + ", renderer up: " + (Wait-Up 'http://localhost:5173/' 120))

# 5) run until the window closes, then stop what we started (Docker stays up)
$win.WaitForExit()
foreach ($id in $started) { taskkill /T /F /PID $id *> $null }
Log 'window closed, services stopped'
$mutex.ReleaseMutex()
