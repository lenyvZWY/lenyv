@echo off
rem ============================================================
rem  保险库 · 桌面版启动器
rem  双击这个文件，就会弹出保险库的独立窗口（没有地址栏、没有标签页）。
rem  关掉那个窗口，程序自己就退出了。
rem ============================================================
cd /d "%~dp0"

set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"

if not defined NODE (
  echo.
  echo   [X] 没找到 Node.js，装一个 Node.js 之后再来双击这个文件。
  echo.
  pause
  exit /b 1
)

"%NODE%" desktop\launcher.cjs
if errorlevel 1 pause
