@echo off
setlocal
rem ============================================================
rem  Vault launcher. Double-click this file.
rem ============================================================
cd /d "%~dp0"

set "LOG=%~dp0desktop-launch.log"
echo ==== launch %DATE% %TIME% ==== > "%LOG%"
echo cwd=%CD% >> "%LOG%"

set "NODE="
where node >nul 2>nul
if %errorlevel%==0 set "NODE=node"
if defined NODE goto run
if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if defined NODE goto run
goto nonode

:run
echo node=%NODE% >> "%LOG%"
start "Vault" /min "%NODE%" "%~dp0desktop\launcher.cjs"
exit /b 0

:nonode
echo Node.js not found >> "%LOG%"
echo.
echo   [X] Node.js not found. Please install Node.js first.
echo.
pause
exit /b 1
