#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
integrer_sauvegarde.py — prépare une sauvegarde PilotRH v2 pour la v3
=====================================================================
Prend une sauvegarde JSON exportée par l'ancienne version et produit :

  1. <nom>_corrigee.json   la même sauvegarde, nettoyée et corrigée :
       · les comptes (`users`) et la clé de signature (`_secret`) sont retirés
         — l'ancien export les écrivait en clair sur le disque ;
       · les identifiants d'employées attribués deux fois sont séparés ;
       · les réglages sont complétés (jours fériés, portée de l'arrondi,
         plage de pause) sans changer vos valeurs existantes.

  2. demo/PilotRH_mes_donnees.html   vos vraies données dans la nouvelle
       interface, en fichier autonome à double-cliquer, pour vérifier avant
       de toucher au serveur. Rien n'y est enregistré.

  3. un rapport à l'écran : ce que la mise à jour va changer dans vos chiffres.

    python outils/integrer_sauvegarde.py ma_sauvegarde.json
    python outils/integrer_sauvegarde.py ma_sauvegarde.json --jours-demo 150
"""
import argparse, collections, datetime, json, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

FIXES = [
    {"md": "01-01", "nom": "Nouvel An"},
    {"md": "01-14", "nom": "Fête de la Révolution"},
    {"md": "03-20", "nom": "Fête de l'Indépendance"},
    {"md": "04-09", "nom": "Jour des Martyrs"},
    {"md": "05-01", "nom": "Fête du Travail"},
    {"md": "07-25", "nom": "Fête de la République"},
    {"md": "08-13", "nom": "Fête de la Femme"},
    {"md": "10-15", "nom": "Fête de l'Évacuation"},
]
MD_FIXES = {f["md"] for f in FIXES}


def titre(t):
    print("\n" + t)
    print("-" * len(t))


def separer_ids(emps, pts):
    """Deux employées avec le même identifiant partagent le même historique de
    pointage : la clé de la table est (date, identifiant). C'est le bug de
    génération d'identifiant de l'ancienne version. On ne peut pas démêler
    l'historique après coup — mais on peut au moins séparer les fiches, et
    l'historique de celle qui repart à zéro sera reconstruit au prochain import
    du .mdb, puisque le rapprochement se fait sur le MATRICULE."""
    par_id = collections.defaultdict(list)
    for e in emps:
        par_id[e.get("id")].append(e)
    doublons = {k: v for k, v in par_id.items() if len(v) > 1}
    if not doublons:
        return [], emps

    maxn = 0
    for e in emps:
        try:
            maxn = max(maxn, int(str(e.get("id", "E0"))[1:]))
        except Exception:
            pass

    rapport = []
    for eid, fiches in doublons.items():
        # on garde l'historique à la première fiche (ordre du fichier), les
        # suivantes reçoivent un identifiant neuf
        garde = fiches[0]
        n_jours = sum(1 for j in pts if eid in pts[j])
        for f in fiches[1:]:
            maxn += 1
            neuf = "E" + str(maxn).zfill(3)
            rapport.append({
                "ancien": eid, "neuf": neuf,
                "garde_matricule": str(garde.get("matricule") or garde.get("cin") or "?"),
                "garde_nom": ((garde.get("prenom") or "") + " " + (garde.get("nom") or "")).strip(),
                "deplace_matricule": str(f.get("matricule") or f.get("cin") or "?"),
                "deplace_nom": ((f.get("prenom") or "") + " " + (f.get("nom") or "")).strip(),
                "jours": n_jours,
            })
            f["id"] = neuf
        # L'ACCÈS EST RÉVOQUÉ SUR LES DEUX FICHES, pas seulement sur celle qui
        # est déplacée. Les deux personnes ne partageaient qu'UNE fiche, donc
        # qu'UNE carte QR a été imprimée — et rien ne dit laquelle des deux la
        # détient physiquement. Laisser le jeton à la fiche conservée ferait
        # courir le risque qu'une ouvrière ouvre l'espace personnel de l'autre
        # et y lise ses heures et son salaire. Deux cartes à réimprimer valent
        # mieux qu'une fuite : le serveur attribue un accès neuf au démarrage.
        for f in fiches:
            f.pop("token", None)
            f.pop("pin", None)
    return rapport, emps


def migrer_settings(s):
    """Complète les réglages sans rien changer aux valeurs déjà en place."""
    s = dict(s or {})
    ajouts = []
    if s.get("modeHS") not in ("fin", "seuil"):
        s["modeHS"] = "fin"; ajouts.append("modeHS = fin")
    if "arrondiPortee" not in s or s["arrondiPortee"] not in ("jour", "periode"):
        s["arrondiPortee"] = "jour"
        ajouts.append("arrondiPortee = jour (comportement de votre version actuelle)")
    if not s.get("feriesFixes"):
        s["feriesFixes"] = [dict(f) for f in FIXES]
        ajouts.append("liste des 8 fêtes tunisiennes à date fixe")
    if not isinstance(s.get("feries"), list):
        s["feries"] = []
        ajouts.append("liste vide pour les fêtes religieuses (à saisir chaque année)")
    if s.get("feriesActifs") is None:
        s["feriesActifs"] = True; ajouts.append("prise en compte des jours fériés activée")
    if not isinstance(s.get("clotures"), list):
        s["clotures"] = []; ajouts.append("liste vide des mois clôturés")
    # taux de rémunération par défaut : à zéro, donc sans effet tant que vous ne
    # les saisissez pas — la paie reste exprimée en heures et en jours comme avant
    if s.get("tauxHoraireDefaut") is None:
        s["tauxHoraireDefaut"] = 0
        ajouts.append("prix de l'heure par défaut = 0 (à renseigner dans les paramètres)")
    if s.get("tauxJourDefaut") is None:
        s["tauxJourDefaut"] = 0
        ajouts.append("prix de la journée par défaut = 0 (à renseigner dans les paramètres)")

    # plage de pause : déduite du milieu de journée, à corriger par les RH
    def tomin(t):
        try:
            h, m = str(t).split(":")[:2]; return int(h) * 60 + int(m)
        except Exception:
            return None
    def frommin(m):
        m = int(round(m)) % 1440
        return "%02d:%02d" % (m // 60, m % 60)
    plages = []
    for k, j in (s.get("jours") or {}).items():
        if not isinstance(j, dict):
            continue
        p = int(j.get("pause") or 0)
        if p > 0 and not (j.get("pauseDe") and j.get("pauseA")):
            a, b = tomin(j.get("debut")), tomin(j.get("fin"))
            if a is not None and b is not None and b > a:
                mid = (a + b) / 2.0
                j["pauseDe"] = frommin(mid - p / 2.0)
                j["pauseA"] = frommin(mid + p / 2.0)
                plages.append("jour %s : %s → %s (%d min)" % (k, j["pauseDe"], j["pauseA"], p))
    for p in (s.get("periodes") or []):
        for k, j in (p.get("jours") or {}).items():
            if isinstance(j, dict) and int(j.get("pause") or 0) > 0 and not (j.get("pauseDe") and j.get("pauseA")):
                a, b = tomin(j.get("debut")), tomin(j.get("fin"))
                if a is not None and b is not None and b > a:
                    mid = (a + b) / 2.0
                    pp = int(j.get("pause"))
                    j["pauseDe"] = frommin(mid - pp / 2.0)
                    j["pauseA"] = frommin(mid + pp / 2.0)
    return s, ajouts, plages


def analyser(d):
    emps, pts, s = d.get("employees") or [], d.get("pointages") or {}, d.get("settings") or {}
    r = {}
    r["nb_emp"] = len(emps)
    r["nb_jours"] = len(pts)
    r["nb_rec"] = sum(len(v) for v in pts.values())
    ks = sorted(pts.keys())
    r["du"], r["au"] = (ks[0], ks[-1]) if ks else ("—", "—")

    jours_cfg = s.get("jours") or {}
    def ouvre_semaine(ds):
        dow = (datetime.date.fromisoformat(ds).weekday() + 1) % 7
        j = jours_cfg.get(str(dow)) or jours_cfg.get(dow) or {}
        return j.get("actif") is not False

    abs_tot = abs_repos = abs_ferie = 0
    ferie_dates = set()
    incomplets = 0
    incomplets_mois = collections.Counter()
    manuels = 0
    for j, rec in pts.items():
        est_ferie = j[5:] in MD_FIXES
        est_ouvre = ouvre_semaine(j)
        if est_ferie:
            ferie_dates.add(j)
        for eid, o in rec.items():
            if not isinstance(o, dict):
                continue
            if o.get("manuel") or o.get("hM") not in (None, "") or o.get("hsM") not in (None, ""):
                manuels += 1
            st = o.get("statut")
            if st == "absent":
                abs_tot += 1
                if est_ferie: abs_ferie += 1
                elif not est_ouvre: abs_repos += 1
            elif st == "present":
                pl = o.get("punches")
                seul = (len(pl) == 1) if pl else (bool(o.get("entree")) and not o.get("sortie"))
                if seul:
                    incomplets += 1
                    incomplets_mois[j[:7]] += 1
    r.update(abs_tot=abs_tot, abs_repos=abs_repos, abs_ferie=abs_ferie,
             ferie_dates=sorted(ferie_dates), incomplets=incomplets,
             incomplets_mois=incomplets_mois, manuels=manuels,
             arrondi=s.get("arrondi"), sens=s.get("arrondiSens"),
             pause=(jours_cfg.get("1") or {}).get("pause"),
             tol=(jours_cfg.get("1") or {}).get("tol"),
             secrets=bool(d.get("_secret")), users=len(d.get("users") or []),
             acces=sum(1 for e in emps if e.get("token") or e.get("pin")))
    return r


def faire_demo(d, jours_demo):
    """Génère l'interface RH autonome avec les données réelles, en ne gardant
    qu'une tranche récente de pointages pour que le fichier reste ouvrable."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("fd", os.path.join(BASE, "outils", "faire_demo.py"))
    fd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fd)

    pts = d.get("pointages") or {}
    ks = sorted(pts.keys())
    garde = set(ks[-jours_demo:]) if jours_demo and len(ks) > jours_demo else set(ks)
    data = {
        "employees": d.get("employees") or [],
        "settings": d.get("settings") or {},
        "pointages": {k: pts[k] for k in garde},
        "documents": d.get("documents") or [],
        "conges": d.get("conges") or [],
        "absences": d.get("absences") or [],
        "signalements": d.get("signalements") or [],
        "notes": [], "votes": [],
        "audit": [{"ts": datetime.datetime.now().isoformat(timespec="seconds"),
                   "qui": "Système", "role": "admin", "ip": "local",
                   "action": "Vos données réelles chargées dans la démonstration"}],
    }
    html = fd.faire_rh(data)
    html = html.replace("PilotRH — démonstration (hors ligne)",
                        "PilotRH — mes données réelles (hors ligne)")
    html = html.replace(
        "Données <b style=\"color:#fff\">fictives</b>.",
        "<b style=\"color:#fff\">VOS DONNÉES RÉELLES</b>, en lecture hors ligne.")
    html = html.replace(
        "Vous pouvez tout modifier : rien n’est enregistré, tout repart de zéro au rechargement.",
        "Vous pouvez tout modifier sans risque : ce fichier ne parle à aucun serveur, "
        "rien n’est enregistré, tout repart de zéro au rechargement.")
    return html, len(garde)


