@echo off
rem Launch the SpellDirector viewer and open it in your browser.
rem Usage: double-click, or run "run.bat [port]" from a terminal.
rem It first pulls updates from GitHub (skipped, with a note, if there is no Git,
rem no network or you have local changes), then closes any SpellDirector that is
rem already running and starts a fresh one, so only one ever runs.
rem Set SPELLDIRECTOR_NO_UPDATE=1 to skip the update.
setlocal
cd /d "%~dp0"

rem Windows reads a .bat file while it runs, and the update may change this file.
rem Everything below is one block, which Windows reads in full before running it.
(
    set "PY="
    where py >nul 2>nul && set "PY=py -3"
    if not defined PY where python >nul 2>nul && set "PY=python"
    if not defined PY (
        echo Python 3 was not found. Install it from https://www.python.org/downloads/ and try again.
    ) else (
        call %%PY%% tools\launch.py %*
    )
    rem 3: a newer launch replaced this viewer, so close this window without waiting.
    if errorlevel 3 if not errorlevel 4 exit /b
    pause
    exit /b
)
