@echo off
setlocal
cd /d "%~dp0"
title DM Screen sync
rem Bring this copy up to date with GitHub: sounds added, renamed or moved on the website, setup saves,
rem and new versions of the screen. Your own new files are left alone. start.bat does this quietly too.

where git >nul 2>nul || (
  echo Git is needed for this: https://git-scm.com/download/win
  pause
  exit /b 1
)
echo Checking GitHub for changes...
git fetch --quiet origin || (
  echo Could not reach GitHub. Check the internet connection and run this again.
  pause
  exit /b 1
)
git merge --ff-only --quiet origin/main || (
  echo.
  echo This copy has changes of its own that clash with GitHub's, so nothing was changed.
  echo Ask Claude in this folder to sort it out (see ADDING_SOUNDS.md^).
  pause
  exit /b 1
)
for /f %%c in ('git rev-parse --short HEAD') do set HEAD=%%c
echo Up to date with GitHub (%HEAD%).
rem The sounds are in the private repo DMscreen-sounds: its copy beside this one comes up to date too.
if exist "..\DMscreen-sounds\.git" (
  git -C "..\DMscreen-sounds" pull --ff-only --quiet && echo The sounds copy ^(DMscreen-sounds^) is up to date too. || echo The sounds copy ^(DMscreen-sounds^) could not be brought up to date: ask Claude to look at it.
)
if /i not "%~1"=="--quiet" pause
