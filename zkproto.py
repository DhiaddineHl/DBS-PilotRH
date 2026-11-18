# -*- coding: utf-8 -*-
"""
zkproto.py — dialogue réseau avec une pointeuse ZKTeco (port 4370)
==================================================================
Écrit avec la seule bibliothèque standard de Python : RIEN à installer.

Pourquoi ne plus dépendre du module « pyzk » :
  * il fallait l'installer avec pip sur le PC de l'atelier — première cause de
    « rien ne se lance » ;
  * avant de se connecter, il lance la commande « ping » du système : sur un
    réseau où le ping est filtré (cas courant), il abandonnait alors que la
    pointeuse répondait parfaitement sur son port ;
  * une seule date invalide dans la mémoire de l'appareil faisait échouer
    toute la lecture.

Ce module ne fait que LIRE. Il n'efface jamais rien sur la pointeuse et ne
modifie ni ses utilisateurs ni son horloge.

Compatible Python 3.6 et suivants.
"""
import socket
import struct
import time

# ------------------------------------------------------------------ constantes
USHRT_MAX = 65535
CMD_CONNECT, CMD_EXIT, CMD_ENABLEDEVICE, CMD_DISABLEDEVICE = 1000, 1001, 1002, 1003
CMD_AUTH = 1102
CMD_ACK_OK, CMD_ACK_ERROR, CMD_ACK_DATA, CMD_ACK_UNAUTH = 2000, 2001, 2002, 2005
CMD_PREPARE_DATA, CMD_DATA, CMD_FREE_DATA = 1500, 1501, 1502
CMD_PREPARE_BUFFER, CMD_READ_BUFFER = 1503, 1504
CMD_OPTIONS_RRQ, CMD_ATTLOG_RRQ, CMD_USERTEMP_RRQ = 11, 13, 9
CMD_GET_FREE_SIZES, CMD_GET_TIME = 50, 201
FCT_USER = 5
ENTETE_TCP = b"\x50\x50\x82\x7d"
BLOC_TCP, BLOC_UDP = 0xFFC0, 16 * 1024


class ErreurPointeuse(Exception):
    """Erreur avec une cause identifiée et une explication lisible.

    code : 'injoignable' | 'refuse' | 'muette' | 'motdepasse' | 'coupure' | 'protocole'
    """

    def __init__(self, code, message, conseil=""):
        Exception.__init__(self, message)
        self.code = code
        self.message = message
        self.conseil = conseil

    def __str__(self):
        return self.message


def somme_controle(octets):
    s = 0
    n = len(octets)
    i = 0
    while n - i > 1:
        s += octets[i] | (octets[i + 1] << 8)
        if s > USHRT_MAX:
            s -= USHRT_MAX
        i += 2
    if n - i:
        s += octets[-1]
    while s > USHRT_MAX:
        s -= USHRT_MAX
    s = ~s
    while s < 0:
        s += USHRT_MAX
    return s


def cle_communication(motdepasse, session, tics=50):
    """Réponse au défi d'authentification (mot de passe de communication)."""
    cle = int(motdepasse) & 0xFFFFFFFF
    k = 0
    for i in range(32):
        k = (k << 1) | (1 if cle & (1 << i) else 0)
    k = (k + int(session)) & 0xFFFFFFFF
    b = bytearray(struct.pack("<I", k))
    b[0] ^= ord("Z"); b[1] ^= ord("K"); b[2] ^= ord("S"); b[3] ^= ord("O")
    h1, h2 = struct.unpack("<HH", bytes(b))
    b = bytearray(struct.pack("<HH", h2, h1))
    t = tics & 0xFF
    return bytes(bytearray([b[0] ^ t, b[1] ^ t, t, b[3] ^ t]))


def decoder_date(n):
    """Date compacte de la pointeuse -> 'AAAA-MM-JJ HH:MM:SS', ou None si invalide."""
    s = n % 60; n //= 60
    mi = n % 60; n //= 60
    h = n % 24; n //= 24
    j = n % 31 + 1; n //= 31
    mo = n % 12 + 1; n //= 12
    a = n + 2000
    if j > _jours_du_mois(a, mo):
        return None
    return "%04d-%02d-%02d %02d:%02d:%02d" % (a, mo, j, h, mi, s)


def _jours_du_mois(a, m):
    if m == 2:
        return 29 if (a % 4 == 0 and (a % 100 != 0 or a % 400 == 0)) else 28
    return 30 if m in (4, 6, 9, 11) else 31


