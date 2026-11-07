# One-time setup: checks prerequisites, installs Electron, builds the audio service, runs the tests.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Missing: $cmd. $hint" -ForegroundColor Red; exit 1 }
}
Need dotnet 'Install the .NET 10 SDK: winget install Microsoft.DotNet.SDK.10'
Need node   'Install Node.js 22 LTS or newer: winget install OpenJS.NodeJS.LTS'

$sdks = (dotnet --list-sdks) -join "`n"
if ($sdks -notmatch '(?m)^10\.') { Write-Host ".NET 10 SDK not found. Installed SDKs:`n$sdks`nRun: winget install Microsoft.DotNet.SDK.10" -ForegroundColor Red; exit 1 }
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { Write-Host "Node.js 22+ required (found $(node --version))." -ForegroundColor Red; exit 1 }

Write-Host "Installing Electron ..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'apps\desktop-electron')
try {
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
    Write-Host 'Electron binary missing; running its installer explicitly ...' -ForegroundColor Yellow
    node node_modules\electron\install.js
  }
} finally { Pop-Location }

& (Join-Path $PSScriptRoot 'build-service.ps1')
& (Join-Path $PSScriptRoot 'test.ps1')
Write-Host "`nSetup complete. Start the app with: scripts\start.ps1" -ForegroundColor Green
