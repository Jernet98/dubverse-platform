@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo No se encontro Python. Instala Python 3 y marca "Add Python to PATH".
  pause
  exit /b 1
)
python dubverse_uploader.py
if errorlevel 1 pause
