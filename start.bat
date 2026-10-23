@echo off
setlocal
cd /d "%~dp0"
title DM Screen

if not exist ".venv\Scripts\python.exe" (
  echo Setting up the DM Screen for the first time. This takes a minute...
  where python >nul 2>nul || (
    echo Python 3 is needed. Get it from https://www.python.org/downloads/ and run this again.
    pause
    exit /b 1
  )
  python -m venv .venv || (
    echo Could not create the Python environment.
    pause
    exit /b 1
  )
)

if not exist ".venv\.deps-ok" (
  echo Installing the parts it needs...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt || (
    echo Installing failed. Check the internet connection and run this again.
    pause
    exit /b 1
  )
  echo ok> ".venv\.deps-ok"
)

".venv\Scripts\python.exe" server.py --open %*
pause
