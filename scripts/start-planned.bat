@echo off
REM Launches Planned: backend (FastAPI) + frontend (Vite) in their own
REM windows, then opens the app in the default browser.
REM Close either window (or Ctrl+C inside it) to stop that server.

set ROOT=%~dp0..

REM Free up the ports first in case a previous run's process is still
REM hanging around (e.g. window closed without stopping the server).
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1

REM No --reload here: daily use, not development. It also keeps this a
REM single process, which the in-app "Quit app" button relies on to kill
REM the backend cleanly by its listening port.
start "Planned - Backend" cmd /k "cd /d "%ROOT%\backend" && .venv\Scripts\python.exe -m uvicorn planned.main:app --port 8000"
start "Planned - Frontend" cmd /k "cd /d "%ROOT%\frontend" && npm run dev -- --port 5173 --strictPort"

timeout /t 4 /nobreak >nul
start http://localhost:5173
