$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Has-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-Package([string]$Id, [string]$Title) {
  Write-Host "Устанавливаю $Title..." -ForegroundColor Cyan
  winget install --id $Id --exact --accept-package-agreements --accept-source-agreements
}

if (-not (Has-Command "winget")) {
  throw "Не найден winget. Обновите 'Установщик приложений' в Microsoft Store и повторите."
}
if (-not (Has-Command "node")) { Install-Package "OpenJS.NodeJS.LTS" "Node.js" }
if (-not (Has-Command "python")) { Install-Package "Python.Python.3.12" "Python 3.12" }
if (-not (Has-Command "ffmpeg")) { Install-Package "Gyan.FFmpeg" "FFmpeg" }

$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $Chrome)) { Install-Package "Google.Chrome" "Google Chrome" }

$MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$MachinePath;$UserPath"

if (-not (Has-Command "node") -or -not (Has-Command "python") -or -not (Has-Command "ffmpeg")) {
  Write-Host "Программы установлены. Закройте это окно и запустите INSTALL.bat ещё раз." -ForegroundColor Yellow
  exit 0
}

Write-Host "Устанавливаю локальные зависимости проекта..." -ForegroundColor Cyan
& npm install

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  & python -m venv .venv
}
& ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt

Write-Host ""
Write-Host "Установка завершена. Теперь запускайте START.bat." -ForegroundColor Green
