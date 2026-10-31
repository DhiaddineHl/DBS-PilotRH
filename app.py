# -*- coding: utf-8 -*-
"""
PilotRH — serveur applicatif (FastAPI + SQLite)
===============================================
- Lit directement le .mdb de la pointeuse ZKTeco (côté serveur)
- Historique des pointages conservé intégralement (table dédiée, jamais écrasée)
- Journal d'audit de chaque modification (inspection du travail / vérifications)
- Photos / documents sur le disque ; OCR + assistant IA via l'API Anthropic

Fiabilité (v3)
--------------
* SQLite en mode WAL + busy_timeout : plus de « database is locked » sous charge.
* UN SEUL verrou d'écriture applicatif autour de toute séquence
  lecture-modification-écriture : deux postes RH ne s'écrasent plus mutuellement.
* Migration du schéma exécutée une seule fois au démarrage (et non à chaque
  connexion), avec table schema_version et index sur pointage(emp, d).
* Sauvegarde automatique quotidienne réelle (sqlite3 .backup + rétention).
* Toute erreur est journalisée côté serveur et renvoyée au client sous une forme
  exploitable : le front n'avale plus les échecs en silence.
* /api/state ne renvoie plus jamais les comptes ni la clé de signature.
"""
import re
import os, json, sqlite3, base64, threading, time, datetime, io, secrets, hashlib, hmac
import logging, shutil, tempfile, contextlib
from fastapi import FastAPI, UploadFile, File, Request, Form, Query
from fastapi.responses import JSONResponse, FileResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
import httpx
import mdb_import
import fiches_import

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("pilotrh")

BASE = os.path.dirname(os.path.abspath(__file__))


def _dossier_donnees():
    """Où écrire la base, les photos, les documents et les sauvegardes.

    Ordre de priorité :
      1. PILOTRH_DATA, si vous l'avez réglée vous-même ;
      2. RAILWAY_VOLUME_MOUNT_PATH — le chemin où Railway monte réellement le
         volume. Sans cette ligne, un volume monté ailleurs que sur /app/data
         était ignoré : l'application écrivait dans le conteneur et TOUT était
         perdu au redéploiement suivant, sans le moindre avertissement ;
      3. ./data, à côté du code (installation locale sur PC).
    """
    for cle in ("PILOTRH_DATA", "RAILWAY_VOLUME_MOUNT_PATH"):
        v = (os.environ.get(cle) or "").strip()
        if v:
            return v
    return os.path.join(BASE, "data")


DATA_DIR = _dossier_donnees()
PHOTO_DIR = os.path.join(DATA_DIR, "photos")
DOC_DIR   = os.path.join(DATA_DIR, "docs")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
DB_PATH   = os.path.join(DATA_DIR, "pilotrh.db")
SEED_MDB  = os.path.join(BASE, "seed", "attBackup.mdb")
API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL     = os.environ.get("PILOTRH_MODEL", "claude-sonnet-4-6")
MDB_PATH  = os.environ.get("PILOTRH_MDB_PATH", "")
SYNC_MIN  = int(os.environ.get("PILOTRH_SYNC_MINUTES", "60"))
TZ_NAME   = os.environ.get("TZ", "Africa/Tunis")

# fenêtre de pointages renvoyée par /api/state (le reste se charge à la demande
# via /api/pointages?frm=&to=) — évite de transférer 3 ans d'historique à chaque
# ouverture de l'application
STATE_WINDOW_DAYS = int(os.environ.get("PILOTRH_STATE_WINDOW_DAYS", "70"))

MAX_UPLOAD_MB = int(os.environ.get("PILOTRH_MAX_UPLOAD_MB", "40"))
BACKUP_KEEP   = int(os.environ.get("PILOTRH_BACKUP_KEEP", "30"))
BACKUP_HOURS  = float(os.environ.get("PILOTRH_BACKUP_HOURS", "24"))

def _preparer_dossiers():
    """Crée les dossiers de données et vérifie qu'on peut vraiment y écrire.

    Sur Railway, le volume est monté AU DÉMARRAGE, par-dessus le dossier que
    l'image avait préparé — et il appartient à root. Un conteneur qui tourne en
    utilisateur non privilégié se heurtait alors à « Permission denied » au
    premier import du module, avec une trace Python de trente lignes qui ne dit
    pas quoi faire. On échoue toujours (mieux vaut ça qu'écrire dans un dossier
    éphémère et perdre les données en silence), mais en expliquant précisément.
    """
    for d in (DATA_DIR, PHOTO_DIR, DOC_DIR, BACKUP_DIR):
        try:
            os.makedirs(d, exist_ok=True)
        except PermissionError:
            raise RuntimeError(_message_droits(d, "créer le dossier"))
        except OSError as e:
            raise RuntimeError("Impossible de créer %s : %s" % (d, e))
    temoin = os.path.join(DATA_DIR, ".ecriture_test")
    try:
        with open(temoin, "w") as f:
            f.write("ok")
        os.remove(temoin)
    except OSError:
        raise RuntimeError(_message_droits(DATA_DIR, "écrire dans le dossier"))


def _message_droits(chemin, quoi):
    par = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") or ""
    lignes = [
        "",
        "PilotRH ne peut pas %s de données : %s" % (quoi, chemin),
        "",
        "Le dossier existe mais n'appartient pas à l'utilisateur qui fait tourner",
        "l'application. Sur Railway, c'est le cas classique : le volume est monté au",
        "démarrage, il appartient à root, et il recouvre le dossier préparé par l'image.",
        "",
        "Ce qu'il faut vérifier, dans l'ordre :",
        "",
        "  1. Le point de montage du volume (Railway → votre service → Volume) :",
        "     il doit être exactement  /app/data",
    ]
    if par and os.path.normpath(par) != os.path.normpath(DATA_DIR):
        lignes += [
            "     Railway annonce le volume sur : %s" % par,
            "     et PilotRH écrit dans        : %s" % DATA_DIR,
            "     → retirez la variable PILOTRH_DATA, ou donnez-lui la même valeur.",
        ]
    lignes += [
        "  2. Que vous utilisez bien le Dockerfile de cette version : son script de",
        "     démarrage (docker-entrypoint.sh) donne les droits sur le volume avant",
        "     de lâcher les privilèges. Une image construite depuis l'ancienne version",
        "     échoue ici, c'est attendu — reconstruisez.",
        "  3. En dépannage immédiat : réglez la variable  PILOTRH_ROOT=1  pour laisser",
        "     l'application tourner en root. Cela débloque tout de suite, mais c'est",
        "     moins sûr : à n'utiliser que le temps de corriger le point 2.",
        "",
    ]
    return "\n".join(lignes)


_preparer_dossiers()

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo(TZ_NAME)
except Exception:                                     # tzdata absent : on reste en heure locale
    TZ = None
    log.warning("Fuseau %s indisponible — horodatages en heure locale du conteneur", TZ_NAME)

def now():
    return datetime.datetime.now(TZ) if TZ else datetime.datetime.now()

def today():
    return now().date()

def ts():
    return now().isoformat(timespec="seconds")

SYNC = {"source": MDB_PATH, "last": None, "mtime": None, "error": None, "employees": 0}

# Dernier contact avec la pointeuse, quelle qu'en soit la voie (agent d'usine,
# lecture réseau directe, import d'un .mdb à la main). Conservé côté serveur pour
# pouvoir alerter quand PLUS RIEN n'arrive : c'est le défaut qui a laissé passer
# des journées entières sans heure de sortie sans que personne ne s'en aperçoive.
POINTEUSE_META = "pointeuse"        # clé du blob meta (réservée au serveur)

# ---------------------------------------------------------------------------
# Base de données : un seul verrou d'écriture, WAL, migration au démarrage
# ---------------------------------------------------------------------------
_WLOCK = threading.RLock()          # sérialise TOUTES les écritures (y compris les
                                    # séquences lire-puis-écrire sur le blob meta)
SCHEMA = 3

def _connect():
    c = sqlite3.connect(DB_PATH, timeout=20.0, isolation_level=None)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA busy_timeout=15000")
    c.execute("PRAGMA foreign_keys=ON")
    return c

@contextlib.contextmanager
def conn_ro():
    """Connexion de lecture (pas de verrou applicatif : WAL autorise les lectures
    concurrentes pendant une écriture)."""
    c = _connect()
    try:
        yield c
    finally:
        c.close()

@contextlib.contextmanager
def conn_rw():
    """Connexion d'écriture. Le verrou applicatif garantit qu'une séquence
    lecture-modification-écriture n'est jamais entrelacée avec une autre."""
    with _WLOCK:
        c = _connect()
        try:
            c.execute("BEGIN IMMEDIATE")
            yield c
            c.execute("COMMIT")
        except Exception:
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            c.close()

def migrate():
    with conn_rw() as c:
        c.execute("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)")
        c.execute("""CREATE TABLE IF NOT EXISTS pointage(
                     d TEXT, emp TEXT, statut TEXT, entree TEXT, sortie TEXT,
                     punches TEXT, hM TEXT, hsM TEXT, manuel TEXT,
                     src TEXT, maj TEXT, par TEXT,
                     PRIMARY KEY(d, emp))""")
        cols = {r[1] for r in c.execute("PRAGMA table_info(pointage)").fetchall()}
        for col in ("punches", "hM", "hsM", "manuel", "src", "maj", "par"):
            if col not in cols:
                c.execute("ALTER TABLE pointage ADD COLUMN %s TEXT" % col)
                log.info("migration : colonne pointage.%s ajoutée", col)
        # l'ancienne table audit n'avait pas de clé : on la recopie dans la
        # nouvelle structure au lieu de perdre l'historique
        acols = {r[1] for r in c.execute("PRAGMA table_info(audit)").fetchall()}
        if acols and "id" not in acols:
            log.info("migration : reconstruction de la table audit")
            c.execute("ALTER TABLE audit RENAME TO audit_v1")
            acols = set()
        if not acols:
            c.execute("""CREATE TABLE IF NOT EXISTS audit(
                         id INTEGER PRIMARY KEY AUTOINCREMENT,
                         ts TEXT, qui TEXT, role TEXT, ip TEXT, action TEXT)""")
            if c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_v1'").fetchone():
                c.execute("INSERT INTO audit(ts,qui,role,ip,action) "
                          "SELECT ts,qui,'','',action FROM audit_v1 ORDER BY ts")
                c.execute("DROP TABLE audit_v1")
        else:
            for col in ("role", "ip"):
                if col not in acols:
                    c.execute("ALTER TABLE audit ADD COLUMN %s TEXT" % col)
        # index : sans eux, chaque ouverture de l'espace salarié balayait toute la table
        c.execute("CREATE INDEX IF NOT EXISTS idx_pointage_emp_d ON pointage(emp, d)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_pointage_d ON pointage(d)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC)")
        c.execute("INSERT OR REPLACE INTO kv(k,v) VALUES('schema',?)", (str(SCHEMA),))

migrate()

def default_settings():
    base = {"actif": True, "debut": "07:30", "fin": "16:30", "pause": 30,
            "tol": 15, "grace": 15, "pauseDe": "12:00", "pauseA": "12:30"}
    sat  = {"actif": True, "debut": "07:30", "fin": "13:00", "pause": 0,
            "tol": 15, "grace": 15, "pauseDe": "", "pauseA": ""}
    jours = {str(d): dict(base) for d in (1, 2, 3, 4, 5)}
    jours["6"] = sat
    jours["0"] = {"actif": False}
    return {"modeHS": "fin", "jours": jours, "periodes": [],
            "arrondi": 0, "arrondiSens": "proche", "arrondiPortee": "jour",
            "feriesActifs": True, "feriesFixes": mdb_import.FERIES_FIXES,
            "feries": [], "clotures": [],
            # taux par défaut de la convention : repli quand la fiche n'en a pas
            "tauxHoraireDefaut": 0, "tauxJourDefaut": 0}

