# Relier la pointeuse à PilotRH, sans import manuel

## En deux phrases

PilotRH est hébergé sur Internet (Railway), et la pointeuse est sur le réseau de l'usine. Internet
ne peut pas entrer sur le réseau de l'usine : c'est donc un petit programme, **l'agent**, posé sur
un PC de l'atelier, qui lit la pointeuse et envoie les badgeages à PilotRH, plusieurs fois par jour.

## Mise en route — 5 minutes

> **Le bouton s'appelle « Fichier de lancement de l'agent » chez vous, ou il répond « erreur 404 » ?**
> Votre navigateur affiche encore l'ancienne version de l'écran. Rechargez la page avec
> **Ctrl + F5** (sur téléphone : fermez et rouvrez l'onglet). Le bouton devient
> **« Télécharger le kit de l'agent »**. Cette version empêche que cela se reproduise.

**Dans PilotRH** (compte Administrateur ou RH) : *Sécurité & accès → Pointeuse*.

1. Saisissez l'**adresse IP** de la pointeuse, puis **Enregistrer**.
   Pour la trouver, sur l'appareil : *Menu → Comm. → Ethernet* (ou *Réseau*) → « Adresse IP ».
2. Cliquez sur **« Télécharger le kit de l'agent »**. Vous obtenez `PilotRH_Agent.zip`.

**Sur le PC de l'atelier** (branché sur le même réseau que la pointeuse) :

*Vous avez un kit sans `config.ini` (par exemple celui reçu par e-mail) ?* Aucun problème :
`DIAGNOSTIC.bat` vous pose alors deux questions — **l'adresse de PilotRH** et **la clé** — et crée
le fichier lui-même. Les deux se trouvent dans PilotRH, *Sécurité & accès → Pointeuse →
**« Afficher la clé »***, avec un bouton *Copier* (clic droit dans la fenêtre noire pour coller).
Sans clé, vous pouvez aussi répondre avec l'identifiant et le mot de passe d'un compte
**Chef d'atelier**.


3. Copiez le ZIP (clé USB, e-mail…), **clic droit → « Extraire tout… »**.
   Ne lancez rien depuis l'intérieur du ZIP.
4. Dans le dossier extrait, double-cliquez sur **`DIAGNOSTIC.bat`**.
   Il vérifie chaque maillon et termine par **« TOUT FONCTIONNE »** ou par la cause exacte de la panne.
5. Double-cliquez sur **`DEMARRER.bat`**. Laissez la fenêtre ouverte (vous pouvez la réduire).
6. Une seule fois : **`DEMARRAGE_AUTOMATIQUE.bat`**, pour que l'agent se relance à chaque
   démarrage du PC.

C'est tout. Rien à installer, rien à remplir :

- **Python** : si le PC ne l'a pas, le kit télécharge une version portable dans son propre dossier
  (10 Mo, une seule fois, sans droits administrateur, rien n'est installé dans Windows).
- **Aucun module à installer** : la lecture de la pointeuse est intégrée au kit (plus de `pyzk`,
  plus de `pip install`).
- **Aucun compte à créer ni mot de passe à recopier** : le kit contient l'adresse de votre PilotRH
  et une **clé d'accès** qui n'autorise qu'une chose — envoyer des pointages.
- **L'adresse de la pointeuse** n'est pas inscrite sur le PC : l'agent la redemande à PilotRH à
  chaque remontée. Si elle change, corrigez-la dans PilotRH, sans retourner à l'atelier.

## Ce que vous voyez dans PilotRH

L'encadré *Pointeuse* affiche :

- **sur quel PC tourne l'agent**, quand il a donné des nouvelles, sa version ;
- **le modèle et le numéro de série** de la pointeuse, le nombre de badgeages en mémoire ;
- **la dernière panne**, en clair, avec « Que faire » — vue de votre bureau, sans aller à l'atelier ;
- **un décalage de l'horloge** de la pointeuse de plus de 5 minutes (toutes les heures d'entrée et
  de sortie en seraient faussées d'autant).

Trois alertes remontent aussi dans *Alertes* : pointeuse muette, dernière remontée en échec,
horloge décalée.

## Ce que fait l'agent, exactement

- Il **lit** la pointeuse, il n'efface jamais rien dessus et ne touche ni à ses utilisateurs ni à
  son horloge. Pendant la lecture (quelques secondes), l'écran de la pointeuse indique qu'elle est
  occupée ; le badgeage reprend ensuite tout seul.
- Une fois par jour, il envoie **tout l'historique** de la pointeuse (comme l'import manuel du
  fichier `.mdb`). Le reste du temps, il n'envoie que les **60 derniers jours**, et seulement s'il y
  a du nouveau.
- Vos **corrections manuelles restent protégées** : elles ne sont jamais écrasées par un envoi.
- Un envoi **ajoute** des badges, il n'en retire jamais. Si le logiciel ZKTeco vide la pointeuse
  après l'avoir téléchargée, l'agent et le fichier `.mdb` se complètent : aucun n'efface l'autre.
- Une remontée qui échoue est retentée au bout de 2, puis 5, puis 10 minutes, puis au rythme normal.
- Si deux agents sont lancés sur le même PC, le second s'arrête de lui-même.
- Tout est écrit dans `journal_agent.txt`, à côté de lui.

## Si ça ne marche pas

Relancez **`DIAGNOSTIC.bat`**. Il s'arrête au premier maillon qui casse et dit quoi faire. Il
enregistre aussi son compte rendu dans `diagnostic.txt` : c'est ce fichier à envoyer si vous demandez
de l'aide.

| Ce que dit le diagnostic | La cause habituelle |
|---|---|
| « Le fichier pilotrh_agent.py est introuvable » | Lancé depuis l'intérieur du ZIP : *Extraire tout* d'abord |
| « Le fichier config.ini est absent » | Kit reçu sans configuration : répondez aux deux questions de l'assistant (adresse et clé, via « Afficher la clé ») |
| « Impossible de trouver ou de télécharger Python » | Pas d'Internet sur ce PC ; sinon installer Python à la main en cochant *Add python.exe to PATH* |
| « Ce PC ne trouve pas le serveur PilotRH » | Pas d'Internet à ce moment, ou adresse mal écrite |
| « La connexion sécurisée a été refusée par ce PC » | **Date ou heure du PC fausse** (le plus fréquent), ou antivirus qui filtre le https |
| « PilotRH refuse la clé de cet agent » | La clé a été changée dans PilotRH : retéléchargez le kit et remplacez `config.ini` |
| « Ce serveur PilotRH ne connaît pas l'agent » | Le serveur n'a pas encore été mis à jour avec cette version |
| « Rien ne répond à l'adresse 192.168… » | Pointeuse éteinte, câble, mauvaise adresse IP, ou PC sur un autre réseau (Wi-Fi invité…) |
| « Un appareil répond mais refuse le port 4370 » | Ce n'est pas la pointeuse à cette adresse, ou son port a été changé |
| « Ce n'est pas une pointeuse ZKTeco qui répond » | L'adresse est celle d'une imprimante, d'une caméra… |
| « La pointeuse refuse le mot de passe de communication » | Une *Clé Comm.* est réglée sur l'appareil : reportez-la dans PilotRH |
| « La pointeuse a fermé la connexion » | Un autre logiciel ZKTeco (ZKTime…) est connecté en même temps : fermez-le |

Pour la panne réseau, le diagnostic affiche l'adresse du PC et celle de la pointeuse : **les trois
premiers nombres doivent être identiques** (par exemple 192.168.1.**20** et 192.168.1.**201**). Il
propose aussi la commande `ping` à taper pour savoir si la pointeuse est joignable du tout.

## Remplacer le PC, ou si la clé a pu être copiée

Dans PilotRH, *Pointeuse* → **« Changer la clé »**. L'ancienne cesse aussitôt de fonctionner.
Retéléchargez le kit et remplacez le fichier `config.ini` sur le PC de l'atelier.

## Deux sources : la pointeuse ET le fichier `attBackup.mdb`

Si le logiciel ZKTeco tourne sur le PC de l'agent, il tient à jour un fichier `attBackup.mdb` qui
garde **tout l'historique** et se complète au fil de la journée. Par défaut, l'agent envoie
**les deux** : ce qu'il lit sur la pointeuse, et ce fichier quand il a changé. PilotRH additionne
les deux, sans doublon ni effacement. Ainsi :

- si le logiciel ZKTeco vide la pointeuse après son téléchargement, le fichier apporte ce que
  l'agent n'a plus pu lire ;
- si la pointeuse ne répond pas (câble, coupure), le fichier prend le relais, et le diagnostic
  l'indique sans bloquer ;
- **vous n'avez plus jamais à importer le fichier à la main.**

L'agent **trouve le fichier tout seul** dans les emplacements habituels (`C:\ZKTeco`,
`Program Files`, dossiers Att2000 / ZKTime…). Sinon, indiquez son emplacement dans PilotRH :
*Pointeuse → « Fichier .mdb sur le PC de l'atelier »*. Le même encadré permet de choisir
« La pointeuse seulement » ou « Le fichier .mdb seulement », et affiche le fichier envoyé et
l'heure de sa dernière mise à jour.

Le fichier n'est renvoyé que s'il a changé depuis le passage précédent.

## Installation locale (PilotRH sur un PC de l'usine)

Si PilotRH tourne lui-même sur un PC de l'usine (`2_Demarrer_PilotRH.bat`), le serveur peut lire la
pointeuse directement : le bouton **« Tester et importer maintenant »** apparaît dans l'encadré.
Plus besoin d'installer `pyzk` pour cela non plus. Pour une remontée automatique, installez l'agent
comme ci-dessus.

## Ce qui n'a pas pu être vérifié avant livraison

Le dialogue avec la pointeuse a été vérifié contre une pointeuse **simulée** qui reproduit le
protocole ZKTeco — elle-même validée par la bibliothèque de référence `pyzk` — sur tous les formats
de mémoire connus, les réseaux lents, les anciens modèles (UDP), le mot de passe de communication et
les pannes. Il n'a pas pu l'être face à **votre** appareil, ni les fichiers `.bat` sur un vrai
Windows. Si `DIAGNOSTIC.bat` s'arrête sur une erreur que ce tableau n'explique pas, envoyez
`diagnostic.txt` : il contient tout ce qu'il faut pour corriger.
