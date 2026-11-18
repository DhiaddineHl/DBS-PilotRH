# -*- coding: utf-8 -*-
"""L'agent d'usine, de bout en bout.

L'agent est lancé pour de vrai (comme le fait DEMARRER.bat), face à une fausse
pointeuse et à un faux serveur PilotRH. On vérifie ce qu'il envoie, et surtout
que chaque panne possible est NOMMÉE, avec la marche à suivre — la personne
devant le PC de l'atelier n'a aucun autre moyen de savoir ce qui se passe.

Ce que ces tests ne couvrent pas, faute de Windows et de vraie pointeuse ici :
l'exécution des fichiers .bat eux-mêmes. Ils sont donc gardés aussi simples que
possible, et leurs deux pièges connus (fins de ligne, accents) sont vérifiés.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
AGENT_DIR = os.path.join(RACINE, "agent_usine")
AGENT = os.path.join(AGENT_DIR, "pilotrh_agent.py")
sys.path.insert(0, RACINE)
sys.path.insert(0, ICI)
import zkproto
from fausse_pointeuse import FaussePointeuse

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


# ------------------------------------------------------- faux serveur PilotRH
CLE = "cle-de-test-0123456789"
S = {"recus": [], "rapports": [], "code_punches": 200, "code_rapport": 200, "reglages": {}, "html": False}


class Faux(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _rep(self, code, corps):
        b = corps if isinstance(corps, bytes) else json.dumps(corps).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if S["html"]:
            return self._rep(200, b"<html>Bienvenue sur la box</html>")
        self._rep(200 if self.path == "/api/health" else 404, {"ok": True})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        brut = self.rfile.read(n)
        import base64 as _b64
        cle_ok = (self.headers.get("X-PilotRH-Cle") == CLE or
                  self.headers.get("Authorization") == "Basic " + _b64.b64encode(b"chef:secret123").decode())
        if self.path == "/api/agent/rapport":
            if S["code_rapport"] != 200:
                return self._rep(S["code_rapport"], {"error": "x"})
            if not cle_ok:
                return self._rep(401, {"error": "Clé de l'agent refusée"})
            S["rapports"].append(json.loads(brut.decode()))
            return self._rep(200, {"ok": True, "reglages": S["reglages"]})
        if self.path == "/api/punches":
            if not cle_ok:
                return self._rep(401, {"error": "non_connecte"})
            if S["code_punches"] != 200:
                return self._rep(S["code_punches"], {"error": "Import impossible"})
            S["recus"].append(json.loads(brut.decode()))
            return self._rep(200, {"ok": True, "employees": 97, "jours": 28})
        if self.path == "/api/import-mdb":
            S["recus"].append({"mdb": len(brut), "type": self.headers.get("Content-Type", "")})
            return self._rep(200, {"ok": True, "employees": []})
        self._rep(404, {"error": "inconnu"})


serveur = HTTPServer(("127.0.0.1", 0), Faux)
threading.Thread(target=serveur.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d" % serveur.server_address[1]

AUJ = time.strftime("%Y-%m-%d")
PERS = [(i, str(100 + i), "OUVRIERE %d" % i) for i in range(1, 21)]
BADG = [(b, "2024-03-0%d 07:3%d:00" % (j, j)) for j in range(1, 6) for (_u, b, _n) in PERS]   # ancien
BADG += [(b, AUJ + " 07:%02d:00" % (20 + u)) for (u, b, _n) in PERS]                           # aujourd'hui
pointeuse = FaussePointeuse(personnes=PERS, badgeages=list(BADG))


def dossier(url=URL, cle=CLE, ip="", port=""):
    d = tempfile.mkdtemp(prefix="agent_")
    with open(os.path.join(d, "config.ini"), "w", encoding="utf-8") as f:
        f.write("[pilotrh]\nurl = %s\ncle = %s\n\n[pointeuse]\nmethode = pointeuse\nip = %s\nport = %s\n" % (url, cle, ip, port))
    return d


def lancer(d, *args, **env):
    e = dict((k, v) for k, v in os.environ.items() if not k.startswith("PILOTRH_"))
    e["PILOTRH_AGENT_DOSSIER"] = d
    e["PYTHONIOENCODING"] = "utf-8"
    e["PILOTRH_ASSISTANT"] = "0"            # pas de questions, sauf test explicite
    saisie = env.pop("_saisie", None)
    e.update(env)
    if saisie is not None:
        e["PILOTRH_ASSISTANT"] = "1"
    r = subprocess.run([sys.executable, AGENT] + list(args), capture_output=True, env=e, timeout=120,
                       input=(saisie or "").encode("utf-8") if saisie is not None else None)
    return r.returncode, (r.stdout + r.stderr).decode("utf-8", "replace")


def reglages(port=None, ip="127.0.0.1", mdp=0):
    S["reglages"] = {"ip": ip, "port": port or pointeuse.port, "motdepasse": mdp, "intervalle": 30}


def raz():
    S["recus"], S["rapports"] = [], []
    S["code_punches"], S["code_rapport"], S["html"] = 200, 200, False


print("\n--- Première remontée : tout l'historique ---")
reglages(); raz()
d = dossier()
code, s = lancer(d, "--une-fois")
t("l'agent termine sans erreur", code, 0)
t("un envoi", len(S["recus"]), 1)
t("tous les badgeages de la pointeuse", len(S["recus"][0]["punches"]), len(BADG))
t("les personnes aussi", len(S["recus"][0]["users"]), len(PERS))
tv("envoi complet : pas de date de début", "du" not in S["recus"][0])
tv("l'écran dit ce qui a été envoyé", "Envoyé à PilotRH" in s, s[-300:])
tv("l'adresse de la pointeuse venait de PilotRH, pas du PC", "127.0.0.1:%d" % pointeuse.port in s)
tv("un journal est écrit à côté de l'agent", os.path.exists(os.path.join(d, "journal_agent.txt")))
jr = open(os.path.join(d, "journal_agent.txt"), encoding="utf-8").read()
tv("le journal contient le résultat", "Envoyé à PilotRH" in jr)
dernier = S["rapports"][-1]
t("l'agent a dit à PilotRH que tout va bien", dernier["etat"], "ok")
t("il dit combien de badges la pointeuse a aujourd'hui", dernier["pointeuse"]["aujourdhui"], len(PERS))
tv("et l'étendue de sa mémoire", dernier["pointeuse"]["premier"].startswith("2024-03-01") and dernier["pointeuse"]["dernier"][:10] == AUJ)
t("mémoire ancienne : pas d'alerte « vidée »", dernier["pointeuse"]["videe_recemment"], False)
t("avec le modèle de la pointeuse", dernier["pointeuse"]["nom"], "F18/ID")
t("et le nombre de badgeages en mémoire", dernier["pointeuse"]["pointages"], len(BADG))
tv("et l'écart d'horloge", abs(dernier["pointeuse"]["ecart_horloge_min"]) <= 1)
tv("il s'est présenté (nom du PC, version)", dernier["pc"] and dernier["version"])
tv("la pointeuse a été relâchée", not pointeuse.figee)

print("\n--- Deuxième passage : rien de nouveau, rien n'est renvoyé ---")
raz()
code, s = lancer(d, "--une-fois")
t("aucun envoi de pointages", len(S["recus"]), 0)
tv("l'agent le dit", "aucun nouveau badgeage" in s, s[-300:])
t("mais PilotRH sait que la liaison est vivante", S["rapports"][-1]["etat"], "ok")

print("\n--- Un badge de plus : seuls les 60 derniers jours repartent ---")
raz()
pointeuse.badgeages.append(("101", AUJ + " 16:45:00"))
code, s = lancer(d, "--une-fois")
t("un envoi", len(S["recus"]), 1)
tv("fenêtre annoncée au serveur", S["recus"][0].get("du", "") > "2024-03-10", S["recus"][0].get("du"))
t("les vieux badgeages ne sont pas renvoyés", len(S["recus"][0]["punches"]), len(PERS) + 1)
tv("la journée est envoyée ENTIÈRE, pas seulement le nouveau badge",
   sum(1 for p in S["recus"][0]["punches"] if p["dt"][:10] == AUJ) == len(PERS) + 1)

print("\n--- --tout : forcer l'historique complet ---")
raz()
code, s = lancer(d, "--une-fois", "--tout")
t("tout repart", len(S["recus"][0]["punches"]), len(BADG) + 1)

print("\n--- Le serveur refuse l'envoi : rien n'est marqué comme envoyé ---")
raz()
pointeuse.badgeages.append(("102", AUJ + " 16:46:00"))
S["code_punches"] = 503
code, s = lancer(d, "--une-fois")
t("l'agent signale l'échec", code, 1)
tv("message compréhensible", "momentanément indisponible" in s, s[-300:])
raz()
code, s = lancer(d, "--une-fois")
t("au passage suivant, le badge en attente part bien", len(S["recus"]), 1)
tv("il contient le badge qui avait échoué", any(p["dt"].endswith("16:46:00") for p in S["recus"][0]["punches"]))

print("\n--- Pannes côté pointeuse : nommées à l'écran ET remontées à PilotRH ---")
raz(); reglages(ip="192.0.2.77")                 # adresse de documentation : ne répond jamais
d2 = dossier()
code, s = lancer(d2, "--une-fois")
t("échec signalé", code, 1)
tv("la cause est nommée", "Rien ne répond à l'adresse 192.0.2.77" in s, s[-400:])
tv("avec quoi faire", "Que faire" in s)
t("PilotRH reçoit la panne", S["rapports"][-1]["etat"], "erreur")
t("avec son code", S["rapports"][-1]["code"], "injoignable")
tv("et le conseil", "Pointeuse éteinte" in S["rapports"][-1]["conseil"])
tv("aucun pointage envoyé", not S["recus"])

raz()
pm = FaussePointeuse(personnes=PERS, badgeages=list(BADG), motdepasse=4821, cle=zkproto.cle_communication)
reglages(port=pm.port, mdp=0)
code, s = lancer(dossier(), "--une-fois")
tv("mot de passe de communication manquant : nommé", "refuse le mot de passe de communication" in s, s[-400:])
t("code remonté", S["rapports"][-1]["code"], "motdepasse")
raz(); reglages(port=pm.port, mdp=4821)
code, s = lancer(dossier(), "--une-fois")
t("avec le bon mot de passe réglé dans PilotRH : envoi", len(S["recus"]), 1)
pm.arreter()

print("\n--- Pannes côté serveur ---")
raz(); reglages()
code, s = lancer(dossier(cle="mauvaise-cle"), "--une-fois")
tv("clé refusée : nommée", "refuse la clé de cet agent" in s, s[-400:])
tv("remède : retélécharger le kit", "Retéléchargez le kit" in s)
tv("rien n'est lu sur la pointeuse inutilement", "Lecture de la pointeuse" not in s)

code, s = lancer(dossier(url="http://127.0.0.1:9", ip="127.0.0.1", port=str(pointeuse.port)), "--une-fois")
tv("serveur injoignable : la pointeuse est lue quand même (réglages du PC), l'envoi échoue proprement",
   "Impossible de joindre PilotRH" in s and "badgeages en mémoire" in s, s[-500:])
tv("le pare-feu et l'antivirus sont évoqués", "pare-feu" in s and "antivirus" in s)

code, s = lancer(dossier(url="http://nom-qui-n-existe-pas.invalid"), "--une-fois")
tv("adresse mal écrite ou pas d'Internet : nommé", "ne trouve pas le serveur PilotRH" in s, s[-400:])

raz(); S["code_rapport"] = 404
code, s = lancer(dossier(), "--une-fois")
tv("serveur pas encore mis à jour : nommé", "n'a pas été mis à jour" in s, s[-400:])
raz()

print("\n--- Configuration absente ou incomplète ---")
vide = tempfile.mkdtemp(prefix="agent_")
code, s = lancer(vide, "--une-fois")
t("code d'arrêt « configuration » (DEMARRER.bat ne boucle pas dessus)", code, 2)
tv("la panne est nommée", "adresse du serveur PilotRH n'est pas renseignée" in s, s[-300:])
tv("il dit où trouver le kit", "Télécharger le kit" in s)
code, s = lancer(dossier(cle=""), "--une-fois")
tv("clé absente : nommée", "Aucune clé d'accès" in s, s[-300:])
code, s = lancer(dossier(url=URL.replace("http://", "")), "--une-fois", PILOTRH_URL=URL)
t("la variable d'environnement prime sur le fichier", code, 0)

print("\n--- config.ini absent : l'assistant pose les deux questions ---")
reglages()
vide = tempfile.mkdtemp(prefix="agent_")
raz()
code, s = lancer(vide, "--diagnostic", _saisie=URL + "/moi?t=JETON123\n" + CLE + "\n")
t("avec l'adresse collée telle quelle et la clé : le diagnostic va au bout", code, 0)
tv("l'assistant s'annonce", "deux questions, une seule fois" in s, s[-600:])
tv("puis le diagnostic continue jusqu'à la pointeuse", "TOUT FONCTIONNE" in s and "6. Dialogue avec la pointeuse" in s, s[-400:])
cfg = open(os.path.join(vide, "config.ini"), encoding="utf-8").read()
tv("config.ini est écrit", "url = " + URL in cfg and "cle = " + CLE in cfg, cfg)
tv("l'adresse collée depuis le navigateur est nettoyée (plus de /moi?t=…)", "JETON123" not in cfg and "/moi" not in cfg)
raz()
code, s = lancer(vide, "--une-fois")
t("ensuite DEMARRER.bat marche sans rien redemander", code, 0)
tv("et envoie les pointages", len(S["recus"]) == 1)
raz()
vide2 = tempfile.mkdtemp(prefix="agent_")
code, s = lancer(vide2, "--diagnostic", _saisie=URL + "\n\nchef\nsecret123\n")
t("sans clé : identifiant et mot de passe d'un compte Chef d'atelier", code, 0)
cfg2 = open(os.path.join(vide2, "config.ini"), encoding="utf-8").read()
tv("le compte est enregistré", "identifiant = chef" in cfg2 and "motdepasse = secret123" in cfg2, cfg2)
tv("le diagnostic indique l'accès par compte", "compte « chef »" in s)
raz()
code, s = lancer(vide2, "--une-fois")
t("et l'agent envoie avec ce compte", (code, len(S["recus"])), (0, 1))
vide3 = tempfile.mkdtemp(prefix="agent_")
code, s = lancer(vide3, "--diagnostic", _saisie="\n\n")
tv("réponse vide : il redemande au lieu d'écrire un fichier faux", "Adresse vide" in s and not os.path.exists(os.path.join(vide3, "config.ini")), s[-300:])
code, s = lancer(tempfile.mkdtemp(prefix="agent_"), "--diagnostic", _saisie=URL + "\n\nagent\n\n")
tv("ni clé ni mot de passe : rien n'est enregistré, et c'est dit", "n'est pas enregistrée" in s and code == 1, s[-300:])
code, s = lancer(tempfile.mkdtemp(prefix="agent_"), "--diagnostic")
tv("lancé sans clavier (tâche planifiée) : pas de question, la cause et la solution", "Relancez DIAGNOSTIC.bat" in s and code == 1, s[-300:])
sys.path.insert(0, AGENT_DIR)
import importlib.util as _iu
_sp = _iu.spec_from_file_location("agent_mod", AGENT); _ag = _iu.module_from_spec(_sp); _sp.loader.exec_module(_ag)
for brut, att in (("pilotrh-dbs.up.railway.app", "https://pilotrh-dbs.up.railway.app"),
                  ("https://pilotrh-dbs.up.railway.app/moi?t=abc", "https://pilotrh-dbs.up.railway.app"),
                  (" https://pilotrh-dbs.up.railway.app/ ", "https://pilotrh-dbs.up.railway.app"),
                  ("HTTPS://X.up.railway.app/#/parametres", "https://X.up.railway.app"),
                  ("http://192.168.1.10:8000/", "http://192.168.1.10:8000"), ("", "")):
    t("adresse nettoyée : %r" % brut, _ag.nettoyer_adresse(brut), att)

print("\n--- Diagnostic : pas à pas, sans rien envoyer ---")
raz(); reglages()
d3 = dossier()
code, s = lancer(d3, "--diagnostic")
t("diagnostic réussi", code, 0)
for etape in ("1. Ce PC", "2. La configuration", "3. Le serveur PilotRH répond-il", "4. PilotRH accepte-t-il cet agent",
              "5. La pointeuse est-elle joignable", "6. Dialogue avec la pointeuse"):
    tv("étape « %s »" % etape, etape in s)
tv("modèle et numéro de série affichés", "F18/ID" in s and "CJ9X123456789" in s)
tv("nombre de badgeages et période", "badgeages en mémoire" in s and "Badgeages du 2024-03-01" in s, s[-600:])
tv("horloge vérifiée", "Horloge de la pointeuse à l'heure" in s)
tv("verdict final", "TOUT FONCTIONNE" in s)
t("AUCUN pointage envoyé par le diagnostic", len(S["recus"]), 0)
tv("compte rendu enregistré dans un fichier", os.path.exists(os.path.join(d3, "diagnostic.txt")))
s3d = s
import re as _re
tv("le diagnostic compte les badges d'aujourd'hui", _re.search(r"Aujourd'hui : \d+ badgeage\(s\)", s3d), s3d[-700:])
pv = FaussePointeuse(personnes=PERS, badgeages=[(b, AUJ + " 07:40:00") for (_u, b, _n) in PERS[:4]])
reglages(port=pv.port); raz()
code, s = lancer(dossier(), "--diagnostic")
tv("pointeuse vidée par un autre logiciel : expliqué, et dit sans conséquence", "a été vidée" not in s and "ne remonte qu'au" in s and "aucune source n'efface l'autre" in s, s[-700:])
t("signalé aussi à PilotRH", S["rapports"][-1]["pointeuse"].get("videe_recemment") if S["rapports"][-1].get("pointeuse") else None, None)
raz(); code, s = lancer(dossier(), "--une-fois")
t("lors d'une remontée, PilotRH apprend que la mémoire a été vidée", S["rapports"][-1]["pointeuse"]["videe_recemment"], True)
pv.arreter(); reglages()

raz(); reglages(ip="198.51.100.77")
code, s = lancer(dossier(), "--diagnostic")
t("diagnostic en échec : code 1", code, 1)
# (selon le réseau où tournent les tests, une adresse inexistante se tait ou refuse)
tv("il s'arrête à la pointeuse", "[ÉCHEC] Rien ne répond à l'adresse 198.51.100.77" in s
   or "[ÉCHEC] Un appareil répond à 198.51.100.77 mais refuse" in s, s[-900:])
tv("il dit où lire l'adresse sur l'appareil", "Menu → Comm." in s)
tv("il propose la commande ping", "ping 198.51.100.77" in s)
tv("il compare les deux réseaux", "ne semblent pas sur le même réseau" in s)
tv("il dit où corriger l'adresse", "Sécurité & accès → Pointeuse" in s)
tv("verdict final", "un point bloque" in s)

raz(); S["html"] = True
code, s = lancer(dossier(), "--diagnostic")
tv("une autre page web à cette adresse (box, portail) est reconnue", "ce n'est pas PilotRH" in s, s[-500:])
tv("le diagnostic ne va pas plus loin", "5. La pointeuse" not in s)
raz()

code, s = lancer(dossier(cle="mauvaise"), "--diagnostic")
tv("clé refusée : le diagnostic s'arrête à l'étape 4", "[ÉCHEC] PilotRH refuse la clé" in s and "5. La pointeuse" not in s, s[-500:])

print("\n--- Méthode de secours : fichier .mdb ---")
raz()
mdb = os.path.join(tempfile.mkdtemp(), "attBackup.mdb")
open(mdb, "wb").write(b"\x00\x01\x00\x00Standard Jet DB" + b"\x00" * 5000)
dm = dossier()
code, s = lancer(dm, "--une-fois", PILOTRH_METHODE="fichier", PILOTRH_MDB=mdb)
t("fichier envoyé", code, 0)
tv("contenu complet transmis en formulaire", S["recus"] and S["recus"][0]["mdb"] > 5000 and "multipart/form-data" in S["recus"][0]["type"])
raz()
code, s = lancer(dm, "--une-fois", PILOTRH_METHODE="fichier", PILOTRH_MDB=mdb)
t("fichier inchangé : pas renvoyé", len(S["recus"]), 0)
code, s = lancer(dossier(), "--une-fois", PILOTRH_METHODE="fichier", PILOTRH_MDB=os.path.join(ICI, "absent.mdb"))
tv("fichier absent : nommé, avec la piste du dossier partagé", "Fichier introuvable" in s and "dossier partagé" in s, s[-400:])

print("\n--- Les deux sources : la pointeuse ET le fichier .mdb du logiciel ZKTeco ---")
def faux_mdb(dossier, taille=6000):
    os.makedirs(dossier, exist_ok=True)
    f = os.path.join(dossier, "attBackup.mdb")
    open(f, "wb").write(b"\x00\x01\x00\x00Standard Jet DB" + os.urandom(taille))
    return f
racine = tempfile.mkdtemp(prefix="disque_")
mdb_auto = faux_mdb(os.path.join(racine, "ZKTeco", "Att"))
raz(); reglages()
da = dossier()
code, s = lancer(da, "--une-fois", PILOTRH_RECHERCHE_MDB=racine)
t("mode automatique : tout s'est bien passé", code, 0)
t("deux envois : les badges lus sur la pointeuse, puis le fichier", ["punches" in x and "punches" or "mdb" for x in S["recus"]], ["punches", "mdb"])
tv("le fichier a été trouvé tout seul (aucun chemin réglé)", "Fichier .mdb envoyé" in s and S["rapports"][-1].get("mdb") == mdb_auto, s[-400:])
tv("PilotRH sait quel fichier est envoyé et de quand il date", bool(S["rapports"][-1].get("mdb_maj")))
raz()
code, s = lancer(da, "--une-fois", PILOTRH_RECHERCHE_MDB=racine)
t("fichier inchangé : pas renvoyé (12 Mo économisés à chaque passage)", [x for x in S["recus"] if "mdb" in x], [])
time.sleep(1.1); open(mdb_auto, "ab").write(b"10 nouveaux badges")
raz()
code, s = lancer(da, "--une-fois", PILOTRH_RECHERCHE_MDB=racine)
t("le logiciel ZKTeco a ajouté des badges : le fichier repart", len([x for x in S["recus"] if "mdb" in x]), 1)

print("\n--- La pointeuse ne répond pas : le fichier prend le relais ---")
raz(); reglages(ip="192.0.2.77")
code, s = lancer(dossier(), "--une-fois", PILOTRH_RECHERCHE_MDB=racine)
t("pas d'échec : le fichier .mdb est envoyé", (code, len([x for x in S["recus"] if "mdb" in x])), (0, 1))
t("PilotRH voit la liaison vivante", S["rapports"][-1]["etat"], "ok")
tv("et sait que la pointeuse elle-même n'a pas répondu", "Pointeuse non lue" in S["rapports"][-1]["message"], S["rapports"][-1]["message"])
raz()
code, s = lancer(dossier(), "--diagnostic", PILOTRH_RECHERCHE_MDB=racine)
tv("diagnostic : le fichier est trouvé et affiché", "4 bis. Le fichier du logiciel ZKTeco" in s and mdb_auto in s and "trouvé automatiquement" in s, s[-1200:])
tv("la pointeuse muette est signalée sans bloquer", "[ATTENTION] Rien ne répond" in s and "le fichier .mdb prend le relais" in s and "TOUT FONCTIONNE" in s, s[-900:])
t("diagnostic : rien n'est envoyé", S["recus"], [])
code, s = lancer(dossier(), "--une-fois", PILOTRH_RECHERCHE_MDB=tempfile.mkdtemp())
t("ni pointeuse ni fichier : échec, et c'est expliqué", code, 1)
tv("le message dit qu'aucun fichier n'a pu prendre le relais", "aucun fichier attBackup.mdb trouvé" in s, s[-400:])

print("\n--- La source se règle dans PilotRH ---")
raz(); reglages(); S["reglages"]["source"] = "fichier"
code, s = lancer(dossier(), "--une-fois", PILOTRH_RECHERCHE_MDB=racine)
t("« fichier .mdb seulement » : la pointeuse n'est pas lue", [("punches" in x) for x in S["recus"]], [False])
raz(); reglages(); S["reglages"]["source"] = "pointeuse_seule"
code, s = lancer(dossier(), "--une-fois", PILOTRH_RECHERCHE_MDB=racine)
t("« pointeuse seulement » : le fichier n'est pas envoyé", [("punches" in x) for x in S["recus"]], [True])
autre = faux_mdb(os.path.join(tempfile.mkdtemp(), "Partage"))
raz(); reglages(); S["reglages"]["mdb"] = autre
code, s = lancer(dossier(), "--une-fois", PILOTRH_RECHERCHE_MDB=racine)
t("un chemin réglé dans PilotRH l'emporte sur la recherche", S["rapports"][-1].get("mdb"), autre)
raz(); reglages()
code, s = lancer(dossier(), "--une-fois", PILOTRH_RECHERCHE_MDB=racine, PILOTRH_METHODE="pointeuse")
t("un ancien config.ini (« methode = pointeuse ») profite aussi du fichier", len([x for x in S["recus"] if "mdb" in x]), 1)

print("\n--- La recherche du fichier sur le disque ---")
_sp2 = _iu.spec_from_file_location("agent_mod2", AGENT); _ag2 = _iu.module_from_spec(_sp2); _sp2.loader.exec_module(_ag2)
disque = tempfile.mkdtemp(prefix="C_")
vieux = faux_mdb(os.path.join(disque, "ZKTeco", "ZKTime5.0"))
os.utime(vieux, (time.time() - 86400 * 30, time.time() - 86400 * 30))
recent = faux_mdb(os.path.join(disque, "Att2000"))
faux_mdb(os.path.join(disque, "Windows", "Temp"))                          # dossier sans rapport : non visité
faux_mdb(os.path.join(disque, "ZKTeco", "a", "b", "c", "d"))               # trop profond
os.environ["PILOTRH_RECHERCHE_MDB"] = disque
t("le fichier le plus récemment modifié est retenu", _ag2.chercher_mdb(), recent)
os.remove(recent)
t("sinon le suivant", _ag2.chercher_mdb(), vieux)
os.environ["PILOTRH_RECHERCHE_MDB"] = os.path.join(disque, "Windows")
t("sous une racine générale, un dossier sans rapport avec la pointeuse n'est pas fouillé",
  _ag2.chercher_mdb(), "")
os.environ["PILOTRH_RECHERCHE_MDB"] = tempfile.mkdtemp()
t("rien trouvé : chaîne vide, pas d'erreur", _ag2.chercher_mdb(), "")
del os.environ["PILOTRH_RECHERCHE_MDB"]

print("\n--- Deux agents ne tournent pas en même temps ---")
import socket as _so
v = _so.socket(); v.bind(("127.0.0.1", 0)); v.listen(1)
e = dict((k, x) for k, x in os.environ.items() if not k.startswith("PILOTRH_"))
e.update({"PILOTRH_AGENT_DOSSIER": dossier(), "PYTHONIOENCODING": "utf-8", "PILOTRH_AGENT_VERROU": str(v.getsockname()[1])})
r = subprocess.run([sys.executable, AGENT], capture_output=True, env=e, timeout=60)
t("le second s'arrête de lui-même", r.returncode, 0)
tv("en expliquant pourquoi", "tourne déjà" in r.stdout.decode("utf-8", "replace"))
v.close()

print("\n--- Console Windows en vieille page de code : pas de plantage sur un accent ---")
code, s = lancer(dossier(cle="mauvaise"), "--une-fois", PYTHONIOENCODING="cp437:strict")
tv("l'agent va au bout malgré les accents", code in (0, 1) and "Traceback" not in s, s[-300:])

print("\n--- Les fichiers de lancement Windows ---")
bats = [f for f in os.listdir(AGENT_DIR) if f.endswith(".bat")]
t("les cinq lanceurs sont livrés", sorted(bats), ["ARRETER_DEMARRAGE_AUTOMATIQUE.bat", "DEMARRAGE_AUTOMATIQUE.bat",
                                                  "DEMARRER.bat", "DIAGNOSTIC.bat", "_python.bat"])
tous_bat = [os.path.join(AGENT_DIR, f) for f in bats] + [os.path.join(RACINE, f) for f in os.listdir(RACINE) if f.endswith(".bat")]
for chemin in tous_bat:
    brut = open(chemin, "rb").read()
    nom = os.path.basename(chemin)
    tv("%s : fins de ligne Windows partout" % nom, brut.count(b"\n") == brut.count(b"\r\n") and b"\r\n" in brut)
for f in bats:
    brut = open(os.path.join(AGENT_DIR, f), "rb").read()
    tv("%s : aucun accent (ASCII pur)" % f, all(c < 128 for c in bytearray(brut)))
    txt = brut.decode("ascii")
    etiquettes = set(l[1:].strip() for l in txt.split("\r\n") if l.startswith(":") and not l.startswith("::"))
    sauts = set(m.split()[0] for m in txt.replace("goto :", "\x00").split("\x00")[1:])
    tv("%s : chaque « goto » a son étiquette" % f, sauts <= (etiquettes | {"eof"}), str(sauts - etiquettes))
dem = open(os.path.join(AGENT_DIR, "DEMARRER.bat")).read()
tv("la fenêtre ne se ferme jamais sans laisser lire", "pause" in dem)
tv("lancement depuis l'archive ZIP détecté et expliqué", "Extraire tout" in dem)
tv("l'agent est relancé s'il s'arrête", "goto :boucle" in dem)
py = open(os.path.join(AGENT_DIR, "_python.bat")).read()
tv("Python déjà présent : utilisé", "py -3" in py and "python -c" in py)
tv("Python absent : téléchargé dans le dossier, sans installation", "embed" in py and "python.org" in py)
tv("le faux python.exe du Microsoft Store n'est pas pris pour un vrai", "sys.version_info" in py)
tv("Windows 7/8 : version de Python compatible", "3.8.10" in py)
tv("aucun module à installer : pas de pip", "pip" not in py and "pip" not in dem)
src = open(AGENT, encoding="utf-8").read()
tv("l'agent n'importe ni pyzk ni requests", "import requests" not in src and "from zk " not in src and "import zk\n" not in src)
import ast
try:
    ast.parse(src, feature_version=(3, 6)); tv("syntaxe acceptée par un vieux Python (3.6)", True)
except SyntaxError as ex:
    tv("syntaxe acceptée par un vieux Python (3.6)", False, str(ex))
tv("les anciens fichiers, sources de confusion, ne sont plus livrés",
   not any(os.path.exists(os.path.join(RACINE, f)) for f in
           ("pilotrh_agent.py", "push_pointeuse.py", "installer_agent.bat", "lancer_agent_pointeuse.bat",
            "agent_requirements.txt", "DIAGNOSTIC_POINTEUSE.bat", "diagnostic_pointeuse.py")))
lm = open(os.path.join(AGENT_DIR, "LISEZ-MOI.txt"), "rb").read()
tv("la notice s'ouvre correctement dans le Bloc-notes (BOM + CR+LF)", lm[:3] == b"\xef\xbb\xbf" and b"\r\n" in lm)

pointeuse.arreter()
serveur.shutdown()
print("\n=========================")
print("  %d réussis · %d échoués" % (ok, ko))
sys.exit(1 if ko else 0)