mdb_import.default_settings = default_settings

# ---------------------------------------------------------------------------
# État applicatif (blob meta) — les comptes et le secret de session en sortent
# ---------------------------------------------------------------------------
# Clés que le CLIENT est autorisé à écrire. « users » et « _secret » n'y sont
# volontairement PLUS : sans cela, n'importe quel compte pouvait se nommer
# administrateur ou choisir la clé de signature des sessions.
CLIENT_META_KEYS = ("employees", "settings", "documents", "conges", "absences", "signalements", "exclus")
SERVER_META_KEYS = ("users", "_secret", "pointeuse")
# retirés de la réponse envoyée au navigateur : les comptes et la clé de signature
# ne doivent jamais en sortir ; les notes et sondages ont leur propre endpoint
SECRETES = set(SERVER_META_KEYS) | {"notes", "votes"}

def _read_meta(c):
    r = c.execute("SELECT v FROM kv WHERE k='meta'").fetchone()
    return json.loads(r[0]) if r else {}

def get_meta(prive=True):
    """prive=True : état complet (usage interne). prive=False : état expurgé,
    sans comptes ni secret — c'est ce qui part vers le navigateur."""
    with conn_ro() as c:
        m = _read_meta(c)
    if not m:
        m = {"employees": [], "settings": default_settings(),
             "documents": [], "conges": [], "absences": []}
    m.setdefault("employees", [])
    m.setdefault("documents", [])
    m.setdefault("conges", [])
    m.setdefault("absences", [])
    m.setdefault("signalements", [])
    m.setdefault("exclus", [])
    if not m.get("settings"):
        m["settings"] = default_settings()
    if not prive:
        m = {k: v for k, v in m.items() if k not in SECRETES}
    return m

def _valid_meta(partial):
    """Refuse une écriture manifestement corrompue : sans ce garde-fou, un
    POST {"employees": 0} rendait l'application définitivement inutilisable."""
    if not isinstance(partial, dict):
        raise ValueError("corps JSON invalide")
    for k in ("employees", "documents", "conges", "absences", "signalements", "exclus", "users"):
        if k in partial and partial[k] is not None and not isinstance(partial[k], list):
            raise ValueError("le champ '%s' doit être une liste" % k)
    if "settings" in partial and partial["settings"] is not None and not isinstance(partial["settings"], dict):
        raise ValueError("le champ 'settings' doit être un objet")
    if "employees" in partial and isinstance(partial["employees"], list):
        for e in partial["employees"]:
            if not isinstance(e, dict) or not e.get("id"):
                raise ValueError("chaque employée doit être un objet avec un 'id'")
    return True

def set_meta(partial, cles=CLIENT_META_KEYS):
    _valid_meta(partial)
    with conn_rw() as c:
        cur = _read_meta(c)
        for k in cles:
            if k in partial and partial[k] is not None:
                cur[k] = partial[k]
        if not cur.get("settings"):
            cur["settings"] = default_settings()
        c.execute("INSERT OR REPLACE INTO kv(k,v) VALUES('meta',?)",
                  (json.dumps(cur, ensure_ascii=False),))
    return True

def set_meta_serveur(partial):
    return set_meta(partial, cles=CLIENT_META_KEYS + SERVER_META_KEYS)


POINTEUSE_DEFAUT = {"ip": "192.168.1.201", "port": 4370, "motdepasse": 0,
                    "intervalle": 30, "alerte_h": 24, "note": ""}


def pointeuse_reglages():
    r = dict(POINTEUSE_DEFAUT)
    r.update((get_meta().get(POINTEUSE_META) or {}).get("reglages") or {})
    return r


def pointeuse_etat():
    p = get_meta().get(POINTEUSE_META) or {}
    return p.get("etat") or {}


def _note_contact(voie, pointages=0, jours=0, employees=0, erreur_msg=None, qui=""):
    """Enregistre le dernier contact avec la pointeuse. Appelé par TOUTES les voies
    d'entrée : sans cela, l'application ne peut pas savoir qu'elle ne reçoit plus
    rien — et un silence de trois jours ne se voit qu'au moment de la paie."""
    with _WLOCK:
        m = get_meta()
        p = dict(m.get(POINTEUSE_META) or {})
        etat = dict(p.get("etat") or {})
        if erreur_msg:
            etat["derniere_erreur"] = {"ts": ts(), "voie": voie, "message": str(erreur_msg)[:300]}
        else:
            etat.update({"ts": ts(), "voie": voie, "pointages": int(pointages or 0),
                         "jours": int(jours or 0), "employees": int(employees or 0),
                         "par": qui or ""})
            etat["derniere_erreur"] = None
        p["etat"] = etat
        set_meta_serveur({POINTEUSE_META: p})
    return etat


def pointeuse_silence_h():
    """Heures écoulées depuis le dernier pointage reçu (None si jamais rien reçu)."""
    e = pointeuse_etat()
    if not e.get("ts"):
        return None
    try:
        t = datetime.datetime.fromisoformat(str(e["ts"]))
        maintenant = now()
        if t.tzinfo is None and maintenant.tzinfo is not None:
            maintenant = maintenant.replace(tzinfo=None)
        return max(0.0, (maintenant - t).total_seconds() / 3600.0)
    except Exception:
        return None

def _rec_from_row(row):
    d, emp, st, e, s, p, hm, hsm, man, src = row
    rec = {"statut": st, "entree": e or "", "sortie": s or ""}
    if p:
        try: rec["punches"] = json.loads(p)
        except Exception: pass
    for champ, val in (("hM", hm), ("hsM", hsm)):
        if val not in (None, ""):
            try: rec[champ] = int(val)
            except Exception: pass
    if man not in (None, "", "0"):
        rec["manuel"] = 1
    if src:
        rec["src"] = src
    return d, emp, rec

_SEL = "SELECT d,emp,statut,entree,sortie,punches,hM,hsM,manuel,src FROM pointage"

def get_pointages(frm=None, to=None):
    with conn_ro() as c:
        if frm or to:
            rows = c.execute(_SEL + " WHERE d>=? AND d<=?", (frm or "0000", to or "9999")).fetchall()
        else:
            rows = c.execute(_SEL).fetchall()
    out = {}
    for row in rows:
        d, emp, rec = _rec_from_row(row)
        out.setdefault(d, {})[emp] = rec
    return out

def get_state(prive=True, frm=None, to=None):
    m = get_meta(prive=prive)
    m["pointages"] = get_pointages(frm, to)
    return m

def _rec_row(d, emp, r, par="", src=None):
    return (d, emp, r.get("statut", "absent"), r.get("entree", ""), r.get("sortie", ""),
            json.dumps(r["punches"]) if r.get("punches") else None,
            str(r["hM"]) if r.get("hM") not in (None, "") else None,
            str(r["hsM"]) if r.get("hsM") not in (None, "") else None,
            "1" if r.get("manuel") else None,
            src if src is not None else r.get("src"),
            ts(), par)

_INS = ("INSERT OR REPLACE INTO pointage"
        "(d,emp,statut,entree,sortie,punches,hM,hsM,manuel,src,maj,par)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")

def write_pointages(rows):
    with conn_rw() as c:
        c.executemany(_INS, rows)
    return len(rows)

def set_state(s, remplacer=False, par="Système"):
    """remplacer=True : restauration réelle (la table est vidée d'abord), au lieu
    d'une fusion qui laissait subsister les journées erronées."""
    _valid_meta(s)
    pts = s.get("pointages") or {}
    rows = [_rec_row(d, emp, r, par) for d, day in pts.items()
            if isinstance(day, dict) for emp, r in day.items() if isinstance(r, dict)]
    with conn_rw() as c:
        cur = _read_meta(c)
        for k in CLIENT_META_KEYS:
            if k in s and s[k] is not None:
                cur[k] = s[k]
        if not cur.get("settings"):
            cur["settings"] = default_settings()
        c.execute("INSERT OR REPLACE INTO kv(k,v) VALUES('meta',?)",
                  (json.dumps(cur, ensure_ascii=False),))
        if remplacer:
            c.execute("DELETE FROM pointage")
        if rows:
            c.executemany(_INS, rows)
    return len(rows)

def audit(qui, action, role="", ip=""):
    try:
        with conn_rw() as c:
            c.execute("INSERT INTO audit(ts,qui,role,ip,action) VALUES(?,?,?,?,?)",
                      (ts(), str(qui)[:120], str(role)[:40], str(ip)[:60], str(action)[:1000]))
    except Exception:
        log.exception("échec d'écriture du journal d'audit")

def empty_state():
    return {"employees": [], "settings": default_settings(),
            "pointages": {}, "documents": [], "conges": [], "absences": []}

# --- amorçage : importe la base fournie au premier démarrage -----------------
with conn_ro() as _c:
    _has = _c.execute("SELECT 1 FROM kv WHERE k='meta'").fetchone()
if not _has:
    s = empty_state()
    if os.path.exists(SEED_MDB) and os.environ.get("PILOTRH_SEED", "1") != "0":
        try:
            s = mdb_import.merge(s, SEED_MDB)
            log.info("[seed] %d employées · %d jours", len(s["employees"]), len(s["pointages"]))
        except Exception:
            log.exception("[seed] échec de l'amorçage")
    set_state(s)
    audit("Système", "Amorçage initial de la base")

# ---------------------------------------------------------------------------
# Sauvegarde automatique (celle que l'interface annonçait sans l'implémenter)
# ---------------------------------------------------------------------------
def faire_backup(motif="auto"):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    nom = "pilotrh_%s_%s.db" % (now().strftime("%Y%m%d_%H%M%S"), motif)
    dest = os.path.join(BACKUP_DIR, nom)
    src = _connect()
    try:
        # .backup() produit une copie COHÉRENTE même pendant les écritures,
        # contrairement à un simple cp du fichier .db
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    fichiers = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith(".db"))
    for vieux in fichiers[:-BACKUP_KEEP]:
        try: os.remove(os.path.join(BACKUP_DIR, vieux))
        except OSError: pass
    log.info("sauvegarde écrite : %s (%.1f Mo)", nom, os.path.getsize(dest) / 1e6)
    return {"fichier": nom, "taille": os.path.getsize(dest), "ts": ts()}

def _backup_loop():
    while True:
        try:
            faire_backup("auto")
            audit("Système", "Sauvegarde automatique")
        except Exception:
            log.exception("échec de la sauvegarde automatique")
        time.sleep(max(3600, int(BACKUP_HOURS * 3600)))

threading.Thread(target=_backup_loop, daemon=True).start()

# --- synchronisation réseau -------------------------------------------------
_SYNC_LOCK = threading.Lock()

def do_sync(force=False):
    if not MDB_PATH:
        SYNC["error"] = "PILOTRH_MDB_PATH non configuré"; return SYNC
    if not os.path.exists(MDB_PATH):
        SYNC["error"] = "fichier introuvable : " + MDB_PATH; return SYNC
    if not _SYNC_LOCK.acquire(blocking=False):
        SYNC["error"] = "synchronisation déjà en cours"; return SYNC
    try:
        mt = os.path.getmtime(MDB_PATH)
        if not force and SYNC["mtime"] == mt:
            return SYNC
        s = mdb_import.merge(get_state(), MDB_PATH)
        set_state(s, par="Pointeuse")
        ensure_tokens_persist()
        SYNC.update(mtime=mt, error=None, employees=len(s["employees"]), last=ts())
        audit("Système", "Synchronisation pointeuse (%d employées)" % SYNC["employees"])
        _note_contact("dossier surveillé", jours=len(s["pointages"]),
                      employees=len(s["employees"]), qui="Système")
        log.info("[sync] %s", SYNC["last"])
    except Exception as e:
        SYNC["error"] = str(e)
        log.exception("échec de synchronisation")
    finally:
        _SYNC_LOCK.release()
    return SYNC

