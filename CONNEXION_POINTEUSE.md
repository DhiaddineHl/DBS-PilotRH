# Connecter PilotRH à la pointeuse

## Pourquoi un « agent » ?

Votre application PilotRH est **en ligne** (sur Railway, sur Internet).
Votre pointeuse est **dans l'usine**, sur votre réseau local privé.

Internet ne peut pas aller « chercher » un appareil derrière votre box/routeur : c'est
bloqué pour des raisons de sécurité. Il faut donc un **petit programme relais** — l'agent —
qui tourne sur un PC de l'usine (sur le même réseau que la pointeuse) et qui **envoie**
les pointages vers le cloud. Ce PC doit être allumé aux heures où l'on veut la mise à jour.

Deux méthodes au choix. La méthode 1 est la plus automatique.

---

## Méthode 1 — Connexion directe à la pointeuse (recommandée)

L'agent se branche directement sur la pointeuse par le réseau (protocole ZKTeco, port 4370).
Aucun logiciel ZKTeco nécessaire.

**Étapes (à faire une seule fois) :**

1. Sur un PC de l'usine, installez **Python** depuis https://www.python.org
   (à l'installation, cochez **« Add Python to PATH »**).
2. Copiez le dossier de l'agent (les fichiers `pilotrh_agent.py`, `installer_agent.bat`,
   `lancer_agent_pointeuse.bat`) sur ce PC.
3. Double-cliquez sur **`installer_agent.bat`** (installe les modules nécessaires).
4. Ouvrez **`pilotrh_agent.py`** avec le Bloc-notes et remplissez en haut :
   - `URL` = l'adresse de votre app, ex. `https://dbs-pilotrh.up.railway.app`
   - `ADMIN_PW` = le mot de passe admin du serveur (si vous en avez défini un)
   - `POINTEUSE_IP` = l'adresse IP de la pointeuse (voir ci-dessous comment la trouver)
   - laissez `METHODE = "pointeuse"`
5. Double-cliquez sur **`lancer_agent_pointeuse.bat`**. L'agent envoie les pointages
   maintenant, puis toutes les 30 minutes (modifiable via `PILOTRH_INTERVAL_MIN`).

**Trouver l'adresse IP de la pointeuse :** sur l'écran de la pointeuse, menu
`Réseau` / `Comm` / `Ethernet` → notez l'adresse `IP` (ex. `192.168.1.201`).
Le PC et la pointeuse doivent être sur le même réseau (mêmes 3 premiers nombres de l'IP).

**Lancement automatique au démarrage de Windows :** Planificateur de tâches → Créer une
tâche → Déclencheur « À l'ouverture de session » → Action : démarrer
`lancer_agent_pointeuse.bat`.

---

## Méthode 2 — Envoi du fichier `.mdb`

Si vous préférez continuer à utiliser le logiciel ZKTeco (qui met à jour `attBackup.mdb`),
l'agent peut simplement envoyer ce fichier.

1. Mêmes étapes 1 à 3 que ci-dessus.
2. Dans `pilotrh_agent.py`, mettez :
   - `METHODE = "fichier"`
   - `URL` et `ADMIN_PW` comme ci-dessus
   - `MDB` = le chemin du fichier, ex. `C:\ZKTeco\attBackup.mdb`
     (ou un dossier partagé : `\\PC-POINTEUSE\ZKTeco\attBackup.mdb`)
3. Lancez `lancer_agent_pointeuse.bat`.

---

## Vérifier que ça marche

Dans la fenêtre de l'agent, vous devez voir une ligne du type :
`[01/07 08:15:00] OK — envoyé au cloud · 107 employées · 992 jours`

Puis, dans l'application, l'onglet **Présences** du jour se remplit tout seul, et
l'**Historique** (Paramètres → Journal) montre une entrée « Import direct pointeuse ».

## En cas de problème

- « Échec connexion pointeuse » : vérifiez l'IP, que la pointeuse est allumée et sur le
  même réseau, et que le port 4370 n'est pas bloqué par un pare-feu.
- « Erreur serveur 401 » : le mot de passe `ADMIN_PW` ne correspond pas à celui du serveur.
- « Fichier introuvable » (méthode fichier) : vérifiez le chemin `MDB`.
