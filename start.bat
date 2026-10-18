@echo off
setlocal enabledelayedexpansion
title CREATE ORIGINS OS -- Control Panel
color 0A
cls

:: ══════════════════════════════════════════════════════════════════════════════
::  CONFIG — edit these if paths change
:: ══════════════════════════════════════════════════════════════════════════════
set ROOT=%~dp0
set PYTHON=C:\Users\vijay\AppData\Local\Programs\Python\Python311\python.exe
set PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin

:: Chrome runs COOS. Edge runs LinkedIn automation (Edge has LinkedIn logged in).
set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
set EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
set EDGE64=C:\Program Files\Microsoft\Edge\Application\msedge.exe

:: Dedicated Chrome profile for COOS (separate from main Chrome profile).
set SJ_PROFILE=%ROOT%storage\browser-profiles\coos

:: Service URLs
set FRONTEND_URL=http://localhost:3001
set BACKEND_URL=http://localhost:8000
set MINIO_URL=http://localhost:9001
set HEALTH_URL=http://localhost:8000/health

:: ══════════════════════════════════════════════════════════════════════════════
::  BANNER
:: ══════════════════════════════════════════════════════════════════════════════
echo.
echo  =====================================================
echo   CREATE ORIGINS OS  --  Full Restart
echo  =====================================================
echo.
echo  After startup you do NOT need to run this again.
echo  Changes auto-reflect:
echo    Frontend (.tsx/.ts/.css)  --  HMR, browser updates instantly
echo    Backend  (.py files)      --  uvicorn --reload, restarts in 1s
echo.
echo  Only re-run this if:  services crash / packages added / env files changed
echo  =====================================================
echo.

:: ══════════════════════════════════════════════════════════════════════════════
::  STEP 1 -- Kill everything first (so file locks are released before deletes)
:: ══════════════════════════════════════════════════════════════════════════════
echo  [1/6] Stopping existing services...

wmic process where "name='python.exe' and commandline like '%%uvicorn%%'" delete >nul 2>&1
wmic process where "name='python3.exe' and commandline like '%%uvicorn%%'" delete >nul 2>&1

for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

taskkill /fi "WindowTitle eq COOS - FastAPI" /F >nul 2>&1
taskkill /fi "WindowTitle eq COOS - Frontend" /F >nul 2>&1

timeout /t 3 /nobreak >nul
echo  [OK]  All services stopped.
echo.

:: ══════════════════════════════════════════════════════════════════════════════
::  STEP 2 -- Clear Next.js build cache (safe now -- processes are dead)
::           This deletes the compiled JS/CSS so Turbopack starts completely
::           fresh. Prevents old cached bundles causing hydration errors.
:: ══════════════════════════════════════════════════════════════════════════════
echo  [2/6] Clearing build cache...

if exist "%ROOT%frontend\.next" (
    rmdir /s /q "%ROOT%frontend\.next" >nul 2>&1
    if exist "%ROOT%frontend\.next" (
        echo  [WARN] Could not fully delete .next -- a file may still be locked.
    ) else (
        echo  [OK]  .next cache cleared.
    )
) else (
    echo  [OK]  Cache already clean.
)
echo.

:: ══════════════════════════════════════════════════════════════════════════════
::  STEP 3 -- Dependency checks (auto-install if missing)
:: ══════════════════════════════════════════════════════════════════════════════
echo  [3/6] Checking dependencies...

:: Check frontend .env
if not exist "%ROOT%frontend\.env.local" (
    echo  [WARN] frontend\.env.local is missing -- API calls may fail.
) else (
    echo  [OK]  frontend\.env.local found.
)

:: Check backend infra .env (Docker)
if not exist "%ROOT%backend\infra\.env" (
    echo  [WARN] backend\infra\.env is missing -- copy from .env.example
) else (
    echo  [OK]  backend\infra\.env found.
)

:: Check backend API .env
if not exist "%ROOT%backend\python\.env" (
    echo  [WARN] backend\python\.env is missing -- backend will use defaults.
) else (
    echo  [OK]  backend\python\.env found.
)

:: Auto npm install if node_modules is missing
if not exist "%ROOT%frontend\node_modules" (
    echo  [INFO] node_modules not found -- running npm install...
    cd /d "%ROOT%frontend"
    call npm install
    if !errorlevel! neq 0 (
        echo  [ERR]  npm install failed. Fix errors above before continuing.
        pause >nul
        exit /b 1
    )
    echo  [OK]  npm install complete.
) else (
    echo  [OK]  node_modules present.
)

:: Auto pip install if a key package is missing
"%PYTHON%" -c "import fastapi, uvicorn" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [INFO] Python deps missing -- running pip install...
    "%PYTHON%" -m pip install -r "%ROOT%backend\python\requirements.txt"
    echo  [OK]  pip install complete.
) else (
    echo  [OK]  Python dependencies present.
)
echo.

:: ══════════════════════════════════════════════════════════════════════════════
::  STEP 4 -- Docker infrastructure
:: ══════════════════════════════════════════════════════════════════════════════
echo  [4/6] Starting infrastructure (PostgreSQL, Redis, MinIO)...

docker compose --env-file "%ROOT%backend\infra\.env" -f "%ROOT%backend\infra\docker-compose.yml" up -d >nul 2>&1
if %errorlevel% neq 0 (
    echo  [WARN] Docker Compose failed. Is Docker Desktop running?
    echo  [WARN] Backend will start but DB features will not work.
) else (
    echo  [OK]  PostgreSQL + Redis + MinIO running.
)
echo.

