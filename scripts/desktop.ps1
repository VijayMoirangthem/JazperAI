# Launch the desktop shell: starts the Vite renderer (app/) if it is not running, then Electron (which starts the backend itself).
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$root = Split-Path $PSScriptRoot -Parent
$up = try { (Invoke-WebRequest http://localhost:5173 -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
if (-not $up) { Start-Process npm.cmd -WorkingDirectory (Join-Path $root 'app') -ArgumentList 'run','dev' -WindowStyle Minimized; Start-Sleep 6 }
Set-Location (Join-Path $root 'desktop')
npm start
