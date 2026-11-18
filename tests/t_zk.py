# -*- coding: utf-8 -*-
"""Le dialogue réseau avec la pointeuse (zkproto.py).

Aucune vraie pointeuse n'est disponible pour les tests. On utilise donc une
fausse pointeuse (fausse_pointeuse.py) — et, pour ne pas se contenter d'un
programme qui se parle à lui-même, on la fait d'abord interroger par « pyzk »,
la bibliothèque de référence, quand elle est installée : si pyzk lit
correctement la fausse pointeuse, celle-ci parle bien le vrai protocole.
"""
import os
import random
import socket
import sys
import time

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))
sys.path.insert(0, ICI)
import zkproto
from zkproto import Pointeuse, ErreurPointeuse, lire_tout
from fausse_pointeuse import FaussePointeuse

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


random.seed(7)
PERS = [(i, str(100 + i), "OUVRIERE %d" % i) for i in range(1, 98)]
BADG = []
for j in range(1, 29):
    for (_u, b, _n) in PERS:
        BADG.append((b, "2026-10-%02d 07:%02d:%02d" % (j, random.randint(20, 40), random.randint(0, 59))))
        BADG.append((b, "2026-10-%02d 16:%02d:%02d" % (j, random.randint(30, 50), random.randint(0, 59))))
ATTENDU = [{"badge": b, "dt": d} for b, d in BADG]

try:
    from zk import ZK
    from zk.base import make_commkey
except Exception:
    ZK = None

print("\n--- La fausse pointeuse est validée par la bibliothèque de référence (pyzk) ---")
if ZK is None:
    print("  (pyzk absent : validation croisée ignorée)")
else:
    # (pyzk ne supporte pas les réponses découpées par un réseau lent : ce cas,
    #  que zkproto gère, est donc vérifié plus bas sans lui)
    for tp, tb, frag in ((72, 40, False), (28, 16, False), (72, 8, False)):
        f = FaussePointeuse(personnes=PERS, badgeages=BADG, taille_personne=tp, taille_badgeage=tb, fragmenter=frag)
        c = ZK("127.0.0.1", port=f.port, timeout=10, ommit_ping=True).connect()
        us = c.get_users()
        at = c.get_attendance()
        c.disconnect()
        f.arreter()
        nom = "pyzk · fiches %d octets · badgeages %d octets%s" % (tp, tb, " · réseau morcelé" if frag else "")
        t(nom + " : personnes", len(us), len(PERS))
        t(nom + " : badgeages", [{"badge": str(a.user_id), "dt": a.timestamp.strftime("%Y-%m-%d %H:%M:%S")} for a in at], ATTENDU)
    for mdp, sess in ((0, 1), (123456, 4242), (999999, 65000), (1, 0)):
        t("clé de communication identique à pyzk (%d / %d)" % (mdp, sess),
          zkproto.cle_communication(mdp, sess), make_commkey(mdp, sess))
    import struct
    from zk.base import ZK as _Z
    for brut in (b"\xe8\x03\x00\x00\x00\x00\xfe\xff", b"\xdf\x05\x00\x00\x11\x22\x33\x00abcde", bytes(range(200))):
        t("somme de contrôle identique à pyzk (%d octets)" % len(brut),
          struct.pack("<H", zkproto.somme_controle(bytearray(brut))),
          _Z("127.0.0.1")._ZK__create_checksum(list(bytearray(brut))))

print("\n--- Lecture complète, tous modèles ---")
for tp in (72, 28):
    for tb in (40, 16, 8):
        f = FaussePointeuse(personnes=PERS, badgeages=BADG, taille_personne=tp, taille_badgeage=tb)
        d = lire_tout("127.0.0.1", f.port)
        f.arreter()
        nom = "fiches %d · badgeages %d" % (tp, tb)
        t(nom + " : personnes", len(d["users"]), len(PERS))
        t(nom + " : badge et nom", (d["users"][0]["badge"], d["users"][0]["name"][:8]), ("101", "OUVRIERE"))
        t(nom + " : badgeages identiques", d["punches"], ATTENDU)
        tv(nom + " : la pointeuse a été figée pendant la lecture", f.figee_vue)
        tv(nom + " : puis relâchée", not f.figee)

