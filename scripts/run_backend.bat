@echo off
:: Runs the Jazper backend and restarts it automatically if it ever exits or crashes (Ctrl+C twice / close the window to stop).
:: Uses run_server.py (explicit event loop, no auto-reloader: the reloader hung repeatedly on Windows). Restart by closing this
:: window and running start.bat again after editing backend code.
title COOS - FastAPI
set ROOT=%~dp0..\
set PYTHON=%ROOT%backend\.venv\Scripts\python.exe
if not exist "%PYTHON%" set PYTHON=C:\Users\vijay\AppData\Local\Programs\Python\Python311\python.exe
cd /d "%ROOT%backend\python"
:loop
echo [%date% %time%] starting backend on :8000
"%PYTHON%" run_server.py --port 8000
echo [%date% %time%] backend stopped (exit %errorlevel%) - restarting in 3 s
timeout /t 3 /nobreak >nul
goto loop
