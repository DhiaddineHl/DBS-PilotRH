#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PilotRH — agent de la pointeuse (à installer sur un PC de l'usine)
==================================================================
Ce programme tourne sur un PC branché sur le MÊME réseau que la pointeuse.
Il lit les badgeages sur l'appareil et les envoie à PilotRH. Il est nécessaire
parce qu'un serveur hébergé sur Internet ne peut pas entrer sur le réseau de
l'usine : c'est donc ce PC qui fait le pont, de l'intérieur vers l'extérieur.

  * RIEN à installer en plus de Python : ni « pyzk », ni « requests ».
  * Il ne fait que LIRE la pointeuse. Il n'efface jamais rien dessus.
  * Tout ce qu'il fait est écrit dans « journal_agent.txt », à côté de lui.
  * Ses réglages (adresse de la pointeuse, fréquence) viennent de PilotRH :
    on les change dans l'application, sans revenir sur ce PC.

Utilisation (les fichiers .bat le font pour vous) :
    python pilotrh_agent.py                tourne en continu
    python pilotrh_agent.py --une-fois     une seule remontée, puis s'arrête
    python pilotrh_agent.py --diagnostic   vérifie tout, pas à pas, sans rien envoyer
    python pilotrh_agent.py --tout         renvoie tout l'historique de la pointeuse
"""
from __future__ import print_function

import base64
import datetime
import json
import os
import platform
import socket
import ssl
import sys
import time
import traceback

try:
    import configparser
except ImportError:                                   # Python 2 : non supporté
    print("Cette version de Python est trop ancienne. Installez Python 3.")
    sys.exit(3)
import urllib.error
import urllib.request

VERSION = "4.0"
ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
sys.path.insert(1, os.path.dirname(ICI))              # dans le dépôt, zkproto.py est un cran au-dessus
import zkproto                                        # noqa: E402
from zkproto import ErreurPointeuse                   # noqa: E402

DOSSIER = os.environ.get("PILOTRH_AGENT_DOSSIER") or ICI
JOURNAL = os.path.join(DOSSIER, "journal_agent.txt")
ETAT = os.path.join(DOSSIER, "etat_agent.json")
FENETRE_JOURS = 60        # hors envoi complet, on renvoie les 60 derniers jours entiers
PORT_VERROU = 47370       # sert seulement à empêcher deux agents de tourner ensemble


# ------------------------------------------------------------------ journal
def _sortie_sure():
    """Une console Windows en page de code 850 fait planter print() sur un « é ».
    On demande à Python de remplacer plutôt que d'échouer."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(errors="replace")
        except Exception:
            pass


def log(msg, ecran=True):
    ligne = "[%s] %s" % (time.strftime("%d/%m/%Y %H:%M:%S"), msg)
    if ecran:
        try:
            print(ligne)
            sys.stdout.flush()
        except Exception:
            try:
                print(ligne.encode("ascii", "replace").decode("ascii"))
            except Exception:
                pass
    try:
        if os.path.exists(JOURNAL) and os.path.getsize(JOURNAL) > 1024 * 1024:
            ancien = JOURNAL + ".ancien"
            if os.path.exists(ancien):
                os.remove(ancien)
            os.rename(JOURNAL, ancien)
        with open(JOURNAL, "a", encoding="utf-8") as f:
            f.write(ligne + "\n")
    except Exception:
        pass                                          # un journal illisible ne doit jamais arrêter l'agent


