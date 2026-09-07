@echo off
setlocal
title Reels Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto node_missing

if not exist "node_modules\express" goto install_missing

node "scripts\helper-server.mjs"
set "REELS_EXIT=%ERRORLEVEL%"
echo.
echo Reels Studio stopped. Error code: %REELS_EXIT%
pause
exit /b %REELS_EXIT%

:node_missing
echo Node.js is not available. Run INSTALL.bat again.
pause
exit /b 1

:install_missing
echo Installation is incomplete. Run INSTALL.bat again.
pause
exit /b 1