def _sync_loop():
    while True:
        time.sleep(max(60, SYNC_MIN * 60))
        do_sync()

if MDB_PATH:
    threading.Thread(target=_sync_loop, daemon=True).start()
    threading.Thread(target=lambda: do_sync(force=True), daemon=True).start()

app = FastAPI(title="PilotRH")

ADMIN_PW = os.environ.get("PILOTRH_ADMIN_PASSWORD", "")
OPEN_MODE = os.environ.get("PILOTRH_OPEN", "").lower() in ("1", "true", "yes", "oui", "on")

# ---------------------------------------------------------------------------
# Comptes utilisateurs + rôles + sessions
# ---------------------------------------------------------------------------
ROLES = {"admin": "Administrateur", "rh": "RH",
         "atelier": "Chef d'atelier", "lecture": "Lecture seule"}

PBKDF2_ITERS = 210000          # recommandation OWASP courante
PBKDF2_LEGACY = 100000         # ce qu'utilisaient les versions précédentes

def _pbkdf2(pw, salt, iters):
    return hashlib.pbkdf2_hmac("sha256", str(pw).encode(), salt.encode(), iters).hex()

def _hash_pw(pw, salt=None, iters=PBKDF2_ITERS):
    """Format : sel$itérations$empreinte.
    L'ancien format (sel$empreinte, 100 000 itérations) reste accepté à la
    vérification : sans cela, augmenter le nombre d'itérations aurait bloqué
    TOUS les comptes existants au premier redémarrage après la mise à jour."""
    salt = salt or secrets.token_hex(8)
    return "%s$%d$%s" % (salt, iters, _pbkdf2(pw, salt, iters))

def _check_pw(pw, stored):
    try:
        parts = str(stored).split("$")
        if len(parts) == 3:
            salt, iters, h = parts[0], int(parts[1]), parts[2]
        elif len(parts) == 2:
            salt, iters, h = parts[0], PBKDF2_LEGACY, parts[1]      # ancien format
        else:
            return False
        return hmac.compare_digest(_pbkdf2(pw, salt, iters), h)
    except Exception:
        return False

def _besoin_rehash(stored):
    """Un mot de passe encore stocké à l'ancien format sera réenregistré au
    format renforcé lors de la prochaine connexion réussie."""
    parts = str(stored).split("$")
    if len(parts) == 2:
        return True
    try:
        return len(parts) == 3 and int(parts[1]) < PBKDF2_ITERS
    except Exception:
        return False

def _rehash(login, pw):
    with _WLOCK:
        users = get_meta().get("users", [])
        for u in users:
            if u.get("login", "").lower() == str(login).lower():
                u["pass"] = _hash_pw(pw)
        set_meta_serveur({"users": users})

def _secret():
    s = os.environ.get("PILOTRH_SESSION_SECRET", "")
    if s:
        return s
    with _WLOCK:
        m = get_meta()
        s = m.get("_secret")
        if not s:
            s = secrets.token_hex(24)
            set_meta_serveur({"_secret": s})
    return s

RESET_ADMIN = os.environ.get("PILOTRH_RESET_ADMIN", "")

def reset_admin():
    """Dépannage : si PILOTRH_RESET_ADMIN est définie au démarrage, le mot de passe
    du compte « admin » est remis à cette valeur (le compte est recréé s'il a
    disparu). À utiliser puis À RETIRER : tant que la variable reste en place, le
    mot de passe est réécrit à chaque redémarrage."""
    if not RESET_ADMIN:
        return
    if len(RESET_ADMIN) < 8:
        log.error("PILOTRH_RESET_ADMIN ignorée : 8 caractères minimum requis")
        return
    with _WLOCK:
        users = get_meta().get("users", []) or []
        admin = next((u for u in users if u.get("login", "").lower() == "admin"), None)
        if admin:
            admin["pass"] = _hash_pw(RESET_ADMIN)
            admin["role"] = "admin"
        else:
            users.append({"login": "admin", "nom": "Administrateur",
                          "role": "admin", "pass": _hash_pw(RESET_ADMIN)})
        set_meta_serveur({"users": users})
    audit("Système", "Mot de passe administrateur réinitialisé (PILOTRH_RESET_ADMIN)")
    log.warning("=" * 68)
    log.warning("Mot de passe du compte « admin » réinitialisé.")
    log.warning("RETIREZ maintenant la variable PILOTRH_RESET_ADMIN, puis redéployez.")
    log.warning("=" * 68)

def ensure_users():
    if get_meta().get("users"):
        return
    pw = ADMIN_PW
    genere = False
    if not pw:
        pw = secrets.token_urlsafe(9)
        genere = True
    set_meta_serveur({"users": [{"login": "admin", "nom": "Administrateur",
                                "role": "admin", "pass": _hash_pw(pw)}]})
    if genere:
        log.warning("=" * 68)
        log.warning("PILOTRH_ADMIN_PASSWORD n'est pas définie.")
        log.warning("Compte admin créé avec un mot de passe ALÉATOIRE : %s", pw)
        log.warning("Notez-le maintenant, il ne sera plus affiché.")
        log.warning("=" * 68)

def _find_user(login):
    for u in get_meta().get("users", []):
        if u.get("login", "").lower() == str(login).lower():
            return u
    return None

def _sign_session(u, days=7):
    exp = int(time.time()) + days * 86400
    payload = base64.urlsafe_b64encode(json.dumps(
        {"login": u["login"], "role": u["role"], "nom": u.get("nom", ""), "exp": exp}).encode()).decode()
    sig = hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return payload + "." + sig

def _read_session(request):
    tok = request.cookies.get("pilotrh_sess", "")
    if "." not in tok:
        return None
    payload, sig = tok.rsplit(".", 1)
    good = hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, good):
        return None
    try:
        d = json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except Exception:
        return None
    return d if d.get("exp", 0) >= time.time() else None

def _basic_user(request):
    auth = request.headers.get("authorization", "")
    if auth.startswith("Basic "):
        try:
            login, pw = base64.b64decode(auth[6:]).decode().split(":", 1)
            u = _find_user(login)
            if u and _check_pw(pw, u["pass"]):
                return {"login": u["login"], "role": u["role"], "nom": u.get("nom", "")}
        except Exception:
            pass
    return None

def _current_user(request):
    return _read_session(request) or _basic_user(request)

def _acteur(request, defaut="RH"):
    """L'auteur d'une modification est déterminé par la SESSION, jamais par le
    corps de la requête : sinon un chef d'atelier pouvait signer « RH »."""
    if OPEN_MODE:
        return "Poste local", "admin"
    u = _current_user(request)
    if not u:
        return defaut, "lecture"
    return (u.get("nom") or u.get("login") or defaut), u.get("role", "lecture")

def _ip(request):
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))

# L'espace salarié n'a pas de session : chaque appel porte le jeton de la carte QR
# et l'endpoint vérifie lui-même ce jeton (_find_by_token). Ces chemins doivent
# donc échapper au portier d'authentification — sinon la salariée reçoit
# « non_connecte » et l'action est perdue.
#
# TOUT nouvel endpoint /api/me/... doit être ajouté ici. L'oubli est passé
# inaperçu pour /api/me/lu et /api/me/vote : les tests appelaient la fonction
# directement, donc sans traverser le portier. Un test énumère désormais les
# routes déclarées et refuse tout /api/me/... absent de cette liste.
PUBLIC_SALARIE = ("/api/me", "/api/me/flag", "/api/me/lu", "/api/me/vote")

PUBLIC_EXACT = set(PUBLIC_SALARIE) | {
    "/moi", "/moi.html", "/login", "/login.html", "/api/login",
    "/api/logout", "/api/health", "/favicon.ico",
    # le service worker et le manifeste doivent être servis à la RACINE :
    # un service worker déposé sous /assets/ n'a autorité que sur /assets/,
    # donc il n'interceptait jamais /moi — l'espace salarié n'était en
    # réalité ni installable ni utilisable hors ligne.
    "/sw.js", "/manifest.webmanifest"}
PUBLIC_PREFIXES = ("/assets/",)
ADMIN_ONLY = ("/api/users",)
RH_PLUS = ("/api/employee/delete", "/api/import-mdb", "/api/punches", "/api/sync",
           "/api/pull-device", "/api/qr-codes.pdf", "/api/backup", "/api/ai", "/api/ocr")
WRITE_PREFIXES = ("/api/pointage", "/api/pointages/bulk", "/api/day", "/api/state",
                  "/api/state-meta", "/api/employee")

def _est_public(p):
    return p in PUBLIC_EXACT or any(p.startswith(x) for x in PUBLIC_PREFIXES)

