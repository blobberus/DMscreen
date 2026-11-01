@echo off
setlocal
cd /d "%~dp0"
title DM Screen: add sounds
rem Adds the sounds in "Sounds to Add" on the Desktop to the DM screen: each playlist folder in it goes
rem to the same folder of the private sounds repo (the DMscreen-sounds clone beside this one), made
rem small enough where needed, and what was added moves to its Added folder. See tools\add_sounds.py.
rem "add_sounds.bat --dry-run" only shows what it would do.

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

rem ffmpeg comes with imageio-ffmpeg. Asking Python whether it's there needs no marker file (start.bat's
rem .deps-ok), which this window can't always write inside Documents.
".venv\Scripts\python.exe" -c "import imageio_ffmpeg" 2>nul || (
  echo Installing the parts it needs...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt || (
    echo Installing failed. Check the internet connection and run this again.
    pause
    exit /b 1
  )
)

where git >nul 2>nul || (
  echo Git is needed for this: https://git-scm.com/download/win
  pause
  exit /b 1
)

".venv\Scripts\python.exe" tools\add_sounds.py %*
set CODE=%errorlevel%
echo.
pause
exit /b %CODE%
