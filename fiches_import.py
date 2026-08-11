# -*- coding: utf-8 -*-
"""Import en masse des fiches du personnel — modèle à remplir puis à renvoyer.

Créer 97 fiches à la main dans l'interface prend des heures et se prête aux
fautes de frappe. Ce module produit un classeur Excel prérempli (colonnes
nommées, listes déroulantes, notice) et sait le relire pour créer ou mettre à
jour les fiches en une fois.

Trois garde-fous, volontairement stricts :
  1. Le rapprochement se fait sur le MATRICULE, jamais sur le nom : c'est la
     clé qui relie une fiche aux pointages de la pointeuse.
  2. Une cellule VIDE ne modifie rien. Sans cette règle, remplir trois colonnes
     effacerait tout le reste du dossier. Pour vider un champ, on écrit « - ».
  3. Aucun pointage n'est touché, et personne n'est jamais supprimé.
"""
import csv
import io
import re
import unicodedata
from datetime import date, datetime

# Listes de référence : elles alimentent les listes déroulantes du modèle et
# restent alignées sur celles de l'interface (pilotrh-app.js).
SERVICES = ['Couture', 'Coupe', 'Finition', 'Repassage', 'Qualité', 'Méthodes', 'Magasin']
ATELIERS = ['Atelier A', 'Atelier B', 'Atelier C']
POSTES = ['Couturière piqueuse', 'Mécanicienne', 'Repasseuse', 'Contrôleuse qualité', 'Coupeuse',
          'Finition main', "Chef d’atelier", 'Agent de méthode', 'Préparatrice', 'Magasinier']
CONTRATS = ['CDI', 'CDD', 'CIVP', 'SIVP']
CATEGORIES = ['Ouvrier', 'Cadre']
FAMILLES = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)']
NIVEAUX = ['Sans', 'Primaire', 'Base', 'Secondaire', 'Bac', 'Licence', 'Maîtrise', 'Ingénieur']
SEXES = ['F', 'H']
MODES_PAIE = ['Heure', 'Journée']

VIDER = "-"          # écrire « - » dans une cellule pour effacer le champ

# (clé interne, titre de colonne, type, liste de choix, aide affichée en notice)
COLONNES = [
    ("matricule",   "Matricule",                  "txt",  None,       "OBLIGATOIRE — le numéro du badge sur la pointeuse. C'est la clé : s'il existe déjà, la fiche est mise à jour ; sinon elle est créée."),
    ("nom",         "Nom",                        "txt",  None,       "OBLIGATOIRE pour une création."),
    ("prenom",      "Prénom",                     "txt",  None,       ""),
    ("cin",         "CIN",                        "txt",  None,       "Numéro de carte d'identité."),
    ("cnss",        "N° CNSS",                    "txt",  None,       ""),
    ("poste",       "Poste",                      "txt",  POSTES,     "Liste déroulante, mais un autre libellé est accepté."),
    ("categorie",   "Catégorie",                  "txt",  CATEGORIES, "Ouvrier ou Cadre."),
    ("service",     "Service",                    "txt",  SERVICES,   ""),
    ("atelier",     "Atelier",                    "txt",  ATELIERS,   ""),
    ("contrat",     "Contrat",                    "txt",  CONTRATS,   ""),
    ("embauche",    "Date d'embauche",            "date", None,       "JJ/MM/AAAA (ou une vraie date Excel)."),
    ("naissance",   "Date de naissance",          "date", None,       "JJ/MM/AAAA (ou une vraie date Excel)."),
    ("sexe",        "Sexe",                       "txt",  SEXES,      "F ou H (Femme / Homme acceptés)."),
    ("famille",     "Situation familiale",        "txt",  FAMILLES,   ""),
    ("enfants",     "Enfants",                    "int",  None,       "Nombre d'enfants."),
    ("niveau",      "Niveau scolaire",            "txt",  NIVEAUX,    ""),
    ("tel",         "Téléphone",                  "txt",  None,       ""),
    ("email",       "Email",                      "txt",  None,       ""),
    ("adresse",     "Adresse",                    "txt",  None,       ""),
    ("responsable", "Responsable",                "txt",  None,       ""),
    ("modePaie",    "Mode de paie",               "txt",  MODES_PAIE, "Heure = payé(e) à l'heure (convention) · Journée = payé(e) à la journée travaillée (cadres). Vide = déduit de la catégorie."),
    ("tauxHoraire", "Prix d'une heure (TND)",     "num",  None,       "Utilisé si le mode de paie est « Heure »."),
    ("tauxJour",    "Prix d'une journée (TND)",   "num",  None,       "Utilisé si le mode de paie est « Journée »."),
    ("salaire",     "Salaire mensuel (TND)",      "num",  None,       "Information de dossier : n'entre pas dans le calcul de la paie."),
]
PAR_CLE = {c[0]: c for c in COLONNES}
TITRES = [c[1] for c in COLONNES]