@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Connexion obligatoire (sauf espace salarié). Applique les rôles."""
    p = request.url.path
    if not OPEN_MODE and not _est_public(p):
        user = _current_user(request)
        if not user:
            if p.startswith("/api"):
                return JSONResponse({"error": "non_connecte"}, status_code=401)
            return RedirectResponse("/login", status_code=302)
        role = user.get("role", "lecture")
        if any(p.startswith(x) for x in ADMIN_ONLY) and role != "admin":
            return JSONResponse({"error": "Réservé à l'administrateur"}, status_code=403)
        if any(p.startswith(x) for x in RH_PLUS) and role not in ("admin", "rh"):
            return JSONResponse({"error": "Action non autorisée pour votre rôle"}, status_code=403)
        if role == "lecture" and request.method in ("POST", "PUT", "PATCH", "DELETE") \
           and any(p.startswith(x) for x in WRITE_PREFIXES):
            return JSONResponse({"error": "Compte en lecture seule"}, status_code=403)
    resp = await call_next(request)
    if p.startswith("/api"):
        resp.headers["Cache-Control"] = "no-store"
    elif p in ("/", "/moi", "/login") or p.endswith(".html"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["X-Frame-Options"] = "DENY"
    return resp

@app.exception_handler(Exception)
async def _boom(request: Request, exc: Exception):
    """Une exception non prévue ne doit ni exposer les chemins du serveur, ni
    laisser le front sans réponse exploitable."""
    ref = secrets.token_hex(4)
    log.exception("erreur non gérée [%s] %s %s", ref, request.method, request.url.path)
    return JSONResponse({"error": "Erreur interne du serveur", "ref": ref}, status_code=500)

def erreur(msg, code=400):
    return JSONResponse({"error": msg}, status_code=code)

# ---------------------------------------------------------------------------
# Clôture de mois : un mois clos n'est plus modifiable
# ---------------------------------------------------------------------------
def _clotures():
    return set((get_meta().get("settings") or {}).get("clotures") or [])

def _mois_clos(dates):
    cl = _clotures()
    return sorted({str(d)[:7] for d in dates if str(d)[:7] in cl})

# ---------------------------------------------------------------------------
# État
# ---------------------------------------------------------------------------
def _resume_pointeuse():
    """Résumé non confidentiel de la liaison, joint à l'état pour que l'alerte
    « pointeuse muette » puisse s'afficher sans appel supplémentaire. Les réglages
    complets (adresse, mot de passe de communication) restent sur /api/pointeuse."""
    h = pointeuse_silence_h()
    seuil = +pointeuse_reglages().get("alerte_h", 24) or 24
    return {"silence_h": (round(h, 2) if h is not None else None),
            "muet": (h is None or h > seuil), "seuil_h": seuil,
            "voie": (pointeuse_etat() or {}).get("voie", "")}


@app.get("/api/state")
def api_state(pointages: str = Query("fenetre", pattern="^(fenetre|tout|aucun)$")):
    """Renvoie l'état SANS les comptes ni la clé de signature, et par défaut avec
    seulement une fenêtre récente de pointages (le reste via /api/pointages)."""
    if pointages == "tout":
        m = get_state(prive=False)
        m["pointeuse"] = _resume_pointeuse()
        return m
    if pointages == "aucun":
        m = get_meta(prive=False); m["pointages"] = {}; m["fenetre"] = None
        m["pointeuse"] = _resume_pointeuse()
        return m
    to = today()
    frm = to - datetime.timedelta(days=STATE_WINDOW_DAYS)
    m = get_meta(prive=False)
    m["pointages"] = get_pointages(frm.isoformat(), to.isoformat())
    m["fenetre"] = {"du": frm.isoformat(), "au": to.isoformat()}
    m["pointeuse"] = _resume_pointeuse()
    return m

@app.post("/api/state")
async def api_set_state(req: Request, remplacer: int = 0):
    b = await req.json()
    qui, role = _acteur(req)
    try:
        n = await run_in_threadpool(set_state, b, bool(remplacer), qui)
    except ValueError as e:
        return erreur(str(e))
    audit(qui, "%s de la base (%d pointages)" % ("Restauration complète" if remplacer else "Import / fusion", n),
          role, _ip(req))
    return {"ok": True, "pointages": n}

@app.post("/api/state-meta")
async def api_set_meta(req: Request):
    b = await req.json()
    qui, role = _acteur(req)
    try:
        await run_in_threadpool(set_meta, b)
    except ValueError as e:
        return erreur(str(e))
    # cette écriture n'était pas journalisée : les changements de salaire et
    # d'horaires ne laissaient aucune trace
    audit(qui, "Mise à jour des données de référence (%s)" % ", ".join(k for k in CLIENT_META_KEYS if k in b),
          role, _ip(req))
    return {"ok": True}

@app.post("/api/employee/delete")
async def api_employee_delete(req: Request):
    b = await req.json()
    eid = b.get("id")
    qui, role = _acteur(req)
    with _WLOCK:
        m = get_meta()
        emps = m.get("employees", [])
        target = next((e for e in emps if e.get("id") == eid), None)
        if not target:
            return erreur("Employée introuvable", 404)
        badge = str(target.get("matricule") or target.get("cin") or "").strip()
        exclus = set(str(x) for x in m.get("exclus", []))
        if badge:
            exclus.add(badge)
        set_meta({"employees": [e for e in emps if e.get("id") != eid],
                  "exclus": sorted(exclus)})
        with conn_rw() as c:
            c.execute("DELETE FROM pointage WHERE emp=?", (eid,))
    audit(qui, "Employée supprimée (démission) · %s %s [badge %s]"
          % (target.get("prenom", ""), target.get("nom", ""), badge or "?"), role, _ip(req))
    return {"ok": True, "exclus": sorted(exclus)}

# ---------------------------------------------------------------------------
# Fiches du personnel — modèle à remplir et import en masse
# ---------------------------------------------------------------------------
@app.get("/api/employees/modele.xlsx")
def api_modele_fiches(request: Request, actuels: int = 0):
    """Classeur à remplir. actuels=1 : préremplit avec les fiches existantes,
    pour corriger en masse plutôt que tout retaper."""
    u = _current_user(request)
    if not u or u.get("role") not in ("admin", "rh"):
        return erreur("Réservé aux RH", 403)
    emps = get_meta()["employees"] if actuels else None
    try:
        data = fiches_import.modele_xlsx(emps)
    except Exception as e:
        log.exception("modèle de fiches")
        return erreur("Génération du modèle impossible : %s" % e, 500)
    nom = "PilotRH_fiches_actuelles.xlsx" if actuels else "PilotRH_modele_fiches.xlsx"
    return Response(content=data,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="%s"' % nom})


@app.post("/api/employees/import-fiches")
async def api_import_fiches(req: Request,
                            file: UploadFile = File(...),
                            appliquer: int = Form(0)):
    """Deux temps : appliquer=0 renvoie l'aperçu ligne par ligne sans rien
    écrire, appliquer=1 écrit. Aucun pointage n'est touché, aucune fiche
    supprimée."""
    u = _current_user(req)
    if not u or u.get("role") not in ("admin", "rh"):
        return erreur("Réservé aux RH", 403)
    try:
        data = await _lire_upload(file, max_mo=12)
    except ValueError as e:
        return erreur(str(e), 413)
    qui, role = _acteur(req)

    def _travail():
        lignes, inconnues = fiches_import.lire(file.filename or "", data)
        if not lignes:
            raise ValueError("Aucune ligne à traiter dans ce fichier.")
        if appliquer:
            with _WLOCK:
                m = get_meta()
                rap = fiches_import.analyser(m, lignes)
                res = fiches_import.appliquer(m, rap)
                set_meta({"employees": m["employees"]})
            ensure_tokens_persist()      # les fiches créées reçoivent leur accès QR
            rap["applique"] = res
        else:
            rap = fiches_import.analyser(get_meta(), lignes)
        rap["inconnues"] = inconnues
        rap["fichier"] = file.filename or ""
        return rap

    try:
        rap = await run_in_threadpool(_travail)
    except ValueError as e:
        return erreur(str(e))
    except Exception as e:
        log.exception("import de fiches")
        return erreur("Lecture impossible : %s" % e)
    if appliquer:
        a = rap.get("applique") or {}
        audit(qui, "Import de fiches (%d créée(s), %d mise(s) à jour) depuis %s"
              % (a.get("crees", 0), a.get("majs", 0), rap.get("fichier") or "?"), role, _ip(req))
    return rap


# ---------------------------------------------------------------------------
# Pointages
# ---------------------------------------------------------------------------
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")

@app.post("/api/pointage")
async def api_pointage(req: Request):
    b = await req.json()
    d, emp = str(b.get("date", "")), str(b.get("id", ""))
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
        return erreur("Date invalide")
    if not _ID_RE.match(emp):
        return erreur("Identifiant employée invalide")
    clos = _mois_clos([d])
    if clos:
        return erreur("Le mois %s est clôturé : rouvrez-le pour le modifier." % clos[0], 409)
    qui, role = _acteur(req)
    await run_in_threadpool(write_pointages, [_rec_row(d, emp, b, qui, b.get("src") or "manuel")])
    audit(qui, "Pointage modifié · %s · %s (%s %s-%s%s)"
          % (emp, d, b.get("statut"), b.get("entree", ""), b.get("sortie", ""),
             " · %sh saisies" % b.get("hM") if b.get("hM") not in (None, "") else ""),
          role, _ip(req))
    return {"ok": True}

@app.post("/api/pointages/bulk")
async def api_pointages_bulk(req: Request):
    """Écriture groupée (validation d'un congé, import CSV…) en une transaction."""
    b = await req.json()
    items = b.get("recs") or []
    if not isinstance(items, list) or not items:
        return erreur("Aucun pointage transmis")
    if len(items) > 20000:
        return erreur("Trop de lignes en une seule fois (max 20000)")
    dates = []
    rows = []
    qui, role = _acteur(req)
    src = b.get("src") or "manuel"
    for it in items:
        d, emp = str(it.get("date", "")), str(it.get("id", ""))
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d) or not _ID_RE.match(emp):
            return erreur("Ligne invalide : date=%r id=%r" % (d, emp))
        dates.append(d)
        rows.append(_rec_row(d, emp, it, qui, it.get("src") or src))
    clos = _mois_clos(dates)
    if clos:
        return erreur("Mois clôturé(s) concerné(s) : %s" % ", ".join(clos), 409)
    n = await run_in_threadpool(write_pointages, rows)
    audit(qui, "%s · %d pointages sur %d jour(s) [%s]"
          % (b.get("motif") or "Écriture groupée", n, len(set(dates)), src), role, _ip(req))
    return {"ok": True, "ecrits": n}

@app.post("/api/day")
async def api_day(req: Request):
    b = await req.json()
    d = str(b.get("date", "")); recs = b.get("recs") or {}
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
        return erreur("Date invalide")
    clos = _mois_clos([d])
    if clos:
        return erreur("Le mois %s est clôturé." % clos[0], 409)
    qui, role = _acteur(req)
    rows = [_rec_row(d, emp, r, qui, r.get("src") or "manuel")
            for emp, r in recs.items() if _ID_RE.match(str(emp)) and isinstance(r, dict)]
    await run_in_threadpool(write_pointages, rows)
    audit(qui, "Journée créée/mise à jour · %s (%d employées)" % (d, len(rows)), role, _ip(req))
    return {"ok": True, "ecrits": len(rows)}

@app.get("/api/pointages")
def api_pointages(frm: str = "", to: str = ""):
    """Chargement fenêtré — c'est ce que l'interface utilise désormais au lieu de
    rapatrier trois ans d'historique à chaque ouverture."""
    if not frm or not to:
        return erreur("Paramètres 'frm' et 'to' obligatoires")
    if to < frm:
        frm, to = to, frm
    jours = (datetime.date.fromisoformat(to) - datetime.date.fromisoformat(frm)).days
    if jours > 1500:
        return erreur("Plage trop large (max ~4 ans)")
    return get_pointages(frm, to)

@app.get("/api/stats/absenteisme")
def api_stats_abs(mois: int = Query(6, ge=1, le=36)):
    """Taux d'absentéisme mensuel RÉEL. L'interface affichait jusqu'ici une courbe
    codée en dur (4,2 / 3,8 / 5,1 …) qui ne venait pas des données."""
    t = today()
    out = []
    y, m = t.year, t.month
    fenetres = []
    for _ in range(mois):
        fenetres.append((y, m))
        m -= 1
        if m == 0: y, m = y - 1, 12
    fenetres.reverse()
    with conn_ro() as c:
        for (yy, mm) in fenetres:
            debut = datetime.date(yy, mm, 1)
            fin = (datetime.date(yy + 1, 1, 1) if mm == 12 else datetime.date(yy, mm + 1, 1)) - datetime.timedelta(days=1)
            if fin > t: fin = t
            r = c.execute("SELECT COUNT(*), SUM(CASE WHEN statut='absent' THEN 1 ELSE 0 END) "
                          "FROM pointage WHERE d>=? AND d<=?",
                          (debut.isoformat(), fin.isoformat())).fetchone()
            tot, abs_ = (r[0] or 0), (r[1] or 0)
            out.append({"mois": "%04d-%02d" % (yy, mm),
                        "taux": round(abs_ * 100.0 / tot, 1) if tot else 0.0,
                        "jours": tot, "absences": abs_})
    return out

@app.get("/api/audit")
def api_audit(limit: int = Query(50, ge=1, le=500)):
    with conn_ro() as c:
        rows = c.execute("SELECT ts,qui,role,ip,action FROM audit ORDER BY id DESC LIMIT ?",
                         (limit,)).fetchall()
    return [{"ts": t, "qui": q, "role": r, "ip": i, "action": a} for t, q, r, i, a in rows]

# ---------------------------------------------------------------------------
# Imports pointeuse
# ---------------------------------------------------------------------------
async def _lire_upload(file: UploadFile, max_mo=None):
    """Lecture bornée : un envoi de plusieurs Go faisait tomber le conteneur."""
    limite = (max_mo or MAX_UPLOAD_MB) * 1024 * 1024
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 256)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > limite:
            raise ValueError("Fichier trop volumineux (limite %d Mo)" % (max_mo or MAX_UPLOAD_MB))
    return bytes(buf)

