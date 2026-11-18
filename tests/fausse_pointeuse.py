# -*- coding: utf-8 -*-
"""Une fausse pointeuse ZKTeco, pour les tests.

Elle parle le protocole du port 4370 en TCP et en UDP, et sait se comporter
comme les différents modèles (taille des enregistrements) et comme les pannes
que l'on rencontre en atelier : muette, coupure en plein transfert, réponses
découpées en petits morceaux par un réseau lent, mot de passe de communication,
mémoire contenant une date impossible.

Elle est validée par la bibliothèque de référence « pyzk » quand celle-ci est
installée (voir t_zk.py) : ce n'est donc pas seulement le client de PilotRH qui
se parle à lui-même.
"""
import random
import socket
import struct
import threading
import time

TOP = b"\x50\x50\x82\x7d"


def coder_date(txt):
    a, mo, j = int(txt[0:4]), int(txt[5:7]), int(txt[8:10])
    h, mi, s = int(txt[11:13]), int(txt[14:16]), int(txt[17:19])
    return ((a - 2000) * 12 * 31 + (mo - 1) * 31 + j - 1) * 86400 + (h * 60 + mi) * 60 + s


class FaussePointeuse(object):
    def __init__(self, port=0, personnes=None, badgeages=None, motdepasse=0,
                 taille_personne=72, taille_badgeage=40, fragmenter=False,
                 muette=False, couper_apres=None, sans_tampon=False, udp_seul=False,
                 petit_en_ligne=False, brut_invalide=0, nom="F18/ID", cle=None):
        self.personnes = personnes or []          # [(uid, badge, nom)]
        self.badgeages = badgeages or []          # [(badge, 'AAAA-MM-JJ HH:MM:SS')]
        self.motdepasse = motdepasse
        self.cle = cle                            # fonction (mdp, session) -> 4 octets
        self.tp, self.tb = taille_personne, taille_badgeage
        self.fragmenter, self.muette = fragmenter, muette
        self.couper_apres, self.sans_tampon = couper_apres, sans_tampon
        self.udp_seul, self.petit_en_ligne = udp_seul, petit_en_ligne
        self.brut_invalide = brut_invalide        # nb d'enregistrements à date impossible
        self.nom = nom
        self.journal = []                         # commandes reçues
        self.figee = False
        self.figee_vue = False
        self._stop = False
        self._tcp = None
        if not udp_seul:
            self._tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self._tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._tcp.bind(("127.0.0.1", port))
            self._tcp.listen(5)
            port = self._tcp.getsockname()[1]
        self._udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._udp.bind(("127.0.0.1", port))
        self.port = self._udp.getsockname()[1]
        if self._tcp:
            threading.Thread(target=self._boucle_tcp, daemon=True).start()
        threading.Thread(target=self._boucle_udp, daemon=True).start()

    def arreter(self):
        self._stop = True
        for s in (self._tcp, self._udp):
            try:
                if s:
                    try:
                        s.shutdown(socket.SHUT_RDWR)      # réveille le fil bloqué en lecture
                    except OSError:
                        pass
                    s.close()
            except Exception:
                pass

    # --------------------------------------------------------------- mémoire
    def _blob_personnes(self):
        out = []
        for uid, badge, nom in self.personnes:
            if self.tp == 28:
                out.append(struct.pack("<HB5s8sIxBhI", uid, 0, b"", nom.encode("utf-8")[:8], 0, 1, 0, int(badge)))
            else:
                out.append(struct.pack("<HB8s24sIx7sx24s", uid, 0, b"", nom.encode("utf-8")[:24], 0, b"1",
                                       str(badge).encode()))
        b = b"".join(out)
        return struct.pack("<I", len(b)) + b

    def _blob_badgeages(self):
        uid_de = dict((str(b), u) for u, b, _n in self.personnes)
        out = []
        lignes = [(b, coder_date(d)) for b, d in self.badgeages]
        # 30 février : une date que la pointeuse sait stocker mais qui n'existe pas
        lignes += [("1", ((2024 - 2000) * 12 * 31 + 1 * 31 + 29) * 86400)] * self.brut_invalide
        for badge, t in lignes:
            if self.tb == 8:
                out.append(struct.pack("<HBIB", uid_de.get(str(badge), 0), 1, t, 0))
            elif self.tb == 16:
                out.append(struct.pack("<IIBB2sI", int(badge), t, 1, 0, b"", 0))
            else:
                out.append(struct.pack("<H24sBIB8s", uid_de.get(str(badge), 0), str(badge).encode(), 1, t, 0, b""))
        b = b"".join(out)
        return struct.pack("<I", len(b)) + b

    def _nb_badgeages(self):
        return len(self.badgeages) + self.brut_invalide

    # ------------------------------------------------------------- protocole
    def _traiter(self, etat, cmd, data, tcp):
        """Rend la liste des paquets (code, données) à renvoyer."""
        self.journal.append(cmd)
        OK, ERR = 2000, 2001
        if cmd == 1000:
            etat["session"] = random.randint(1, 60000)
            etat["auth"] = not self.motdepasse
            return [(2005 if self.motdepasse else OK, b"")]
        if cmd == 1102:
            etat["auth"] = (data[:4] == self.cle(self.motdepasse, etat["session"]))
            return [(OK if etat["auth"] else 2005, b"")]
        if not etat.get("auth"):
            return [(2005, b"")]
        if cmd == 11:
            cle = data.split(b"\x00")[0].decode()
            val = {"~DeviceName": self.nom, "~SerialNumber": "CJ9X123456789"}.get(cle, "")
            return [(OK, (cle + "=" + val).encode() + b"\x00")]
        if cmd == 50:
            f = [0] * 20
            f[4], f[8], f[16] = len(self.personnes), self._nb_badgeages(), 100000
            return [(OK, struct.pack("<20i", *f))]
        if cmd == 201:
            return [(OK, struct.pack("<I", coder_date(time.strftime("%Y-%m-%d %H:%M:%S"))))]
        if cmd == 1003:
            self.figee = self.figee_vue = True
            return [(OK, b"")]
        if cmd == 1002:
            self.figee = False
            return [(OK, b"")]
        if cmd in (1001, 1502):
            return [(OK, b"")]
        if cmd == 1503:
            if self.sans_tampon:
                return [(ERR, b"")]
            _un, demande, _fct, _ext = struct.unpack("<bhii", data[:11])
            etat["tampon"] = self._blob_personnes() if demande == 9 else self._blob_badgeages()
            if self.petit_en_ligne and len(etat["tampon"]) <= 1024:
                return [(1501, etat["tampon"])]
            return [(OK, b"\x00" + struct.pack("<I", len(etat["tampon"])) + b"\x00" * 4)]
        if cmd == 1504:
            debut, n = struct.unpack("<ii", data[:8])
            return self._paquets_donnees(etat["tampon"][debut:debut + n], tcp)
        if cmd in (9, 13) and self.sans_tampon:
            return self._paquets_donnees(self._blob_personnes() if cmd == 9 else self._blob_badgeages(), tcp)
        return [(ERR, b"")]

    def _paquets_donnees(self, bloc, tcp):
        r = [(1500, struct.pack("<II", len(bloc), 0))]
        if tcp:
            r.append((1501, bloc))
        else:
            for i in range(0, len(bloc), 1024):
                r.append((1501, bloc[i:i + 1024]))
        r.append((2000, b""))
        return r

    @staticmethod
    def _paquet(code, session, rid, data):
        return struct.pack("<4H", code, 0, session, rid) + data

    # ------------------------------------------------------------------- TCP
    def _boucle_tcp(self):
        while not self._stop:
            try:
                c, _a = self._tcp.accept()
            except Exception:
                return
            threading.Thread(target=self._client_tcp, args=(c,), daemon=True).start()

    def _client_tcp(self, c):
        etat, tampon, envoyes = {}, b"", 0
        try:
            while not self._stop:
                while len(tampon) < 8:
                    b = c.recv(65536)
                    if not b:
                        return
                    tampon += b
                n = struct.unpack("<I", tampon[4:8])[0]
                while len(tampon) < 8 + n:
                    b = c.recv(65536)
                    if not b:
                        return
                    tampon += b
                p, tampon = tampon[8:8 + n], tampon[8 + n:]
                cmd, _ck, _sess, rid = struct.unpack("<4H", p[:8])
                if self.muette:
                    continue
                for code, data in self._traiter(etat, cmd, p[8:], True):
                    q = self._paquet(code, etat.get("session", 0), rid, data)
                    brut = TOP + struct.pack("<I", len(q)) + q
                    if self.couper_apres is not None and code == 1501:
                        envoyes += len(brut)
                        if envoyes > self.couper_apres:
                            c.sendall(brut[:len(brut) // 2])
                            c.close()
                            return
                    if self.fragmenter:
                        i = 0
                        while i < len(brut):
                            k = random.choice((1, 3, 7, 100, 1460, 4000))
                            c.sendall(brut[i:i + k])
                            i += k
                            if k < 100:
                                time.sleep(0.0005)
                    else:
                        c.sendall(brut)
                if cmd == 1001:
                    return
        except Exception:
            pass
        finally:
            try:
                c.close()
            except Exception:
                pass

    # ------------------------------------------------------------------- UDP
    def _boucle_udp(self):
        etats = {}
        while not self._stop:
            try:
                p, adr = self._udp.recvfrom(65536)
            except Exception:
                return
            if self._stop:
                return
            if self.muette or len(p) < 8:
                continue
            etat = etats.setdefault(adr, {})
            cmd, _ck, _sess, rid = struct.unpack("<4H", p[:8])
            for code, data in self._traiter(etat, cmd, p[8:], False):
                try:
                    self._udp.sendto(self._paquet(code, etat.get("session", 0), rid, data), adr)
                except OSError:
                    return
