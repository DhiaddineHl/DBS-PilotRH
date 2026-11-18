# -*- coding: utf-8 -*-
"""Inscrit dans les pages HTML un numéro de version pour chaque script et feuille
de style (empreinte de leur contenu) : /assets/pilotrh-app.js?v=2efd9f1d1d.

Une mise à jour du fichier change l'adresse, donc le navigateur ne peut plus
servir l'ancienne copie de son cache. C'est ce qui manquait quand un écran d'une
version précédente appelait une adresse supprimée (« erreur 404 »).

À relancer après toute modification de static/assets : python3 outils/versionner.py
(un test échoue si on l'oublie)."""
import hashlib
import os
import re

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(RACINE, "static", "assets")
PAGES = ("index.html", "moi.html", "login.html")
MOTIF = re.compile(r'(<(?:script src|link rel="stylesheet" href)="/assets/)([\w.-]+\.(?:js|css))(?:\?v=\w+)?(")')


def empreinte(nom):
    with open(os.path.join(ASSETS, nom), "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:10]


def versionner(html):
    return MOTIF.sub(lambda m: "%s%s?v=%s%s" % (m.group(1), m.group(2), empreinte(m.group(2)), m.group(3)), html)


if __name__ == "__main__":
    for p in PAGES:
        chemin = os.path.join(RACINE, "static", p)
        if not os.path.exists(chemin):
            continue
        with open(chemin, encoding="utf-8") as f:
            avant = f.read()
        apres = versionner(avant)
        if apres != avant:
            with open(chemin, "w", encoding="utf-8") as f:
                f.write(apres)
        print("%-11s %d fichier(s) versionné(s)" % (p, len(MOTIF.findall(apres))))
