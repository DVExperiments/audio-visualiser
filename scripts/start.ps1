# Starts the app. Logs from the audio service appear in this window.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'apps\desktop-electron')
try { npm start } finally { Pop-Location }
