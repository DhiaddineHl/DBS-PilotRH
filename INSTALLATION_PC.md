# PilotRH — installation sur votre PC

Version qui tourne **directement sur votre ordinateur**, sans Internet.
Idéale si le PC est sur le **même réseau que la pointeuse** : vous pouvez importer
les pointages en un clic, sans passer par un fichier.

---

## Installation (une seule fois)

1. **Installez Python** : https://www.python.org/downloads/
   → À l'installation, **cochez la case « Add Python to PATH »** (très important).
2. **Décompressez** ce dossier où vous voulez (ex. `C:\PilotRH`).
3. Double-cliquez sur **`1_Installer.bat`** et attendez la fin (1 à 2 minutes).

## Utilisation (tous les jours)

1. Double-cliquez sur **`2_Demarrer_PilotRH.bat`**.
2. Une fenêtre noire s'ouvre (le « moteur ») — **laissez-la ouverte**.
3. L'application s'ouvre toute seule dans votre navigateur : **http://localhost:8000**
   (si la page ne s'affiche pas tout de suite, attendez quelques secondes et rafraîchissez).
4. Pour arrêter : fermez la fenêtre noire.

> Astuce : faites un clic droit sur `2_Demarrer_PilotRH.bat` → *Envoyer vers* →
> *Bureau (créer un raccourci)* pour le lancer facilement.

## Importer les pointages depuis la pointeuse

Menu **Sécurité & accès** → carte **« Pointeuse · connexion réseau »** :
saisissez l'**adresse IP** de la pointeuse (écran de la pointeuse → menu Réseau/Comm →
IP, ex. `192.168.1.201`) puis cliquez **Importer depuis la pointeuse**.

Vous pouvez aussi importer un fichier `.mdb` comme d'habitude.

## Bon à savoir

- **Vos données** sont enregistrées dans le sous-dossier `data` (à côté de `app.py`).
  Pour une sauvegarde, copiez ce dossier `data`.
- **Pas de page de connexion** en version locale (un seul poste) : l'app s'ouvre directement.
  Pour activer les comptes/rôles même en local, retirez la ligne `set PILOTRH_OPEN=1`
  dans `2_Demarrer_PilotRH.bat` (identifiant par défaut `admin` / `admin`).
- **Accès depuis un autre PC du réseau** (optionnel) : dans `2_Demarrer_PilotRH.bat`,
  remplacez `--host 127.0.0.1` par `--host 0.0.0.0`. Les autres postes ouvrent alors
  `http://IP-DU-PC:8000`. L'espace salarié est à `.../moi`.
- **L'assistant IA** nécessite une clé : définissez la variable `ANTHROPIC_API_KEY`
  (facultatif ; le reste de l'application fonctionne sans).

## En cas de souci

- **« site introuvable » à l'ouverture** : le tout premier lancement prépare la base
  (~20 secondes) — le serveur n'est pas encore prêt. **Attendez 20-30 s et rafraîchissez
  la page (touche F5)**. Le nouveau lanceur ouvre désormais le navigateur automatiquement
  seulement quand le serveur répond. Les lancements suivants sont rapides.
  Vérifiez aussi que la **fenêtre noire est bien restée ouverte** (elle contient le serveur).
- **La fenêtre noire affiche « No module named uvicorn »** ou se ferme aussitôt : les
  composants ne sont pas installés → lancez d'abord **`1_Installer.bat`**.


- « python n'est pas reconnu » → Python non installé ou case « Add to PATH » non cochée :
  réinstallez Python en cochant la case, puis relancez `1_Installer.bat`.
- Le port 8000 est déjà utilisé → dans `2_Demarrer_PilotRH.bat`, remplacez `8000`
  par `8010` (aux deux endroits) et ouvrez `http://localhost:8010`.
- « Connexion à la pointeuse impossible » → vérifiez l'IP, que la pointeuse est allumée
  et sur le même réseau, et que le port 4370 n'est pas bloqué par un pare-feu.