# ------------------------------------------------------------ configuration
class Config(object):
    def __init__(self):
        cp = configparser.ConfigParser()
        self.fichier = os.path.join(DOSSIER, "config.ini")
        self.fichier_lu = False
        try:
            if os.path.exists(self.fichier):
                with open(self.fichier, encoding="utf-8-sig") as f:
                    cp.read_file(f)
                self.fichier_lu = True
        except Exception as e:
            log("Le fichier config.ini est illisible : %s" % e)

        def lire(section, cle, env, defaut=""):
            v = os.environ.get(env)
            if v is None:
                try:
                    v = cp.get(section, cle)
                except Exception:
                    v = defaut
            return (v or "").strip().strip('"')

        self.url = lire("pilotrh", "url", "PILOTRH_URL").rstrip("/")
        self.cle = lire("pilotrh", "cle", "PILOTRH_CLE")
        self.login = lire("pilotrh", "identifiant", "PILOTRH_LOGIN", "agent")
        self.motdepasse = lire("pilotrh", "motdepasse", "PILOTRH_PASSWORD")
        self.methode = (lire("pointeuse", "methode", "PILOTRH_METHODE", "pointeuse") or "pointeuse").lower()
        self.mdb = lire("pointeuse", "fichier_mdb", "PILOTRH_MDB", r"C:\ZKTeco\attBackup.mdb")
        # Laissés vides, ces réglages sont donnés par PilotRH (Sécurité & accès → Pointeuse).
        self.ip_locale = lire("pointeuse", "ip", "PILOTRH_DEVICE_IP")
        self.port_local = lire("pointeuse", "port", "PILOTRH_DEVICE_PORT")
        self.mdp_local = lire("pointeuse", "motdepasse", "PILOTRH_DEVICE_PW")
        self.intervalle_local = lire("pointeuse", "intervalle_min", "PILOTRH_INTERVAL_MIN")
        if self.url and not self.url.lower().startswith(("http://", "https://")):
            self.url = "https://" + self.url

    def probleme(self):
        """Phrase décrivant ce qui manque, ou None."""
        if not self.url or "VOTRE-APP" in self.url:
            return ("L'adresse du serveur PilotRH n'est pas renseignée.",
                    "Dans PilotRH : Sécurité & accès → Pointeuse → « Télécharger le kit de l'agent ». "
                    "Le kit contient un fichier config.ini déjà rempli : dézippez-le en entier sur ce PC.")
        if not self.cle and not self.motdepasse:
            return ("Aucune clé d'accès n'est renseignée (ligne « cle » de config.ini).",
                    "Retéléchargez le kit depuis PilotRH : Sécurité & accès → Pointeuse → "
                    "« Télécharger le kit de l'agent ». La clé y est déjà inscrite.")
        return None


def reglages_effectifs(cfg, du_serveur):
    r = {"ip": "192.168.1.201", "port": 4370, "motdepasse": 0, "intervalle": 30}
    for k in r:
        if du_serveur and du_serveur.get(k) not in (None, ""):
            r[k] = du_serveur[k]
    if cfg.ip_locale:
        r["ip"] = cfg.ip_locale
    for cle, val in (("port", cfg.port_local), ("motdepasse", cfg.mdp_local), ("intervalle", cfg.intervalle_local)):
        if val:
            try:
                r[cle] = int(val)
            except ValueError:
                pass
    r["port"], r["motdepasse"], r["intervalle"] = int(r["port"]), int(r["motdepasse"] or 0), max(5, int(r["intervalle"]))
    return r


