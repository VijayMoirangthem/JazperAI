# Launch the Sir Jasper desktop shell (starts the backend itself if it is not running; start the frontend first: cd frontend; npm run dev)
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Set-Location (Join-Path (Split-Path $PSScriptRoot -Parent) "desktop")
npm start
