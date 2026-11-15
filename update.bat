@echo off
rem Update this SpellDirector checkout to the latest main.
rem Usage: double-click, or run "update.bat" from a terminal.
rem Safe: it never discards your work. If you have uncommitted changes it stops and tells you.
setlocal

rem Windows reads a .bat file while it runs, so updating this file mid-run could break it.
rem Run from a temporary copy instead, pointed back at this folder.
if not "%~1"=="--from-copy" (
    copy /y "%~f0" "%TEMP%\spelldirector-update.bat" >nul
    call "%TEMP%\spelldirector-update.bat" --from-copy "%~dp0."
    exit /b
)
cd /d "%~2"

where git >nul 2>nul
if errorlevel 1 (
    echo Git was not found. Install it from https://git-scm.com/download/win and try again.
    goto :fail
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
    echo This folder is not a git checkout, so there is nothing to update.
    goto :fail
)

rem Stop if tracked files have uncommitted changes. Untracked files are left alone.
git diff --quiet
if errorlevel 1 goto :dirty
git diff --cached --quiet
if errorlevel 1 goto :dirty

set "OLDREQ="
for /f %%h in ('git rev-parse HEAD:requirements-dev.txt 2^>nul') do set "OLDREQ=%%h"

echo Fetching from GitHub...
git fetch --prune origin
if errorlevel 1 (
    echo Could not reach GitHub. Check your internet connection or sign-in and try again.
    goto :fail
)

for /f "delims=" %%b in ('git branch --show-current') do set "BRANCH=%%b"
if not "%BRANCH%"=="main" (
    echo Switching from "%BRANCH%" to main...
    git switch main
    if errorlevel 1 (
        echo Could not switch to main. See the message above.
        goto :fail
    )
)

echo Updating main...
git pull --ff-only origin main
if errorlevel 1 (
    echo.
    echo Your local main has commits that are not on GitHub, so it can't be fast-forwarded.
    echo Nothing was changed. Ask Claude to help sort it out.
    goto :fail
)

rem List local branches whose GitHub branch was deleted (usually merged). They are kept.
set "GONE="
for /f "tokens=1,2" %%a in ('git for-each-ref --format^="%%(refname:short) %%(upstream:track)" refs/heads') do (
    if "%%b"=="[gone]" (
        if not defined GONE echo.& echo These local branches were deleted on GitHub. Remove one with "git branch -D name" when you are done with it:
        set "GONE=1"
        echo   %%a
    )
)

set "NEWREQ="
for /f %%h in ('git rev-parse HEAD:requirements-dev.txt 2^>nul') do set "NEWREQ=%%h"
if not "%OLDREQ%"=="%NEWREQ%" call :deps

echo.
for /f "delims=" %%v in (VERSION) do echo Up to date: SpellDirector %%v on main.
git log -1 --format="Latest change: %%s (%%cr)"
goto :done

:deps
echo.
echo Python packages changed. Updating them...
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
    for /d %%d in ("%ProgramFiles%\Blender Foundation\Blender *") do (
        for /d %%v in ("%%d\*") do if exist "%%v\python\bin\python.exe" set "PY="%%v\python\bin\python.exe""
    )
)
if not defined PY (
    echo Python was not found, so packages were not updated. The viewer still works.
    exit /b 0
)
%PY% -m pip install -r requirements-dev.txt
if errorlevel 1 echo Packages could not be updated. The viewer still works; the breakdown tool and tests may need them.
exit /b 0

:dirty
echo.
echo You have uncommitted changes, so nothing was updated:
git status --short --untracked-files=no
echo.
echo Commit or stash them (or ask Claude), then run update.bat again.
goto :fail

:fail
echo.
echo Update did not finish.

:done
pause