# ---------------------------------------------------------------------------
# normalisation
# ---------------------------------------------------------------------------
def _sansacc(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def _clef_entete(s):
    """« N° CNSS », « n cnss », « NCNSS » → même clé."""
    return re.sub(r"[^a-z0-9]", "", _sansacc(s).lower())


# Synonymes tolérés en en-tête, pour ne pas rejeter un fichier retapé à la main.
ALIAS = {
    "matricule": "matricule", "mat": "matricule", "badge": "matricule", "numerobadge": "matricule",
    "nom": "nom", "nomdefamille": "nom",
    "prenom": "prenom",
    "cin": "cin", "cartedidentite": "cin",
    "ncnss": "cnss", "cnss": "cnss", "numerocnss": "cnss",
    "poste": "poste", "fonction": "poste",
    "categorie": "categorie",
    "service": "service",
    "atelier": "atelier",
    "contrat": "contrat", "typedecontrat": "contrat",
    "datedembauche": "embauche", "embauche": "embauche", "dateembauche": "embauche",
    "datedenaissance": "naissance", "naissance": "naissance", "datenaissance": "naissance",
    "sexe": "sexe", "genre": "sexe",
    "situationfamiliale": "famille", "situation": "famille", "famille": "famille",
    "enfants": "enfants", "nombredenfants": "enfants",
    "niveauscolaire": "niveau", "niveau": "niveau",
    "telephone": "tel", "tel": "tel", "gsm": "tel", "portable": "tel",
    "email": "email", "mail": "email", "adresseemail": "email",
    "adresse": "adresse", "lieu": "adresse",
    "responsable": "responsable", "chef": "responsable",
    "modedepaie": "modePaie", "modepaie": "modePaie", "paye": "modePaie", "paiement": "modePaie",
    "prixduneheuretnd": "tauxHoraire", "prixduneheure": "tauxHoraire", "tauxhoraire": "tauxHoraire",
    "prixheure": "tauxHoraire", "tauxhorairetnd": "tauxHoraire",
    "prixdunejourneetnd": "tauxJour", "prixdunejournee": "tauxJour", "tauxjour": "tauxJour",
    "prixjour": "tauxJour", "tauxjourtnd": "tauxJour", "tauxjournalier": "tauxJour",
    "salairemenseueltnd": "salaire", "salairemensueltnd": "salaire", "salairemensuel": "salaire",
    "salaire": "salaire", "salairetnd": "salaire",
}


def _val(x):
    """Valeur d'une cellule, en texte propre."""
    if x is None:
        return ""
    if isinstance(x, (datetime, date)):
        return x.strftime("%Y-%m-%d")
    if isinstance(x, float) and x == int(x):
        return str(int(x))
    return str(x).strip()


def _date(s):
    """Accepte JJ/MM/AAAA, JJ-MM-AAAA, AAAA-MM-JJ et les dates Excel."""
    s = _val(s)
    if not s:
        return None
    s = s.replace(".", "/").replace("-", "/").strip()
    m = re.match(r"^(\d{4})/(\d{1,2})/(\d{1,2})$", s)
    if m:
        a, mo, j = m.groups()
    else:
        m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
        if not m:
            raise ValueError("date illisible « %s » (attendu JJ/MM/AAAA)" % s)
        j, mo, a = m.groups()
        if len(a) == 2:
            a = ("20" if int(a) < 70 else "19") + a
    try:
        d = date(int(a), int(mo), int(j))
    except ValueError:
        raise ValueError("date impossible « %s »" % s)
    if not (1930 <= d.year <= 2100):
        raise ValueError("année invraisemblable « %s »" % s)
    return d.isoformat()


def _num(s):
    s = _val(s).replace(" ", "").replace(" ", "").replace(",", ".")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        raise ValueError("nombre illisible « %s »" % s)
    if v < 0:
        raise ValueError("nombre négatif « %s »" % s)
    return round(v, 3)


def _choix(s, liste, quoi):
    """Rapproche une valeur d'une liste de référence sans tenir compte de la
    casse ni des accents ; laisse passer une valeur libre pour les listes
    ouvertes (poste, service, atelier)."""
    s = _val(s)
    if not s:
        return None
    k = _clef_entete(s)
    for ref in liste:
        if _clef_entete(ref) == k:
            return ref
    return ("LIBRE", s) if quoi in ("poste", "service", "atelier", "famille", "niveau", "contrat") else None


def _sexe(s):
    k = _clef_entete(s)
    if k in ("f", "femme", "feminin", "mme", "mlle"):
        return "F"
    if k in ("h", "homme", "m", "masculin", "mr"):
        return "H"
    return None


def _mode_paie(s):
    k = _clef_entete(s)
    if k in ("heure", "heures", "horaire", "alheure", "h", "aheure"):
        return "horaire"
    if k in ("journee", "jour", "journalier", "alajournee", "j", "ajournee"):
        return "journalier"
    return None


# ---------------------------------------------------------------------------
# lecture d'un fichier fourni
# ---------------------------------------------------------------------------
def lire(nom, data):
    """Renvoie (lignes, entetes_inconnues). Chaque ligne est
    {"n": numéro de ligne dans le fichier, "brut": {cle: texte}}."""
    bas = (nom or "").lower()
    if bas.endswith(".xlsx") or bas.endswith(".xlsm"):
        table = _lire_xlsx(data)
    elif bas.endswith(".csv") or bas.endswith(".txt"):
        table = _lire_csv(data)
    elif bas.endswith(".xls"):
        raise ValueError("Le format .xls (ancien Excel) n'est pas lu. "
                         "Ouvrez le fichier et enregistrez-le en .xlsx, ou en .csv.")
    else:
        raise ValueError("Format non reconnu : attendu .xlsx ou .csv")

    # repérage de la ligne d'en-tête : celle qui contient « matricule »
    idx_ent = None
    for i, r in enumerate(table[:30]):
        if any(_clef_entete(c) in ("matricule", "mat", "badge") for c in r):
            idx_ent = i
            break
    if idx_ent is None:
        raise ValueError("Colonne « Matricule » introuvable. Utilisez le modèle proposé : "
                         "la première ligne du tableau doit porter les noms des colonnes.")

    entete = table[idx_ent]
    mapping, inconnues = {}, []
    for j, titre in enumerate(entete):
        t = _val(titre)
        if not t:
            continue
        cle = ALIAS.get(_clef_entete(t))
        if cle:
            mapping[j] = cle
        else:
            inconnues.append(t)

    lignes = []
    for i in range(idx_ent + 1, len(table)):
        r = table[i]
        brut = {}
        for j, cle in mapping.items():
            if j < len(r):
                brut[cle] = _val(r[j])
        if not any(brut.values()):
            continue                      # ligne entièrement vide : ignorée
        lignes.append({"n": i + 1, "brut": brut})
    return lignes, inconnues


def _lire_xlsx(data):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = None
    for f in wb.worksheets:                     # la notice n'est pas un tableau
        if _clef_entete(f.title) != "notice":
            ws = f
            break
    ws = ws or wb.worksheets[0]
    table = []
    for r in ws.iter_rows(values_only=True):
        table.append(["" if c is None else c for c in r])
        if len(table) > 5000:
            raise ValueError("Fichier trop long (plus de 5000 lignes)")
    wb.close()
    return table


def _lire_csv(data):
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            txt = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("Encodage du CSV illisible")
    tete = txt[:4000]
    sep = ";" if tete.count(";") >= tete.count(",") else ","
    return [r for r in csv.reader(io.StringIO(txt), delimiter=sep)]


# ---------------------------------------------------------------------------
# analyse : ce que l'import ferait, sans rien écrire
# ---------------------------------------------------------------------------
def _mat(e):
    return str(e.get("matricule") or e.get("cin") or "").strip()


def _nouvel_id(employees):
    mx = 0
    for e in employees:
        m = re.match(r"^E(\d+)$", str(e.get("id") or ""))
        if m:
            mx = max(mx, int(m.group(1)))
    return "E%03d" % (mx + 1)


def analyser(state, lignes):
    """Calcule, ligne par ligne, l'action et les champs qui changeraient.
    N'écrit rien : c'est l'aperçu montré avant validation."""
    employees = state.get("employees") or []
    par_mat = {}
    for e in employees:
        m = _mat(e)
        if m:
            par_mat.setdefault(m, e)
    exclus = set(str(x) for x in (state.get("exclus") or []))

    vus = {}
    res = []
    for ligne in lignes:
        b = ligne["brut"]
        out = {"n": ligne["n"], "matricule": b.get("matricule", ""), "nom": "", "action": "",
               "champs": [], "erreurs": [], "avis": [], "valeurs": {}}
        mat = _val(b.get("matricule"))
        if not mat:
            out["action"] = "erreur"
            out["erreurs"].append("matricule manquant")
            res.append(out)
            continue
        if mat in vus:
            out["action"] = "erreur"
            out["erreurs"].append("matricule en double dans le fichier (déjà ligne %d)" % vus[mat])
            res.append(out)
            continue
        vus[mat] = ligne["n"]

        vals = {}
        for cle, titre, typ, choix, _aide in COLONNES:
            if cle not in b:
                continue
            txt = _val(b[cle])
            if txt == "":
                continue                      # cellule vide : on ne touche pas
            if txt == VIDER:
                vals[cle] = "" if typ in ("txt", "date") else 0
                continue
            try:
                if typ == "date":
                    vals[cle] = _date(txt)
                elif typ == "num":
                    vals[cle] = _num(txt)
                elif typ == "int":
                    v = _num(txt)
                    vals[cle] = int(v) if v is not None else 0
                elif cle == "sexe":
                    v = _sexe(txt)
                    if v is None:
                        raise ValueError("sexe « %s » non reconnu (attendu F ou H)" % txt)
                    vals[cle] = v
                elif cle == "modePaie":
                    v = _mode_paie(txt)
                    if v is None:
                        raise ValueError("mode de paie « %s » non reconnu (attendu Heure ou Journée)" % txt)
                    vals[cle] = v
                elif choix:
                    v = _choix(txt, choix, cle)
                    if v is None:
                        raise ValueError("%s : « %s » n'est pas dans la liste (%s)" % (titre, txt, ", ".join(choix)))
                    if isinstance(v, tuple):
                        vals[cle] = v[1]
                        out["avis"].append("%s « %s » hors liste, conservé tel quel" % (titre, v[1]))
                    else:
                        vals[cle] = v
                else:
                    vals[cle] = txt
            except ValueError as ex:
                out["erreurs"].append("%s : %s" % (titre, ex))

        existant = par_mat.get(mat)
        out["nom"] = _val(vals.get("prenom") or (existant or {}).get("prenom")) + " " + \
                     _val(vals.get("nom") or (existant or {}).get("nom"))
        out["nom"] = out["nom"].strip()

        if out["erreurs"]:
            out["action"] = "erreur"
            res.append(out)
            continue

        if existant is None:
            if not _val(vals.get("nom")):
                out["action"] = "erreur"
                out["erreurs"].append("nouvelle fiche sans nom : le nom est obligatoire pour créer")
                res.append(out)
                continue
            if mat in exclus:
                out["avis"].append("ce matricule figure dans les départs (démission) : "
                                   "la fiche sera recréée et réapparaîtra dans les imports")
            out["action"] = "creation"
            out["champs"] = sorted(vals.keys())
        else:
            change = []
            for cle, v in list(vals.items()):
                avant = existant.get(cle)
                if cle == "modePaie" and not avant:
                    # mode absent de la fiche : il est déduit de la catégorie.
                    # Si le fichier redit la même chose, rien ne change et on
                    # n'écrit pas : sinon tout aller-retour du modèle prérempli
                    # apparaîtrait comme une modification de toutes les fiches.
                    cat = _val(vals.get("categorie") or existant.get("categorie"))
                    deduit = "journalier" if cat == "Cadre" else "horaire"
                    if v == deduit:
                        vals.pop(cle)
                        continue
                if cle in ("enfants", "salaire", "tauxHoraire", "tauxJour"):
                    if float(avant or 0) != float(v or 0):
                        change.append(cle)
                elif _val(avant) != _val(v):
                    change.append(cle)
            out["action"] = "maj" if change else "inchange"
            out["champs"] = sorted(change)
            out["id"] = existant.get("id")
        out["valeurs"] = vals
        res.append(out)

    resume = {"total": len(res)}
    for a in ("creation", "maj", "inchange", "erreur"):
        resume[a] = sum(1 for r in res if r["action"] == a)
    # fiches existantes absentes du fichier : signalées, jamais supprimées
    resume["absents"] = sum(1 for m in par_mat if m not in vus)
    return {"lignes": res, "resume": resume}


def appliquer(state, rapport):
    """Écrit les créations et mises à jour du rapport dans state["employees"].
    Ne supprime rien, ne touche à aucun pointage."""
    employees = state.get("employees") or []
    par_mat = {}
    for e in employees:
        m = _mat(e)
        if m:
            par_mat.setdefault(m, e)
    crees, majs = 0, 0
    for r in rapport["lignes"]:
        if r["action"] not in ("creation", "maj"):
            continue
        vals = r.get("valeurs") or {}
        mat = _val(r["matricule"])
        e = par_mat.get(mat)
        if e is None:
            e = {"id": _nouvel_id(employees), "matricule": mat, "actif": True,
                 "cin": _val(vals.get("cin")) or mat, "sexe": "F"}
            employees.append(e)
            par_mat[mat] = e
            crees += 1
        else:
            majs += 1
        for cle, v in vals.items():
            e[cle] = v
        e["matricule"] = mat
        e.pop("aCompleter", None)          # la fiche vient d'être renseignée
    state["employees"] = employees
    return {"crees": crees, "majs": majs}


# ---------------------------------------------------------------------------
# génération du modèle
# ---------------------------------------------------------------------------
def modele_xlsx(employees=None):
    """Classeur à remplir. Si `employees` est fourni, les fiches actuelles y sont
    préremplies : on corrige en masse au lieu de tout retaper."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Fiches"

    or_ = "FF8A6D3B"
    ws["A1"] = "PilotRH — fiches du personnel"
    ws["A1"].font = Font(size=14, bold=True, color=or_)
    ws["A2"] = ("Remplissez une ligne par salarié. Le MATRICULE est la clé : s'il existe déjà, la fiche est mise à jour ; "
                "sinon elle est créée. Une cellule laissée VIDE ne change rien — écrivez « - » pour effacer un champ. "
                "Aucun pointage n'est modifié et personne n'est supprimé. Voir l'onglet Notice. "
                "La ligne grisée en italique est un EXEMPLE : remplacez-la par vos données ou supprimez-la.")
    ws["A2"].font = Font(size=9, italic=True, color="FF666666")
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=2, start_column=1, end_row=3, end_column=min(12, len(COLONNES)))
    ws.row_dimensions[2].height = 15
    ws.row_dimensions[3].height = 15

    LIG = 5                                     # ligne d'en-tête du tableau
    fond = PatternFill("solid", fgColor="FFF3EAD9")
    bord = Border(bottom=Side(style="thin", color="FFD9C9A8"))
    for j, (cle, titre, typ, choix, _aide) in enumerate(COLONNES, start=1):
        c = ws.cell(row=LIG, column=j, value=titre)
        c.font = Font(bold=True, size=10, color=or_)
        c.fill = fond
        c.border = bord
        c.alignment = Alignment(wrap_text=True, vertical="center")
        largeur = 13
        if cle in ("nom", "prenom", "poste", "adresse", "email", "responsable"):
            largeur = 22
        elif cle in ("service", "atelier", "famille", "niveau", "modePaie"):
            largeur = 18
        elif cle in ("tauxHoraire", "tauxJour", "salaire", "embauche", "naissance"):
            largeur = 16
        ws.column_dimensions[get_column_letter(j)].width = largeur
    ws.row_dimensions[LIG].height = 30
    ws.freeze_panes = ws.cell(row=LIG + 1, column=3)

    # listes déroulantes
    for j, (cle, titre, typ, choix, _aide) in enumerate(COLONNES, start=1):
        if not choix:
            continue
        libelles = MODES_PAIE if cle == "modePaie" else choix
        dv = DataValidation(type="list", formula1='"%s"' % ",".join(libelles),
                            allow_blank=True, showErrorMessage=False)
        ws.add_data_validation(dv)
        col = get_column_letter(j)
        dv.add("%s%d:%s%d" % (col, LIG + 1, col, LIG + 600))

    fmt_date = "DD/MM/YYYY"
    fmt_num = "0.000"
    lignes_ecrites = 0
    for e in (employees or []):
        r = LIG + 1 + lignes_ecrites
        mode = e.get("modePaie") if e.get("modePaie") in ("horaire", "journalier") else ""
        src = {
            "matricule": _mat(e), "nom": e.get("nom"), "prenom": e.get("prenom"),
            "cin": e.get("cin"), "cnss": e.get("cnss"), "poste": e.get("poste"),
            "categorie": e.get("categorie"), "service": e.get("service"), "atelier": e.get("atelier"),
            "contrat": e.get("contrat"), "embauche": e.get("embauche"), "naissance": e.get("naissance"),
            "sexe": ("H" if e.get("sexe") == "H" else "F") if e.get("sexe") else "",
            "famille": e.get("famille"),
            "enfants": e.get("enfants"), "niveau": e.get("niveau"), "tel": e.get("tel"),
            "email": e.get("email"), "adresse": e.get("adresse"), "responsable": e.get("responsable"),
            "modePaie": {"journalier": "Journée", "horaire": "Heure"}.get(mode, ""),
            "tauxHoraire": e.get("tauxHoraire"), "tauxJour": e.get("tauxJour"), "salaire": e.get("salaire"),
        }
        for j, (cle, titre, typ, choix, _aide) in enumerate(COLONNES, start=1):
            v = src.get(cle)
            if v in (None, "", 0) and typ in ("num", "int"):
                v = None
            c = ws.cell(row=r, column=j)
            if typ == "date" and v:
                try:
                    y, m, d = str(v)[:10].split("-")
                    c.value = date(int(y), int(m), int(d))
                    c.number_format = fmt_date
                except Exception:
                    c.value = str(v)
            elif typ == "num":
                c.value = None if v is None else float(v)
                c.number_format = fmt_num
            elif typ == "int":
                c.value = None if v is None else int(v)
            else:
                c.value = "" if v is None else str(v)
            c.font = Font(size=10)
            if cle == "matricule":
                c.font = Font(size=10, bold=True)
        lignes_ecrites += 1

    if not lignes_ecrites:
        # une ligne d'exemple, en gris, à écraser
        exemple = {"matricule": "195", "nom": "Ben Salah", "prenom": "Amel", "cin": "09123456",
                   "cnss": "12345678", "poste": POSTES[0], "categorie": "Ouvrier",
                   "service": SERVICES[0], "atelier": ATELIERS[0], "contrat": "CDI",
                   "embauche": "2021-09-01", "naissance": "1996-04-12", "sexe": "F",
                   "famille": FAMILLES[0], "enfants": 0, "niveau": "Base", "tel": "20 000 000",
                   "email": "", "adresse": "Nabeul", "responsable": "", "modePaie": "Heure",
                   "tauxHoraire": 2.5, "tauxJour": None, "salaire": 520}
        for j, (cle, titre, typ, choix, _aide) in enumerate(COLONNES, start=1):
            v = exemple.get(cle)
            c = ws.cell(row=LIG + 1, column=j)
            if typ == "date" and v:
                y, m, d = str(v).split("-")
                c.value = date(int(y), int(m), int(d))
                c.number_format = fmt_date
            elif typ in ("num", "int"):
                c.value = v
                if typ == "num":
                    c.number_format = fmt_num
            else:
                c.value = "" if v is None else str(v)
            c.font = Font(size=10, italic=True, color="FF999999")


    # ------------------------------------------------------------- notice
    nt = wb.create_sheet("Notice")
    nt.column_dimensions["A"].width = 30
    nt.column_dimensions["B"].width = 100
    nt["A1"] = "Comment remplir ce fichier"
    nt["A1"].font = Font(size=13, bold=True, color=or_)
    regles = [
        ("Clé de rapprochement", "Le MATRICULE, et lui seul. C'est le numéro du badge sur la pointeuse. "
                                 "Matricule déjà connu → la fiche est mise à jour. Matricule inconnu → une fiche est créée."),
        ("Cellule vide", "Ne change rien. Vous pouvez donc ne remplir que les colonnes qui vous intéressent."),
        ("Effacer un champ", "Écrivez « %s » dans la cellule." % VIDER),
        ("Ce qui n'est jamais touché", "Les pointages, l'historique, les congés et les accès QR. "
                                       "Aucune fiche n'est supprimée par un import : les personnes absentes du fichier sont simplement laissées telles quelles."),
        ("Dates", "JJ/MM/AAAA, ou une vraie date Excel. AAAA-MM-JJ est aussi accepté."),
        ("Nombres", "La virgule et le point décimal sont acceptés (2,5 comme 2.5)."),
        ("Mode de paie", "« Heure » pour les ouvrières payées à l'heure suivant la convention, "
                         "« Journée » pour les cadres payés à la journée travaillée. "
                         "Laissé vide, le mode est déduit de la catégorie (Cadre → Journée)."),
        ("Taux", "Renseignez le prix de l'heure OU le prix de la journée, selon le mode. "
                 "Laissé vide, c'est le taux par défaut des paramètres qui s'applique."),
        ("Avant d'appliquer", "L'application affiche un aperçu ligne par ligne (créations, mises à jour, erreurs). "
                              "Rien n'est écrit tant que vous n'avez pas validé."),
    ]
    r = 3
    for t, d in regles:
        nt.cell(row=r, column=1, value=t).font = Font(bold=True, size=10)
        c = nt.cell(row=r, column=2, value=d)
        c.font = Font(size=10)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        nt.row_dimensions[r].height = 30
        r += 1

    r += 1
    nt.cell(row=r, column=1, value="Colonnes").font = Font(size=12, bold=True, color=or_)
    r += 1
    for cle, titre, typ, choix, aide in COLONNES:
        nt.cell(row=r, column=1, value=titre).font = Font(bold=True, size=10)
        txt = aide or ""
        if choix and cle != "modePaie":
            txt += (" " if txt else "") + "Valeurs proposées : " + ", ".join(choix) + "."
        c = nt.cell(row=r, column=2, value=txt)
        c.font = Font(size=10)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        r += 1

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
