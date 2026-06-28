@echo off
cd /d "%~dp0"
echo Mo cong cu PDF
echo Khong dong cua so nay.
echo.
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-cutting-server.ps1"
echo.
echo Cong cu PDF da dung.
pause
