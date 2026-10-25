@echo off
REM ---------------------------------------------------------------------------
REM  EndoReport - Windows installer builder
REM  Run this on a Windows machine that has Node.js 20 or newer installed.
REM  The finished installer appears in the "release" folder.
REM ---------------------------------------------------------------------------
setlocal

echo.
echo ============================================
echo   Building EndoReport for Windows
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo         Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo Node.js %NODEVER% detected.
echo.

if not exist node_modules (
  echo Installing dependencies for the first time. This can take a few minutes...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Running the offline self-test...
call npm test
if errorlevel 1 (
  echo.
  echo [WARNING] The self-test reported a problem. The installer will still be built,
  echo           but please review the output above.
  echo.
)

echo.
echo Building the renderer...
call npm run build
if errorlevel 1 (
  echo [ERROR] The renderer build failed.
  pause
  exit /b 1
)

echo.
echo Packaging the Windows installer...
call npx electron-builder --win --x64
if errorlevel 1 (
  echo [ERROR] Packaging failed.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Done. Look inside the "release" folder for
echo   EndoReport-Setup-*.exe
echo ============================================
echo.
start "" "%~dp0release"
pause
