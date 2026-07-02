@echo off
chcp 65001 >nul
title PilotRH - Agent pointeuse
REM ================================================================
REM  Pont entre la pointeuse et l'application PilotRH (cloud)
REM  A lancer sur un PC de l'usine, sur le meme reseau que la pointeuse.
REM
REM  PREMIERE FOIS SEULEMENT :
REM   1) Installer Python depuis https://www.python.org  (cocher "Add to PATH")
REM   2) Ouvrir ce dossier, double-clic sur "installer_agent.bat"
REM   3) Ouvrir "pilotrh_agent.py" avec le Bloc-notes et remplir :
REM        URL, ADMIN_PW, POINTEUSE_IP  (ou MDB si methode fichier)
REM ================================================================
cd /d "%~dp0"
python pilotrh_agent.py
echo.
echo (L'agent s'est arrete. Appuyez sur une touche pour fermer.)
pause >nul
