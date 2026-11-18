@echo off
setlocal
title PilotRH - Annuler le demarrage automatique
set "CIBLE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PilotRH_Agent.bat"
if exist "%CIBLE%" del "%CIBLE%"
echo.
echo  Le demarrage automatique de l'agent est annule.
echo  (L'agent deja lance continue jusqu'a ce que vous fermiez sa fenetre.)

:fin
echo.
echo  Appuyez sur une touche pour fermer cette fenetre.
pause >nul
endlocal
