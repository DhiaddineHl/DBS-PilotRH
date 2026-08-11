@echo off
chcp 65001 >nul
title PilotRH - Application (laisser cette fenetre ouverte)
cd /d "%~dp0"
REM PILOTRH_OPEN=1 desactive TOUTE authentification. C'est acceptable ici parce
REM que le serveur ecoute exclusivement sur 127.0.0.1 (voir la derniere ligne).
REM Si vous remplacez 127.0.0.1 par 0.0.0.0 pour y acceder depuis un autre poste,
REM RETIREZ cette ligne et definissez PILOTRH_ADMIN_PASSWORD : sinon toute
REM machine du reseau de l'usine obtient l'administration complete.
set PILOTRH_OPEN=1
set TZ=Africa/Tunis

REM --- verifier que Python et les composants sont installes ---
python -c "import uvicorn" 1>nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Les composants ne sont pas installes ^(ou Python manque^).
  echo       Lancez d'abord "1_Installer.bat", puis relancez ce fichier.
  echo.
  pause
  exit /b
)

echo ===============================================
echo   PilotRH demarre...
echo   IMPORTANT : le PREMIER lancement prend ~20 secondes
echo   (preparation de la base). Ne fermez pas cette fenetre.
echo   Le navigateur s'ouvrira TOUT SEUL quand ce sera pret.
echo ===============================================
echo.

REM --- ouvre le navigateur des que le serveur repond (attend jusqu'a 90 s) ---
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest 'http://localhost:8000' -UseBasicParsing -TimeoutSec 2 ^| Out-Null; Start-Process 'http://localhost:8000'; break}catch{Start-Sleep -Seconds 1}}"

python -m uvicorn app:app --host 127.0.0.1 --port 8000
echo.
echo (PilotRH est arrete. Vous pouvez fermer cette fenetre.)
pause
