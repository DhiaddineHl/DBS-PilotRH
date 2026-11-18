# -*- coding: utf-8 -*-
"""
Lecture directe de la base Access ZKTeco (.mdb) et fusion dans l'état PilotRH.
Utilise access-parser (pur Python) : aucun moteur Microsoft requis.

Règle de pointage :  entrée = premier badge du jour, sortie = dernier badge du jour.
Fusion : les employées existantes sont mises à jour sans écraser les champs
         saisis manuellement (poste, catégorie, salaire, photo...).

Protections garanties par ce module
-----------------------------------
1. Une journée corrigée à la main (rec['manuel'], rec['hM'] ou rec['hsM']) n'est
   JAMAIS écrasée par un import, quel qu'il soit.
2. Un jour férié ou de repos hebdomadaire sans pointage n'est plus marqué
   « absent » : il reçoit le statut 'ferie' / 'repos'. Sans cela, tout l'effectif
   sortait « absent » le 20 mars, le 1er mai ou pendant l'Aïd, dans les états
   remis au comptable comme dans les alertes.
3. Un mois clôturé (settings.clotures) n'est pas modifié par l'import.
"""
import datetime
from collections import defaultdict
from access_parser import AccessParser

# Fenêtre importée par défaut : tout l'historique réel utile.
# La pointeuse a des dates erronées (horloge déréglée) hors de cette plage : on les ignore.
DEFAULT_DU = "2023-01-01"
DEFAULT_AU = None  # None => calculé dynamiquement (aujourd'hui + 1 jour)
# Une personne inconnue de l'application reçoit une fiche dès qu'elle a badgé UNE
# fois dans les 5 derniers mois. On exigeait 3 jours : une nouvelle recrue restait
# invisible ses deux premiers jours, et ces deux journées étaient perdues.
MIN_JOURS_ACTIF = 1
JOURS_ROSTER = 150    # roster courant = a pointé dans les ~5 derniers mois

# Fêtes tunisiennes à date fixe (les fêtes religieuses, mobiles, se saisissent
# dans les paramètres de l'application : settings.feries)
FERIES_FIXES = [
    {"md": "01-01", "nom": "Nouvel An"},
    {"md": "01-14", "nom": "Fête de la Révolution"},
    {"md": "03-20", "nom": "Fête de l'Indépendance"},
    {"md": "04-09", "nom": "Jour des Martyrs"},
    {"md": "05-01", "nom": "Fête du Travail"},
    {"md": "07-25", "nom": "Fête de la République"},
    {"md": "08-13", "nom": "Fête de la Femme"},
    {"md": "10-15", "nom": "Fête de l'Évacuation"},
]


def _split_nom(name):
    p = (name or "").strip().split()
    return (p[0], " ".join(p[1:])) if len(p) >= 2 else (name or "", "")


def _sexe(v):
    """Corrige un bug de longue date : les deux branches renvoyaient 'F', donc
    tout le personnel importé par le réseau était enregistré comme femme."""
    s = str(v or "").strip().lower()
    if s.startswith("m") or s.startswith("h") or s in ("1",):
        return "H"
    if s.startswith("f") or s in ("0", "2"):
        return "F"
    return "F"          # atelier majoritairement féminin : défaut le plus probable


def _assemble(users, checkins, du=DEFAULT_DU, au=None):
    """checkins : liste de (uid, 'YYYY-MM-DD HH:MM:SS'). Construit users/actifs/day_user."""
    today = datetime.date.today()
    if not au:
        au = (today + datetime.timedelta(days=1)).isoformat()
    actif_depuis = (today - datetime.timedelta(days=JOURS_ROSTER)).isoformat()

    punches = defaultdict(list)   # (uid, date) -> [HH:MM]
    recent = set()
    for uid, t in checkins:
        if not t or uid not in users:
            continue
        t = str(t)
        d = t[:10]
        if du <= d <= au and t[11:16]:
            punches[(uid, d)].append(t[11:16])
            if d >= actif_depuis:
                recent.add(uid)

    days_per = defaultdict(set)
    for (uid, d) in punches:
        days_per[uid].add(d)
    actifs = {uid for uid in recent if len(days_per[uid]) >= MIN_JOURS_ACTIF}

    # On garde les pointages de TOUT LE MONDE : c'est la fusion qui décide qui est
    # rattaché à une fiche, et qui signale ce qu'elle laisse de côté.
    day_user = defaultdict(dict)
    for (uid, d), ts in punches.items():
        ts = sorted(set(ts))
        clean = []
        for t in ts:
            if clean and (int(t[:2]) * 60 + int(t[3:5])) - (int(clean[-1][:2]) * 60 + int(clean[-1][3:5])) < 5:
                continue
            clean.append(t)
        day_user[d][uid] = clean
    return users, actifs, day_user


