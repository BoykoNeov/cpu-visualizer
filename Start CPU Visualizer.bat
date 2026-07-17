@echo off
REM ============================================================
REM  CPU Visualizer - double-click launcher
REM  Opens the app. Reuses a CPU Visualizer dev server if one is
REM  already running; otherwise starts one.
REM  Close this window (or press Ctrl+C) to stop a server that
REM  this window started.
REM ============================================================

REM Run from the folder this script lives in, regardless of CWD.
cd /d "%~dp0"

title CPU Visualizer

echo.
echo   CPU Visualizer
echo   ==============
echo.

REM --- Reuse a server that is already serving THIS project ----------------------------
REM
REM This used to start ANOTHER server on every double-click, and never stop the old one:
REM vite treats 5173 as its preferred port, not a reserved one, so when the port is busy
REM it does not fail - it quietly climbs to 5174, 5175, ... Sixteen servers stacked
REM across 5173-5190 is an observed outcome, each holding a live render loop open in any
REM tab still pointed at it.
REM
REM The detector identifies the server by what it SERVES (it fetches each candidate port
REM and matches the app's <title>), NOT by which port is busy - "is something on 5173?"
REM is the same bug in a different costume, since another vite project is very often the
REM thing sitting there and reusing it would open the wrong app. See the header of
REM tools\find-dev-server.mjs.
REM
REM It deliberately runs BEFORE the node_modules check below: it imports nothing, so it
REM works even on a machine where nothing is installed yet.
REM
REM Batch quirks, all load-bearing: `set "VAR="` first so a stale value cannot leak in
REM from the environment; `usebackq delims=` captures the output line whole; the redirect
REM must be escaped as `2^>nul` inside the backticks. The detector prints the URL and
REM nothing else, so DEV_URL ends up holding a URL or nothing.
set "DEV_URL="
for /f "usebackq delims=" %%u in (`node "tools\find-dev-server.mjs" 2^>nul`) do set "DEV_URL=%%u"

if defined DEV_URL (
    echo   A CPU Visualizer server is already running - reusing it.
    echo   Opening %DEV_URL%
    echo.
    echo   This is safe, not a stale snapshot: vite reads your code from disk on every
    echo   request, so even a server left running for days serves the code as it is now.
    echo   The one exception is vite.config.ts - a change there needs a fresh server, so
    echo   close the other CPU Visualizer window and double-click this one again.
    echo.
    REM `start` needs the empty "" title argument, or it reads the URL as a window title.
    start "" "%DEV_URL%"
    REM Nothing to babysit on this path - there is no server of ours to keep alive - so the
    REM window would otherwise vanish the instant it is double-clicked and the note above
    REM would never be readable. Hold it open briefly, then close on our own. `timeout` wants
    REM a real console: if this was piped or redirected it fails harmlessly and we just exit.
    timeout /t 8 /nobreak >nul 2>&1
    exit /b 0
)

REM First run? Install dependencies.
if not exist "node_modules" (
    echo   Installing dependencies ^(first run, this can take a minute^)...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo   Dependency install failed. See the messages above.
        pause
        exit /b 1
    )
)

echo   Starting the dev server...
echo   Your browser will open by itself once the server is ready.
echo.

REM Hand the window over to the dev server (stays running until you close it).
REM
REM `npm start` passes --open, so VITE opens the browser, on the URL it actually bound. Do not
REM hardcode a port here: 5173 is Vite's PREFERRED port, not a promise. If anything else already
REM holds it (another copy of this app, or an unrelated dev server), Vite quietly moves to the next
REM free one — 5174, 5175, ... — and a hardcoded 5173 then sends the user to whatever OTHER program
REM owns that port, or to a blank page. Only the server knows where it landed, so only the server
REM should open the browser. This also drops the old "wait 4 seconds and hope" timer: --open fires
REM when the server is actually listening, not when a guess expires.
call npm start

echo.
echo   Dev server stopped.
pause
