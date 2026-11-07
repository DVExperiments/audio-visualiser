@echo off
rem Builds the Windows installer and portable app by double-click (no typing).
rem Needs Node.js 22+ and the .NET 10 SDK installed; the script says so if either is missing.
title Building Audio Visualisation Studio
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Recurse -File | Unblock-File; & '.\scripts\package.ps1'; exit $LASTEXITCODE"
if errorlevel 1 (
  echo.
  echo The build did not finish. Scroll up for the message in red.
  pause
  exit /b 1
)
echo.
echo Finished. Opening the folder with the installer...
explorer "apps\desktop-electron\dist"
pause
