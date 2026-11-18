@echo off
setlocal
title PilotRH - Demarrage automatique
cd /d "%~dp0"
set "DEMARRAGE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%DEMARRAGE%" goto :ok
echo  Dossier de demarrage de Windows introuvable :
echo  %DEMARRAGE%
goto :fin
:ok
> "%DEMARRAGE%\PilotRH_Agent.bat" echo @echo off
>> "%DEMARRAGE%\PilotRH_Agent.bat" echo start "PilotRH Agent" /min "%~dp0DEMARRER.bat"
if exist "%DEMARRAGE%\PilotRH_Agent.bat" goto :fait
echo  [ECHEC] Impossible d'ecrire dans le dossier de demarrage.
goto :fin
:fait
echo.
echo  C'est fait : l'agent se lancera tout seul, fenetre reduite,
echo  a chaque ouverture de session Windows sur ce PC.
echo.
echo  IMPORTANT : ne deplacez plus ce dossier. Si vous le deplacez,
echo  relancez ce fichier depuis le nouvel emplacement.
echo.
echo  Pour annuler : double-clic sur ARRETER_DEMARRAGE_AUTOMATIQUE.bat

:fin
echo.
echo  Appuyez sur une touche pour fermer cette fenetre.
pause >nul
endlocal
