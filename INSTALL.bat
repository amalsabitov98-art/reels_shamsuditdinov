@echo off
setlocal
title Reels Studio - Setup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
set "REELS_EXIT=%ERRORLEVEL%"
echo.
if errorlevel 1 echo Setup failed. Send a screenshot of the error above.
if not errorlevel 1 echo Setup finished. You can now run START.bat.
pause
exit /b %REELS_EXIT%
