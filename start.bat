@echo off
setlocal
title Wild Card Showdown
cd /d "%~dp0"

rem ---- find Node.js ----
set "NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto havenode
set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE%" goto havenode
set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if exist "%NODE%" goto havenode
echo.
echo  Node.js is not installed (or Windows can't find it yet).
echo  1. Install the LTS version from https://nodejs.org
echo  2. Restart the laptop, then double-click start.bat again.
echo.
pause
exit /b 1

:havenode
rem ---- dependencies are bundled; only install if they're missing ----
if exist "node_modules\ws\package.json" if exist "node_modules\qrcode-generator\package.json" goto run
echo First run: installing the two small helper packages (needs internet once)...
for %%I in ("%NODE%") do set "NODEDIR=%%~dpI"
set "PATH=%NODEDIR%;%PATH%"
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo  Could not install packages. Check the internet connection and try again.
  pause
  exit /b 1
)

:run
set OPEN_BROWSER=1
rem Players needed to start. 2 is handy for testing; change to 3 for real games.
if not defined MIN_PLAYERS set MIN_PLAYERS=2
"%NODE%" server.js
echo.
echo  Wild Card Showdown has stopped.
pause
