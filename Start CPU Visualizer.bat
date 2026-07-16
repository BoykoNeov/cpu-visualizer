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
echo   When it says "Local: http://localhost:5173", the app is ready.
echo.

REM Open the browser shortly after the server has had time to boot.
REM (Vite's default port is 5173.)
start "" cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:5173"

REM Hand the window over to the dev server (stays running until you close it).
call npm run dev

echo.
echo   Dev server stopped.
pause
