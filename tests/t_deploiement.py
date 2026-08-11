# -*- coding: utf-8 -*-
"""Déploiement en conteneur (Railway, Docker) — droits sur le volume.

Le déploiement échouait à l'import du module avec
« PermissionError: [Errno 13] /app/data/backups ». Cause : un volume est monté
AU DÉMARRAGE, par-dessus le dossier préparé par l'image, et il appartient à
root — ce qui recouvre le `chown` fait à la construction. Le serveur, lui,
tourne en utilisateur non privilégié.

Ce fichier vérifie les trois pièces du correctif :
  1. la résolution du dossier de données (dont `RAILWAY_VOLUME_MOUNT_PATH`) ;
  2. le message d'erreur, qui doit dire quoi faire au lieu d'afficher une trace ;
  3. le script d'entrée, qui ajuste les droits du volume PUIS lâche les
     privilèges — vérifié en le lançant réellement.
"""
import os
import shutil
import subprocess
import sys
import tempfile

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
UID_APP = 10001

ok = ko = 0


def t(nom, got, exp):
    global ok, ko
    if got == exp:
        ok += 1
    else:
        ko += 1
        print("  ECHEC  %s\n    attendu %r\n    obtenu  %r" % (nom, exp, got))


def tv(nom, cond, detail=""):
    t(nom + ((" :: %s" % detail) if (not cond and detail) else ""), bool(cond), True)


def sans_env(**extra):
    """Environnement propre : sans quoi les variables du poste de test faussent
    la résolution du dossier de données."""
    env = dict(os.environ)
    for cle in ("PILOTRH_DATA", "RAILWAY_VOLUME_MOUNT_PATH", "PILOTRH_ROOT"):
        env.pop(cle, None)
    env["PYTHONPATH"] = ICI          # doublures fastapi / starlette / access_parser
    env.update({k: v for k, v in extra.items() if v is not None})
    return env


def dossier_resolu(env):
    """Interroge app.py sur le dossier qu'il retiendrait, sans rien démarrer :
    on extrait la fonction de résolution et on l'exécute seule."""
    code = "\n".join([
        "import os",
        "src = open(%r, encoding='utf-8').read()" % os.path.join(RACINE, "app.py"),
        "deb = src.index('def _dossier_donnees')",
        "fin = src.index('DATA_DIR = _dossier_donnees()')",
        "ns = {'os': os, 'BASE': %r}" % RACINE,
        "exec(src[deb:fin], ns)",
        "print(ns['_dossier_donnees']())",
    ])
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                       env=env, timeout=60)
    sortie = (r.stdout or r.stderr).strip()
    return sortie.splitlines()[-1] if sortie else ""


print("\n--- Où l'application écrit ses données ---")
t("PILOTRH_DATA est prioritaire",
  dossier_resolu(sans_env(PILOTRH_DATA="/choisi/par/moi")), "/choisi/par/moi")
# Sans cette résolution, un volume monté ailleurs que sur /app/data était ignoré :
# l'application écrivait dans le conteneur et tout disparaissait au redéploiement.
t("le volume annoncé par Railway est utilisé à défaut",
  dossier_resolu(sans_env(RAILWAY_VOLUME_MOUNT_PATH="/mnt/volume")), "/mnt/volume")
t("PILOTRH_DATA l'emporte sur le volume Railway",
  dossier_resolu(sans_env(PILOTRH_DATA="/a", RAILWAY_VOLUME_MOUNT_PATH="/b")), "/a")
t("sans rien : ./data à côté du code",
  dossier_resolu(sans_env()), os.path.join(RACINE, "data"))
t("une valeur vide ne compte pas",
  dossier_resolu(sans_env(PILOTRH_DATA="   ")), os.path.join(RACINE, "data"))

print("\n--- Un volume non accessible en écriture : message utile, pas une trace ---")
peut_baisser = (os.geteuid() == 0) and bool(shutil.which("setpriv"))
if not peut_baisser:
    print("  (test lancé sans les droits root ou sans setpriv — cas non simulable, ignoré)")
else:
    vol = tempfile.mkdtemp(prefix="faux-volume-")
    try:
        os.chown(vol, 0, 0)
        os.chmod(vol, 0o755)
        r = subprocess.run(
            ["setpriv", "--reuid=%d" % UID_APP, "--regid=%d" % UID_APP, "--clear-groups",
             sys.executable, "-c", "import app"],
            capture_output=True, text=True, cwd=RACINE, env=sans_env(PILOTRH_DATA=vol))
        sortie = r.stdout + r.stderr
        tv("le démarrage échoue bien (mieux que perdre les données en silence)",
           r.returncode != 0)
        tv("le message nomme le dossier en cause", vol in sortie, sortie[-300:])
        tv("il explique la cause (volume monté par root)",
           "appartient" in sortie and "root" in sortie)
        tv("il donne le bon point de montage", "/app/data" in sortie)
        tv("il indique le dépannage immédiat", "PILOTRH_ROOT=1" in sortie)
        tv("il ne se contente pas d'une PermissionError brute",
           "PilotRH ne peut pas" in sortie)

        # même dossier, mais accessible : le démarrage doit passer
        for sous in ("photos", "docs", "backups"):
            os.makedirs(os.path.join(vol, sous), exist_ok=True)
        for racine_d, dossiers, fichiers in os.walk(vol):
            os.chown(racine_d, UID_APP, UID_APP)
            for f in fichiers:
                os.chown(os.path.join(racine_d, f), UID_APP, UID_APP)
        os.chown(vol, UID_APP, UID_APP)
        r = subprocess.run(
            ["setpriv", "--reuid=%d" % UID_APP, "--regid=%d" % UID_APP, "--clear-groups",
             sys.executable, "-c",
             "import app, os; print('DATA=' + app.DATA_DIR); "
             "print('DB=' + str(os.path.exists(app.DB_PATH)))"],
            capture_output=True, text=True, cwd=RACINE, env=sans_env(PILOTRH_DATA=vol))
        sortie = r.stdout + r.stderr
        tv("une fois les droits donnés, le démarrage réussit en non-root",
           "DATA=" + vol in sortie, sortie[-300:])
        tv("la base de données est créée dans le volume", "DB=True" in sortie)
        tv("le témoin d'écriture ne reste pas dans le volume",
           ".ecriture_test" not in os.listdir(vol))
    finally:
        shutil.rmtree(vol, ignore_errors=True)

