#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reinit_admin.py — remet le mot de passe du compte « admin » de PilotRH
=====================================================================
À utiliser quand personne ne peut plus se connecter à l'interface.

Fonctionne directement sur le fichier de base de données, sans démarrer le
serveur et sans aucune dépendance à installer.

    python reinit_admin.py                       (demande le mot de passe)
    python reinit_admin.py --liste                (liste les comptes existants)
    python reinit_admin.py --compte rh1           (autre compte que « admin »)
    python reinit_admin.py --data /app/data       (autre dossier de données)

Sur Railway, où l'on n'a pas d'accès direct au disque, utilisez plutôt la
variable d'environnement PILOTRH_RESET_ADMIN (voir MISE_A_JOUR_v3.md).
"""
import argparse, getpass, hashlib, json, os, secrets, sqlite3, sys

ITERS = 210000

def hash_pw(pw, salt=None, iters=ITERS):
    salt = salt or secrets.token_hex(8)
    h = hashlib.pbkdf2_hmac("sha256", str(pw).encode(), salt.encode(), iters).hex()
    return "%s$%d$%s" % (salt, iters, h)

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="Réinitialise un mot de passe PilotRH")
    ap.add_argument("--data", default=os.environ.get("PILOTRH_DATA", os.path.join(base, "data")),
                    help="dossier de données (contient pilotrh.db)")
    ap.add_argument("--compte", default="admin", help="identifiant à réinitialiser")
    ap.add_argument("--liste", action="store_true", help="liste les comptes et sort")
    ap.add_argument("--mot-de-passe", default="", help="évite la saisie interactive")
    a = ap.parse_args()

    db = os.path.join(a.data, "pilotrh.db")
    if not os.path.exists(db):
        print("Base introuvable : %s" % db)
        print("Indiquez le bon dossier avec --data")
        return 1

    c = sqlite3.connect(db)
    try:
        r = c.execute("SELECT v FROM kv WHERE k='meta'").fetchone()
        if not r:
            print("Cette base ne contient pas encore de données.")
            return 1
        meta = json.loads(r[0])
        users = meta.get("users") or []

        if a.liste:
            if not users:
                print("Aucun compte enregistré.")
            for u in users:
                ancien = len(str(u.get("pass", "")).split("$")) == 2
                print("  %-20s %-16s %s" % (u.get("login", "?"), u.get("role", "?"),
                                            "(hachage ancien format)" if ancien else ""))
            return 0

        pw = a.mot_de_passe
        if not pw:
            pw = getpass.getpass("Nouveau mot de passe pour « %s » : " % a.compte)
            if pw != getpass.getpass("Confirmez : "):
                print("Les deux saisies diffèrent.")
                return 1
        if len(pw) < 8:
            print("8 caractères minimum.")
            return 1

        cible = next((u for u in users if u.get("login", "").lower() == a.compte.lower()), None)
        if cible:
            cible["pass"] = hash_pw(pw)
            action = "mis à jour"
        else:
            users.append({"login": a.compte, "nom": a.compte,
                          "role": "admin", "pass": hash_pw(pw)})
            action = "créé (rôle administrateur)"
        meta["users"] = users
        c.execute("INSERT OR REPLACE INTO kv(k,v) VALUES('meta',?)",
                  (json.dumps(meta, ensure_ascii=False),))
        try:
            c.execute("INSERT INTO audit(ts,qui,role,ip,action) VALUES(datetime('now'),?,?,?,?)",
                      ("Système", "admin", "local", "Mot de passe réinitialisé hors ligne · %s" % a.compte))
        except Exception:
            pass                      # ancienne structure de table audit : sans importance
        c.commit()
        print("Compte « %s » %s." % (a.compte, action))
        print("Redémarrez PilotRH, puis connectez-vous avec ce mot de passe.")
        return 0
    finally:
        c.close()

if __name__ == "__main__":
    sys.exit(main())
