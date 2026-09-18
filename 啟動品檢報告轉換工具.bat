@echo off
setlocal
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0local-inspection-report-server.ps1"
if not "%ERRORLEVEL%"=="0" pause
exit /b %ERRORLEVEL%
