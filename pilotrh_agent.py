#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pilotrh_agent.py — Pont usine → PilotRH (cloud)
================================================
Ce petit programme tourne sur un PC de l'USINE (celui qui est sur le même réseau
que la pointeuse). Il récupère les pointages et les envoie automatiquement à votre
application PilotRH en ligne (Railway). Le cloud ne pouvant pas atteindre la
pointeuse lui-même (elle est sur votre réseau privé), c'est cet agent qui fait le pont.

Il propose DEUX méthodes — choisissez-en une avec la variable METHODE ci-dessous :

  METHODE = "pointeuse"  -> se connecte DIRECTEMENT à la pointeuse par le réseau
                            (protocole ZKTeco, port 4370). Aucun logiciel ZKTeco requis.
                            Nécessite :  pip install pyzk requests

  METHODE = "fichier"    -> envoie le fichier attBackup.mdb que le logiciel ZKTeco
                            met à jour sur le PC.
                            Nécessite :  pip install requests

------------------------------------------------------------------------------
CONFIGURATION (modifiez les valeurs ci-dessous OU utilisez des variables d'environnement)
------------------------------------------------------------------------------
"""
import os, sys, time

# --- À REMPLIR ---------------------------------------------------------------
METHODE   = os.environ.get("PILOTRH_METHODE", "pointeuse")   # "pointeuse" ou "fichier"

URL       = os.environ.get("PILOTRH_URL", "https://VOTRE-APP.up.railway.app").rstrip("/")
ADMIN_PW  = os.environ.get("PILOTRH_ADMIN_PASSWORD", "")      # mot de passe admin du serveur (si défini)
INTERVAL  = int(os.environ.get("PILOTRH_INTERVAL_MIN", "30")) * 60   # minutes entre deux envois

# Pour METHODE = "pointeuse" :
POINTEUSE_IP   = os.environ.get("PILOTRH_DEVICE_IP", "192.168.1.201")  # adresse IP de la pointeuse
POINTEUSE_PORT = int(os.environ.get("PILOTRH_DEVICE_PORT", "4370"))
POINTEUSE_PW   = int(os.environ.get("PILOTRH_DEVICE_PW", "0"))         # mot de passe communication (0 par défaut)

# Pour METHODE = "fichier" :
MDB       = os.environ.get("PILOTRH_MDB", r"C:\ZKTeco\attBackup.mdb")
# -----------------------------------------------------------------------------

try:
    import requests
except ImportError:
    print("Le module 'requests' est requis :  pip install requests")
    sys.exit(1)

AUTH = ("admin", ADMIN_PW) if ADMIN_PW else None


def _log(msg):
    print("[%s] %s" % (time.strftime("%d/%m %H:%M:%S"), msg), flush=True)


# ---------------------------------------------------------------------------
# MÉTHODE 1 : connexion directe à la pointeuse (ZKTeco / port 4370)
# ---------------------------------------------------------------------------
def lire_pointeuse():
    try:
        from zk import ZK
    except ImportError:
        _log("Le module 'pyzk' est requis pour la connexion directe :  pip install pyzk")
        return None
    zk = ZK(POINTEUSE_IP, port=POINTEUSE_PORT, timeout=20,
            password=POINTEUSE_PW, force_udp=False, ommit_ping=False)
    conn = None
    try:
        _log("Connexion à la pointeuse %s:%s ..." % (POINTEUSE_IP, POINTEUSE_PORT))
        conn = zk.connect()
        conn.disable_device()                      # fige l'appareil le temps de la lecture
        users = conn.get_users() or []
        att = conn.get_attendance() or []
        conn.enable_device()
        users_rows = [{"badge": str(u.user_id or u.uid), "name": u.name or "", "sexe": ""}
                      for u in users]
        punch_rows = [{"badge": str(a.user_id),
                       "dt": a.timestamp.strftime("%Y-%m-%d %H:%M:%S")}
                      for a in att if a.timestamp]
        _log("Lu sur la pointeuse : %d employées, %d pointages" % (len(users_rows), len(punch_rows)))
        return {"users": users_rows, "punches": punch_rows}
    except Exception as e:
        _log("Échec connexion pointeuse : %s" % e)
        _log("  Vérifiez : l'IP de la pointeuse, qu'elle est allumée et sur le même réseau, et le port 4370.")
        return None
    finally:
        try:
            if conn: conn.disconnect()
        except Exception:
            pass


def envoyer_pointeuse():
    data = lire_pointeuse()
    if not data or not data["punches"]:
        return False
    try:
        r = requests.post(URL + "/api/punches", json=data, auth=AUTH, timeout=180)
        if r.status_code == 200:
            d = r.json()
            _log("OK — envoyé au cloud · %s employées · %s jours" %
                 (d.get("employees", "?"), d.get("jours", "?")))
            return True
        _log("Erreur serveur %s : %s" % (r.status_code, r.text[:200]))
    except Exception as e:
        _log("Échec d'envoi : %s" % e)
    return False


# ---------------------------------------------------------------------------
# MÉTHODE 2 : envoi du fichier .mdb
# ---------------------------------------------------------------------------
def envoyer_fichier():
    if not os.path.exists(MDB):
        _log("Fichier introuvable : %s" % MDB)
        return False
    try:
        with open(MDB, "rb") as f:
            r = requests.post(URL + "/api/import-mdb",
                              files={"file": ("attBackup.mdb", f)},
                              auth=AUTH, timeout=180)
        if r.status_code == 200:
            d = r.json()
            n = len(d.get("employees", [])) if isinstance(d, dict) else "?"
            _log("OK — fichier envoyé · %s employées" % n)
            return True
        _log("Erreur serveur %s : %s" % (r.status_code, r.text[:200]))
    except Exception as e:
        _log("Échec d'envoi : %s" % e)
    return False


def envoyer():
    return envoyer_pointeuse() if METHODE == "pointeuse" else envoyer_fichier()


def main():
    once = "--once" in sys.argv
    if "VOTRE-APP" in URL:
        _log("⚠ Configurez d'abord PILOTRH_URL (l'adresse de votre app Railway) en haut du fichier.")
        return
    _log("Agent PilotRH démarré · méthode = %s · cible = %s" % (METHODE, URL))
    while True:
        envoyer()
        if once:
            break
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
