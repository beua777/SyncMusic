@echo off
rem SyncMusic launcher: installs packages on first run, starts the background server, opens the app window.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing packages...
  call npm install --no-fund --no-audit
)
node launch.js %*
