# -*- coding: utf-8 -*-
"""Écrit les fichiers .bat de l'agent d'usine.

Deux règles, vérifiées par les tests, parce que les enfreindre donne un fichier
qui « s'ouvre et se referme » sans explication sous Windows :
  * fins de ligne Windows (CR+LF) — un .bat aux fins de ligne Linux peut sauter
    des étiquettes « :nom » et s'arrêter n'importe où ;
  * texte en ASCII pur — un accent dans un .bat s'affiche en hiéroglyphes et
    peut casser une commande.
"""
import os

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = os.path.join(RACINE, "agent_usine")

PYTHON = r"""@echo off
rem ------------------------------------------------------------------
rem  Cherche un Python utilisable et le range dans la variable PYEXE.
rem  S'il n'y en a pas, telecharge un Python "portable" dans le dossier
rem  python\ a cote de ce fichier : rien n'est installe dans Windows,
rem  aucun droit administrateur n'est necessaire.
rem ------------------------------------------------------------------
set PYEXE=

if exist "%~dp0python\python.exe" set PYEXE="%~dp0python\python.exe"
if defined PYEXE goto :eof

py -3 -c "import sys;sys.exit(0 if sys.version_info>=(3,6) else 1)" >nul 2>nul
if not errorlevel 1 set PYEXE=py -3
if defined PYEXE goto :eof

python -c "import sys;sys.exit(0 if sys.version_info>=(3,6) else 1)" >nul 2>nul
if not errorlevel 1 set PYEXE=python
if defined PYEXE goto :eof

echo.
echo  Python n'est pas installe sur ce PC.
echo  Telechargement d'un Python portable (environ 10 Mo, une seule fois)...
echo  Rien n'est installe dans Windows : il est simplement range dans ce dossier.
echo.
set PYVER=3.11.9
set PYARCH=amd64
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set PYARCH=win32
ver | findstr /r /c:" 6\.[0-3]\." >nul
if not errorlevel 1 set PYVER=3.8.10
set "PYURL=https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-embed-%PYARCH%.zip"
set "PYZIP=%TEMP%\pilotrh_python.zip"
set "PYDEST=%~dp0python"
echo [%date% %time%] Telechargement de %PYURL% >> "%~dp0journal_agent.txt"
if exist "%PYZIP%" del "%PYZIP%" >nul 2>nul

curl.exe -L -s -f -o "%PYZIP%" "%PYURL%" >nul 2>nul
if exist "%PYZIP%" goto :dezipper
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile($env:PYURL,$env:PYZIP)" >nul 2>nul
if exist "%PYZIP%" goto :dezipper
echo  [ECHEC] Le telechargement n'a pas abouti.
echo [%date% %time%] ECHEC du telechargement de Python >> "%~dp0journal_agent.txt"
goto :eof

:dezipper
if not exist "%PYDEST%" mkdir "%PYDEST%"
tar -xf "%PYZIP%" -C "%PYDEST%" >nul 2>nul
if exist "%PYDEST%\python.exe" goto :pret
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=New-Object -ComObject Shell.Application; $s.NameSpace($env:PYDEST).CopyHere($s.NameSpace($env:PYZIP).Items(),16)" >nul 2>nul
if exist "%PYDEST%\python.exe" goto :pret
echo  [ECHEC] Le fichier telecharge n'a pas pu etre decompresse.
echo [%date% %time%] ECHEC de la decompression de Python >> "%~dp0journal_agent.txt"
goto :eof

:pret
set PYEXE="%PYDEST%\python.exe"
echo  Python portable pret.
echo [%date% %time%] Python portable %PYVER% %PYARCH% installe dans python\ >> "%~dp0journal_agent.txt"
goto :eof
"""

ENTETE = r"""@echo off
setlocal
title PilotRH - {titre}
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
"""

FIN = r"""
:fin
echo.
echo  Appuyez sur une touche pour fermer cette fenetre.
pause >nul
endlocal
"""

DEMARRER = ENTETE.format(titre="Agent de la pointeuse") + r"""echo.
echo  PilotRH - agent de la pointeuse
echo  Laissez cette fenetre ouverte (vous pouvez la reduire).
echo  Tout est note dans le fichier journal_agent.txt de ce dossier.
echo.
:boucle
%PYEXE% "%~dp0pilotrh_agent.py" %*
set CODE=%ERRORLEVEL%
if "%CODE%"=="0" goto :fin
if "%CODE%"=="2" goto :fin
echo.
echo  L'agent s'est arrete (code %CODE%). Nouvel essai dans une minute...
echo [%date% %time%] Agent arrete avec le code %CODE%, relance >> "%~dp0journal_agent.txt"
ping -n 61 127.0.0.1 >nul
goto :boucle
""" + FIN

DIAGNOSTIC = ENTETE.format(titre="Diagnostic de la pointeuse") + r"""%PYEXE% "%~dp0pilotrh_agent.py" --diagnostic
""" + FIN

AUTO = r"""@echo off
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
""" + FIN

STOP = r"""@echo off
setlocal
title PilotRH - Annuler le demarrage automatique
set "CIBLE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PilotRH_Agent.bat"
if exist "%CIBLE%" del "%CIBLE%"
echo.
echo  Le demarrage automatique de l'agent est annule.
echo  (L'agent deja lance continue jusqu'a ce que vous fermiez sa fenetre.)
""" + FIN

FICHIERS = {
    "_python.bat": PYTHON,
    "DEMARRER.bat": DEMARRER,
    "DIAGNOSTIC.bat": DIAGNOSTIC,
    "DEMARRAGE_AUTOMATIQUE.bat": AUTO,
    "ARRETER_DEMARRAGE_AUTOMATIQUE.bat": STOP,
}


def ecrire(chemin, texte):
    texte.encode("ascii")                       # lève une erreur au moindre accent
    brut = texte.replace("\r\n", "\n").replace("\n", "\r\n").encode("ascii")
    with open(chemin, "wb") as f:
        f.write(brut)


def convertir(chemin):
    """Passe un .bat existant en fins de ligne Windows, sans toucher au reste."""
    with open(chemin, "rb") as f:
        brut = f.read()
    with open(chemin, "wb") as f:
        f.write(brut.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))


if __name__ == "__main__":
    os.makedirs(AGENT, exist_ok=True)
    for nom, texte in FICHIERS.items():
        ecrire(os.path.join(AGENT, nom), texte)
        print("écrit   agent_usine/%s" % nom)
    for nom in sorted(os.listdir(RACINE)):
        if nom.lower().endswith(".bat"):
            convertir(os.path.join(RACINE, nom))
            print("CR+LF   %s" % nom)
