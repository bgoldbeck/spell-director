@echo off
rem Launch the SpellDirector viewer and open it in your browser.
rem Usage: double-click, or run "run.bat [port]" from a terminal.
setlocal
cd /d "%~dp0"

set "PORTARG="
if not "%~1"=="" set "PORTARG=--port %~1"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 tools\serve.py --open %PORTARG%
    goto :done
)
where python >nul 2>nul
if %errorlevel%==0 (
    python tools\serve.py --open %PORTARG%
    goto :done
)
echo Python 3 was not found. Install it from https://www.python.org/downloads/ and try again.

:done
pause
