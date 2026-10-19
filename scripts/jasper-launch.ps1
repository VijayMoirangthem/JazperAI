# Jazper launcher: Docker -> database/redis -> [build UI if stale] -> backend -> [renderer dev server] -> desktop window.
# Modes (storage\launcher-mode.txt, set with scripts\set_mode.ps1):
#   dev   (default) backend auto-reloads on .py edits, renderer hot-reloads on app/src edits, so changes show instantly.
#   prod  the UI is built once (rebuilt automatically when app/src changed) and served by the backend: faster start, no dev server.
# Edit desktop/*.js: close and reopen the app. Closing the window stops the backend/renderer this script started (Docker stays up).
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

$modeFile = Join-Path $root 'storage\launcher-mode.txt'
$mode = if (Test-Path $modeFile) { (Get-Content $modeFile -Raw).Trim().ToLower() } else { 'dev' }
if ($mode -ne 'prod') { $mode = 'dev' }
Log "mode: $mode"

$started = @()
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
$electron = Join-Path $root 'desktop\node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { Log 'electron missing: run npm install in desktop/'; exit 1 }

# 1) the window opens immediately with a splash; it waits for the services below
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:JASPER_LAUNCHER = '1'  # the window waits for the services started below instead of starting its own backend
if ($mode -eq 'prod') { $env:JASPER_MODE = 'prod' } else { Remove-Item Env:JASPER_MODE -ErrorAction SilentlyContinue }
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

# 3) production UI: rebuild when anything under app/src (or the entry files) is newer than the build
if ($mode -eq 'prod') {
  $appDir = Join-Path $root 'app'; $dist = Join-Path $appDir 'dist\index.html'
  $newest = (Get-ChildItem (Join-Path $appDir 'src'), (Join-Path $appDir 'index.html'), (Join-Path $appDir 'package.json'), (Join-Path $appDir 'vite.config.ts') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum
  if (-not (Test-Path $dist) -or (Get-Item $dist).LastWriteTime -lt $newest) {
    Log 'UI build is missing or stale: building'
    $env:JASPER_BASE = '/ui/'
    Start-Process 'npm.cmd' -ArgumentList 'run', 'build' -WorkingDirectory $appDir -WindowStyle Hidden -Wait `
      -RedirectStandardOutput (Join-Path $logDir 'build.out.log') -RedirectStandardError (Join-Path $logDir 'build.err.log')
    Remove-Item Env:JASPER_BASE -ErrorAction SilentlyContinue
    Log "UI build finished (exists: $(Test-Path $dist))"
  }
}

# 4) backend (auto-reload in dev mode)
if (-not (Up 'http://localhost:8000/health/')) {
  $args = @('run_server.py'); if ($mode -eq 'dev') { $args += '--reload' }
  $b = Start-Process $py -ArgumentList $args -WorkingDirectory (Join-Path $root 'backend\python') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'backend.out.log') -RedirectStandardError (Join-Path $logDir 'backend.err.log')
  $started += $b.Id; Log "backend pid $($b.Id)"
}

# 5) renderer dev server (dev mode only)
if ($mode -eq 'dev' -and -not (Up 'http://localhost:5173/')) {
  $v = Start-Process 'npm.cmd' -ArgumentList 'run', 'dev' -WorkingDirectory (Join-Path $root 'app') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'renderer.out.log') -RedirectStandardError (Join-Path $logDir 'renderer.err.log')
  $started += $v.Id; Log "renderer pid $($v.Id)"
}
$uiUrl = if ($mode -eq 'prod') { 'http://localhost:8000/ui/' } else { 'http://localhost:5173/' }
Log ("backend up: " + (Wait-Up 'http://localhost:8000/health/' 120) + ", ui up: " + (Wait-Up $uiUrl 120))

# 6) run until the window closes, then stop what we started (Docker stays up)
$win.WaitForExit()
foreach ($id in $started) { taskkill /T /F /PID $id *> $null }
Log 'window closed, services stopped'
$mutex.ReleaseMutex()
