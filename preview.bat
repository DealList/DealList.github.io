@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo   DealList Local Preview
echo ========================================
echo.
echo URL: http://127.0.0.1:8765/
echo Press Ctrl+C to stop the server.
echo.

start "" http://127.0.0.1:8765/

py -3 -m http.server 8765 --bind 127.0.0.1

pause
