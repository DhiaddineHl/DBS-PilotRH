# -*- coding: utf-8 -*-
"""Tests de l'import en masse des fiches du personnel (fiches_import.py).

Ce qui est vérifié en priorité : qu'un import ne peut PAS effacer des données.
Une cellule vide ne touche à rien, aucune fiche n'est supprimée, aucun pointage
n'est modifié, et le classeur prérempli relu sans modification ne produit
aucun changement.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fiches_import as F   # noqa: E402

ok = ko = 0


def t(nom, got, exp):
    global ok, ko
    if got == exp:
        ok += 1
    else:
        ko += 1
        print("  ECHEC  %s\n    attendu %r\n    obtenu  %r" % (nom, exp, got))


def csv_de(lignes, sep=";"):
    return ("\r\n".join(sep.join(str(c) for c in r) for r in lignes)).encode("utf-8")


TETE = ["Matricule", "Nom", "Prénom", "Catégorie", "Service", "Date d'embauche", "Sexe",
        "Mode de paie", "Prix d'une heure (TND)", "Prix d'une journée (TND)", "Salaire mensuel (TND)"]


def etat(emps=None, exclus=None):
    return {"employees": [dict(e) for e in (emps or [])], "exclus": list(exclus or []),
            "pointages": {"2026-08-03": {"E001": {"statut": "present", "entree": "07:30", "sortie": "16:30"}}}}


BASE = [
    {"id": "E001", "matricule": "195", "nom": "Ben Salah", "prenom": "Amel",
     "categorie": "Ouvrier", "service": "Couture", "embauche": "2021-09-01", "sexe": "F",
     "tauxHoraire": 2.5, "cnss": "12345678"},
    {"id": "E002", "matricule": "205", "nom": "Trabelsi", "prenom": "Sonia",
     "categorie": "Cadre", "modePaie": "journalier", "tauxJour": 45, "sexe": "F"},
]

print("\n--- Lecture du CSV et repérage de l'en-tête ---")
data = csv_de([["PilotRH — fiches"], [], TETE,
               ["195", "Ben Salah", "Amel", "Ouvrier", "Couture", "01/09/2021", "F", "Heure", "2,5", "", "520"]])
lignes, inconnues = F.lire("x.csv", data)
t("une ligne de données lue", len(lignes), 1)
t("aucune colonne inconnue", inconnues, [])
t("le matricule est lu", lignes[0]["brut"]["matricule"], "195")
t("numéro de ligne réel du fichier", lignes[0]["n"], 4)

t("colonne inconnue signalée, pas rejetée",
  F.lire("x.csv", csv_de([TETE + ["Blabla"], ["195", "A", "B", "", "", "", "", "", "", "", "", "zz"]]))[1],
  ["Blabla"])

try:
    F.lire("x.csv", csv_de([["Nom", "Prénom"], ["A", "B"]]))
    t("sans colonne Matricule => refus", "pas d'erreur", "ValueError")
except ValueError as e:
    t("sans colonne Matricule => refus", "Matricule" in str(e), True)

try:
    F.lire("vieux.xls", b"\x00\x01")
    t("format .xls refusé avec explication", "pas d'erreur", "ValueError")
except ValueError as e:
    t("format .xls refusé avec explication", ".xlsx" in str(e), True)

print("\n--- Dates, nombres, listes ---")
t("date JJ/MM/AAAA", F._date("01/09/2021"), "2021-09-01")
t("date AAAA-MM-JJ", F._date("2021-09-01"), "2021-09-01")
t("date JJ-MM-AAAA", F._date("1-9-2021"), "2021-09-01")
t("année sur 2 chiffres", F._date("01/09/96"), "1996-09-01")
t("date vide => None", F._date(""), None)
for mauvaise in ("32/01/2021", "abc", "2021/13/01"):
    try:
        F._date(mauvaise)
        t("date invalide « %s » refusée" % mauvaise, "pas d'erreur", "ValueError")
    except ValueError:
        t("date invalide « %s » refusée" % mauvaise, True, True)
t("virgule décimale", F._num("2,5"), 2.5)
t("point décimal", F._num("2.5"), 2.5)
t("espaces ignorés", F._num(" 1 250,75 "), 1250.75)
try:
    F._num("-3")
    t("nombre négatif refusé", "pas d'erreur", "ValueError")
except ValueError:
    t("nombre négatif refusé", True, True)
t("sexe Femme => F", F._sexe("Femme"), "F")
t("sexe h => H", F._sexe("h"), "H")
t("sexe inconnu => None", F._sexe("autre"), None)
t("mode Heure", F._mode_paie("Heure"), "horaire")
t("mode Journée accentué", F._mode_paie("Journée"), "journalier")
t("mode journalier", F._mode_paie("journalier"), "journalier")
t("mode inconnu => None", F._mode_paie("mensuel"), None)
t("en-tête sans accent ni ponctuation reconnu", F.ALIAS[F._clef_entete("N° CNSS")], "cnss")
t("en-tête « Prix d'une heure (TND) » reconnu",
  F.ALIAS[F._clef_entete("Prix d'une heure (TND)")], "tauxHoraire")

print("\n--- Analyse : création, mise à jour, inchangé ---")
d = csv_de([TETE,
            ["195", "Ben Salah", "Amel", "Ouvrier", "Couture", "01/09/2021", "F", "Heure", "2,5", "", "520"],
            ["300", "Jlassi", "Rim", "Ouvrier", "Coupe", "10/03/2026", "F", "Heure", "2,5", "", "500"]])
rap = F.analyser(etat(BASE), F.lire("x.csv", d)[0])
t("une création + une mise à jour",
  [rap["resume"]["creation"], rap["resume"]["maj"], rap["resume"]["erreur"]], [1, 1, 0])
t("la nouvelle est bien une création", rap["lignes"][1]["action"], "creation")
t("seuls le salaire change sur l'existante", rap["lignes"][0]["champs"], ["salaire"])
t("les fiches non citées sont comptées, pas supprimées", rap["resume"]["absents"], 1)

d2 = csv_de([TETE, ["195", "", "", "", "", "", "", "", "", "", "520"]])
rap2 = F.analyser(etat(BASE), F.lire("x.csv", d2)[0])
t("cellules vides : rien d'autre ne change", rap2["lignes"][0]["champs"], ["salaire"])

d3 = csv_de([TETE, ["195", "Ben Salah", "Amel", "Ouvrier", "Couture", "01/09/2021", "F", "Heure", "2,5", "", ""]])
t("aucune différence => inchangé",
  F.analyser(etat(BASE), F.lire("x.csv", d3)[0])["lignes"][0]["action"], "inchange")

print("\n--- Erreurs et doublons ---")
d4 = csv_de([TETE, ["", "Sans matricule", "", "", "", "", "", "", "", "", ""]])
r4 = F.analyser(etat(BASE), F.lire("x.csv", d4)[0])
t("matricule manquant => erreur", r4["lignes"][0]["action"], "erreur")
t("erreur explicite", "matricule manquant" in r4["lignes"][0]["erreurs"][0], True)

d5 = csv_de([TETE,
             ["300", "Jlassi", "Rim", "", "", "", "", "", "", "", ""],
             ["300", "Autre", "Nom", "", "", "", "", "", "", "", ""]])
r5 = F.analyser(etat(BASE), F.lire("x.csv", d5)[0])
t("matricule en double dans le fichier => erreur sur la 2e", r5["lignes"][1]["action"], "erreur")
t("le doublon cite la première ligne", "ligne 2" in r5["lignes"][1]["erreurs"][0], True)
t("la première passe quand même", r5["lignes"][0]["action"], "creation")

d6 = csv_de([TETE, ["400", "", "", "", "", "", "", "", "", "", "500"]])
r6 = F.analyser(etat(BASE), F.lire("x.csv", d6)[0])
t("création sans nom => erreur", r6["lignes"][0]["action"], "erreur")
t("message clair sur le nom", "nom" in r6["lignes"][0]["erreurs"][0].lower(), True)

d7 = csv_de([TETE, ["195", "", "", "Directeur", "", "", "", "", "", "", ""]])
r7 = F.analyser(etat(BASE), F.lire("x.csv", d7)[0])
t("catégorie hors liste => erreur", r7["lignes"][0]["action"], "erreur")
t("l'erreur nomme la colonne", "Catégorie" in r7["lignes"][0]["erreurs"][0], True)

d8 = csv_de([TETE, ["195", "", "", "", "Atelier tricot", "", "", "", "", "", ""]])
r8 = F.analyser(etat(BASE), F.lire("x.csv", d8)[0])
t("service hors liste : accepté avec un avis", r8["lignes"][0]["action"], "maj")
t("avis émis", len(r8["lignes"][0]["avis"]), 1)

d9 = csv_de([TETE, ["195", "", "", "", "", "", "", "", "trois", "", ""]])
t("taux illisible => erreur",
  F.analyser(etat(BASE), F.lire("x.csv", d9)[0])["lignes"][0]["action"], "erreur")

d10 = csv_de([TETE, ["600", "Ancienne", "Ouvrière", "", "", "", "", "", "", "", ""]])
r10 = F.analyser(etat(BASE, exclus=["600"]), F.lire("x.csv", d10)[0])
t("matricule démissionné : recréation possible mais signalée", r10["lignes"][0]["action"], "creation")
t("avis de réapparition dans les imports", "démission" in r10["lignes"][0]["avis"][0], True)

print("\n--- Effacer un champ avec « - » ---")
d11 = csv_de([TETE + ["Téléphone"], ["195", "", "", "", "-", "", "", "", "", "", "", "-"]])
r11 = F.analyser(etat(BASE), F.lire("x.csv", d11)[0])
t("« - » efface bien le champ", r11["lignes"][0]["valeurs"]["service"], "")
t("« - » listé comme changement", sorted(r11["lignes"][0]["champs"]), ["service"])
d11b = csv_de([TETE + ["N° CNSS"], ["195", "", "", "", "", "", "", "", "", "", "", "-"]])
r11b = F.analyser(etat(BASE), F.lire("x.csv", d11b)[0])
t("« - » efface un champ réellement rempli",
  [r11b["lignes"][0]["champs"], r11b["lignes"][0]["valeurs"]["cnss"]], [["cnss"], ""])

print("\n--- Application : ce qui est écrit, ce qui ne l'est pas ---")
st = etat(BASE)
rap = F.analyser(st, F.lire("x.csv", csv_de([TETE,
    ["195", "", "", "", "", "", "", "", "", "", "600"],
    ["300", "Jlassi", "Rim", "Ouvrier", "Coupe", "10/03/2026", "F", "Heure", "2,75", "", "500"],
    ["", "Sans matricule", "", "", "", "", "", "", "", "", ""]]))[0])
res = F.appliquer(st, rap)
t("1 créée, 1 mise à jour", [res["crees"], res["majs"]], [1, 1])
t("effectif passé de 2 à 3", len(st["employees"]), 3)
e195 = [e for e in st["employees"] if e["matricule"] == "195"][0]
t("salaire mis à jour", e195["salaire"], 600)
t("nom NON écrasé par une cellule vide", e195["nom"], "Ben Salah")
t("CNSS conservé", e195["cnss"], "12345678")
t("taux horaire conservé", e195["tauxHoraire"], 2.5)
e300 = [e for e in st["employees"] if e["matricule"] == "300"][0]
t("identifiant attribué sans collision", e300["id"], "E003")
t("nouvelle fiche active", e300["actif"], True)
t("CIN par défaut = matricule si absent", e300["cin"], "300")
t("mode de paie converti", e300["modePaie"], "horaire")
t("taux à virgule converti", e300["tauxHoraire"], 2.75)
t("date convertie en ISO", e300["embauche"], "2026-03-10")
t("les pointages ne sont pas touchés", st["pointages"]["2026-08-03"]["E001"]["entree"], "07:30")
t("aucune fiche supprimée", sorted(e["matricule"] for e in st["employees"]), ["195", "205", "300"])
t("E002, absent du fichier, intact",
  [e for e in st["employees"] if e["id"] == "E002"][0]["tauxJour"], 45)

st2 = etat([dict(BASE[0], aCompleter=True)])
F.appliquer(st2, F.analyser(st2, F.lire("x.csv", csv_de([TETE,
    ["195", "Ben Salah", "Amel", "Ouvrier", "Couture", "01/09/2021", "F", "Heure", "2,5", "", "600"]]))[0]))
t("marque « fiche à compléter » retirée après renseignement",
  "aCompleter" in st2["employees"][0], False)

st3 = etat(BASE)
F.appliquer(st3, F.analyser(st3, F.lire("x.csv", csv_de([TETE,
    ["", "Sans matricule", "", "", "", "", "", "", "", "", ""]]))[0]))
t("une ligne en erreur n'écrit rien", len(st3["employees"]), 2)

print("\n--- Modèle Excel : génération et aller-retour ---")
try:
    import openpyxl  # noqa: F401
    dispo = True
except ImportError:
    dispo = False

if not dispo:
    print("  (openpyxl absent — tests du classeur ignorés)")
else:
    vierge = F.modele_xlsx()
    t("le modèle vierge est un vrai .xlsx", vierge[:2], b"PK")
    wb = openpyxl.load_workbook(__import__("io").BytesIO(vierge))
    t("deux onglets : Fiches et Notice", wb.sheetnames, ["Fiches", "Notice"])
    ws = wb["Fiches"]
    t("toutes les colonnes présentes dans l'ordre",
      [ws.cell(row=5, column=j + 1).value for j in range(len(F.COLONNES))], F.TITRES)
    t("une ligne d'exemple est fournie", ws.cell(row=6, column=1).value, "195")
    t("listes déroulantes posées", len(ws.data_validations.dataValidation) > 0, True)
    wb.close()

    lignes, inc = F.lire("m.xlsx", vierge)
    t("le modèle vierge se relit : la seule ligne est l'exemple", len(lignes), 1)
    t("aucune ligne parasite de commentaire dans le tableau",
      [l["brut"].get("matricule") for l in lignes], ["195"])
    t("aucune colonne inconnue dans le modèle", inc, [])

    prerempli = F.modele_xlsx(BASE)
    lignes, inc = F.lire("a.xlsx", prerempli)
    t("les 2 fiches sont préremplies", len(lignes), 2)
    r = F.analyser(etat(BASE), lignes)
    t("aller-retour sans modification => aucun changement",
      [r["resume"]["creation"], r["resume"]["maj"], r["resume"]["erreur"], r["resume"]["inchange"]],
      [0, 0, 0, 2])
    t("la notice n'est pas lue comme un tableau de données", r["resume"]["total"], 2)

    # une seule colonne complétée dans le classeur prérempli
    wb = openpyxl.load_workbook(__import__("io").BytesIO(prerempli))
    ws = wb["Fiches"]
    col = F.TITRES.index("Prix d'une heure (TND)") + 1
    ws.cell(row=6, column=col, value=3.1)
    buf = __import__("io").BytesIO()
    wb.save(buf)
    r = F.analyser(etat(BASE), F.lire("a.xlsx", buf.getvalue())[0])
    t("une seule cellule modifiée => un seul champ change",
      [r["lignes"][0]["action"], r["lignes"][0]["champs"]], ["maj", ["tauxHoraire"]])
    t("l'autre fiche reste inchangée", r["lignes"][1]["action"], "inchange")

    grand = F.modele_xlsx([dict(BASE[0], id="E%03d" % i, matricule=str(1000 + i)) for i in range(1, 121)])
    t("120 fiches préremplies sans erreur", len(F.lire("g.xlsx", grand)[0]), 120)

print("\n=========================")
print("  %d réussis · %d échoués" % (ok, ko))
sys.exit(1 if ko else 0)
