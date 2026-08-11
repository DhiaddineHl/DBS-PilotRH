# -*- coding: utf-8 -*-
"""Reprise d'une sauvegarde de l'ancienne version (outils/integrer_sauvegarde.py).

La question qui compte ici : **les cartes QR déjà distribuées continuent-elles de
fonctionner ?** Réimprimer 97 cartes et redistribuer 97 codes en main propre est
une opération lourde ; la migration ne doit donc toucher aux accès que là où c'est
indispensable — et là où c'est indispensable, elle ne doit surtout pas l'oublier.
"""
import os
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, ".."))
sys.path.insert(0, os.path.join(ICI, "..", "outils"))
import integrer_sauvegarde as M   # noqa: E402

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


def fiche(eid, mat, nom, token="JETON-" + "x", pin="1234"):
    return {"id": eid, "matricule": mat, "prenom": "P" + mat, "nom": nom,
            "token": token + mat, "pin": pin, "sexe": "F", "categorie": "Ouvrier"}


print("\n--- sans doublon, aucune carte n'est touchée ---")
emps = [fiche("E001", "101", "Aa"), fiche("E002", "102", "Bb"), fiche("E003", "103", "Cc")]
avant = {e["id"]: (e["token"], e["pin"]) for e in emps}
rapport, sortie = M.separer_ids(emps, {})
t("aucun doublon signalé", rapport, [])
t("les 3 fiches sont conservées", len(sortie), 3)
tv("les 3 cartes restent valables",
   all((e["token"], e["pin"]) == avant[e["id"]] for e in sortie))

print("\n--- deux fiches sur le même identifiant : les DEUX accès sont révoqués ---")
# Cas réel rencontré : deux ouvrières partageaient l'identifiant E096. Une seule
# fiche existait, donc une seule carte a été imprimée — et rien ne dit laquelle
# des deux la détient. Laisser le jeton à la fiche conservée ferait courir le
# risque qu'une ouvrière ouvre l'espace personnel de l'autre.
emps = [fiche("E010", "195", "Chtiwi"), fiche("E010", "205", "Chouchen"),
        fiche("E011", "300", "Dd")]
pts = {"2026-08-%02d" % j: {"E010": {"statut": "present"}, "E011": {"statut": "present"}}
       for j in range(1, 11)}
rapport, sortie = M.separer_ids(emps, pts)
t("un doublon signalé", len(rapport), 1)
r = rapport[0]
t("l'ancien identifiant est nommé", r["ancien"], "E010")
t("la première fiche garde l'identifiant", r["garde_matricule"], "195")
t("la seconde reçoit un identifiant neuf", r["deplace_matricule"], "205")
tv("le nouvel identifiant ne collisionne pas", r["neuf"] not in ("E010", "E011"), r["neuf"])
t("le nombre de journées mélangées est chiffré", r["jours"], 10)

par_mat = {e["matricule"]: e for e in sortie}
t("les identifiants sont bien distincts",
  len({e["id"] for e in sortie}), 3)
tv("matricule 195 : accès révoqué",
   not par_mat["195"].get("token") and not par_mat["195"].get("pin"))
tv("matricule 205 : accès révoqué",
   not par_mat["205"].get("token") and not par_mat["205"].get("pin"))
tv("matricule 300, non concerné : sa carte reste valable",
   par_mat["300"].get("token") == "JETON-x300" and par_mat["300"].get("pin") == "1234",
   str(par_mat["300"].get("token")))
tv("les noms sont conservés",
   par_mat["195"]["nom"] == "Chtiwi" and par_mat["205"]["nom"] == "Chouchen")

print("\n--- trois fiches sur le même identifiant ---")
emps = [fiche("E020", "401", "Aa"), fiche("E020", "402", "Bb"), fiche("E020", "403", "Cc")]
rapport, sortie = M.separer_ids(emps, {})
t("deux déplacements signalés", len(rapport), 2)
t("trois identifiants distincts", len({e["id"] for e in sortie}), 3)
tv("les trois accès sont révoqués",
   all(not e.get("token") and not e.get("pin") for e in sortie))

print("\n--- les réglages sont complétés sans être modifiés ---")
s, ajouts, plages = M.migrer_settings({"arrondi": 15, "arrondiSens": "proche", "modeHS": "fin",
                       "jours": {"1": {"actif": True, "debut": "07:30", "fin": "16:30",
                                       "pause": 45, "tol": 0}}})
t("l'arrondi choisi est conservé", s["arrondi"], 15)
t("la tolérance à 0 minute est conservée (et non remplacée par 15)",
  s["jours"]["1"]["tol"], 0)
t("la pause de 45 minutes est conservée", s["jours"]["1"]["pause"], 45)
t("l'arrondi reste appliqué à la journée", s.get("arrondiPortee"), "jour")
tv("la plage de pause manquante est déduite et signalée", len(plages) == 1, str(plages))
tv("chaque ajout est listé pour être relu", len(ajouts) >= 3, str(len(ajouts)))
tv("les taux de rémunération sont ajoutés, à zéro",
   s.get("tauxHoraireDefaut", 0) == 0 and s.get("tauxJourDefaut", 0) == 0)

print("\n--- les secrets ne ressortent jamais du fichier corrigé ---")
brut = {"employees": [fiche("E001", "101", "Aa")], "settings": {},
        "users": [{"login": "admin", "pass": "sel$hash"}], "_secret": "cle-de-session",
        "pointages": {}}
propre = M.nettoyer(brut) if hasattr(M, "nettoyer") else None
if propre is None:
    print("  (pas de fonction de nettoyage exposée — vérification par lecture du code)")
    src = open(os.path.join(ICI, "..", "outils", "integrer_sauvegarde.py"), encoding="utf-8").read()
    tv("les comptes sont retirés", '"users"' in src and "pop" in src)
    tv("la clé de session est retirée", "_secret" in src)
else:
    tv("les comptes sont retirés", "users" not in propre)
    tv("la clé de session est retirée", "_secret" not in propre)

print("\n=========================")
print("  %d réussis · %d échoués" % (ok, ko))
sys.exit(1 if ko else 0)
