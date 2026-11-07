# Builds the release packages: a Windows installer (NSIS) and a portable .exe, with the audio service
# bundled as a self-contained single file (users do not need .NET installed).
#   .\scripts\package.ps1              tests, service, installer + portable
#   .\scripts\package.ps1 -SkipTests   (not for releases)
# Code signing: set CSC_LINK (path or base64 of a .pfx) and CSC_KEY_PASSWORD first; see docs/RELEASE.md.
param([switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'apps\desktop-electron'
$svc = Join-Path $app 'service-bin'

# friendly checks first: the two tools the build needs
foreach ($tool in @(@{ cmd = 'node'; name = 'Node.js 22 or newer'; url = 'https://nodejs.org (the LTS version)' }, @{ cmd = 'dotnet'; name = '.NET 10 SDK'; url = 'https://dot.net' })) {
  if (-not (Get-Command $tool.cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: $($tool.name). Install it from $($tool.url), then run this again." -ForegroundColor Red
    exit 1
  }
}

# the app's libraries (three.js, KaTeX, Electron, electron-builder) must be installed BEFORE the tests:
# a fresh copy of the project has no node_modules (v0.20.1 ran the tests first, so they could not find them)
Write-Host 'Installing the app''s libraries ...' -ForegroundColor Cyan
Push-Location $app; npm ci --no-audit --no-fund; $ok = $LASTEXITCODE -eq 0; Pop-Location
if (-not $ok) { throw 'npm ci failed (is this computer online?)' }

if (-not $SkipTests) {
  Write-Host 'Running tests ...' -ForegroundColor Cyan
  Push-Location (Join-Path $root 'tests\DspCore.Tests'); dotnet run -c Release; if ($LASTEXITCODE -ne 0) { throw 'C# tests failed' }; Pop-Location
  Push-Location $app; npm test; if ($LASTEXITCODE -ne 0) { throw 'JavaScript tests failed' }; Pop-Location
}

Write-Host 'Publishing the audio service (self-contained, single file, win-x64) ...' -ForegroundColor Cyan
if (Test-Path $svc) { Remove-Item $svc -Recurse -Force }
dotnet publish (Join-Path $root 'services\audio-capture-dotnet\AudioCapture.csproj') `
  -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:DebugType=none -o $svc
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }
if (-not (Test-Path (Join-Path $svc 'AudioCapture.exe'))) { throw 'AudioCapture.exe missing after publish' }

Write-Host 'Building installer and portable app ...' -ForegroundColor Cyan
Push-Location $app
if (-not $env:CSC_LINK) { Write-Host 'CSC_LINK not set: the packages will be UNSIGNED (Windows SmartScreen will warn on first run).' -ForegroundColor Yellow }
npx electron-builder --win nsis portable --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed ($LASTEXITCODE)" }
# every file the app loads must be inside the package (v0.20.2 shipped without three.js's add-ons)
Write-Host 'Checking the package contains everything the app loads ...' -ForegroundColor Cyan
node tools/verify-package.mjs (Join-Path $app 'dist\win-unpacked\resources\app.asar')
if ($LASTEXITCODE -ne 0) { throw 'The package is missing files the app needs (see above)' }
Pop-Location

Write-Host "Done. Packages are in $app\dist :" -ForegroundColor Green
Get-ChildItem (Join-Path $app 'dist') -Filter *.exe | ForEach-Object { Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
Write-Host 'Note: the dev service in service-bin was replaced by the self-contained build; run scripts\build-service.ps1 to go back.'
