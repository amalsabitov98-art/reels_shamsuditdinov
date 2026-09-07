# ASCII messages intentionally work in Windows PowerShell 5 without a UTF-8 BOM.
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Has-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Run-Native([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE. Installation is NOT complete." }
}
function Install-Package([string]$Id, [string]$Title) {
  if (-not (Has-Command "winget")) { throw "Install App Installer from Microsoft Store, then run INSTALL.bat again." }
  Write-Host "Installing $Title..."
  Run-Native "winget" @("install", "--id", $Id, "--exact", "--accept-package-agreements", "--accept-source-agreements")
}
if (-not (Has-Command "node")) { Install-Package "OpenJS.NodeJS.LTS" "Node.js" }
if (-not (Has-Command "python")) { Install-Package "Python.Python.3.12" "Python 3.12" }
if (-not (Has-Command "ffmpeg")) { Install-Package "Gyan.FFmpeg" "FFmpeg" }

$ChromePaths = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
if (-not ($ChromePaths | Where-Object { Test-Path $_ })) { Install-Package "Google.Chrome" "Google Chrome" }

$MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$MachinePath;$UserPath"

if (-not (Has-Command "node") -or -not (Has-Command "python") -or -not (Has-Command "ffmpeg")) {
  Write-Host "Close this window and run INSTALL.bat again to refresh installed tools." -ForegroundColor Yellow
  exit 1
}

Write-Host "Installing project dependencies..." -ForegroundColor Cyan
Run-Native "node" @("-e", "if(Number(process.versions.node.split('.')[0])<20)process.exit(1)")
Run-Native "python" @("--version")
Run-Native "npm.cmd" @("ci")

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  Run-Native "python" @("-m", "venv", ".venv")
}
Run-Native ".venv\Scripts\python.exe" @("-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt")

Write-Host ""
Write-Host "Installation completed. Run START.bat." -ForegroundColor Green