print("\n--- Informations de l'appareil ---")
f = FaussePointeuse(personnes=PERS, badgeages=BADG)
with Pointeuse("127.0.0.1", f.port) as p:
    i = p.infos()
f.arreter()
t("nom du modèle", i["nom"], "F18/ID")
t("numéro de série", i["serie"], "CJ9X123456789")
t("nombre de badgeages annoncé", i["pointages"], len(BADG))
tv("horloge de la pointeuse lue", i["heure"] and i["heure"][:4] == time.strftime("%Y"), i["heure"])
t("liaison", i["liaison"], "TCP")

print("\n--- Réseau lent : réponses découpées en petits morceaux ---")
f = FaussePointeuse(personnes=PERS, badgeages=BADG, fragmenter=True)
d = lire_tout("127.0.0.1", f.port)
f.arreter()
t("rien n'est perdu ni mélangé", d["punches"], ATTENDU)

print("\n--- Gros volume : trois ans de mémoire ---")
GROS = [(str(100 + i % 97), "20%02d-%02d-%02d %02d:%02d:00" % (23 + i // 40000, 1 + (i // 3400) % 12, 1 + (i // 120) % 28, 7 + i % 10, i % 60))
        for i in range(110000)]
f = FaussePointeuse(personnes=PERS, badgeages=GROS)
t0 = time.time()
d = lire_tout("127.0.0.1", f.port)
duree = time.time() - t0
f.arreter()
t("110 000 badgeages lus", len(d["punches"]), 110000)
t("le dernier est intact", d["punches"][-1], {"badge": GROS[-1][0], "dt": GROS[-1][1]})
tv("en moins de 20 secondes", duree < 20, "%.1f s" % duree)

print("\n--- Petite mémoire renvoyée d'un seul bloc ---")
f = FaussePointeuse(personnes=PERS[:3], badgeages=BADG[:10], petit_en_ligne=True)
d = lire_tout("127.0.0.1", f.port)
f.arreter()
t("personnes", len(d["users"]), 3)
t("badgeages", d["punches"], ATTENDU[:10])

print("\n--- Pointeuse vide ---")
f = FaussePointeuse(personnes=PERS[:2], badgeages=[])
d = lire_tout("127.0.0.1", f.port)
f.arreter()
t("aucun badgeage n'est une réponse valable, pas une panne", d["punches"], [])

print("\n--- Ancien modèle : pas de lecture par tampon ---")
f = FaussePointeuse(personnes=PERS, badgeages=BADG, sans_tampon=True)
d = lire_tout("127.0.0.1", f.port)
f.arreter()
t("la lecture directe prend le relais", d["punches"], ATTENDU)

print("\n--- Ancien modèle : UDP seulement ---")
f = FaussePointeuse(personnes=PERS, badgeages=BADG, udp_seul=True)
d = lire_tout("127.0.0.1", f.port)
f.arreter()
t("le repli UDP est automatique", d["punches"], ATTENDU)
t("et signalé", d["infos"]["liaison"], "UDP")

print("\n--- Mot de passe de communication ---")
f = FaussePointeuse(personnes=PERS, badgeages=BADG, motdepasse=4821, cle=zkproto.cle_communication)
d = lire_tout("127.0.0.1", f.port, motdepasse=4821)
t("bon mot de passe : lecture", len(d["punches"]), len(BADG))
try:
    lire_tout("127.0.0.1", f.port, motdepasse=1111)
    tv("mauvais mot de passe refusé", False)
except ErreurPointeuse as e:
    t("mauvais mot de passe : cause nommée", e.code, "motdepasse")
    tv("le conseil dit où le trouver sur l'appareil", "Comm" in e.conseil, e.conseil)
try:
    lire_tout("127.0.0.1", f.port, motdepasse=0)
    tv("mot de passe absent refusé", False)
except ErreurPointeuse as e:
    t("mot de passe absent : cause nommée", e.code, "motdepasse")
f.arreter()

print("\n--- Mémoire abîmée : une date impossible ---")
f = FaussePointeuse(personnes=PERS, badgeages=BADG, brut_invalide=3)
d = lire_tout("127.0.0.1", f.port)
f.arreter()
t("les badgeages valides sont tous lus", d["punches"], ATTENDU)
t("les enregistrements illisibles sont comptés, pas fatals", d["ignores"], 3)
t("30 février refusé", zkproto.decoder_date(((2024 - 2000) * 12 * 31 + 31 + 29) * 86400), None)
t("29 février d'une année bissextile accepté", zkproto.decoder_date(((2024 - 2000) * 12 * 31 + 31 + 28) * 86400), "2024-02-29 00:00:00")

print("\n--- Pannes : chacune a un nom ---")
s = socket.socket(); s.bind(("127.0.0.1", 0)); libre = s.getsockname()[1]; s.close()
try:
    lire_tout("127.0.0.1", libre, delai=2)
    tv("port fermé détecté", False)
except ErreurPointeuse as e:
    t("rien n'écoute : pas de trace Python, une cause", e.code in ("refuse", "injoignable"), True)
    tv("le message cite l'adresse", "127.0.0.1" in e.message, e.message)

f = FaussePointeuse(personnes=PERS, badgeages=BADG, muette=True)
t0 = time.time()
try:
    lire_tout("127.0.0.1", f.port, delai=2)
    tv("pointeuse muette détectée", False)
except ErreurPointeuse as e:
    t("appareil qui accepte la connexion mais ne répond pas", e.code, "injoignable")
tv("sans attendre indéfiniment", time.time() - t0 < 10)
f.arreter()

f = FaussePointeuse(personnes=PERS, badgeages=BADG, couper_apres=20000)
try:
    lire_tout("127.0.0.1", f.port, delai=3)
    tv("coupure en plein transfert détectée", False)
except ErreurPointeuse as e:
    t("coupure en plein transfert : cause nommée", e.code, "coupure")
f.arreter()

srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
import threading
def _autre():
    c, _ = srv.accept(); c.recv(100); c.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n"); time.sleep(0.5); c.close()
threading.Thread(target=_autre, daemon=True).start()
try:
    Pointeuse("127.0.0.1", srv.getsockname()[1], delai=3, mode="tcp").connecter()
    tv("autre appareil détecté", False)
except ErreurPointeuse as e:
    t("un autre appareil à cette adresse (imprimante, caméra)", e.code, "protocole")
    tv("le message le dit", "pas une pointeuse" in e.message, e.message)

ouvert, _d = zkproto.tester_port("127.0.0.1", libre, 1)
t("test de port : fermé", ouvert, False)

print("\n--- Le module n'a besoin de rien d'autre que Python ---")
src = open(os.path.join(os.path.dirname(ICI), "zkproto.py"), encoding="utf-8").read()
import ast
mods = set()
for n in ast.walk(ast.parse(src)):
    if isinstance(n, ast.Import):
        mods.update(a.name.split(".")[0] for a in n.names)
    elif isinstance(n, ast.ImportFrom):
        mods.add((n.module or "").split(".")[0])
t("modules utilisés : uniquement la bibliothèque standard", sorted(mods), ["socket", "struct", "sys", "time"])
tv("aucune commande d'effacement dans le module", "CLEAR" not in src and "clear_" not in src)
try:
    ast.parse(src, feature_version=(3, 6))
    tv("syntaxe acceptée par un vieux Python (3.6)", True)
except SyntaxError as e:
    tv("syntaxe acceptée par un vieux Python (3.6)", False, str(e))

print("\n=========================")
print("  %d réussis · %d échoués" % (ok, ko))
sys.exit(1 if ko else 0)