def norm_badge(b):
    """« 0123 », « 123 » et « 123 » (espaces) désignent le même badge."""
    s = str(b if b is not None else "").strip()
    return (s.lstrip("0") or ("0" if s else "")) if s.isdigit() else s


def _a_un_nom(u):
    return any(c.isalpha() for c in (u.get("nom", "") + u.get("prenom", "")))


def parse(mdb_path, du=DEFAULT_DU, au=None):
    """Lecture du fichier Access (.mdb) exporté par le logiciel ZKTeco."""
    db = AccessParser(mdb_path)
    U = db.parse_table("USERINFO")
    C = db.parse_table("CHECKINOUT")
    users = {}
    for i in range(len(U["USERID"])):
        uid, name = U["USERID"][i], U["Name"][i]
        # Une personne enregistrée sur la pointeuse SANS nom (seulement un numéro de
        # badge) était sautée ici : tous ses pointages disparaissaient en silence.
        nom, prenom = _split_nom(name or "")
        users[uid] = {
            "badge": str(U["Badgenumber"][i] or uid),
            "nom": nom, "prenom": prenom,
            "sexe": _sexe(U["Gender"][i]),
        }
    checkins = [(C["USERID"][i], C["CHECKTIME"][i]) for i in range(len(C["USERID"]))]
    return _assemble(users, checkins, du, au)


def parse_punches(users_rows, punch_rows, du=DEFAULT_DU, au=None):
    """Lecture directe depuis la pointeuse (connexion réseau).
    users_rows : [{'badge','name','sexe'?}]   punch_rows : [{'badge','dt':'YYYY-MM-DD HH:MM:SS'}]"""
    users = {}
    for u in users_rows or []:
        badge = str(u.get("badge") or u.get("uid") or "").strip()
        if not badge:
            continue
        nom, prenom = _split_nom(u.get("name", "") or "")
        users[badge] = {"badge": badge, "nom": nom, "prenom": prenom,
                        "sexe": _sexe(u.get("sexe"))}
    checkins = []
    for p in punch_rows or []:
        badge = str(p.get("badge") or p.get("uid") or "").strip()
        dt = str(p.get("dt") or "").replace("T", " ")
        if badge and dt:
            users.setdefault(badge, {"badge": badge, "nom": "", "prenom": "", "sexe": "F"})
            checkins.append((badge, dt))
    return _assemble(users, checkins, du, au)


def merge(state, mdb_path, du=DEFAULT_DU, au=None):
    """Fusionne un fichier .mdb dans l'état existant."""
    return _merge_assembled(state, *parse(mdb_path, du, au))


def merge_punches(state, users_rows, punch_rows, du=DEFAULT_DU, au=None):
    """Fusionne des pointages lus directement sur la pointeuse (réseau)."""
    return _merge_assembled(state, *parse_punches(users_rows, punch_rows, du, au))


def _badges_rec(r):
    """Les heures badgées déjà connues pour une journée (« HH:MM »)."""
    if not isinstance(r, dict):
        return []
    p = r.get("punches")
    if isinstance(p, list) and p:
        src = p
    else:
        src = [r.get("entree"), r.get("sortie")]
    return [str(x)[:5] for x in src if x and len(str(x)) >= 5 and str(x)[2] == ":"]


def _fusion_badges(*listes):
    """Réunion de plusieurs lectures d'une même journée, triée, en ne gardant
    qu'un passage par tranche de 5 minutes (même règle qu'à l'assemblage)."""
    tout = sorted(set(x for l in listes for x in l))
    out = []
    for t in tout:
        if out and (int(t[:2]) * 60 + int(t[3:5])) - (int(out[-1][:2]) * 60 + int(out[-1][3:5])) < 5:
            continue
        out.append(t)
    return out


def _est_protege(rec):
    """Un enregistrement de pointage est protégé (jamais écrasé par un import) dès
    qu'il a été touché manuellement : statut/entrée/sortie corrigés (rec['manuel']),
    heures forcées (rec['hM']) ou heures supplémentaires forcées (rec['hsM'])."""
    if not rec or not isinstance(rec, dict):
        return False
    if rec.get("manuel"):
        return True
    if rec.get("hM") not in (None, ""):
        return True
    if rec.get("hsM") not in (None, ""):
        return True
    if rec.get("src") == "conge":          # journée générée par un congé validé
        return True
    return False


