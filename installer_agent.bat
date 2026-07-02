@echo off
chcp 65001 >nul
title PilotRH - Installation des modules
cd /d "%~dp0"
echo Installation des modules necessaires...
python -m pip install --upgrade pip
python -m pip install pyzk requests
echo.
echo Termine. Vous pouvez maintenant lancer "lancer_agent_pointeuse.bat".
pause >nul
