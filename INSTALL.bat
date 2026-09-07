@echo off
chcp 65001 >nul
title Reels Studio - установка
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
echo.
pause
