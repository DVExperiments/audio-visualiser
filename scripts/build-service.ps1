# Builds the native audio service (AudioCapture.exe) into apps\desktop-electron\service-bin.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rid = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
$out = Join-Path $root 'apps\desktop-electron\service-bin'

Write-Host "Building audio service for $rid ..." -ForegroundColor Cyan
dotnet publish (Join-Path $root 'services\audio-capture-dotnet\AudioCapture.csproj') `
  -c Release -r $rid --self-contained false -p:PublishSingleFile=false -o $out
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }
Write-Host "Audio service built: $out\AudioCapture.exe" -ForegroundColor Green