def main():
    ap = argparse.ArgumentParser(description="Prépare une sauvegarde PilotRH v2 pour la v3")
    ap.add_argument("fichier", help="sauvegarde JSON exportée par l'ancienne version")
    ap.add_argument("--jours-demo", type=int, default=120,
                    help="nombre de journées de pointage à embarquer dans la démonstration (0 = toutes)")
    ap.add_argument("--sortie", default=None, help="chemin du JSON corrigé")
    a = ap.parse_args()

    if not os.path.exists(a.fichier):
        print("Fichier introuvable :", a.fichier); return 1
    d = json.load(open(a.fichier, encoding="utf-8"))
    if not isinstance(d.get("employees"), list):
        print("Ce fichier ne ressemble pas à une sauvegarde PilotRH."); return 1

    r = analyser(d)

    print("=" * 70)
    print(" SAUVEGARDE PILOTRH — %s" % os.path.basename(a.fichier))
    print("=" * 70)
    print("  %d salariés · %s pointages sur %d journées (%s → %s)"
          % (r["nb_emp"], format(r["nb_rec"], ",").replace(",", " "), r["nb_jours"], r["du"], r["au"]))
    print("  %d enregistrements portent une saisie manuelle : ils seront protégés des imports."
          % r["manuels"])

    titre("1. Ce que contient ce fichier et qui ne devrait pas y être")
    if r["secrets"] or r["users"]:
        print("  Ce fichier contient EN CLAIR :")
        if r["users"]:
            print("    · %d compte(s) utilisateur avec l'empreinte du mot de passe" % r["users"])
        if r["secrets"]:
            print("    · la clé de signature des sessions (`_secret`)")
        print("  Quiconque obtient ce fichier peut fabriquer un cookie administrateur.")
        print("  → Le fichier corrigé ci-dessous ne les contient plus. Traitez l'original")
        print("    comme un document confidentiel, et changez PILOTRH_SESSION_SECRET.")
    else:
        print("  Aucun compte ni clé de session : bien.")
    print("  · %d salariés ont un jeton et un code d'espace salarié dans ce fichier." % r["acces"])
    print("    C'est normal, mais cela signifie qu'il permet d'ouvrir l'espace de n'importe qui.")

    titre("2. Identifiants attribués deux fois")
    rapport_ids, emps = separer_ids(d["employees"], d.get("pointages") or {})
    if rapport_ids:
        for x in rapport_ids:
            print("  %s était partagé par deux fiches :" % x["ancien"])
            print("     · matricule %s (%s) garde l'identifiant %s et ses %d journées"
                  % (x["garde_matricule"], x["garde_nom"], x["ancien"], x["jours"]))
            print("     · matricule %s (%s) reçoit l'identifiant %s"
                  % (x["deplace_matricule"], x["deplace_nom"], x["neuf"]))
        print()
        print("  Les deux partageaient la même clé de pointage : leur historique était")
        print("  MÉLANGÉ, et un seul des deux pointages était conservé chaque jour.")
        print("  Après restauration, réimportez votre .mdb : le rapprochement se fait sur")
        print("  le MATRICULE, donc l'historique de la fiche déplacée sera reconstruit")
        print("  correctement sous son nouvel identifiant.")
        print()
        print("  IMPORTANT — CARTES QR : l'accès a été retiré aux DEUX fiches concernées.")
        print("  Les deux personnes ne partageaient qu'une fiche, donc une seule carte QR")
        print("  a été imprimée, et rien ne dit laquelle des deux la détient. La laisser")
        print("  active ferait courir le risque qu'une ouvrière ouvre l'espace personnel")
        print("  de l'autre. Réimprimez donc DEUX cartes (Sécurité & accès → Cartes QR),")
        print("  et relevez leurs nouveaux codes dans la liste confidentielle.")
        print("  Toutes les AUTRES cartes déjà distribuées continuent de fonctionner")
        print("  telles quelles, avec leur code actuel : rien à réimprimer pour elles.")
    else:
        print("  Aucun doublon : bien.")

    titre("3. Absences qui n'en sont pas")
    print("  %s enregistrements 'absent' au total." % format(r["abs_tot"], ",").replace(",", " "))
    print("    · %d tombent un jour de REPOS hebdomadaire" % r["abs_repos"])
    print("    · %d tombent un JOUR FÉRIÉ à date fixe" % r["abs_ferie"])
    reste = r["abs_tot"] - r["abs_repos"] - r["abs_ferie"]
    print("    · %s absences réelles restantes" % format(reste, ",").replace(",", " "))
    if r["abs_ferie"] or r["abs_repos"]:
        pc = (r["abs_repos"] + r["abs_ferie"]) * 100.0 / max(1, r["abs_tot"])
        print("  Autrement dit %.1f %% de vos « absences » sont des jours chômés." % pc)
        print("  Après la mise à jour, ces journées passent en 'férié' ou 'repos' : vos")
        print("  taux d'absentéisme vont BAISSER, et les états d'absence remis au")
        print("  comptable ne les listeront plus.")
    if r["ferie_dates"]:
        print("  Dates fériées concernées : %s" % ", ".join(r["ferie_dates"]))

    titre("4. Pointages incomplets — le point le plus coûteux")
    print("  %s journées 'présent' n'ont qu'UN SEUL badge (sortie manquante)." % format(r["incomplets"], ",").replace(",", " "))
    print("  Dans votre version actuelle, ces journées comptent 0 heure, sans aucune")
    print("  alerte : elles ne sont donc pas payées.")
    if r["incomplets_mois"]:
        derniers = sorted(r["incomplets_mois"].items())[-6:]
        print("  Volume des 6 derniers mois : %s"
              % ", ".join("%s : %d" % (m, n) for m, n in derniers))
        moy = sum(n for _, n in derniers) / float(len(derniers))
        print("  Soit environ %.0f journées par mois à vérifier — c'est traitable." % moy)
    print("  La v3 les marque « à vérifier », les compte dans un bandeau et demande")
    print("  confirmation avant d'éditer le rapport de paie.")

    titre("5. Vos réglages, repris tels quels")
    print("  arrondi : %s min, %s" % (r["arrondi"], r["sens"]))
    print("  pause lundi-vendredi : %s min · tolérance de retard : %s min" % (r["pause"], r["tol"]))
    s2, ajouts, plages = migrer_settings(d.get("settings"))
    print("  Aucune de ces valeurs n'est modifiée. Complété automatiquement :")
    for x in ajouts:
        print("    + %s" % x)
    if plages:
        print("  Plage de pause déduite du milieu de journée (À CORRIGER avec vos horaires réels) :")
        for x in plages:
            print("    · %s" % x)
        print("    Tant que la plage est fausse, seules les DEMI-JOURNÉES sont mal calculées ;")
        print("    les journées complètes restent identiques à aujourd'hui.")

    # --- écriture du JSON corrigé -------------------------------------------
    propre = {k: v for k, v in d.items() if k not in ("users", "_secret")}
    propre["employees"] = emps
    propre["settings"] = s2
    propre["_migration"] = {
        "outil": "integrer_sauvegarde.py", "date": datetime.date.today().isoformat(),
        "source": os.path.basename(a.fichier),
        "retire": ["users", "_secret"],
        "identifiants_separes": rapport_ids,
        "settings_completes": ajouts,
    }
    dest = a.sortie or os.path.join(os.path.dirname(os.path.abspath(a.fichier)),
                                    os.path.splitext(os.path.basename(a.fichier))[0] + "_corrigee.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(propre, f, ensure_ascii=False)
    titre("6. Fichiers produits")
    print("  %s   (%.1f Mo)" % (dest, os.path.getsize(dest) / 1e6))
    print("     À restaurer depuis Sécurité & accès → Restaurer un fichier.")
    print("     Les pointages sont envoyés par lots : les 3 ans d'historique sont conservés.")

    # --- démonstration avec les données réelles -----------------------------
    try:
        html, nj = faire_demo(propre, a.jours_demo)
        os.makedirs(os.path.join(BASE, "demo"), exist_ok=True)
        dh = os.path.join(BASE, "demo", "PilotRH_mes_donnees.html")
        with open(dh, "w", encoding="utf-8") as f:
            f.write(html)
        print("  %s   (%.1f Mo, %d dernières journées)" % (dh, os.path.getsize(dh) / 1e6, nj))
        print("     À double-cliquer : vos données réelles dans la nouvelle interface,")
        print("     sans serveur et sans rien enregistrer.")
    except Exception as e:
        print("  (démonstration non générée : %s)" % e)

    titre("7. Ordre conseillé")
    print("  1. Ouvrez PilotRH_mes_donnees.html et vérifiez vos chiffres du mois en cours.")
    print("  2. Comparez avec ce que vous sortez aujourd'hui : les écarts doivent")
    print("     s'expliquer par les points 3 et 4 ci-dessus, et rien d'autre.")
    print("  3. Déployez la v3, puis restaurez le fichier corrigé.")
    print("  4. Réimportez votre .mdb pour reconstruire l'historique de la fiche séparée.")
    print("  5. Corrigez les plages de pause, saisissez les fêtes religieuses de l'année.")
    print("  6. Traitez les journées « à vérifier » du mois en cours, puis clôturez le mois.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
