@echo off
setlocal
cd /d "%~dp0"
title DM Screen update
if not exist ".venv\Scripts\python.exe" (
  echo Run start.bat once first.
  pause
  exit /b 1
)
echo Updating the downloader (yt-dlp) and the other parts...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check --upgrade -r requirements.txt
echo ok> ".venv\.deps-ok"
echo Done. Restart the DM Screen if it is running.
pause