print("\n--- Le script d'entrée du conteneur ---")
entree = os.path.join(RACINE, "docker-entrypoint.sh")
tv("le script existe", os.path.exists(entree))
tv("il est exécutable", os.access(entree, os.X_OK))
sh = open(entree, encoding="utf-8").read()
tv("il crée les sous-dossiers avant de changer le propriétaire",
   sh.index("mkdir -p") < sh.index("chown -R"))
tv("il lâche les privilèges (setpriv / su-exec / gosu)",
   all(x in sh for x in ("setpriv", "su-exec", "gosu")))
tv("il lance uvicorn avec le port fourni par l'hébergeur", "${PORT:-8000}" in sh)
tv("il conserve la restriction des en-têtes de proxy",
   "forwarded-allow-ips" in sh and "PILOTRH_TRUSTED_PROXY" in sh)
tv("il tient compte du volume annoncé par Railway", "RAILWAY_VOLUME_MOUNT_PATH" in sh)
tv("il prévoit le dépannage en root", "PILOTRH_ROOT" in sh)

if peut_baisser:
    # On lance le VRAI script, avec un faux uvicorn : ce qui est vérifié, c'est
    # le propriétaire du volume et l'utilisateur sous lequel uvicorn démarre.
    vol = tempfile.mkdtemp(prefix="faux-volume-")
    faux = tempfile.mkdtemp(prefix="faux-bin-")
    try:
        os.chown(vol, 0, 0)
        with open(os.path.join(faux, "uvicorn"), "w") as f:
            f.write("#!/bin/sh\necho \"UID=$(id -u)\"\necho \"ARGS=$*\"\n")
        os.chmod(os.path.join(faux, "uvicorn"), 0o755)
        # le dossier doit être traversable par l'utilisateur 10001, sinon le VRAI
        # uvicorn est trouvé à la place et le test attend un serveur réel
        os.chmod(faux, 0o755)
        env = sans_env(PILOTRH_DATA=vol)
        env["PATH"] = faux + os.pathsep + env["PATH"]
        r = subprocess.run(["sh", entree], capture_output=True, text=True, cwd=RACINE,
                           env=env, timeout=30)
        sortie = r.stdout + r.stderr
        tv("le script démarre uvicorn", "UID=" in sortie, sortie[-300:])
        tv("uvicorn ne tourne PAS en root", "UID=%d" % UID_APP in sortie, sortie[-300:])
        tv("le port et les en-têtes de proxy sont passés",
           "--proxy-headers" in sortie and "--port 8000" in sortie)
        t("le volume appartient désormais à l'application", os.stat(vol).st_uid, UID_APP)
        tv("les trois sous-dossiers sont créés",
           all(os.path.isdir(os.path.join(vol, d)) for d in ("photos", "docs", "backups")))

        # dépannage : PILOTRH_ROOT=1 doit laisser le serveur en root
        env["PILOTRH_ROOT"] = "1"
        r = subprocess.run(["sh", entree], capture_output=True, text=True, cwd=RACINE,
                           env=env, timeout=30)
        sortie = r.stdout + r.stderr
        tv("PILOTRH_ROOT=1 fait tourner uvicorn en root", "UID=0" in sortie, sortie[-200:])
        tv("et le dit clairement dans les journaux",
           "déconseillé" in sortie or "deconseille" in sortie)
    finally:
        shutil.rmtree(vol, ignore_errors=True)
        shutil.rmtree(faux, ignore_errors=True)

print("\n--- Le Dockerfile ---")
df = open(os.path.join(RACINE, "Dockerfile"), encoding="utf-8").read()
tv("setpriv est installé (util-linux)", "util-linux" in df)
tv("le script d'entrée est déclaré", 'ENTRYPOINT ["/app/docker-entrypoint.sh"]' in df)
tv("il est rendu exécutable dans l'image", "chmod +x /app/docker-entrypoint.sh" in df)
tv("plus de USER figé avant le montage du volume",
   "\nUSER pilotrh" not in df)
tv("l'utilisateur non privilégié existe toujours", "useradd -r -u 10001" in df)
tv("le contrôle de santé est conservé", "HEALTHCHECK" in df)
tv("le fuseau de l'usine est conservé", "Africa/Tunis" in df)

print("\n=========================")
print("  %d réussis · %d échoués" % (ok, ko))
sys.exit(1 if ko else 0)
