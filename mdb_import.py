# -*- coding: utf-8 -*-
"""
Lecture directe de la base Access ZKTeco (.mdb) et fusion dans l'état PilotRH.
Utilise access-parser (pur Python) : aucun moteur Microsoft requis.

Règle de pointage :  entrée = premier badge du jour, sortie = dernier badge du jour.
Fusion : les employées existantes sont mises à jour sans écraser les champs
         saisis manuellement (poste, catégorie, salaire, photo...).
"""
import datetime
from collections import defaultdict
from access_parser import AccessParser

# Fenêtre importée par défaut : tout l'historique réel utile.
# La pointeuse a des dates erronées (horloge déréglée) hors de cette plage : on les ignore.
DEFAULT_DU = "2023-01-01"
DEFAULT_AU = None  # None => calculé dynamiquement (aujourd'hui + 1 jour)
MIN_JOURS_ACTIF = 3   # une employée est "active" si elle a pointé >= 3 jours
ACTIF_DEPUIS = "2026-03-01"  # roster courant = a pointé après cette date


def _split_nom(name):
    p = (name or "").strip().split()
    return (p[0], " ".join(p[1:])) if len(p) >= 2 else (name or "", "")


def parse(mdb_path, du=DEFAULT_DU, au=None):
    today = datetime.date.today()
    if not au:
        au = (today + datetime.timedelta(days=1)).isoformat()   # inclut aujourd'hui, exclut le futur (horloge déréglée)
    actif_depuis = (today - datetime.timedelta(days=150)).isoformat()  # roster courant = pointé dans les ~5 derniers mois
    db = AccessParser(mdb_path)
    U = db.parse_table("USERINFO")
    C = db.parse_table("CHECKINOUT")

    users = {}
    for i in range(len(U["USERID"])):
        uid, name = U["USERID"][i], U["Name"][i]
        if not name:
            continue
        nom, prenom = _split_nom(name)
        users[uid] = {
            "badge": str(U["Badgenumber"][i] or uid),
            "nom": nom, "prenom": prenom,
            "sexe": "F" if (U["Gender"][i] or "").lower().startswith("f") else "H",
        }

    punches = defaultdict(list)   # (uid, date) -> [HH:MM]
    recent = set()                # employées du roster courant
    for i in range(len(C["USERID"])):
        uid, t = C["USERID"][i], C["CHECKTIME"][i]
        if not t or uid not in users:
            continue
        d = t[:10]
        if du <= d <= au and t[11:16]:
            punches[(uid, d)].append(t[11:16])
            if d >= actif_depuis:
                recent.add(uid)

    days_per = defaultdict(set)
    for (uid, d) in punches:
        days_per[uid].add(d)
    # roster courant : a pointé récemment ET au moins MIN_JOURS_ACTIF jours
    actifs = {uid for uid in recent if len(days_per[uid]) >= MIN_JOURS_ACTIF}

    # entrée/sortie par jour — tout l'historique des employées actives est conservé
    day_user = defaultdict(dict)
    for (uid, d), ts in punches.items():
        if uid not in actifs:
            continue
        # dédoublonnage des badges trop rapprochés (< 5 min = même passage) puis tri
        ts = sorted(set(ts))
        clean = []
        for t in ts:
            if clean and (int(t[:2]) * 60 + int(t[3:5])) - (int(clean[-1][:2]) * 60 + int(clean[-1][3:5])) < 5:
                continue
            clean.append(t)
        day_user[d][uid] = clean

    return users, actifs, day_user


def merge(state, mdb_path, du=DEFAULT_DU, au=None):
    """Fusionne le contenu du .mdb dans l'état existant et le renvoie."""
    users, actifs, day_user = parse(mdb_path, du, au)

    exclus = set(str(b) for b in state.get("exclus", []))   # badges d'employées supprimées (démission) : jamais réimportées
    employees = state.get("employees", [])
    by_badge = {e.get("matricule") or e.get("cin"): e for e in employees}
    next_n = len(employees) + 1

    badge_to_id = {}
    for uid in sorted(actifs, key=lambda u: int(users[u]["badge"]) if users[u]["badge"].isdigit() else 9999):
        u = users[uid]
        badge = u["badge"]
        if badge in ("", "0") or not any(c.isalpha() for c in (u.get("nom", "") + u.get("prenom", ""))):
            continue                                # badge de test / sans nom : ignoré
        if badge in exclus:
            continue                                # démissionnaire supprimée : on ne la réimporte pas
        if badge in by_badge:                      # déjà connue : MAJ douce
            e = by_badge[badge]
            e["prenom"] = e.get("prenom") or u["prenom"]
            e["nom"] = e.get("nom") or u["nom"]
            badge_to_id[uid] = e["id"]
        else:                                      # nouvelle employée
            eid = "E" + str(next_n).zfill(3)
            next_n += 1
            e = {
                "id": eid, "prenom": u["prenom"], "nom": u["nom"],
                "poste": "Couturière piqueuse", "categorie": "Ouvrier",
                "service": "Couture", "atelier": "Atelier A", "contrat": "CDI",
                "embauche": "2022-01-01", "naissance": "1995-01-01",
                "famille": "Célibataire", "enfants": 0, "niveau": "Bac",
                "email": "", "tel": "", "adresse": "Nabeul", "salaire": 900,
                "cin": badge, "matricule": badge, "sexe": u["sexe"],
                "responsable": "Direction", "actif": True,
            }
            employees.append(e)
            by_badge[badge] = e
            badge_to_id[uid] = eid

    state["employees"] = employees

    # pointages
    pointages = state.get("pointages", {})
    emp_ids = [e["id"] for e in employees if e.get("actif", True)]
    for d in sorted(day_user):
        rec = {}
        present = set()
        for uid, plist in day_user[d].items():
            eid = badge_to_id.get(uid)
            if not eid:
                continue                            # badge filtré : pas de pointage
            present.add(eid)
            r = {"statut": "present", "entree": plist[0], "sortie": plist[-1] if len(plist) > 1 else ""}
            if len(plist) > 2:
                r["punches"] = plist                # sorties/retours intermédiaires conservés
            rec[eid] = r
        for eid in emp_ids:
            if eid not in present:
                rec[eid] = {"statut": "absent", "entree": "", "sortie": ""}
        pointages[d] = rec
    state["pointages"] = pointages

    if "settings" not in state or not state.get("settings"):
        state["settings"] = (default_settings() if "default_settings" in globals()
                             else {"modeHS": "fin", "jours": {}, "periodes": []})
    state.setdefault("absences", [])
    state.setdefault("conges", [])
    state.setdefault("documents", [])
    return state
