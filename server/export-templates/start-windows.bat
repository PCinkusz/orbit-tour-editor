@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node serve.mjs
  goto :done
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py
  goto :done
)
where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py
  goto :done
)
echo.
echo Could not find Node.js or Python on this computer.
echo Install one of them (nodejs.org or python.org), or upload this folder to a web host.
echo See HOW-TO-PLAY.txt for the hosting option.
echo.
:done
pause