def _texte(b, encodages=("utf-8", "cp1256", "cp1252")):
    b = b.split(b"\x00")[0]
    for enc in encodages:
        try:
            return b.decode(enc).strip()
        except Exception:
            continue
    return b.decode("latin-1", "ignore").strip()


def tester_port(ip, port=4370, delai=4):
    """(ouvert, détail). Ne dialogue pas : dit seulement si quelque chose écoute."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(delai)
    try:
        s.connect((ip, int(port)))
        return True, "ouvert"
    except socket.timeout:
        return False, "aucune réponse"
    except ConnectionRefusedError:
        return False, "refusé"
    except OSError as e:
        return False, str(e)
    finally:
        try:
            s.close()
        except Exception:
            pass


class Pointeuse(object):
    """Connexion en lecture seule à une pointeuse.

        with Pointeuse("192.168.1.201") as p:
            print(p.infos())
            badges = p.pointages()
    """

    def __init__(self, ip, port=4370, motdepasse=0, delai=15, mode="auto", journal=None):
        self.ip, self.port = ip, int(port)
        self.motdepasse = int(motdepasse or 0)
        self.delai = delai
        self.mode = mode                    # 'auto' : TCP puis UDP · 'tcp' · 'udp'
        self._journal = journal or (lambda m: None)
        self.sock = None
        self.tcp = True
        self.session = 0
        self.reponse_id = USHRT_MAX - 1
        self.connectee = False
        self.ignores = 0                    # enregistrements illisibles, sautés
        self._tampon = b""

    # ------------------------------------------------------------- transport
    def __enter__(self):
        return self.connecter()

    def __exit__(self, *a):
        self.fermer()

    def _ouvrir(self, tcp):
        self.tcp = tcp
        self._tampon = b""
        if tcp:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            # se connecter est quasi instantané sur un réseau local : inutile
            # d'attendre aussi longtemps que pour lire une grosse mémoire
            self.sock.settimeout(min(self.delai, 8))
            self.sock.connect((self.ip, self.port))
            self.sock.settimeout(self.delai)
        else:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.settimeout(self.delai)
            self.sock.connect((self.ip, self.port))

    def _lire_exact(self, n):
        while len(self._tampon) < n:
            bloc = self.sock.recv(65536)
            if not bloc:
                raise ErreurPointeuse("coupure", "La pointeuse a fermé la connexion en cours de lecture.",
                                      "Réessayez ; si cela se répète, redémarrez la pointeuse.")
            self._tampon += bloc
        r, self._tampon = self._tampon[:n], self._tampon[n:]
        return r

    def _lire_paquet(self):
        """Rend (code, session, id, données) pour UN paquet complet."""
        try:
            if self.tcp:
                tete = self._lire_exact(8)
                if tete[:4] != ENTETE_TCP:
                    raise ErreurPointeuse(
                        "protocole", "Réponse inattendue : ce n'est pas une pointeuse ZKTeco qui répond à cette adresse.",
                        "Vérifiez l'adresse IP : un autre appareil (imprimante, caméra…) l'utilise peut-être.")
                longueur = struct.unpack("<I", tete[4:8])[0]
                if longueur < 8 or longueur > 64 * 1024 * 1024:
                    raise ErreurPointeuse("protocole", "Paquet de taille incohérente reçu de la pointeuse.")
                p = self._lire_exact(longueur)
            else:
                p = self.sock.recv(65536)
                if len(p) < 8:
                    raise ErreurPointeuse("protocole", "Paquet trop court reçu de la pointeuse.")
        except socket.timeout:
            raise ErreurPointeuse(
                "muette", "La pointeuse ne répond plus (délai de %s s dépassé)." % self.delai,
                "Elle est peut-être occupée ou en veille : réessayez dans une minute.")
        except (ConnectionResetError, BrokenPipeError):
            raise ErreurPointeuse("coupure", "Connexion coupée par la pointeuse.",
                                  "Un autre logiciel (ZKTime, ZKAccess…) est peut-être connecté en même temps : fermez-le.")
        code, _somme, session, rid = struct.unpack("<4H", p[:8])
        return code, session, rid, p[8:]

    def _envoyer(self, commande, donnees=b""):
        brut = struct.pack("<4H", commande, 0, self.session, self.reponse_id) + donnees
        somme = somme_controle(bytearray(brut))
        rid = self.reponse_id + 1
        if rid >= USHRT_MAX:
            rid -= USHRT_MAX
        paquet = struct.pack("<4H", commande, somme, self.session, rid) + donnees
        try:
            if self.tcp:
                self.sock.sendall(ENTETE_TCP + struct.pack("<I", len(paquet)) + paquet)
            else:
                self.sock.send(paquet)
        except socket.timeout:
            raise ErreurPointeuse("muette", "Impossible d'envoyer la demande à la pointeuse (délai dépassé).")
        except OSError as e:
            raise ErreurPointeuse("coupure", "Envoi impossible vers la pointeuse : %s" % e)
        code, session, rid, d = self._lire_paquet()
        self.reponse_id = rid
        return code, session, d

    # -------------------------------------------------------------- connexion
    def connecter(self):
        essais = {"auto": (True, False), "tcp": (True,), "udp": (False,)}.get(self.mode, (True, False))
        derniere = None
        premiere = None
        for tcp in essais:
            nom = "TCP" if tcp else "UDP"
            try:
                self._journal("Connexion %s à %s:%s…" % (nom, self.ip, self.port))
                self._ouvrir(tcp)
                self.session, self.reponse_id = 0, USHRT_MAX - 1
                code, session, _d = self._envoyer(CMD_CONNECT)
                self.session = session
                if code == CMD_ACK_UNAUTH:
                    code, _s, _d = self._envoyer(CMD_AUTH, cle_communication(self.motdepasse, self.session))
                    if code != CMD_ACK_OK:
                        raise ErreurPointeuse(
                            "motdepasse",
                            "La pointeuse refuse le mot de passe de communication.",
                            "Sur la pointeuse : Menu → Comm. → « Clé Comm » (ou « Mot de passe »). "
                            "Reportez ce nombre dans PilotRH, ou remettez-le à 0 sur l'appareil.")
                elif code != CMD_ACK_OK:
                    raise ErreurPointeuse("protocole", "La pointeuse a répondu par un refus (code %s)." % code)
                self.connectee = True
                self._journal("Connectée en %s." % nom)
                return self
            except ErreurPointeuse as e:
                self._fermer_socket()
                if e.code == "motdepasse":
                    raise
                if e.code == "muette":
                    e = ErreurPointeuse(
                        "injoignable", "Rien ne répond à l'adresse %s (port %s)." % (self.ip, self.port),
                        "Pointeuse éteinte, câble débranché, mauvaise adresse IP, ou PC sur un autre réseau.")
                derniere = e
            except socket.timeout:
                self._fermer_socket()
                derniere = ErreurPointeuse(
                    "injoignable", "Rien ne répond à l'adresse %s (port %s)." % (self.ip, self.port),
                    "Pointeuse éteinte, câble débranché, mauvaise adresse IP, ou PC sur un autre réseau.")
            except ConnectionRefusedError:
                self._fermer_socket()
                derniere = ErreurPointeuse(
                    "refuse", "Un appareil répond à %s mais refuse le port %s." % (self.ip, self.port),
                    "Ce n'est sans doute pas la pointeuse, ou son port a été changé (Menu → Comm.).")
            except OSError as e:
                self._fermer_socket()
                derniere = ErreurPointeuse(
                    "injoignable", "Rien ne répond à l'adresse %s (port %s)." % (self.ip, self.port),
                    "Pointeuse éteinte, câble débranché, mauvaise adresse IP, ou PC sur un autre réseau. "
                    "(Détail technique : %s)" % e)
            # en mode automatique, c'est l'échec du premier essai (TCP) qui décrit
            # le mieux la panne : l'essai UDP n'est qu'un repli pour vieux modèles
            if premiere is None:
                premiere = derniere
        raise premiere or derniere

    def _fermer_socket(self):
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass
        self.sock = None
        self.connectee = False

    def fermer(self):
        if self.sock and self.connectee:
            try:
                self.sock.settimeout(3)
                self._envoyer(CMD_EXIT)
            except Exception:
                pass
        self._fermer_socket()

    # ---------------------------------------------------------------- lecture
    def _option(self, nom):
        try:
            code, _s, d = self._envoyer(CMD_OPTIONS_RRQ, nom.encode("ascii") + b"\x00")
            if code != CMD_ACK_OK:
                return ""
            return _texte(d.split(b"=", 1)[-1])
        except ErreurPointeuse:
            raise
        except Exception:
            return ""

    def tailles(self):
        code, _s, d = self._envoyer(CMD_GET_FREE_SIZES)
        if code != CMD_ACK_OK or len(d) < 80:
            return {"utilisateurs": None, "pointages": None, "capacite_pointages": None}
        f = struct.unpack("<20i", d[:80])
        return {"utilisateurs": f[4], "pointages": f[8], "capacite_pointages": f[16]}

    def heure(self):
        """Horloge de la pointeuse ('AAAA-MM-JJ HH:MM:SS'), ou None."""
        code, _s, d = self._envoyer(CMD_GET_TIME)
        if code != CMD_ACK_OK or len(d) < 4:
            return None
        return decoder_date(struct.unpack("<I", d[:4])[0])

    def infos(self):
        t = self.tailles()
        return {"nom": self._option("~DeviceName"), "serie": self._option("~SerialNumber"),
                "utilisateurs": t["utilisateurs"], "pointages": t["pointages"],
                "capacite_pointages": t["capacite_pointages"], "heure": self.heure(),
                "liaison": "TCP" if self.tcp else "UDP"}

    def figer(self):
        """Suspend le badgeage le temps de la lecture (l'écran affiche « en cours »)."""
        self._envoyer(CMD_DISABLEDEVICE)

    def liberer(self):
        self._envoyer(CMD_ENABLEDEVICE)

    def _suite_donnees(self, code, d):
        """Termine la réception d'un bloc dont le premier paquet est (code, d)."""
        if code == CMD_DATA:
            return d
        if code == CMD_PREPARE_DATA:
            attendu = struct.unpack("<I", d[:4])[0]
            morceaux, recu = [], 0
            while recu < attendu:
                c, _s, _r, bloc = self._lire_paquet()
                if c == CMD_DATA:
                    morceaux.append(bloc)
                    recu += len(bloc)
                elif c == CMD_ACK_OK:
                    break
                else:
                    raise ErreurPointeuse("protocole", "Transfert interrompu par la pointeuse (code %s)." % c)
            else:
                # l'accusé de fin suit les données ; son absence n'est pas une panne
                ancien = self.sock.gettimeout()
                try:
                    self.sock.settimeout(2)
                    self._lire_paquet()
                except ErreurPointeuse:
                    pass
                finally:
                    self.sock.settimeout(ancien)
            return b"".join(morceaux)[:attendu] if attendu else b"".join(morceaux)
        return None

    def _lire_tampon(self, commande, fct=0, ext=0):
        """Lecture d'un grand volume (utilisateurs, pointages)."""
        code, _s, d = self._envoyer(CMD_PREPARE_BUFFER, struct.pack("<bhii", 1, commande, fct, ext))
        if code == CMD_DATA:
            return d
        if code == CMD_ACK_OK and len(d) >= 5:
            taille = struct.unpack("<I", d[1:5])[0]
            pas = BLOC_TCP if self.tcp else BLOC_UDP
            morceaux, debut = [], 0
            while debut < taille:
                n = min(pas, taille - debut)
                bloc = None
                for _essai in range(3):
                    c, _s2, d2 = self._envoyer(CMD_READ_BUFFER, struct.pack("<ii", debut, n))
                    bloc = self._suite_donnees(c, d2)
                    if bloc is not None and len(bloc) >= n:
                        break
                    bloc = None
                if bloc is None:
                    raise ErreurPointeuse(
                        "coupure", "La lecture de la mémoire de la pointeuse s'est interrompue (à %d sur %d octets)." % (debut, taille),
                        "Réseau instable entre le PC et la pointeuse : vérifiez le câble ou le Wi-Fi.")
                morceaux.append(bloc[:n])
                debut += n
            try:
                self._envoyer(CMD_FREE_DATA)
            except ErreurPointeuse:
                pass
            return b"".join(morceaux)
        # Anciens modèles : pas de lecture par tampon, on demande directement.
        code, _s, d = self._envoyer(commande, struct.pack("<b", fct) if fct else b"")
        r = self._suite_donnees(code, d)
        if r is None:
            raise ErreurPointeuse("protocole", "Cette pointeuse ne sait pas transmettre sa mémoire par le réseau (code %s)." % code,
                                  "Utilisez la méthode « fichier » (attBackup.mdb).")
        try:
            self._envoyer(CMD_FREE_DATA)
        except ErreurPointeuse:
            pass
        return r

    def utilisateurs(self):
        """[{'uid', 'badge', 'nom'}]"""
        brut = self._lire_tampon(CMD_USERTEMP_RRQ, FCT_USER)
        if len(brut) <= 4:
            return []
        total = struct.unpack("<I", brut[:4])[0]
        brut = brut[4:]
        n = self.tailles()["utilisateurs"] or 0
        taille = total // n if n and total % n == 0 else 0
        if taille not in (28, 72):
            taille = 72 if total % 72 == 0 else (28 if total % 28 == 0 else 72)
        r = []
        for i in range(0, len(brut) - taille + 1, taille):
            e = brut[i:i + taille]
            if taille == 28:
                uid, _pr, _pw, nom, _carte, _g, _tz, badge = struct.unpack("<HB5s8sIxBhI", e)
                badge = str(badge)
            else:
                uid, _pr, _pw, nom, _carte, _g, badge = struct.unpack("<HB8s24sIx7sx24s", e)
                badge = _texte(badge)
            r.append({"uid": uid, "badge": badge or str(uid), "nom": _texte(nom)})
        return r

    def pointages(self, utilisateurs=None):
        """[{'badge', 'dt'}] — tous les badgeages en mémoire, du plus ancien au plus récent.

        Les enregistrements dont la date est impossible (mémoire abîmée) sont
        sautés et comptés dans self.ignores, au lieu de faire échouer la lecture."""
        self.ignores = 0
        n = self.tailles()["pointages"]
        if n == 0:
            return []
        brut = self._lire_tampon(CMD_ATTLOG_RRQ)
        if len(brut) <= 4:
            return []
        total = struct.unpack("<I", brut[:4])[0]
        brut = brut[4:]
        taille = total // n if n and total % n == 0 else 0
        if taille not in (8, 16, 40):
            taille = 40 if total % 40 == 0 else (16 if total % 16 == 0 else 8)
        par_uid = {}
        if taille == 8:
            if utilisateurs is None:
                utilisateurs = self.utilisateurs()
            par_uid = dict((u["uid"], u["badge"]) for u in utilisateurs)
        r = []
        for i in range(0, len(brut) - taille + 1, taille):
            e = brut[i:i + taille]
            if taille == 8:
                uid, _st, t, _p = struct.unpack("<HBIB", e)
                badge = par_uid.get(uid, str(uid))
            elif taille == 16:
                badge, t, _st, _p, _res, _wc = struct.unpack("<IIBB2sI", e)
                badge = str(badge)
            else:
                _uid, badge, _st, t, _p, _esp = struct.unpack("<H24sBIB8s", e)
                badge = _texte(badge)
            dt = decoder_date(t)
            if not dt or not badge:
                self.ignores += 1
                continue
            r.append({"badge": badge, "dt": dt})
        return r


def lire_tout(ip, port=4370, motdepasse=0, delai=15, journal=None, figer=True):
    """Lecture complète, en garantissant que la pointeuse est toujours relâchée.

    Rend {'infos', 'users': [{'badge','name','sexe'}], 'punches': [{'badge','dt'}], 'ignores'}"""
    p = Pointeuse(ip, port, motdepasse, delai=delai, journal=journal)
    p.connecter()
    fige = False
    try:
        infos = p.infos()
        if figer:
            try:
                p.figer()
                fige = True
            except ErreurPointeuse:
                pass
        us = p.utilisateurs()
        pts = p.pointages(us)
        return {"infos": infos,
                "users": [{"badge": u["badge"], "name": u["nom"], "sexe": ""} for u in us],
                "punches": pts, "ignores": p.ignores}
    finally:
        if fige:
            try:
                p.liberer()
            except Exception:
                pass
        p.fermer()


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage : python zkproto.py ADRESSE_IP [PORT] [MOT_DE_PASSE]")
        sys.exit(2)
    try:
        t0 = time.time()
        d = lire_tout(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4370,
                      int(sys.argv[3]) if len(sys.argv) > 3 else 0, journal=print)
        print(d["infos"])
        print("%d personnes, %d badgeages lus en %.1f s" % (len(d["users"]), len(d["punches"]), time.time() - t0))
    except ErreurPointeuse as e:
        print("ECHEC :", e.message)
        if e.conseil:
            print("  ->", e.conseil)
        sys.exit(1)
