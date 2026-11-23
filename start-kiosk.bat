@echo off
REM Rotary XL Kiosk - start the server and open the browser full screen (exit with Alt+F4)
cd /d "%~dp0"
set PORT=8090
set URL=http://localhost:%PORT%

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 (
  start "Rotary Kiosk Server" /min cmd /c "node server.js"
  timeout /t 2 /nobreak >nul
)

set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if not exist "%EDGE%" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
set PROFILE=%~dp0.kiosk-profile
set FLAGS=--kiosk --app=%URL% --user-data-dir="%PROFILE%" --no-first-run --disable-pinch --overscroll-history-navigation=0 --disable-features=TranslateUI

if exist "%CHROME%" (
  start "" "%CHROME%" %FLAGS%
) else if exist "%EDGE%" (
  start "" "%EDGE%" %FLAGS% --edge-kiosk-type=fullscreen
) else (
  start "" %URL%
)
