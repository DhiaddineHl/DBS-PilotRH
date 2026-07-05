@echo off
chcp 65001 >nul
title PilotRH - Installation (a lancer une seule fois)
cd /d "%~dp0"
echo ===============================================
echo   Installation de PilotRH sur ce PC
echo ===============================================
echo.
python --version >nul 2>&1
if errorlevel 1 (
  echo   [!] Python n'est pas installe.
  echo.
  echo   1^) Telechargez Python sur : https://www.python.org/downloads/
  echo   2^) IMPORTANT : a l'installation, cochez "Add Python to PATH"
  echo   3^) Relancez ensuite ce fichier "1_Installer.bat"
  echo.
  pause
  exit /b
)
echo Python detecte. Installation des composants (1 a 2 minutes)...
echo.
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
echo.
echo ===============================================
echo   Termine ! Double-cliquez sur "2_Demarrer_PilotRH.bat"
echo ===============================================
pause
