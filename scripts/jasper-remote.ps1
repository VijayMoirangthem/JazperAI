<#
  Jasper phone link: makes the Jasper running on this PC reachable from your phone over the internet.

  What it does
    1. Makes sure the Jasper backend answers on http://localhost:8000 (starts it if it is not running).
    2. Opens a tunnel (default: Cloudflare quick tunnel, no account needed; or ngrok with -Provider ngrok).
    3. Tells Jasper its public address and creates a 5-minute pairing code.
    4. Opens a page with a QR code. Scan it in the Jasper app (Welcome > Connect with QR code).

  Only /remote/v1/* is reachable through the tunnel (core/remote_guard.py blocks everything else).
  Leave this window open while you use the phone. Press R for a new code, Q to stop.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\jasper-remote.ps1 [-Provider cloudflared|ngrok] [-NgrokDomain my.ngrok-free.app] [-NoBrowser]
#>
param(
  [ValidateSet('cloudflared', 'ngrok', 'tailscale')][string]$Provider = 'cloudflared',
  [string]$NgrokDomain = '',
  [int]$Port = 8000,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Python = 'C:\Users\vijay\AppData\Local\Programs\Python\Python311\python.exe'
$Api = "http://localhost:$Port"
$Out = Join-Path $Root 'storage\remote'
New-Item -ItemType Directory -Force $Out | Out-Null
$script:Tunnel = $null

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

function Test-Health {
  try { (Invoke-WebRequest "$Api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

# 1. Backend ------------------------------------------------------------------------------------------------
function Test-Port($p) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); $true } catch { $false }
}

function Start-Infra {
  # Jasper's database (PostgreSQL on 5433), Redis and MinIO run in Docker, the same way start.bat starts them.
  if (Test-Port 5433) { return }
  Say 'Starting Docker infrastructure (database, Redis)...' Yellow
  $env:PATH += ';C:\Program Files\Docker\Docker\resources\bin'
  cmd /c 'docker info >nul 2>&1'
  if ($LASTEXITCODE -ne 0) {
    $desktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $desktop) { Start-Process $desktop } else { Say 'Docker Desktop is not installed.' Red; return }
    Say 'Waiting for Docker Desktop to start (up to 3 minutes)...' Yellow
    for ($i = 0; $i -lt 60; $i++) { Start-Sleep 3; cmd /c 'docker info >nul 2>&1'; if ($LASTEXITCODE -eq 0) { break } }
  }
  $envFile = Join-Path $Root 'backend\infra\.env'
  $composeFile = Join-Path $Root 'backend\infra\docker-compose.yml'
  cmd /c "docker compose --env-file ""$envFile"" -f ""$composeFile"" up -d >nul 2>&1"
  for ($i = 0; $i -lt 30; $i++) { if (Test-Port 5433) { break }; Start-Sleep 2 }
}

if (-not (Test-Health)) {
  Start-Infra
  Say 'Jasper backend is not running. Starting it...' Yellow
  & $Python -c 'import asyncpg, psycopg, fastapi, uvicorn' 2>$null
  if ($LASTEXITCODE -ne 0) {
    Say 'Installing Python requirements (first time only)...' Yellow
    & $Python -m pip install 'asyncpg==0.29.0' 'psycopg[binary,pool]' | Out-Null
  }
  Start-Process -WindowStyle Hidden -FilePath $Python -WorkingDirectory (Join-Path $Root 'backend\python') `
    -ArgumentList 'run_server.py', '--port', $Port `
    -RedirectStandardOutput (Join-Path $Out 'backend.log') -RedirectStandardError (Join-Path $Out 'backend.err')
  $up = $false
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 3; if (Test-Health) { $up = $true; break } }
  if (-not $up) { Say "Backend did not start. See $Out\backend.err" Red; exit 1 }
}
Say 'Jasper backend is running.' Green

# 2. Tunnel -------------------------------------------------------------------------------------------------
function Start-Tunnel {
  if ($Provider -eq 'tailscale') {
    # Permanent private address: only YOUR devices on your Tailscale network can reach it, the address never changes, and nothing is
    # opened to the public internet. Needs Tailscale installed + signed in on this PC and the phone (free, https://tailscale.com),
    # and "HTTPS Certificates" enabled once in the Tailscale admin console (DNS page).
    $ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
    if (-not $ts) { $ts = 'C:\Program Files\Tailscale\tailscale.exe' }
    if (-not (Test-Path $ts)) { Say 'Tailscale is not installed. Install it from https://tailscale.com/download, sign in, then run this again.' Red; exit 1 }
    $st = & $ts status --json 2>$null | ConvertFrom-Json
    if (-not $st -or $st.BackendState -ne 'Running') { Say 'Tailscale is installed but not signed in / connected. Open Tailscale, sign in, then run this again.' Red; exit 1 }
    & $ts serve --bg --https=443 "http://127.0.0.1:$Port" | Out-Null   # persists across restarts: you do not need to keep this window open
    $dns = ($st.Self.DNSName).TrimEnd('.')
    if (-not $dns) { Say 'Could not read this PC''s Tailscale name. Is MagicDNS enabled?' Red; exit 1 }
    return "https://$dns"
  }
  if ($Provider -eq 'ngrok') {
    $ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
    if (-not $ngrok) {
      Say 'ngrok is not installed. Install it with:  winget install ngrok.ngrok   then run: ngrok config add-authtoken <your token>' Red
      exit 1
    }
    $ngrokArgs = @('http', "$Port", '--log', 'stdout')
    if ($NgrokDomain) { $ngrokArgs += @("--url=$NgrokDomain") }
    $script:Tunnel = Start-Process -WindowStyle Hidden -PassThru -FilePath $ngrok -ArgumentList $ngrokArgs `
      -RedirectStandardOutput (Join-Path $Out 'ngrok.log') -RedirectStandardError (Join-Path $Out 'ngrok.err')
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep 1
      try {
        $t = (Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2).tunnels | Where-Object { $_.public_url -like 'https://*' } | Select-Object -First 1
        if ($t) { return $t.public_url }
      } catch { }
    }
    Say "ngrok did not give an address. See $Out\ngrok.err (is the auth token set?)" Red
    exit 1
  }

  $exe = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if (-not $exe) {
    $dir = Join-Path $Root 'tools\cloudflared'
    $exe = Join-Path $dir 'cloudflared.exe'
    if (-not (Test-Path $exe)) {
      Say 'Downloading cloudflared (one time, about 40 MB)...' Yellow
      New-Item -ItemType Directory -Force $dir | Out-Null
      Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $exe -UseBasicParsing
    }
  }
  $log = Join-Path $Out 'cloudflared.err'
  Remove-Item $log -ErrorAction SilentlyContinue
  $script:Tunnel = Start-Process -WindowStyle Hidden -PassThru -FilePath $exe `
    -ArgumentList 'tunnel', '--url', "http://localhost:$Port", '--no-autoupdate' `
    -RedirectStandardOutput (Join-Path $Out 'cloudflared.out') -RedirectStandardError $log
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep 1
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) { return $m.Matches[0].Value }
    }
  }
  Say "cloudflared did not give an address. See $log" Red
  exit 1
}

Say "Opening the $Provider tunnel..." Yellow
$PublicUrl = Start-Tunnel
Say "Public address: $PublicUrl" Green

# 3. Register address and make a pairing code -----------------------------------------------------------------
Invoke-RestMethod -Method Put -Uri "$Api/api/remote/public-url" -ContentType 'application/json' -Body (@{ url = $PublicUrl } | ConvertTo-Json) | Out-Null

function New-PairPage {
  $pair = Invoke-RestMethod -Method Post -Uri "$Api/api/remote/pair/start"
  $payload = "jasper://pair?u=$([uri]::EscapeDataString($PublicUrl))&c=$($pair.code)"
  $html = @"
<!doctype html><html><head><meta charset="utf-8"><title>Jasper phone link</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#fff;color:#111;display:flex;flex-direction:column;align-items:center;padding:36px}
h1{font-weight:600;margin:0 0 6px}p{color:#666;margin:4px 0 18px;text-align:center;max-width:420px}
#qr{padding:16px;border:1px solid #eee;border-radius:20px}.code{font-size:34px;letter-spacing:8px;font-weight:700;margin:18px 0 4px}
small{color:#999;word-break:break-all;max-width:420px;text-align:center}</style></head><body>
<h1>Connect your phone to Jasper</h1><p>Open the Jasper app, tap <b>Connect with QR code</b> and scan this. The code works once for 5 minutes.</p>
<div id="qr"></div><div class="code">$($pair.code)</div><small>$PublicUrl</small>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>new QRCode(document.getElementById('qr'),{text:'$payload',width:260,height:260,correctLevel:QRCode.CorrectLevel.M});</script>
</body></html>
"@
  $file = Join-Path $Out 'pair.html'
  Set-Content -Path $file -Value $html -Encoding UTF8
  return @{ File = $file; Code = $pair.code; Payload = $payload }
}

$p = New-PairPage
Write-Host ''
Say "  Pairing code : $($p.Code)   (valid 5 minutes)" Cyan
Say "  Address      : $PublicUrl" Cyan
Say "  Link         : $($p.Payload)" DarkGray
if (-not $NoBrowser) { Start-Process $p.File }
Write-Host ''
Say 'On the phone: Jasper app > Connect with QR code. Keep this window open.  [R] new code   [Q] quit' White

try {
  while ($true) {
    try {
      if ([Console]::KeyAvailable) {
        $key = [Console]::ReadKey($true).Key
        if ($key -eq 'Q') { break }
        if ($key -eq 'R') {
          $p = New-PairPage
          Say "New code: $($p.Code)" Cyan
          if (-not $NoBrowser) { Start-Process $p.File }
        }
      }
    } catch { }  # no console attached (for example run in the background): just keep the tunnel open
    if ($script:Tunnel -and $script:Tunnel.HasExited) { Say 'The tunnel stopped.' Red; break }
    Start-Sleep -Milliseconds 400
  }
} finally {
  if ($script:Tunnel -and -not $script:Tunnel.HasExited) { Stop-Process -Id $script:Tunnel.Id -Force -ErrorAction SilentlyContinue }
  Say 'Phone link stopped.' Yellow
}
