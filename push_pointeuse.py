#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
push_pointeuse.py — connecteur usine → cloud
============================================
À lancer sur un PC de l'usine qui voit la pointeuse (le fichier .mdb).
Il envoie automatiquement le .mdb au serveur PilotRH (sur Railway) dès qu'il
change, pour que l'espace salarié et l'administration soient toujours à jour.

PRÉREQUIS :  pip install requests

CONFIGURATION : par variables d'environnement OU en éditant les valeurs ci-dessous.
  PILOTRH_URL              = https://pilotrh.up.railway.app
  PILOTRH_MDB              = C:\\ZKTeco\\attBackup.mdb   (ou \\\\PC-POINTEUSE\\ZKTeco\\attBackup.mdb)
  PILOTRH_ADMIN_PASSWORD   = le mot de passe admin du serveur (si défini)
  PILOTRH_INTERVAL_MIN     = 30   (intervalle de vérification en minutes)

UTILISATION :
  python push_pointeuse.py            -> tourne en continu (surveille le fichier)
  python push_pointeuse.py --once     -> envoie une fois puis s'arrête

Sur Windows, vous pouvez le lancer au démarrage via le Planificateur de tâches.
"""
import os, sys, time

try:
    import requests
except ImportError:
    print("Le module 'requests' est requis. Installez-le avec :  pip install requests")
    sys.exit(1)

URL      = os.environ.get("PILOTRH_URL", "https://VOTRE-APP.up.railway.app").rstrip("/")
MDB      = os.environ.get("PILOTRH_MDB", r"C:\ZKTeco\attBackup.mdb")
ADMIN_PW = os.environ.get("PILOTRH_ADMIN_PASSWORD", "")
INTERVAL = int(os.environ.get("PILOTRH_INTERVAL_MIN", "30")) * 60

auth = ("admin", ADMIN_PW) if ADMIN_PW else None


def envoyer():
    if not os.path.exists(MDB):
        print(f"[!] Fichier introuvable : {MDB}")
        return False
    try:
        with open(MDB, "rb") as f:
            r = requests.post(URL + "/api/import-mdb",
                              files={"file": ("attBackup.mdb", f)},
                              auth=auth, timeout=180)
        if r.status_code == 200:
            d = r.json()
            n = len(d.get("employees", [])) if isinstance(d, dict) else "?"
            print(f"[OK] Pointage envoyé · {n} employées · {time.strftime('%d/%m %H:%M')}")
            return True
        print(f"[!] Erreur serveur {r.status_code} : {r.text[:200]}")
    except Exception as e:
        print(f"[!] Échec d'envoi : {e}")
    return False


def main():
    once = "--once" in sys.argv
    print(f"PilotRH · connecteur pointeuse")
    print(f"  Serveur : {URL}")
    print(f"  Fichier : {MDB}")
    if once:
        envoyer(); return
    print(f"  Surveillance toutes les {INTERVAL // 60} min (Ctrl+C pour arrêter)\n")
    last = None
    envoyer()  # premier envoi au démarrage
    while True:
        try:
            time.sleep(INTERVAL)
            if os.path.exists(MDB):
                mt = os.path.getmtime(MDB)
                if mt != last:
                    if envoyer():
                        last = mt
        except KeyboardInterrupt:
            print("\nArrêt.")
            break
        except Exception as e:
            print(f"[!] {e}")


if __name__ == "__main__":
    main()
