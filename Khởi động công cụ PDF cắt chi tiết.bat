@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-piece-cutting-launcher.ps1" -Register
set "PIECE_CUTTING_EXIT_CODE=%ERRORLEVEL%"

if not "%PIECE_CUTTING_EXIT_CODE%"=="0" (
  echo.
  pause
)

exit /b %PIECE_CUTTING_EXIT_CODE%
