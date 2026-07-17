@echo off
REM ============================================================
REM  CPU Visualizer - double-click launcher
REM  Starts the Vite dev server and opens it in your browser.
REM  Close this window (or press Ctrl+C) to stop the server.
REM ============================================================

REM Run from the folder this script lives in, regardless of CWD.
cd /d "%~dp0"

title CPU Visualizer

echo.
echo   CPU Visualizer
echo   ==============
echo.

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