_IMPORT_LOCK = threading.Lock()

@app.post("/api/import-mdb")
async def api_import_mdb(req: Request,
                         file: UploadFile = File(...),
                         du: str = Form(mdb_import.DEFAULT_DU),
                         au: str = Form("")):
    try:
        data = await _lire_upload(file)
    except ValueError as e:
        return erreur(str(e), 413)
    if not _IMPORT_LOCK.acquire(blocking=False):
        return erreur("Un import est déjà en cours, réessayez dans un instant.", 409)
    tmp = None
    qui, role = _acteur(req)
    try:
        # fichier temporaire UNIQUE : deux imports simultanés ne se mélangent plus
        fd, tmp = tempfile.mkstemp(suffix=".mdb", dir=DATA_DIR)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        def _travail():
            s = mdb_import.merge(get_state(), tmp, du, au or None)
            set_state(s, par=qui)
            ensure_tokens_persist()      # les nouvelles employées reçoivent leur accès
            return s
        s = await run_in_threadpool(_travail)
        audit(qui, "Import .mdb (%d employées, %d jours)" % (len(s["employees"]), len(s["pointages"])),
              role, _ip(req))
        _note_contact("fichier", jours=len(s["pointages"]), employees=len(s["employees"]), qui=qui)
        # on ne renvoie plus l'état complet (il contenait les hashes et le secret) :
        # un résumé suffit, le client recharge ce dont il a besoin
        return {"ok": True, "employees": len(s["employees"]), "jours": len(s["pointages"])}
    except Exception as e:
        log.exception("échec import .mdb")
        return erreur("Import impossible : %s" % e)
    finally:
        _IMPORT_LOCK.release()
        if tmp:
            try: os.remove(tmp)
            except OSError: pass

@app.post("/api/punches")
async def api_punches(req: Request):
    """Reçoit les pointages lus directement sur la pointeuse par l'agent d'usine.
    Corps JSON : {"users":[{"badge","name","sexe"}], "punches":[{"badge","dt"}]}"""
    b = await req.json()
    users = b.get("users", []) or []
    punches = b.get("punches", []) or []
    if not punches:
        return erreur("aucun pointage reçu")
    qui, role = _acteur(req, "Pointeuse")
    try:
        def _travail():
            s = mdb_import.merge_punches(get_state(), users, punches, au=(b.get("au") or None))
            set_state(s, par="Pointeuse")
            ensure_tokens_persist()
            return s
        s = await run_in_threadpool(_travail)
        audit("Pointeuse", "Import direct pointeuse · %d pointages, %d employées"
              % (len(punches), len(s["employees"])), role, _ip(req))
        _note_contact("agent", pointages=len(punches), jours=len(s["pointages"]),
                      employees=len(s["employees"]), qui=qui)
        return {"ok": True, "employees": len(s["employees"]), "jours": len(s["pointages"])}
    except Exception as e:
        log.exception("échec import direct")
        _note_contact("agent", erreur_msg=e, qui=qui)
        return erreur("Import impossible : %s" % e)

@app.post("/api/sync")
def api_sync():
    return do_sync(force=True)

DEVICE_ALLOW = [x.strip() for x in os.environ.get("PILOTRH_DEVICE_ALLOWLIST", "").split(",") if x.strip()]