# ---------------------------------------------------------------------------
# Calendrier : repos hebdomadaire et jours fériés
# ---------------------------------------------------------------------------
def _regime(settings, ds):
    w = datetime.date.fromisoformat(ds).weekday()      # lundi=0 … dimanche=6
    dow = (w + 1) % 7                                  # aligné sur JS : dimanche=0
    for p in (settings.get("periodes") or []):
        du, au = p.get("du"), p.get("au")
        if du and au and du <= ds <= au:
            return (p.get("jours") or {}).get(str(dow)) or (p.get("jours") or {}).get(dow) or {"actif": False}
    j = settings.get("jours") or {}
    return j.get(str(dow)) or j.get(dow) or {"actif": True}


def _feries_set(settings, dates):
    """Ensemble des dates fériées parmi `dates`."""
    if not settings or settings.get("feriesActifs") is False:
        return set()
    # le drapeau "off" doit être respecté : une fête fixe désactivée dans les
    # paramètres ne doit plus être traitée comme un jour férié
    fixes = {f.get("md") for f in (settings.get("feriesFixes") or FERIES_FIXES)
             if f.get("md") and not f.get("off")}
    out = {d for d in dates if d[5:] in fixes}
    for f in (settings.get("feries") or []):
        if not f.get("date"):
            continue
        try:
            d0 = datetime.date.fromisoformat(str(f["date"]))
        except Exception:
            continue
        for k in range(max(1, int(f.get("jours") or 1))):
            out.add((d0 + datetime.timedelta(days=k)).isoformat())
    return out


