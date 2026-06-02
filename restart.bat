@echo off
title Sir Jazper OS -- Restart
color 0A
cls

echo.
echo  ============================================
echo   SIR JAZPER OS -- Restart
echo  ============================================
echo.

set PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin
set PYTHON=C:\Users\vijay\AppData\Local\Programs\Python\Python311\python.exe

:: ── Kill ALL uvicorn and node dev processes ────────────────────────────────────
echo  [1/4] Killing all existing Jazper processes...

:: Kill all Python processes running uvicorn (covers reload parent + worker + any manual starts)
wmic process where "name='python.exe' and commandline like '%%uvicorn%%'" delete >nul 2>&1
wmic process where "name='python3.exe' and commandline like '%%uvicorn%%'" delete >nul 2>&1

:: Kill any node processes on port 3000 (Next.js dev server)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /f >nul 2>&1
)

:: Also kill by window title for previously-started restart.bat windows
taskkill /fi "WindowTitle eq Sir Jazper - FastAPI" /f >nul 2>&1
taskkill /fi "WindowTitle eq Sir Jazper - Frontend" /f >nul 2>&1

timeout /t 2 /nobreak >nul
echo  [OK]  All processes killed.
echo.

:: ── Docker ─────────────────────────────────────────────────────────────────────
echo  [2/4] Ensuring infrastructure (PostgreSQL, Redis, MinIO)...

docker compose up -d >nul 2>&1
if %errorlevel% neq 0 (
    echo  [WARN] Docker compose failed -- make sure Docker Desktop is running.
) else (
    echo  [OK]  Infrastructure running.
)
echo.

:: ── FastAPI Backend ─────────────────────────────────────────────────────────────
echo  [3/4] Starting FastAPI backend on port 8000...
start "Sir Jazper - FastAPI" cmd /k "cd /d %~dp0backend\python && %PYTHON% -m uvicorn main:app --reload --port 8000"
timeout /t 3 /nobreak >nul
echo  [OK]  FastAPI started.
echo.

:: ── Next.js Frontend ────────────────────────────────────────────────────────────
echo  [4/4] Starting Next.js frontend on port 3000...
start "Sir Jazper - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 2 /nobreak >nul
echo  [OK]  Frontend started.
echo.

:: ── Open browser ────────────────────────────────────────────────────────────────
echo  Waiting for services to be ready...
timeout /t 8 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo  ============================================
echo   Sir Jazper OS is running!
echo.
echo   Frontend  --  http://localhost:3000
echo   FastAPI   --  http://localhost:8000
echo   MinIO UI  --  http://localhost:9001
echo  ============================================
echo.
echo  This window can be closed.
pause >nul