:: ══════════════════════════════════════════════════════════════════════════════
::  STEP 4.5 -- COOS Watchdog (Phase 7B)
::             Runs silently in background; watches for restart signals from Darwin.
::             Darwin writes %TEMP%\coos_restart_signal.json → Watchdog restarts
::             the appropriate service and logs to storage/logs/watchdog.log.
:: ══════════════════════════════════════════════════════════════════════════════
echo  [4.5/6] Starting COOS Watchdog...
start "" /B "%PYTHON%" "%ROOT%backend\scripts\watchdog.py"
echo  [OK]  Watchdog running (logs: storage\logs\watchdog.log)
echo.

:: ══════════════════════════════════════════════════════════════════════════════
::  STEP 5 -- FastAPI backend
::            --reload watches ALL .py files -- any save auto-restarts instantly
:: ══════════════════════════════════════════════════════════════════════════════
echo  [5/6] Starting FastAPI backend (auto-reload on .py changes)...
start "COOS - FastAPI" cmd /k "cd /d %ROOT%backend\python && %PYTHON% -m uvicorn main:app --reload --port 8000"
echo  [OK]  FastAPI starting...
echo.

:: ══════════════════════════════════════════════════════════════════════════════
::  STEP 6 -- Next.js frontend
::            HMR watches all .tsx/.ts/.css -- saves reflect in browser instantly
::            without any page reload needed.
:: ══════════════════════════════════════════════════════════════════════════════
echo  [6/6] Starting Next.js frontend (HMR auto-reload on file changes)...
start "COOS - Frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"
echo  [OK]  Frontend starting (Turbopack compiling -- takes ~15s)...
echo.

:: ══════════════════════════════════════════════════════════════════════════════
::  HEALTH CHECKS -- wait until services actually respond before opening browser
::  (replaces blind sleep -- browser only opens when everything is truly ready)
:: ══════════════════════════════════════════════════════════════════════════════
echo  Waiting for services to be ready...

:: --- FastAPI health check (up to 30s) ---
set /a TRIES=0
:WAIT_BACKEND
set /a TRIES+=1
if !TRIES! gtr 15 (
    echo  [WARN] FastAPI did not respond in 30s -- check the FastAPI window for errors.
    goto WAIT_FRONTEND
)
curl -s --connect-timeout 2 "%HEALTH_URL%" >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 2 /nobreak >nul
    goto WAIT_BACKEND
)
echo  [OK]  FastAPI is ready.

:: --- Next.js health check (up to 60s) ---
:WAIT_FRONTEND
set /a TRIES=0
:WAIT_FRONTEND_LOOP
set /a TRIES+=1
if !TRIES! gtr 30 (
    echo  [WARN] Next.js did not respond in 60s -- check the Frontend window for errors.
    goto OPEN_BROWSER
)
curl -s --connect-timeout 2 "%FRONTEND_URL%" >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 2 /nobreak >nul
    goto WAIT_FRONTEND_LOOP
)
echo  [OK]  Next.js is ready.

:: ══════════════════════════════════════════════════════════════════════════════
::  OPEN BROWSER — dedicated profile + no-cache
::
::  WHY --user-data-dir is required:
::  Chrome only reads launch flags (--disable-cache etc.) when starting a fresh
::  process. If Chrome is already open, any "chrome.exe --new-window" call just
::  sends a message to the existing process, which ignores the new flags entirely.
::  Using a separate --user-data-dir forces a brand-new Chrome process every time,
::  so --disable-cache is always respected regardless of other Chrome windows.
::
::  The profile lives at storage\browser-profiles\coos (gitignored).
:: ══════════════════════════════════════════════════════════════════════════════
:OPEN_BROWSER
echo  Opening CREATE ORIGINS OS (Chrome, dedicated profile, cache disabled)...

if exist "%CHROME%" (
    start "" "%CHROME%" --user-data-dir="%SJ_PROFILE%" --disable-cache --disk-cache-size=0 --no-first-run --no-default-browser-check "%FRONTEND_URL%"
    echo  [OK]  Chrome opened with dedicated COOS profile.
) else if exist "%EDGE%" (
    start "" "%EDGE%" --user-data-dir="%SJ_PROFILE%" --disable-cache --disk-cache-size=0 --no-first-run --no-default-browser-check "%FRONTEND_URL%"
    echo  [OK]  Edge opened (Chrome not found).
) else (
    start "" "%FRONTEND_URL%"
    echo  [WARN] No browser found -- opened default browser.
)

:: ══════════════════════════════════════════════════════════════════════════════
::  DONE
:: ══════════════════════════════════════════════════════════════════════════════
echo.
echo  =====================================================
echo   CREATE ORIGINS OS is RUNNING
echo.
echo   Frontend   %FRONTEND_URL%
echo   FastAPI    %BACKEND_URL%
echo   MinIO UI   %MINIO_URL%
echo.
echo   HOT RELOAD ACTIVE:
echo   - Edit any .tsx/.ts/.css  -> browser updates live
echo   - Edit any .py file       -> backend restarts in 1s
echo.
echo   DO NOT run start.bat again unless:
echo   - A service window crashes
echo   - You install new packages (npm/pip)
echo   - You change an env file (see backend\docs\ENV.md)
echo  =====================================================
echo.
pause >nul
