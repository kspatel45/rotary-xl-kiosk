@echo off
REM Start only the server, then open http://localhost:8090 in any browser
cd /d "%~dp0"
node server.js
pause