# ---------------------------------------------------------------------------
# Pointeuse : réglages réseau et surveillance du dernier contact
# ---------------------------------------------------------------------------
@app.get("/api/pointeuse")
def api_pointeuse(request: Request):
    """Réglages + état de la liaison, pour l'écran de configuration."""
    u = _current_user(request) or {}
    rh = (u.get("role") in ("admin", "rh"))
    if not rh:
        # un chef d'atelier a besoin de savoir si la liaison est muette, pas de
        # connaître l'adresse ni le mot de passe de communication de l'appareil
        return {"reglages": {}, "etat": pointeuse_etat(),
                "silence_h": pointeuse_silence_h(), "peut_modifier": False,
                "lecture_directe_possible": False, "pyzk": False,
                "mdb_path": "", "sync": {}, "url_publique": "",
                "compte_agent_existe": True}
    return {"reglages": pointeuse_reglages(),
            "etat": pointeuse_etat(),
            "silence_h": pointeuse_silence_h(),
            # ce que le serveur peut faire lui-même dépend de son emplacement :
            # sur un hébergeur public, il ne peut pas joindre une IP privée
            "lecture_directe_possible": bool(DEVICE_ALLOW) or not bool(
                os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_PROJECT_ID")),
            "pyzk": _pyzk_present(),
            "mdb_path": MDB_PATH,
            "sync": SYNC,
            "url_publique": PUBLIC_URL,
            "peut_modifier": True,
            "compte_agent_existe": any(x.get("login") == "agent" for x in (get_meta().get("users") or []))}


def _pyzk_present():
    try:
        import zk  # noqa: F401
        return True
    except Exception:
        return False


@app.post("/api/pointeuse")
async def api_pointeuse_set(req: Request):
    u = _current_user(req) or {}
    if u.get("role") not in ("admin", "rh"):
        return erreur("Réservé aux RH", 403)
    b = await req.json()
    r = pointeuse_reglages()
    ip = str(b.get("ip") or r["ip"]).strip()
    if ip and not _ip_valide(ip):
        return erreur("Adresse IP invalide : « %s ». Exemple attendu : 192.168.1.201" % ip)
    try:
        port = int(b.get("port") or r["port"])
        mdp = int(b.get("motdepasse") or 0)
        inter = int(b.get("intervalle") or r["intervalle"])
        alerte = int(b.get("alerte_h") or r["alerte_h"])
    except (TypeError, ValueError):
        return erreur("Port, mot de passe, intervalle et délai d'alerte doivent être des nombres.")
    if port not in (4370, 4371):
        return erreur("Port inattendu pour une pointeuse ZKTeco (4370 par défaut).")
    if not (5 <= inter <= 1440):
        return erreur("L'intervalle doit être compris entre 5 minutes et 24 heures.")
    if not (1 <= alerte <= 240):
        return erreur("Le délai d'alerte doit être compris entre 1 et 240 heures.")
    with _WLOCK:
        m = get_meta()
        p = dict(m.get(POINTEUSE_META) or {})
        p["reglages"] = {"ip": ip, "port": port, "motdepasse": mdp, "intervalle": inter,
                         "alerte_h": alerte, "note": str(b.get("note") or "")[:200]}
        set_meta_serveur({POINTEUSE_META: p})
    qui, role = _acteur(req)
    audit(qui, "Réglages de la pointeuse modifiés (%s:%d, toutes les %d min)" % (ip, port, inter),
          role, _ip(req))
    return {"ok": True, "reglages": pointeuse_reglages()}


def _ip_valide(ip):
    try:
        import ipaddress
        ipaddress.ip_address(ip)
        return True
    except Exception:
        return False


@app.get("/api/pointeuse/agent.txt")
def api_agent_config(request: Request):
    """Fichier de configuration prêt à coller à côté de l'agent d'usine. Évite de
    faire modifier un fichier Python à la main sur le PC de l'atelier."""
    u = _current_user(request) or {}
    if u.get("role") not in ("admin", "rh"):
        return erreur("Réservé aux RH", 403)
    r = pointeuse_reglages()
    base = PUBLIC_URL or "https://VOTRE-APP.up.railway.app"
    txt = "\n".join([
        "REM  ---------------------------------------------------------------",
        "REM  PilotRH — configuration de l'agent d'usine",
        "REM  Placez ce fichier a cote de pilotrh_agent.py, sous le nom",
        "REM  lancer_agent.bat, et double-cliquez dessus.",
        "REM",
        "REM  Le mot de passe ci-dessous est celui du compte de service 'agent'",
        "REM  (Securite & acces). Ne mettez JAMAIS le mot de passe administrateur",
        "REM  sur un PC d'atelier.",
        "REM  ---------------------------------------------------------------",
        "@echo off",
        "chcp 65001 >nul",
        'set "PILOTRH_URL=%s"' % base,
        'set "PILOTRH_LOGIN=agent"',
        'set "PILOTRH_PASSWORD=A_REMPLACER_PAR_LE_MOT_DE_PASSE_DU_COMPTE_AGENT"',
        'set "PILOTRH_METHODE=pointeuse"',
        'set "PILOTRH_DEVICE_IP=%s"' % r["ip"],
        'set "PILOTRH_DEVICE_PORT=%d"' % r["port"],
        'set "PILOTRH_DEVICE_PW=%d"' % r["motdepasse"],
        'set "PILOTRH_INTERVAL_MIN=%d"' % r["intervalle"],
        "",
        "REM  Methode fichier .mdb : mettez PILOTRH_METHODE=fichier et decommentez",
        'REM  set "PILOTRH_MDB=C:\\ZKTeco\\attBackup.mdb"',
        "",
        "python pilotrh_agent.py",
        "pause",
        "",
    ])
    return Response(content=txt.encode("utf-8"), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="lancer_agent.bat"'})

def _ip_privee(ip):
    try:
        import ipaddress
        a = ipaddress.ip_address(ip)
        return a.is_private and not a.is_loopback and not a.is_link_local
    except Exception:
        return False

@app.post("/api/pull-device")
async def api_pull_device(req: Request):
    """Se connecte directement à la pointeuse ZKTeco (réseau) et importe les pointages."""
    b = await req.json()
    # à défaut de valeurs dans la requête, on prend les réglages enregistrés :
    # l'adresse de la pointeuse se saisit une fois pour toutes dans l'application
    reg = pointeuse_reglages()
    ip = str(b.get("ip") or reg["ip"]).strip()
    port = int(b.get("port") or reg["port"])
    pw = int(b.get("password") or reg["motdepasse"] or 0)
    # la pointeuse est forcément sur le réseau local : on refuse de faire sonder
    # une adresse publique ou un service interne d'hébergeur par le serveur
    if DEVICE_ALLOW and ip not in DEVICE_ALLOW:
        return erreur("Adresse non autorisée. Adresses permises : %s" % ", ".join(DEVICE_ALLOW), 403)
    if not DEVICE_ALLOW and not _ip_privee(ip):
        return erreur("Seule une adresse IP locale (192.168.x.x, 10.x.x.x…) est acceptée.", 403)
    if port not in (4370, 4371):
        return erreur("Port inattendu pour une pointeuse ZKTeco (4370 attendu).", 400)
    try:
        from zk import ZK
    except ImportError:
        return erreur("Module 'pyzk' non installé sur ce poste (pip install pyzk).")
    qui, role = _acteur(req, "Pointeuse")
    conn = None
    try:
        conn = ZK(ip, port=port, timeout=20, password=pw, force_udp=False, ommit_ping=False).connect()
        conn.disable_device()
        users = conn.get_users() or []
        att = conn.get_attendance() or []
        conn.enable_device()
        urows = [{"badge": str(u.user_id or u.uid), "name": u.name or "",
                  "sexe": getattr(u, "gender", "") or ""} for u in users]
        prows = [{"badge": str(a.user_id), "dt": a.timestamp.strftime("%Y-%m-%d %H:%M:%S")}
                 for a in att if a.timestamp]
        def _travail():
            s = mdb_import.merge_punches(get_state(), urows, prows)
            set_state(s, par="Pointeuse")
            ensure_tokens_persist()
            return s
        s = await run_in_threadpool(_travail)
        audit("Pointeuse", "Import réseau direct · %d pointages, %d employées"
              % (len(prows), len(s["employees"])), role, _ip(req))
        _note_contact("reseau", pointages=len(prows), jours=len(s["pointages"]),
                      employees=len(s["employees"]), qui=qui)
        return {"ok": True, "employees": len(s["employees"]), "jours": len(s["pointages"]),
                "pointages": len(prows)}
    except Exception as e:
        log.exception("échec connexion pointeuse")
        _note_contact("reseau", erreur_msg=e, qui=qui)
        return erreur("Connexion à la pointeuse impossible : %s" % e)
    finally:
        try:
            if conn: conn.disconnect()
        except Exception:
            pass

# ---------------------------------------------------------------------------
# Photos
# ---------------------------------------------------------------------------
@app.post("/api/employee/{eid}/photo")
async def api_photo(req: Request, eid: str, file: UploadFile = File(...)):
    # eid non validé permettait, sous Windows, d'écrire hors du dossier de données
    if not _ID_RE.match(eid):
        return erreur("Identifiant employée invalide")
    if not any(e.get("id") == eid for e in get_meta().get("employees", [])):
        return erreur("Employée introuvable", 404)
    try:
        data = await _lire_upload(file, max_mo=8)
    except ValueError as e:
        return erreur(str(e), 413)
    if not data[:3] in (b"\xff\xd8\xff",) and not data[:8].startswith(b"\x89PNG"):
        return erreur("Format non reconnu — envoyez une image JPEG ou PNG.")
    path = os.path.realpath(os.path.join(PHOTO_DIR, eid + ".jpg"))
    if not path.startswith(os.path.realpath(PHOTO_DIR) + os.sep):
        return erreur("Chemin invalide")
    with open(path, "wb") as f:
        f.write(data)
    url = "/photos/" + eid + ".jpg"
    qui, role = _acteur(req)
    with _WLOCK:
        m = get_meta()
        for e in m["employees"]:
            if e["id"] == eid:
                e["photo"] = url
        set_meta({"employees": m["employees"]})
    audit(qui, "Photo mise à jour · %s" % eid, role, _ip(req))
    return {"photo": url}

@app.get("/photos/{fn}")
def photos(fn: str):
    # /photos n'est plus public : les noms de fichiers étaient séquentiels et
    # devinables, tout le trombinoscope était téléchargeable sans compte
    p = os.path.join(PHOTO_DIR, os.path.basename(fn))
    return FileResponse(p) if os.path.exists(p) else Response(status_code=404)

# ---------------------------------------------------------------------------
# IA / OCR
# ---------------------------------------------------------------------------
_AI_QUOTA = {}
_AI_LOCK = threading.Lock()
_AI_MAX_PAR_HEURE = int(os.environ.get("PILOTRH_AI_QUOTA", "40"))

def _quota_ok(cle):
    h = int(time.time() // 3600)
    k = (cle, h)
    with _AI_LOCK:
        for kk in [x for x in _AI_QUOTA if x[1] != h]:
            _AI_QUOTA.pop(kk, None)
        _AI_QUOTA[k] = _AI_QUOTA.get(k, 0) + 1
        return _AI_QUOTA[k] <= _AI_MAX_PAR_HEURE

async def _anthropic(payload):
    if not API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY non configurée")
    async with httpx.AsyncClient(timeout=120) as cli:
        r = await cli.post("https://api.anthropic.com/v1/messages",
            headers={"x-api-key": API_KEY, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"}, json=payload)
    d = r.json()
    if r.status_code >= 400:
        log.warning("Anthropic %s : %s", r.status_code, str(d)[:300])
        raise RuntimeError("Le service d'IA a refusé la requête (%s)." % r.status_code)
    return "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")

@app.post("/api/ai")
async def api_ai(req: Request):
    b = await req.json()
    qui, role = _acteur(req)
    if not _quota_ok(qui):
        return erreur("Quota d'assistance IA atteint pour cette heure (%d requêtes)." % _AI_MAX_PAR_HEURE, 429)
    msgs = b.get("messages") or []
    if not isinstance(msgs, list) or not msgs:
        return erreur("Aucune question transmise")
    total = sum(len(str(m.get("content", ""))) for m in msgs) + len(str(b.get("system", "")))
    if total > 120000:
        return erreur("Question trop volumineuse")
    try:
        return {"text": await _anthropic({"model": MODEL, "max_tokens": 1024,
                "system": b.get("system", ""), "messages": msgs})}
    except Exception as e:
        return erreur(str(e), 503)

@app.post("/api/ocr")
async def api_ocr(req: Request, file: UploadFile = File(...), names: str = Form("")):
    qui, role = _acteur(req)
    if not _quota_ok(qui):
        return erreur("Quota de lecture automatique atteint pour cette heure.", 429)
    try:
        raw = await _lire_upload(file, max_mo=12)
    except ValueError as e:
        return erreur(str(e), 413)
    b64 = base64.b64encode(raw).decode()
    media = "application/pdf" if (file.filename or "").lower().endswith(".pdf") else (file.content_type or "image/jpeg")
    sys = ("Tu es un moteur OCR RH (usine textile tunisienne). Réponds UNIQUEMENT en JSON strict, "
           "sans markdown: {type, nom, date_debut(YYYY-MM-DD), date_fin, resume, employee_match}. "
           "employee_match = le nom le plus proche parmi: " + names[:8000])
    content = [{"type": "document" if media == "application/pdf" else "image",
                "source": {"type": "base64", "media_type": media, "data": b64}},
               {"type": "text", "text": "Analyse ce document RH."}]
    try:
        out = {"text": await _anthropic({"model": MODEL, "max_tokens": 1024, "system": sys,
               "messages": [{"role": "user", "content": content}]})}
        audit(qui, "Document analysé par IA (%s)" % (file.filename or "?")[:80], role, _ip(req))
        return out
    except Exception as e:
        return erreur(str(e), 503)

# ---------------------------------------------------------------------------
# Santé / sauvegardes
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"ok": True}

@app.get("/api/health/detail")
def health_detail():
    m = get_meta()
    with conn_ro() as c:
        n = c.execute("SELECT COUNT(DISTINCT d) FROM pointage").fetchone()[0]
    sauv = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith(".db"))
    return {"ok": True, "employees": len(m.get("employees", [])),
            "jours_pointage": n, "ia": bool(API_KEY), "sync": SYNC,
            "schema": SCHEMA, "tz": TZ_NAME, "data_dir": DATA_DIR,
            "sauvegardes": len(sauv), "derniere_sauvegarde": sauv[-1] if sauv else None}

@app.get("/api/backups")
def api_backups():
    out = []
    for f in sorted((f for f in os.listdir(BACKUP_DIR) if f.endswith(".db")), reverse=True):
        p = os.path.join(BACKUP_DIR, f)
        out.append({"fichier": f, "taille": os.path.getsize(p),
                    "date": datetime.datetime.fromtimestamp(os.path.getmtime(p)).isoformat(timespec="seconds")})
    return {"dossier": BACKUP_DIR, "conserve": BACKUP_KEEP, "sauvegardes": out}

@app.post("/api/backup/now")
async def api_backup_now(req: Request):
    qui, role = _acteur(req)
    try:
        info = await run_in_threadpool(faire_backup, "manuel")
    except Exception as e:
        log.exception("échec sauvegarde manuelle")
        return erreur("Sauvegarde impossible : %s" % e, 500)
    audit(qui, "Sauvegarde manuelle · %s" % info["fichier"], role, _ip(req))
    return info

# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------
def _rl(x):
    """Échappe le balisage ReportLab : les cellules viennent de la requête et
    <img src="…"/> y était interprété."""
    from xml.sax.saxutils import escape
    return escape("" if x is None else str(x))

@app.post("/api/report/pdf")
async def report_pdf(req: Request):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    b = await req.json()
    INK = colors.HexColor("#1a1d29"); GOLD = colors.HexColor("#8a6d1f")
    LINE = colors.HexColor("#e7e1d4"); SOFT = colors.HexColor("#fbf9f4")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4),
                            leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=12*mm)
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], textColor=INK, fontSize=18, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=ss["Normal"], textColor=colors.HexColor("#5c6270"), fontSize=10, spaceAfter=10)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=GOLD, fontSize=12, spaceBefore=10, spaceAfter=4)
    el = [Paragraph(_rl(b.get("title", "Rapport")), h1)]
    if b.get("subtitle"):
        el.append(Paragraph(_rl(b["subtitle"]), sub))
    if b.get("note"):
        el.append(Paragraph(_rl(b["note"]), sub))
    avail = landscape(A4)[0] - 28 * mm
    cellSt = ParagraphStyle("cell", parent=ss["Normal"], fontSize=8, leading=9.5)
    hdrSt = ParagraphStyle("hdr", parent=ss["Normal"], fontSize=8, leading=9.5,
                           textColor=colors.white, fontName="Helvetica-Bold")
    for sec in b.get("sections", []):
        el.append(Paragraph(_rl(sec.get("title", "")), h2))
        cols = sec.get("columns") or []
        n = max(1, len(cols))
        wts = []
        for c in cols:
            lc = str(c).lower()
            wts.append(2.6 if lc.startswith("nom") else (1.1 if "mat" in lc else 1.0))
        tot = sum(wts) or 1
        cw = [avail * w / tot for w in wts]
        header = [Paragraph(_rl(c), hdrSt) for c in cols]
        rows = sec.get("rows") or [["—"] * n]
        body = [[Paragraph(_rl(x), cellSt) for x in r] for r in rows]
        t = Table([header] + body, colWidths=cw, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), INK),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
        el.append(t); el.append(Spacer(1, 6))
    el.append(Spacer(1, 8))
    qui, _role = _acteur(req)
    el.append(Paragraph("Édité le %s par %s — PilotRH · Lassanis"
                        % (now().strftime("%d/%m/%Y %H:%M"), _rl(qui)),
                        ParagraphStyle("foot", parent=ss["Normal"], textColor=colors.HexColor("#7b8291"), fontSize=8)))
    doc.build(el)
    raw = b.get("title", "rapport")
    fn = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(raw).replace(" ", "_")).strip("_") or "rapport"
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="%s.pdf"' % fn})

# ---------------------------------------------------------------------------
# Espace salarié
# ---------------------------------------------------------------------------
def ensure_tokens_persist():
    """Attribue un jeton secret + un code à 6 chiffres aux employées qui n'en ont
    pas. Le code est tiré avec `secrets` (et non `random`, prédictible)."""
    with _WLOCK:
        m = get_meta(); changed = False
        for e in m["employees"]:
            if not e.get("token"):
                e["token"] = secrets.token_urlsafe(12); changed = True
            if not e.get("pin"):
                e["pin"] = "%06d" % secrets.randbelow(1000000); changed = True
        if changed:
            set_meta({"employees": m["employees"]})
        return m

ensure_users()
reset_admin()          # dépannage : PILOTRH_RESET_ADMIN
ensure_tokens_persist()

def _find_by_token(t):
    if not t:
        return None
    for e in get_meta()["employees"]:
        if e.get("token") and hmac.compare_digest(str(e["token"]), str(t)):
            return e
    return None

# anti-force brute : le code à quelques chiffres était devinable en quelques
# minutes, l'endpoint renvoyant un oracle parfait
_PIN_FAILS = {}
def _pin_bloque(cle):
    n, jusqu = _PIN_FAILS.get(cle, (0, 0))
    return time.time() < jusqu
def _pin_echec(cle):
    n, _ = _PIN_FAILS.get(cle, (0, 0))
    n += 1
    delai = 0 if n < 5 else min(900, 15 * (2 ** (n - 5)))
    _PIN_FAILS[cle] = (n, time.time() + delai)
def _pin_ok(cle):
    _PIN_FAILS.pop(cle, None)

def _jours_emp(eid, frm, to):
    with conn_ro() as c:
        rows = c.execute(_SEL + " WHERE emp=? AND d>=? AND d<=?", (eid, frm, to)).fetchall()
    return {d: rec for d, _e, rec in (_rec_from_row(r) for r in rows)}

