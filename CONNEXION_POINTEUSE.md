# Connecter PilotRH à la pointeuse

## Où se règle tout cela, dans l'application

**Sécurité & accès → encadré « Pointeuse & synchronisation ».** Vous y trouvez :

- l'**adresse IP** de la pointeuse, son **port** (4370) et son mot de passe de communication ;
- la **fréquence de remontée** (toutes les 30 minutes par défaut) ;
- le délai au bout duquel l'application vous **alerte si elle ne reçoit plus rien** ;
- l'état de la liaison : *« Dernier pointage reçu il y a 12 min · par agent d'usine · 1 180 badges »*,
  et la dernière erreur s'il y en a eu une ;
- un bouton **« Fichier de lancement de l'agent »** : il prépare le fichier `lancer_agent.bat`
  déjà rempli avec l'adresse de votre serveur et ces réglages — plus besoin de modifier un
  fichier Python à la main sur le PC de l'atelier ;
- un bouton **« Tester et importer maintenant »**, qui n'apparaît que si ce serveur peut
  réellement joindre la pointeuse (voir juste en dessous).

**Une alerte « Pointeuse muette » apparaît maintenant dans les Notifications** dès que rien
n'est arrivé depuis le délai que vous avez fixé, et un clic dessus ouvre cet encadré. C'est le
signal qui manquait : des journées entières sans heure de sortie sont passées inaperçues
jusqu'à la paie faute d'être averti que la remontée s'était arrêtée.

---

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

## Cas particulier : le serveur est DANS l'usine

Si vous faites tourner PilotRH sur un PC de l'atelier (installation locale par
`2_Demarrer_PilotRH.bat`) plutôt qu'en ligne, l'agent devient inutile : le serveur est déjà sur
le même réseau que la pointeuse et peut la lire lui-même.

1. Installez le module de lecture : `pip install pyzk`
2. Dans Sécurité & accès → Pointeuse, saisissez l'adresse IP et enregistrez.
3. Le bouton **« Tester et importer maintenant »** apparaît : il se connecte et importe.
4. Pour l'automatiser sans agent, vous pouvez aussi laisser le logiciel ZKTeco mettre à jour
   son `attBackup.mdb` et indiquer ce chemin au serveur par la variable d'environnement
   `PILOTRH_MDB_PATH` : le serveur relit le fichier tout seul dès qu'il change
   (fréquence réglée par `PILOTRH_SYNC_MINUTES`, 60 minutes par défaut).

L'application refuse toute adresse publique pour cette lecture directe (seules les plages
locales `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x` sont acceptées) : un serveur qui accepterait
d'aller sonder n'importe quelle adresse sur Internet serait un outil d'attaque.

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
- **Rien n'arrive et l'alerte « Pointeuse muette » s'affiche** : dans l'ordre — le PC de
  l'atelier est-il allumé ? la fenêtre de l'agent est-elle ouverte ? la pointeuse répond-elle
  au `ping` depuis ce PC ? Le message d'erreur exact de la dernière tentative est affiché dans
  l'encadré Pointeuse de l'application.
- **Le PC de l'atelier s'éteint la nuit** : ce n'est pas grave. La pointeuse garde ses badges
  dans sa propre mémoire ; au prochain démarrage de l'agent, tout remonte. Réglez simplement
  le délai d'alerte plus haut que la durée d'extinction (par exemple 16 h) pour ne pas être
  averti chaque matin.

---

## Ce que l'automatisation ne dispense pas de faire

Une remontée toutes les 30 minutes ne garantit pas des journées complètes : si l'agent envoie à
16 h 00 et que les ouvrières sortent à 16 h 30, la journée est enregistrée sans heure de sortie
jusqu'à l'envoi suivant. Deux précautions :

1. **Laissez l'agent tourner après la fin du poste** (au moins une remontée après la dernière
   sortie). Un intervalle de 30 minutes et un PC allumé jusqu'à 18 h suffisent.
2. **Regardez l'alerte « Journées à vérifier »** avant de clôturer le mois : elle liste les
   journées incomplètes, et le bouton *Corriger* mène directement à la ligne concernée.