def lire_etat():
    try:
        with open(ETAT, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def ecrire_etat(e):
    try:
        tmp = ETAT + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(e, f)
        os.replace(tmp, ETAT)
    except Exception:
        pass


# --------------------------------------------------------------- le serveur
class ErreurServeur(Exception):
    def __init__(self, code, message, conseil=""):
        Exception.__init__(self, message)
        self.code, self.message, self.conseil = code, message, conseil


def _entetes(cfg):
    h = {"User-Agent": "PilotRH-Agent/" + VERSION, "Accept": "application/json"}
    if cfg.cle:
        h["X-PilotRH-Cle"] = cfg.cle
    elif cfg.motdepasse:
        h["Authorization"] = "Basic " + base64.b64encode(
            ("%s:%s" % (cfg.login, cfg.motdepasse)).encode("utf-8")).decode("ascii")
    return h


def appel(cfg, chemin, corps=None, brut=None, type_contenu=None, delai=120):
    """Appel HTTP vers PilotRH. Rend le JSON décodé, ou lève ErreurServeur."""
    h = _entetes(cfg)
    data = None
    if corps is not None:
        data = json.dumps(corps).encode("utf-8")
        h["Content-Type"] = "application/json"
    elif brut is not None:
        data = brut
        h["Content-Type"] = type_contenu
    req = urllib.request.Request(cfg.url + chemin, data=data, headers=h,
                                 method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=delai) as r:
            txt = r.read().decode("utf-8", "replace")
            try:
                return json.loads(txt) if txt else {}
            except ValueError:
                raise ErreurServeur(
                    "pas_pilotrh", "L'adresse %s répond, mais ce n'est pas PilotRH." % cfg.url,
                    "Vérifiez la ligne « url » de config.ini : elle doit être l'adresse exacte de votre PilotRH.")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8", "replace")).get("error", "")
        except Exception:
            detail = ""
        if e.code == 401:
            raise ErreurServeur(
                "cle_refusee", "PilotRH refuse la clé de cet agent.",
                "La clé a été régénérée dans PilotRH, ou config.ini vient d'une autre installation. "
                "Retéléchargez le kit (Sécurité & accès → Pointeuse) et remplacez config.ini.")
        if e.code == 403:
            raise ErreurServeur(
                "role", "PilotRH connaît ce compte mais son rôle ne l'autorise pas à envoyer des pointages.",
                "Utilisez la clé du kit plutôt qu'un compte, ou passez le compte en « Chef d'atelier ».")
        if e.code == 404:
            raise ErreurServeur(
                "ancienne_version", "Ce serveur PilotRH ne connaît pas l'agent : il n'a pas été mis à jour.",
                "Déployez la dernière version de PilotRH sur le serveur, puis relancez l'agent.")
        if e.code == 400:
            raise ErreurServeur("refus", "PilotRH a refusé l'envoi : %s" % (detail or "demande invalide"))
        if e.code in (502, 503, 504):
            raise ErreurServeur("serveur_arrete", "Le serveur PilotRH est momentanément indisponible (code %d)." % e.code,
                                "Il redémarre peut-être. L'agent réessaiera tout seul.")
        raise ErreurServeur("http", "Le serveur PilotRH a répondu par une erreur %d. %s" % (e.code, detail))
    except urllib.error.URLError as e:
        raison = getattr(e, "reason", e)
        if isinstance(raison, ssl.SSLError):
            raise ErreurServeur(
                "certificat", "La connexion sécurisée avec PilotRH a été refusée par ce PC.",
                "Cause la plus fréquente : la DATE ou l'HEURE de ce PC est fausse (regardez l'horloge "
                "de Windows). Sinon, un antivirus qui filtre les connexions https.")
        if isinstance(raison, socket.gaierror):
            raise ErreurServeur(
                "internet", "Ce PC ne trouve pas le serveur PilotRH sur Internet.",
                "Soit ce PC n'a pas Internet en ce moment, soit l'adresse « %s » est mal écrite." % cfg.url)
        if isinstance(raison, (socket.timeout, TimeoutError)):
            raise ErreurServeur("lent", "Le serveur PilotRH n'a pas répondu à temps.",
                                "Connexion Internet très lente ou coupée. L'agent réessaiera tout seul.")
        raise ErreurServeur(
            "injoignable", "Impossible de joindre PilotRH : %s" % raison,
            "Vérifiez qu'Internet fonctionne sur ce PC (ouvrez %s dans un navigateur). "
            "Un pare-feu ou un antivirus peut aussi bloquer Python." % cfg.url)
    except (socket.timeout, TimeoutError):
        raise ErreurServeur("lent", "Le serveur PilotRH n'a pas répondu à temps.",
                            "Connexion Internet très lente ou coupée. L'agent réessaiera tout seul.")
    except ssl.SSLError:
        raise ErreurServeur("certificat", "La connexion sécurisée avec PilotRH a été refusée par ce PC.",
                            "Vérifiez la date et l'heure de ce PC.")


def rapport(cfg, etat, code="", message="", conseil="", pointeuse=None, extra=None):
    """Dit à PilotRH comment va l'agent ; reçoit en retour les réglages à appliquer."""
    corps = {"etat": etat, "code": code, "message": message, "conseil": conseil,
             "version": VERSION, "pc": socket.gethostname()[:60],
             "systeme": ("%s %s" % (platform.system(), platform.release()))[:60],
             "python": platform.python_version(), "pointeuse": pointeuse or {}}
    corps.update(extra or {})
    return appel(cfg, "/api/agent/rapport", corps=corps, delai=40)


# ------------------------------------------------------------- la pointeuse
def ecart_horloge_min(heure_pointeuse):
    try:
        hp = datetime.datetime.strptime(heure_pointeuse, "%Y-%m-%d %H:%M:%S")
        return int(round((hp - datetime.datetime.now()).total_seconds() / 60.0))
    except Exception:
        return None


def adresse_locale_vers(ip):
    """Adresse de CE PC sur la carte réseau qui mène à la pointeuse."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((ip, 9))
        return s.getsockname()[0]
    except Exception:
        return ""
    finally:
        s.close()


def meme_reseau(a, b):
    return bool(a and b) and a.split(".")[:3] == b.split(".")[:3]


def a_envoyer(punches, etat, tout=False):
    """Choisit quoi envoyer : (liste, du, complet, raison) — ou (None, …) si rien de nouveau.

    Une fois par jour, on renvoie tout l'historique (comme le faisait l'import
    quotidien du fichier .mdb). Le reste du temps, seulement les 60 derniers
    jours ENTIERS : le serveur reconstruit des journées complètes, il ne faut
    donc jamais lui envoyer une moitié de journée."""
    if not punches:
        return None, None, False, "la pointeuse ne contient aucun badgeage"
    dernier = max(p["dt"] for p in punches)
    signature = "%d|%s" % (len(punches), dernier)
    aujourdhui = time.strftime("%Y-%m-%d")
    complet = tout or etat.get("dernier_complet") != aujourdhui
    if not complet and etat.get("signature") == signature:
        return None, None, False, "aucun nouveau badgeage depuis la dernière remontée"
    if complet:
        return punches, None, True, signature
    du = (datetime.date.today() - datetime.timedelta(days=FENETRE_JOURS)).isoformat()
    return [p for p in punches if p["dt"][:10] >= du], du, False, signature


def cycle_pointeuse(cfg, etat, tout=False):
    """Une remontée complète. Rend le texte du résultat ; lève ErreurPointeuse / ErreurServeur."""
    du_serveur = etat.get("reglages")
    try:
        rep = rapport(cfg, "demarrage" if not etat.get("vu") else "veille")
        du_serveur = rep.get("reglages") or du_serveur
        etat["reglages"] = du_serveur
        etat["vu"] = True
    except ErreurServeur as e:
        if e.code in ("cle_refusee", "role", "ancienne_version", "pas_pilotrh"):
            raise
        log("PilotRH injoignable pour l'instant (%s) : lecture de la pointeuse avec les derniers réglages connus." % e.message)
    r = reglages_effectifs(cfg, du_serveur)
    etat["intervalle"] = r["intervalle"]

    log("Lecture de la pointeuse %s:%s…" % (r["ip"], r["port"]))
    d = zkproto.lire_tout(r["ip"], r["port"], r["motdepasse"], delai=20)
    infos = d["infos"]
    ecart = ecart_horloge_min(infos.get("heure") or "")
    infos_rapport = {"nom": infos.get("nom"), "serie": infos.get("serie"), "liaison": infos.get("liaison"),
                     "pointages": len(d["punches"]), "personnes": len(d["users"]),
                     "heure": infos.get("heure"), "ecart_horloge_min": ecart,
                     "ignores": d["ignores"], "ip": r["ip"]}
    log("Pointeuse %s lue : %d personnes, %d badgeages en mémoire%s." % (
        infos.get("nom") or "", len(d["users"]), len(d["punches"]),
        (" (%d enregistrements illisibles ignorés)" % d["ignores"]) if d["ignores"] else ""))
    if ecart is not None and abs(ecart) >= 5:
        log("ATTENTION : l'horloge de la pointeuse a %d minutes d'%s sur celle de ce PC." % (
            abs(ecart), "avance" if ecart > 0 else "retard"))

    lot, du, complet, raison = a_envoyer(d["punches"], etat, tout)
    if lot is None:
        rapport(cfg, "ok", message="Pointeuse lue : " + raison + ".", pointeuse=infos_rapport,
                extra={"envoyes": 0})
        return "Rien à envoyer : %s." % raison
    corps = {"users": d["users"], "punches": lot}
    if du:
        corps["du"] = du
    rep = appel(cfg, "/api/punches", corps=corps, delai=300)
    etat["signature"] = raison
    if complet:
        etat["dernier_complet"] = time.strftime("%Y-%m-%d")
    etat["dernier_envoi"] = time.strftime("%Y-%m-%d %H:%M:%S")
    rapport(cfg, "ok", message="%d badgeages envoyés (%s)." % (len(lot), "historique complet" if complet else "60 derniers jours"),
            pointeuse=infos_rapport, extra={"envoyes": len(lot)})
    return "Envoyé à PilotRH : %d badgeages (%s) · %s salariées · %s journées." % (
        len(lot), "historique complet" if complet else "60 derniers jours",
        rep.get("employees", "?"), rep.get("jours", "?"))


def cycle_fichier(cfg, etat):
    """Méthode de secours : envoi du fichier attBackup.mdb produit par le logiciel ZKTeco."""
    try:
        rapport(cfg, "veille")
    except ErreurServeur as e:
        if e.code in ("cle_refusee", "role", "ancienne_version", "pas_pilotrh"):
            raise
    if not os.path.exists(cfg.mdb):
        raise ErreurPointeuse(
            "fichier_absent", "Fichier introuvable : %s" % cfg.mdb,
            "Vérifiez le chemin (ligne « fichier_mdb » de config.ini). S'il est sur un dossier partagé, "
            "ce dossier est-il bien accessible depuis ce PC ?")
    mt = os.path.getmtime(cfg.mdb)
    if etat.get("mdb_mtime") == mt and etat.get("dernier_complet") == time.strftime("%Y-%m-%d"):
        rapport(cfg, "ok", message="Fichier .mdb inchangé depuis le dernier envoi.", extra={"envoyes": 0})
        return "Rien à envoyer : le fichier n'a pas changé."
    with open(cfg.mdb, "rb") as f:
        contenu = f.read()
    limite = "----PilotRHAgent%d" % int(time.time() * 1000)
    corps = (("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"attBackup.mdb\"\r\n"
              "Content-Type: application/octet-stream\r\n\r\n" % limite).encode("ascii")
             + contenu + ("\r\n--%s--\r\n" % limite).encode("ascii"))
    appel(cfg, "/api/import-mdb", brut=corps, type_contenu="multipart/form-data; boundary=" + limite, delai=600)
    etat["mdb_mtime"] = mt
    etat["dernier_complet"] = time.strftime("%Y-%m-%d")
    rapport(cfg, "ok", message="Fichier .mdb envoyé (%d Ko)." % (len(contenu) // 1024), extra={"envoyes": 1})
    return "Fichier envoyé à PilotRH (%d Ko)." % (len(contenu) // 1024)


def un_cycle(cfg, etat, tout=False):
    """Rend True si tout s'est bien passé. N'échoue jamais : toute panne est expliquée."""
    try:
        res = cycle_fichier(cfg, etat) if cfg.methode == "fichier" else cycle_pointeuse(cfg, etat, tout)
        log("OK — " + res)
        ecrire_etat(etat)
        return True
    except (ErreurPointeuse, ErreurServeur) as e:
        log("ÉCHEC — " + e.message)
        if e.conseil:
            log("   Que faire : " + e.conseil)
        if isinstance(e, ErreurPointeuse):
            try:                                      # la panne doit se voir dans PilotRH, pas seulement ici
                rapport(cfg, "erreur", code=e.code, message=e.message, conseil=e.conseil)
            except Exception:
                pass
    except Exception as e:
        log("ÉCHEC inattendu — %s" % e)
        log(traceback.format_exc(), ecran=False)
        try:
            rapport(cfg, "erreur", code="interne", message="Erreur interne de l'agent : %s" % e)
        except Exception:
            pass
    ecrire_etat(etat)
    return False


# --------------------------------------------------------------- diagnostic
def diagnostic(cfg):
    """Vérifie chaque maillon, dans l'ordre, et s'arrête au premier qui casse.
    N'envoie aucun badgeage et ne modifie rien."""
    sortie = []

    def dire(txt=""):
        sortie.append(txt)
        log(txt)

    def fin(ok):
        dire("")
        dire("=" * 62)
        dire("  RÉSULTAT : " + ("TOUT FONCTIONNE. Vous pouvez lancer DEMARRER.bat." if ok
                                else "un point bloque — voir « Que faire » ci-dessus."))
        dire("=" * 62)
        try:
            with open(os.path.join(DOSSIER, "diagnostic.txt"), "w", encoding="utf-8") as f:
                f.write("\n".join(sortie) + "\n")
            log("Ce compte rendu est enregistré dans le fichier « diagnostic.txt » (à envoyer en cas de besoin).")
        except Exception:
            pass
        return 0 if ok else 1

    def echec(quoi, conseil):
        dire("   [ÉCHEC] " + quoi)
        if conseil:
            dire("   Que faire : " + conseil)
        return fin(False)

    dire("=" * 62)
    dire("  PilotRH — diagnostic de l'agent de la pointeuse (version %s)" % VERSION)
    dire("=" * 62)
    dire("")
    dire("1. Ce PC")
    dire("   [OK] Python %s · %s %s · PC « %s »" % (platform.python_version(), platform.system(),
                                                    platform.release(), socket.gethostname()))
    dire("   Date et heure de ce PC : %s" % time.strftime("%d/%m/%Y %H:%M"))

    dire("")
    dire("2. La configuration (config.ini)")
    pb = cfg.probleme()
    if pb:
        if not cfg.fichier_lu:
            dire("   Le fichier config.ini est absent de ce dossier : %s" % DOSSIER)
        return echec(pb[0], pb[1])
    dire("   [OK] Serveur : %s" % cfg.url)
    dire("   [OK] Accès : %s" % ("clé du kit" if cfg.cle else "compte « %s »" % cfg.login))
    dire("   Méthode : %s" % ("fichier .mdb" if cfg.methode == "fichier" else "lecture directe de la pointeuse"))

    dire("")
    dire("3. Le serveur PilotRH répond-il ?")
    try:
        appel(cfg, "/api/health", delai=30)
        dire("   [OK] PilotRH répond.")
    except ErreurServeur as e:
        return echec(e.message, e.conseil)

    dire("")
    dire("4. PilotRH accepte-t-il cet agent ?")
    try:
        rep = rapport(cfg, "diagnostic", message="Diagnostic lancé sur le PC de l'atelier.")
        dire("   [OK] Clé acceptée.")
    except ErreurServeur as e:
        return echec(e.message, e.conseil)
    r = reglages_effectifs(cfg, rep.get("reglages"))

    if cfg.methode == "fichier":
        dire("")
        dire("5. Le fichier de la pointeuse")
        if not os.path.exists(cfg.mdb):
            return echec("Fichier introuvable : %s" % cfg.mdb,
                         "Vérifiez le chemin (ligne « fichier_mdb » de config.ini). S'il est sur un "
                         "dossier partagé, ce dossier est-il bien accessible depuis ce PC ?")
        dire("   [OK] %s — %d Ko, modifié le %s" % (
            cfg.mdb, os.path.getsize(cfg.mdb) // 1024,
            time.strftime("%d/%m/%Y %H:%M", time.localtime(os.path.getmtime(cfg.mdb)))))
        return fin(True)

    dire("")
    dire("5. La pointeuse est-elle joignable ?  (adresse %s, port %s%s)" % (
        r["ip"], r["port"], " — réglage donné par PilotRH" if not cfg.ip_locale else " — réglage de config.ini"))
    moi = adresse_locale_vers(r["ip"])
    if moi:
        dire("   Adresse de ce PC : %s" % moi)
        if not meme_reseau(moi, r["ip"]):
            dire("   ATTENTION : ce PC (%s) et la pointeuse (%s) ne semblent pas sur le même réseau." % (moi, r["ip"]))
            dire("   Les trois premiers nombres devraient être identiques.")
    ouvert, detail = zkproto.tester_port(r["ip"], r["port"], 5)
    if not ouvert:
        dire("   Le port %s ne répond pas en TCP (%s) ; essai par l'ancien mode UDP à l'étape suivante." % (r["port"], detail))
    else:
        dire("   [OK] Quelque chose répond sur ce port.")

    dire("")
    dire("6. Dialogue avec la pointeuse")
    try:
        p = zkproto.Pointeuse(r["ip"], r["port"], r["motdepasse"], delai=10)
        p.connecter()
        try:
            i = p.infos()
            us = p.utilisateurs()
            pts = p.pointages(us)
        finally:
            p.fermer()
    except ErreurPointeuse as e:
        try:
            rapport(cfg, "erreur", code=e.code, message=e.message, conseil=e.conseil)
        except Exception:
            pass
        conseil = e.conseil
        if e.code in ("injoignable", "refuse"):
            conseil += ("\n      - Sur la pointeuse : Menu → Comm. → Ethernet (ou Réseau) : relevez « Adresse IP »."
                        "\n      - Reportez-la dans PilotRH : Sécurité & accès → Pointeuse, puis Enregistrer."
                        "\n      - Sur ce PC, ouvrez « Invite de commandes » et tapez :  ping %s"
                        "\n        Si le ping ne répond pas : câble, prise réseau, ou PC sur un autre réseau (Wi-Fi invité…)."
                        "\n        Si le ping répond mais pas le port : un autre logiciel ZKTeco est peut-être"
                        "\n        connecté à la pointeuse en même temps — fermez-le.") % r["ip"]
        return echec(e.message, conseil)
    dire("   [OK] Connectée en %s — modèle « %s », n° de série %s" % (i["liaison"], i["nom"] or "?", i["serie"] or "?"))
    dire("   [OK] %d personnes enregistrées, %d badgeages en mémoire" % (len(us), len(pts)))
    if pts:
        dire("   Badgeages du %s au %s" % (min(x["dt"] for x in pts)[:10], max(x["dt"] for x in pts)[:16]))
    if p.ignores:
        dire("   Note : %d enregistrements à date impossible ont été ignorés." % p.ignores)
    ecart = ecart_horloge_min(i.get("heure") or "")
    if ecart is not None:
        if abs(ecart) >= 5:
            dire("   ATTENTION : l'horloge de la pointeuse (%s) a %d minutes d'%s sur ce PC." % (
                i["heure"][:16], abs(ecart), "avance" if ecart > 0 else "retard"))
            dire("   Une horloge fausse donne des heures d'entrée et de sortie fausses : réglez-la sur l'appareil")
            dire("   (Menu → Système → Date/Heure) après avoir vérifié l'heure de ce PC.")
        else:
            dire("   [OK] Horloge de la pointeuse à l'heure (%s)." % i["heure"][:16])
    try:
        rapport(cfg, "diagnostic", message="Diagnostic réussi : pointeuse lue (%d badgeages)." % len(pts),
                pointeuse={"nom": i["nom"], "serie": i["serie"], "liaison": i["liaison"], "pointages": len(pts),
                           "personnes": len(us), "heure": i["heure"], "ecart_horloge_min": ecart, "ip": r["ip"]})
    except Exception:
        pass
    return fin(True)