def _me_payload(e, mois=""):
    t = today()
    first = t.replace(day=1)
    if mois and len(mois) == 7:
        try:
            y, mo = int(mois[:4]), int(mois[5:7])
            cand = datetime.date(y, mo, 1)
            if cand <= first:
                first = cand
        except Exception:
            pass
    y, mo = first.year, first.month
    nextm = datetime.date(y + 1, 1, 1) if mo == 12 else datetime.date(y, mo + 1, 1)
    last = nextm - datetime.timedelta(days=1)
    to = min(last, t)
    jours = _jours_emp(e["id"], first.isoformat(), to.isoformat())

    m = get_meta()
    st = m.get("settings") or {}
    p_du = p_end = None
    if st.get("congesDu") and st.get("congesAu"):
        try:
            p_du = datetime.date.fromisoformat(str(st["congesDu"]))
            p_end = datetime.date.fromisoformat(str(st["congesAu"]))
        except Exception:
            p_du = p_end = None
    if not p_du or not p_end or p_end < p_du:
        cd = str(st.get("congesDebut", "08-15"))
        try:
            cmonth, cday = int(cd[:2]), int(cd[3:5])
        except Exception:
            cmonth, cday = 8, 15
        ref_year = t.year if (t.month, t.day) >= (cmonth, cday) else t.year - 1
        try:
            p_du = datetime.date(ref_year, cmonth, cday)
            p_end = datetime.date(ref_year + 1, cmonth, cday) - datetime.timedelta(days=1)
        except Exception:
            p_du, p_end = datetime.date(ref_year, 8, 15), datetime.date(ref_year + 1, 8, 14)
    p_to = min(p_end, t)
    cjours = _jours_emp(e["id"], p_du.isoformat(), p_to.isoformat())
    conges = {"du": p_du.isoformat(), "au": p_end.isoformat(),
              "auEffectif": p_to.isoformat(), "jours": cjours}
    notes, votes = _coms_pour(e)
    return {"notes": notes, "votes": votes,
            "nom": e.get("nom", ""), "prenom": e.get("prenom", ""),
            "matricule": e.get("matricule") or e.get("cin") or e["id"],
            "categorie": e.get("categorie", ""), "sexe": e.get("sexe", "F"),
            "mois": first.strftime("%Y-%m"),
            "today": t.isoformat(), "settings": st, "jours": jours, "conges": conges}

@app.post("/api/me")
async def api_me_post(req: Request):
    """Le jeton et le code passent désormais dans le CORPS de la requête : en
    query string, ils finissaient en clair dans les journaux d'accès du serveur
    et dans l'historique des téléphones partagés en atelier."""
    b = await req.json()
    t = str(b.get("t") or "")
    pin = str(b.get("pin") or "")
    mois = str(b.get("mois") or "")
    e = _find_by_token(t)
    if not e:
        return erreur("Lien invalide", 401)
    cle = e["id"] + "|" + _ip(req)
    if _pin_bloque(cle):
        return erreur("Trop de tentatives. Patientez quelques minutes.", 429)
    attendu = str(e.get("pin") or "")
    if not attendu:
        return erreur("Accès non configuré — demandez votre code au service RH.", 403)
    if not hmac.compare_digest(pin, attendu):
        _pin_echec(cle)
        return JSONResponse({"need_pin": True}, status_code=401)
    _pin_ok(cle)
    return _me_payload(e, mois)

@app.get("/api/me")
def api_me(t: str = "", pin: str = "", mois: str = ""):
    """Ancienne forme conservée pour ne pas casser un QR déjà distribué : elle ne
    fait plus que demander au client de repasser par POST."""
    if not t:
        return erreur("Lien invalide", 401)
    return JSONResponse({"need_pin": True, "post": True}, status_code=401)

@app.post("/api/me/flag")
async def api_me_flag(req: Request):
    b = await req.json()
    e = _find_by_token(str(b.get("t") or ""))
    if not e:
        return erreur("invalide", 401)
    cle = "flag|" + e["id"]
    if _pin_bloque(cle):
        return erreur("Vous avez déjà envoyé plusieurs signalements. Patientez.", 429)
    _pin_echec(cle)
    qui = (e.get("prenom", "") + " " + e.get("nom", "")).strip()
    # le message était concaténé brut dans le journal d'audit, lui-même réaffiché
    # sans échappement dans l'écran d'administration
    msg = re.sub(r"[<>\r\n\t]", " ", str(b.get("message", ""))).strip()[:500]
    date = str(b.get("date", ""))[:10]
    if not msg:
        return erreur("Message vide")
    audit(qui, "Signalement salarié · %s · %s" % (date, msg), "salarie", _ip(req))
    with _WLOCK:
        m = get_meta()
        sig = m.get("signalements") or []
        sig.append({"emp": e["id"], "nom": qui, "date": date, "message": msg,
                    "ts": ts(), "traite": False})
        set_meta({"signalements": sig[-2000:]})
    return {"ok": True}

@app.get("/moi")
def page_salarie():
    return FileResponse(os.path.join(BASE, "static", "moi.html"))


# ---------------------------------------------------------------------------
# Application installable : le service worker doit être servi depuis la racine
# ---------------------------------------------------------------------------
# La portée d'un service worker est limitée au dossier d'où il est servi. Déposé
# sous /assets/, il ne contrôlait que /assets/ : la navigation vers /moi n'était
# jamais interceptée, l'espace salarié ne démarrait pas hors ligne et Android
# refusait souvent de proposer « Ajouter à l'écran d'accueil ». On le sert donc
# depuis / (et on garde l'en-tête Service-Worker-Allowed par sécurité).
@app.get("/sw.js")
def service_worker():
    return FileResponse(os.path.join(ASSETS, "sw.js"), media_type="text/javascript",
                        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest")
def web_manifest():
    return FileResponse(os.path.join(ASSETS, "manifest.webmanifest"),
                        media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"})

PUBLIC_URL = os.environ.get("PILOTRH_PUBLIC_URL", "").rstrip("/")

@app.get("/api/qr-codes.pdf")
def qr_codes_pdf(request: Request, codes: int = 0):
    """PDF de cartes QR (une par employée) à imprimer et distribuer.
    Par défaut le code n'est PAS imprimé sur la carte : QR et code sur le même
    support, ce n'est pas un second facteur. Utiliser ?codes=1 pour la liste
    séparée à remettre en main propre."""
    import qrcode
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Image, Spacer
    INK = colors.HexColor("#1a1d29"); GOLD = colors.HexColor("#8a6d1f"); LINE = colors.HexColor("#e7e1d4")
    # l'URL était construite depuis l'en-tête Host fourni par le client : un
    # simple `curl -H "Host: …"` produisait des QR pointant ailleurs
    base = PUBLIC_URL or str(request.base_url).rstrip("/")
    emps = sorted(get_meta()["employees"], key=lambda e: (e.get("nom", ""), e.get("prenom", "")))
    ss = getSampleStyleSheet()
    nm = ParagraphStyle("nm", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=10, textColor=INK, alignment=1, spaceBefore=4)
    sm = ParagraphStyle("sm", parent=ss["Normal"], fontSize=8, textColor=colors.HexColor("#5c6270"), alignment=1)
    pn = ParagraphStyle("pn", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=11, textColor=GOLD, alignment=1, spaceBefore=2)

    def card(e):
        url = "%s/moi?t=%s" % (base, e.get("token", ""))
        q = qrcode.QRCode(box_size=10, border=1); q.add_data(url); q.make()
        img = q.make_image(fill_color="#1a1d29", back_color="white")
        buf = io.BytesIO(); img.save(buf, format="PNG"); buf.seek(0)
        mat = e.get("matricule") or e.get("cin") or e["id"]
        cell = [Image(buf, width=34*mm, height=34*mm),
                Paragraph(_rl("%s %s" % (e.get('prenom', ''), e.get('nom', ''))), nm),
                Paragraph(_rl("Matricule %s" % mat), sm)]
        if codes:
            cell.append(Paragraph(_rl("Code : %s" % e.get('pin', '------')), pn))
        return cell

    cells, row = [], []
    for e in emps:
        row.append(card(e))
        if len(row) == 3:
            cells.append(row); row = []
    if row:
        while len(row) < 3:
            row.append("")
        cells.append(row)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12*mm, rightMargin=12*mm, topMargin=14*mm, bottomMargin=12*mm)
    head = ParagraphStyle("h", parent=ss["Title"], fontSize=15, textColor=INK)
    sub = ParagraphStyle("s", parent=ss["Normal"], fontSize=9, textColor=colors.HexColor("#5c6270"), spaceAfter=8)
    txt = ("Lassanis · Chaque salariée scanne son QR puis saisit son code personnel pour consulter "
           "ses présences, retards et absences du mois. Document confidentiel.")
    if codes:
        txt += " ATTENTION : cette version imprime les codes — à remettre en main propre, séparément des cartes."
    el = [Paragraph("Espace salarié — accès au pointage", head), Paragraph(txt, sub)]
    t = Table(cells, colWidths=[60*mm]*3)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                           ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
                           ("BOX", (0, 0), (-1, -1), 0.4, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE)]))
    el.append(t)
    doc.build(el)
    qui, role = _acteur(request)
    audit(qui, "Génération du PDF des QR codes%s" % (" AVEC les codes" if codes else ""), role, _ip(request))
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="qr_codes_personnel.pdf"'})

@app.post("/api/employee/{eid}/reset-acces")
async def api_reset_acces(req: Request, eid: str):
    """Régénère jeton + code d'une salariée (carte perdue). Il n'existait aucun
    moyen de révoquer un accès sans éditer la base à la main."""
    if not _ID_RE.match(eid):
        return erreur("Identifiant invalide")
    qui, role = _acteur(req)
    if role not in ("admin", "rh"):
        return erreur("Réservé aux RH", 403)
    with _WLOCK:
        m = get_meta()
        e = next((x for x in m["employees"] if x.get("id") == eid), None)
        if not e:
            return erreur("Employée introuvable", 404)
        e["token"] = secrets.token_urlsafe(12)
        e["pin"] = "%06d" % secrets.randbelow(1000000)
        set_meta({"employees": m["employees"]})
        pin = e["pin"]
    audit(qui, "Accès espace salarié régénéré · %s" % eid, role, _ip(req))
    return {"ok": True, "pin": pin}

# ---------------------------------------------------------------------------
# Notes de service & sondages
# ---------------------------------------------------------------------------
# Chaque salariée possède déjà un accès personnel (QR + code) : on s'en sert pour
# diffuser des notes de service et poser des questions. Les notes et sondages sont
# stockés dans le blob meta sous les clés 'notes' et 'votes' — écrites uniquement
# par le serveur, jamais acceptées depuis /api/state-meta.
COMS_KEYS = ("notes", "votes")

def _coms():
    m = get_meta()
    return (m.get("notes") or []), (m.get("votes") or [])

def _set_coms(notes=None, votes=None):
    with _WLOCK:
        cur = get_meta()
        partial = {}
        if notes is not None: partial["notes"] = notes[-500:]
        if votes is not None: partial["votes"] = votes[-300:]
        set_meta(partial, cles=COMS_KEYS)

def _cible_ok(e, cible):
    cible = cible or {}
    if cible.get("service") and e.get("service") != cible["service"]:
        return False
    if cible.get("atelier") and e.get("atelier") != cible["atelier"]:
        return False
    if cible.get("categorie") and e.get("categorie") != cible["categorie"]:
        return False
    return e.get("actif", True) is not False

