@echo off
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