# ---------------------------------------------------------------- principal
def verrou():
    """Empêche deux agents de tourner en même temps (démarrage automatique + double-clic)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", int(os.environ.get("PILOTRH_AGENT_VERROU", PORT_VERROU))))
        s.listen(1)
        return s
    except OSError:
        return None


def main(argv):
    _sortie_sure()
    cfg = Config()
    if "--diagnostic" in argv:
        return diagnostic(cfg)
    une_fois = "--une-fois" in argv or "--once" in argv
    log("=" * 50)
    log("Agent PilotRH %s démarré sur « %s » (Python %s)." % (VERSION, socket.gethostname(), platform.python_version()))
    pb = cfg.probleme()
    if pb:
        log("ÉCHEC — " + pb[0])
        log("   Que faire : " + pb[1])
        return 2
    v = None
    if not une_fois:
        v = verrou()
        if v is None:
            log("Un agent PilotRH tourne déjà sur ce PC : celui-ci s'arrête (c'est normal).")
            return 0
    log("Serveur : %s · méthode : %s" % (cfg.url, cfg.methode))
    etat = lire_etat()
    etat.pop("vu", None)
    tout = "--tout" in argv
    echecs = 0
    while True:
        ok = un_cycle(cfg, etat, tout)
        tout = False
        if une_fois:
            return 0 if ok else 1
        echecs = 0 if ok else echecs + 1
        minutes = int(etat.get("intervalle") or 30)
        if not ok:                                    # après une panne on réessaie vite, puis on espace
            minutes = min(minutes, (2, 5, 10)[min(echecs, 3) - 1])
        log("Prochaine remontée dans %d min. (Laissez cette fenêtre ouverte ; vous pouvez la réduire.)" % minutes)
        try:
            time.sleep(minutes * 60)
        except KeyboardInterrupt:
            log("Agent arrêté à la demande.")
            return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception:
        log("ERREUR FATALE de l'agent :\n" + traceback.format_exc())
        sys.exit(9)