def _propre(s, n):
    return re.sub(r"[\r\t]", " ", str(s or "")).strip()[:n]

@app.get("/api/coms")
def api_coms():
    notes, votes = _coms()
    return {"notes": list(reversed(notes)), "votes": list(reversed(votes))}

@app.post("/api/coms/note")
async def api_coms_note(req: Request):
    b = await req.json()
    titre = _propre(b.get("titre"), 120)
    texte = _propre(b.get("texte"), 3000)
    if not titre or not texte:
        return erreur("Titre et message obligatoires")
    qui, role = _acteur(req)
    notes, _ = _coms()
    notes.append({"id": "N" + secrets.token_hex(5), "titre": titre, "texte": texte,
                  "cible": {k: _propre((b.get("cible") or {}).get(k), 40) for k in ("service", "atelier", "categorie")},
                  "fin": _propre((b.get("cible") or {}).get("fin"), 10),
                  "important": bool(b.get("important")),
                  "ts": ts(), "par": qui, "lus": []})
    _set_coms(notes=notes)
    audit(qui, "Note de service publiée · %s" % titre, role, _ip(req))
    return {"ok": True}

@app.post("/api/coms/note/delete")
async def api_coms_note_del(req: Request):
    b = await req.json()
    qui, role = _acteur(req)
    notes, _ = _coms()
    _set_coms(notes=[n for n in notes if n.get("id") != b.get("id")])
    audit(qui, "Note de service supprimée · %s" % b.get("id"), role, _ip(req))
    return {"ok": True}

@app.post("/api/coms/vote")
async def api_coms_vote(req: Request):
    b = await req.json()
    question = _propre(b.get("question"), 200)
    options = [_propre(o, 80) for o in (b.get("options") or []) if _propre(o, 80)][:8]
    if not question or len(options) < 2:
        return erreur("Une question et au moins deux réponses sont nécessaires")
    qui, role = _acteur(req)
    _, votes = _coms()
    votes.append({"id": "V" + secrets.token_hex(5), "question": question, "options": options,
                  "cible": {k: _propre((b.get("cible") or {}).get(k), 40) for k in ("service", "atelier", "categorie")},
                  "fin": _propre((b.get("cible") or {}).get("fin"), 10),
                  "anonyme": bool(b.get("anonyme", True)),
                  "resultats": [0] * len(options), "votants": [], "detail": {},
                  "ferme": False, "ts": ts(), "par": qui})
    _set_coms(votes=votes)
    audit(qui, "Sondage lancé · %s" % question, role, _ip(req))
    return {"ok": True}

@app.post("/api/coms/vote/close")
async def api_coms_vote_close(req: Request):
    b = await req.json()
    qui, role = _acteur(req)
    _, votes = _coms()
    for v in votes:
        if v.get("id") == b.get("id"):
            v["ferme"] = True
    _set_coms(votes=votes)
    audit(qui, "Sondage clos · %s" % b.get("id"), role, _ip(req))
    return {"ok": True}

@app.post("/api/coms/vote/delete")
async def api_coms_vote_del(req: Request):
    b = await req.json()
    qui, role = _acteur(req)
    _, votes = _coms()
    _set_coms(votes=[v for v in votes if v.get("id") != b.get("id")])
    audit(qui, "Sondage supprimé · %s" % b.get("id"), role, _ip(req))
    return {"ok": True}

def _coms_pour(e):
    """Notes et sondages visibles par une salariée (utilisé par l'espace salarié)."""
    notes, votes = _coms()
    t = today().isoformat()
    mes_notes = [{"id": n["id"], "titre": n["titre"], "texte": n["texte"],
                  "important": n.get("important"), "ts": n.get("ts"), "par": n.get("par"),
                  "lu": e["id"] in (n.get("lus") or [])}
                 for n in notes if _cible_ok(e, n.get("cible")) and (not n.get("fin") or n["fin"] >= t)]
    mes_votes = []
    for v in votes:
        if not _cible_ok(e, v.get("cible")):
            continue
        if v.get("fin") and v["fin"] < t:
            continue
        deja = e["id"] in (v.get("votants") or [])
        mes_votes.append({"id": v["id"], "question": v["question"], "options": v["options"],
                          "ferme": bool(v.get("ferme")), "vote": deja,
                          "resultats": v.get("resultats") if (deja or v.get("ferme")) else None,
                          "monChoix": (v.get("detail") or {}).get(e["id"]) if not v.get("anonyme") else None})
    return list(reversed(mes_notes)), list(reversed(mes_votes))

@app.post("/api/me/lu")
async def api_me_lu(req: Request):
    """Accusé de lecture d'une note de service."""
    b = await req.json()
    e = _find_by_token(str(b.get("t") or ""))
    if not e:
        return erreur("invalide", 401)
    nid = str(b.get("id") or "")
    with _WLOCK:
        notes, _ = _coms()
        touche = False
        for n in notes:
            if n.get("id") == nid and _cible_ok(e, n.get("cible")):
                lus = n.setdefault("lus", [])
                if e["id"] not in lus:
                    lus.append(e["id"]); touche = True
        if touche:
            _set_coms(notes=notes)
    return {"ok": True}

@app.post("/api/me/vote")
async def api_me_vote(req: Request):
    """Réponse d'une salariée à un sondage. Un seul vote par personne."""
    b = await req.json()
    e = _find_by_token(str(b.get("t") or ""))
    if not e:
        return erreur("invalide", 401)
    vid = str(b.get("id") or "")
    try:
        choix = int(b.get("choix"))
    except Exception:
        return erreur("Réponse invalide")
    with _WLOCK:
        _, votes = _coms()
        v = next((x for x in votes if x.get("id") == vid), None)
        if not v:
            return erreur("Sondage introuvable", 404)
        if not _cible_ok(e, v.get("cible")):
            return erreur("Ce sondage ne vous concerne pas", 403)
        if v.get("ferme") or (v.get("fin") and v["fin"] < today().isoformat()):
            return erreur("Ce sondage est clos", 409)
        if e["id"] in (v.get("votants") or []):
            return erreur("Vous avez déjà répondu", 409)
        if choix < 0 or choix >= len(v.get("options") or []):
            return erreur("Réponse invalide")
        v.setdefault("resultats", [0] * len(v["options"]))
        v["resultats"][choix] += 1
        v.setdefault("votants", []).append(e["id"])
        if not v.get("anonyme"):
            v.setdefault("detail", {})[e["id"]] = choix
        _set_coms(votes=votes)
        res = v["resultats"]
    return {"ok": True, "resultats": res}

# ---------------------------------------------------------------------------
# Connexion / comptes
# ---------------------------------------------------------------------------
@app.get("/login")
def login_page():
    return FileResponse(os.path.join(BASE, "static", "login.html"))

_LOGIN_FAILS = {}

@app.post("/api/login")
async def api_login(req: Request):
    b = await req.json()
    ipa = _ip(req)
    login = str(b.get("login", ""))[:80]
    cle = "login|" + ipa
    n, jusqu = _LOGIN_FAILS.get(cle, (0, 0))
    if time.time() < jusqu:
        return erreur("Trop de tentatives. Patientez quelques minutes.", 429)
    u = _find_user(login)
    if not u or not _check_pw(b.get("password", ""), u["pass"]):
        n += 1
        _LOGIN_FAILS[cle] = (n, time.time() + (0 if n < 5 else min(900, 15 * (2 ** (n - 5)))))
        audit(login or "?", "Échec de connexion", "", ipa)
        return erreur("Identifiant ou mot de passe incorrect", 401)
    _LOGIN_FAILS.pop(cle, None)
    if _besoin_rehash(u["pass"]):
        try:
            _rehash(u["login"], b.get("password", ""))
            log.info("mot de passe de %s réenregistré au format renforcé", u["login"])
        except Exception:
            log.exception("échec du renforcement du hachage")
    audit(u.get("nom") or u["login"], "Connexion réussie", u["role"], ipa)
    resp = JSONResponse({"ok": True, "user": {"login": u["login"], "nom": u.get("nom", ""), "role": u["role"]}})
    secure = os.environ.get("PILOTRH_COOKIE_SECURE", "auto").lower()
    if secure == "auto":
        secure = req.url.scheme == "https" or req.headers.get("x-forwarded-proto", "") == "https"
    else:
        secure = secure in ("1", "true", "yes", "on")
    resp.set_cookie("pilotrh_sess", _sign_session(u), max_age=7 * 86400,
                    httponly=True, samesite="lax", secure=bool(secure))
    return resp

@app.post("/api/logout")
def api_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("pilotrh_sess")
    return resp

@app.get("/api/whoami")
def api_whoami(request: Request):
    if OPEN_MODE:
        return {"login": "local", "nom": "Poste local", "role": "admin", "roles": ROLES,
                "open": True}
    u = _current_user(request)
    if not u:
        return erreur("non_connecte", 401)
    return {"login": u["login"], "nom": u.get("nom", ""), "role": u["role"], "roles": ROLES}

@app.get("/api/users")
def api_users_list():
    return [{"login": u["login"], "nom": u.get("nom", ""), "role": u["role"]}
            for u in get_meta().get("users", [])]

@app.post("/api/users")
async def api_users_save(req: Request):
    b = await req.json()
    login = str(b.get("login", "")).strip()
    if not login or not re.match(r"^[A-Za-z0-9._-]{2,40}$", login):
        return erreur("Identifiant invalide (2 à 40 caractères, sans espace)")
    if b.get("role") and b["role"] not in ROLES:
        return erreur("Rôle inconnu")
    pw = b.get("password") or ""
    if pw and len(pw) < 8:
        return erreur("Mot de passe trop court (8 caractères minimum)")
    qui, role = _acteur(req)
    with _WLOCK:
        users = get_meta().get("users", [])
        ex = next((u for u in users if u["login"].lower() == login.lower()), None)
        if ex:
            ex["nom"] = b.get("nom", ex.get("nom", ""))
            ex["role"] = b.get("role", ex.get("role", "lecture"))
            if pw:
                ex["pass"] = _hash_pw(pw)
        else:
            if not pw:
                return erreur("Mot de passe requis pour un nouveau compte")
            users.append({"login": login, "nom": b.get("nom", login),
                          "role": b.get("role", "lecture"), "pass": _hash_pw(pw)})
        set_meta_serveur({"users": users})
    audit(qui, "Utilisateur enregistré · %s (%s)" % (login, b.get("role", "")), role, _ip(req))
    return {"ok": True}

@app.post("/api/users/delete")
async def api_users_delete(req: Request):
    b = await req.json()
    login = str(b.get("login", "")).strip()
    qui, role = _acteur(req)
    with _WLOCK:
        users = get_meta().get("users", [])
        admins = [u for u in users if u["role"] == "admin"]
        if len(admins) <= 1 and any(a["login"].lower() == login.lower() for a in admins):
            return erreur("Impossible de supprimer le dernier administrateur")
        set_meta_serveur({"users": [u for u in users if u["login"].lower() != login.lower()]})
    audit(qui, "Utilisateur supprimé · %s" % login, role, _ip(req))
    return {"ok": True}

# ---------------------------------------------------------------------------
# Fichiers statiques
# ---------------------------------------------------------------------------
ASSETS = os.path.join(BASE, "static", "assets")
os.makedirs(ASSETS, exist_ok=True)
app.mount("/assets", StaticFiles(directory=ASSETS), name="assets")
app.mount("/", StaticFiles(directory=os.path.join(BASE, "static"), html=True), name="static")

log.info("PilotRH prêt · données=%s · fuseau=%s · fenêtre état=%d j · mode ouvert=%s",
         DATA_DIR, TZ_NAME, STATE_WINDOW_DAYS, OPEN_MODE)