def _merge_assembled(state, users, actifs, day_user):
    """Fusionne un jeu déjà assemblé (users/actifs/day_user) dans l'état.

    Personne n'est plus écarté en silence : chaque badge qui a pointé sur la
    période et n'est rattaché à aucune fiche figure dans le rapport d'import
    (state["_import_stats"]["ignores"]) avec la raison, pour que le service RH
    puisse agir au lieu de recréer la personne et ses pointages à la main."""
    exclus_brut = [str(b) for b in state.get("exclus", [])]
    exclus = set(norm_badge(b) for b in exclus_brut)       # démissions : jamais réimportées
    exclus_dates = dict((norm_badge(k), v) for k, v in (state.get("exclus_dates") or {}).items())
    employees = state.get("employees", [])
    by_badge = {}
    for e in employees:
        for k in (e.get("matricule"), e.get("cin")):
            if k not in (None, ""):
                by_badge.setdefault(norm_badge(k), e)

    # identifiants : on repart du plus grand numéro existant, pas du nombre
    # d'employées — après une suppression, le compteur recréait un id déjà pris
    # et deux personnes partageaient le même historique de pointage
    max_n = 0
    for e in employees:
        try:
            max_n = max(max_n, int(str(e.get("id", "E0"))[1:]))
        except Exception:
            pass
    next_n = max_n + 1

    # ce que chaque badge a fait sur la période importée
    vu = defaultdict(list)
    for d in day_user:
        for uid in day_user[d]:
            vu[uid].append(d)

    def _cle_tri(uid):
        b = users.get(uid, {}).get("badge", "")
        return (0, int(b)) if str(b).isdigit() else (1, str(b))

    badge_to_id, nouvelles, ignores, anciens = {}, [], [], 0
    premier_jour = {}            # employé créé ou à compléter -> premier jour badgé
    for uid in sorted(vu, key=_cle_tri):
        u = users.get(uid) or {"badge": str(uid), "nom": "", "prenom": "", "sexe": "F"}
        badge = str(u.get("badge") or "").strip()
        nb = norm_badge(badge)
        jours = sorted(vu[uid])
        nom_aff = (u.get("prenom", "") + " " + u.get("nom", "")).strip()
        info = {"badge": badge, "nom": nom_aff, "jours": len(jours), "premier": jours[0], "dernier": jours[-1]}
        if nb in ("", "0"):
            ignores.append(dict(info, raison="badge_zero"))
            continue
        if nb in by_badge:                                  # déjà connue : MAJ douce
            e = by_badge[nb]
            if _a_un_nom(u):
                e["prenom"] = e.get("prenom") or u["prenom"]
                e["nom"] = e.get("nom") or u["nom"]
            badge_to_id[uid] = e["id"]
            if e.get("aCompleter"):
                premier_jour[e["id"]] = min(jours[0], premier_jour.get(e["id"], jours[0]))
            continue
        if nb in exclus:
            # une personne sortie qui badge encore APRÈS sa sortie : c'est presque
            # toujours une nouvelle recrue à qui l'on a redonné le même numéro
            sortie = exclus_dates.get(nb, "")
            apres = [d for d in jours if not sortie or d > sortie]
            if apres and uid in actifs:
                ignores.append(dict(info, raison="badge_sorti", sortie=sortie, apres=len(apres)))
            continue
        if uid not in actifs:
            anciens += 1                                    # n'a plus badgé depuis 5 mois
            continue
        eid = "E" + str(next_n).zfill(3)
        next_n += 1
        sans_nom = not _a_un_nom(u)
        e = {
            "id": eid,
            "prenom": "" if sans_nom else u["prenom"],
            "nom": ("Badge " + badge) if sans_nom else u["nom"],
            "poste": "Couturière piqueuse", "categorie": "Ouvrier",
            "service": "Couture", "atelier": "Atelier A", "contrat": "CDI",
            # première présence connue plutôt que la date de l'import
            "embauche": jours[0], "naissance": "",
            "famille": "", "enfants": 0, "niveau": "",
            "email": "", "tel": "", "adresse": "", "salaire": 0,
            "cin": badge, "matricule": badge, "sexe": u.get("sexe") or "F",
            "responsable": "", "actif": True, "aCompleter": True,
        }
        employees.append(e)
        by_badge[nb] = e
        badge_to_id[uid] = eid
        premier_jour[eid] = jours[0]
        nouvelles.append(dict(info, id=eid, sansNom=sans_nom))

    state["employees"] = employees

    settings = state.get("settings") or (default_settings() if "default_settings" in globals() else {})
    clotures = set(settings.get("clotures") or [])
    feries = _feries_set(settings, set(day_user.keys()))

    # pointages
    pointages = state.get("pointages", {})
    emp_ids = [e["id"] for e in employees if e.get("actif", True)]
    stats = {"protegees": 0, "jours": 0, "feries": 0, "ignores_clos": 0, "badges_conserves": 0,
             "nouvelles": nouvelles, "ignores": ignores, "anciens": anciens,
             "rattaches": len(badge_to_id)}
    for d in sorted(day_user):
        if d[:7] in clotures:
            stats["ignores_clos"] += 1
            continue                                # mois clôturé : intouchable
        jour_existant = pointages.get(d, {})
        reg = _regime(settings, d)
        est_ferie = d in feries
        est_ouvre = (reg.get("actif") is not False) and not est_ferie
        rec = {}
        present = set()
        for uid, plist in day_user[d].items():
            eid = badge_to_id.get(uid)
            if not eid:
                continue
            present.add(eid)
            existant = jour_existant.get(eid)
            if _est_protege(existant):
                rec[eid] = existant
                stats["protegees"] += 1
                continue
            # Un import AJOUTE des badges, il n'en retire jamais. Chaque source ne
            # voit qu'une partie de la journée : l'agent ne lit que ce que la
            # pointeuse a encore en mémoire (le logiciel ZKTeco peut l'avoir vidée
            # après son propre téléchargement), le fichier .mdb s'arrête à sa
            # dernière copie. Remplacer la journée par la dernière lecture effaçait
            # ce que l'autre source avait apporté.
            avant = _badges_rec(existant)
            tous = _fusion_badges(avant, plist)
            if avant and len(tous) > len(plist):
                stats["badges_conserves"] = stats.get("badges_conserves", 0) + 1
            r = {"statut": "present", "entree": tous[0],
                 "sortie": tous[-1] if len(tous) > 1 else "", "src": "import"}
            if len(tous) > 2:
                r["punches"] = tous
            rec[eid] = r
        for eid in emp_ids:
            if eid in present:
                continue
            # pas d'« absence » avant l'arrivée : une recrue créée aujourd'hui se
            # retrouvait absente sur trois ans d'historique
            if eid in premier_jour and d < premier_jour[eid]:
                continue
            existant = jour_existant.get(eid)
            if _est_protege(existant):
                rec[eid] = existant
                stats["protegees"] += 1
            elif _badges_rec(existant) or (isinstance(existant, dict) and
                                           existant.get("statut") not in (None, "", "absent", "ferie", "repos")):
                # cette lecture ne la voit pas, mais une lecture précédente l'avait
                # vue badger : elle reste présente (c'était le bug « journée effacée »)
                rec[eid] = existant
                stats["badges_conserves"] = stats.get("badges_conserves", 0) + 1
            elif est_ferie:
                # NE PAS marquer absent un jour férié
                rec[eid] = {"statut": "ferie", "entree": "", "sortie": "", "src": "calendrier"}
                stats["feries"] += 1
            elif not est_ouvre:
                rec[eid] = {"statut": "repos", "entree": "", "sortie": "", "src": "calendrier"}
            else:
                rec[eid] = {"statut": "absent", "entree": "", "sortie": "", "src": "import"}
        pointages[d] = rec
        stats["jours"] += 1
    state["pointages"] = pointages
    state["_import_stats"] = stats

    if not state.get("settings"):
        state["settings"] = (default_settings() if "default_settings" in globals()
                             else {"modeHS": "fin", "jours": {}, "periodes": []})
    state.setdefault("absences", [])
    state.setdefault("conges", [])
    state.setdefault("documents", [])
    return state
