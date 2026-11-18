@echo off
setlocal
title PilotRH - Diagnostic de la pointeuse
cd /d "%~dp0"
if exist "%~dp0pilotrh_agent.py" goto :dossier_ok
echo.
echo  Le fichier pilotrh_agent.py est introuvable a cote de ce fichier.
echo.
echo  Cause habituelle : ce fichier a ete lance DEPUIS L'ARCHIVE ZIP.
echo  Fermez cette fenetre, faites un clic droit sur le fichier ZIP,
echo  choisissez "Extraire tout...", puis relancez depuis le dossier extrait.
goto :fin
:dossier_ok
call "%~dp0_python.bat"
if defined PYEXE goto :python_ok
echo.
echo  Impossible de trouver ou de telecharger Python sur ce PC.
echo.
echo  Que faire :
echo    1. Verifiez qu'Internet fonctionne sur ce PC, puis relancez ce fichier.
echo    2. Sinon, installez Python a la main : https://www.python.org/downloads/
echo       et COCHEZ la case "Add python.exe to PATH" sur le premier ecran.
echo       Puis relancez ce fichier.
goto :fin
:python_ok
%PYEXE% "%~dp0pilotrh_agent.py" --diagnostic

:fin
echo.
echo  Appuyez sur une touche pour fermer cette fenetre.
pause >nul
endlocal
