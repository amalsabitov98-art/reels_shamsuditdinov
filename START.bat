@echo off
chcp 65001 >nul
title Reels Studio
cd /d "%~dp0"
if not exist "node_modules" (
  echo Сначала запустите INSTALL.bat
  pause
  exit /b 1
)
node scripts\helper-server.mjs
pause
