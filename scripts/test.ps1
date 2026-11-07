# Runs every automated test: C# DSP fixtures and JavaScript unit tests.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "DSP fixture tests (C#)" -ForegroundColor Cyan
dotnet run -c Release --project (Join-Path $root 'tests\DspCore.Tests\DspCore.Tests.csproj')
if ($LASTEXITCODE -ne 0) { throw 'DSP tests failed' }

Write-Host "`nApp tests (JavaScript)" -ForegroundColor Cyan
Push-Location (Join-Path $root 'apps\desktop-electron')
if (-not (Test-Path 'node_modules\three')) { Write-Host 'Installing the app''s libraries first ...'; npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm ci failed' } }
try { npm test; if ($LASTEXITCODE -ne 0) { throw 'JavaScript tests failed' } } finally { Pop-Location }
Write-Host "`nAll tests passed." -ForegroundColor Green
