# Déployer PilotRH sur Railway — guide pas à pas

Ce guide part de zéro. Le plus important : **le Volume** (sinon vos données sont
effacées à chaque mise à jour) et **comment mettre à jour** une fois en ligne.

Railway demande une carte bancaire et coûte environ **5 $/mois** pour une petite app.

---

## Les 3 réglages indispensables

1. **Un Volume monté sur `/app/data`** → conserve la base (employées, pointages,
   comptes, photos). **Sans volume, tout est effacé à chaque redéploiement.**
2. **Les variables d'environnement** (mot de passe admin, clé IA…).
3. **Un domaine public** pour obtenir l'adresse `https://…up.railway.app`.

---

## A. Première mise en ligne

### Méthode simple : en ligne de commande (aucune connaissance de Git requise)

Sur votre PC (une seule fois) :

1. Installez **Node.js** (https://nodejs.org) puis, dans un terminal :
   `npm i -g @railway/cli`
2. Placez-vous dans le dossier `pilotrh_server` (celui qui contient `app.py`) :
   `cd chemin/vers/pilotrh_server`
3. Connectez-vous : `railway login`
4. Créez le projet : `railway init` (donnez un nom, ex. « pilotrh »)
5. Envoyez le code : `railway up`
6. **Ajoutez le volume** (indispensable) :
   `railway volume add --mount /app/data`
7. Ajoutez les variables (voir section C), puis **générez le domaine** dans le
   tableau de bord (section B, point « domaine »).

Pour **mettre à jour** ensuite : il suffit de relancer `railway up` depuis le dossier.

### Méthode alternative : via GitHub (mises à jour automatiques)

1. Mettez le contenu du dossier `pilotrh_server` dans un dépôt **GitHub**.
2. Sur https://railway.app → **New Project** → **Deploy from GitHub repo** →
   choisissez le dépôt et la branche. Railway détecte le `Dockerfile` et construit tout seul.
3. Faites les points « volume », « variables » et « domaine » ci-dessous.
   Ensuite, **chaque `git push` redéploie automatiquement**.

---

## B. Réglages dans le tableau de bord Railway

Cliquez sur votre service (la tuile), puis :

- **Volume** : ouvrez la palette de commandes (**Ctrl + K**) → tapez *Volume* → *New Volume*,
  ou clic droit sur le canevas → *New* → *Volume*. Mount path : **`/app/data`** (exactement).
- **Variables** (onglet *Variables*) : voir section C.
- **Domaine** : onglet *Settings* → section *Networking* → *Generate Domain*.
  Vous obtenez l'adresse `https://…up.railway.app`. C'est l'adresse de votre app.

> Note : le volume n'est monté qu'au **démarrage** (pas pendant la construction) —
> c'est le cas de PilotRH, donc tout fonctionne normalement.

---

## C. Variables d'environnement

Dans l'onglet *Variables*, ajoutez :

| Variable                 | Valeur                          | Utilité                                  |
|--------------------------|---------------------------------|------------------------------------------|
| `PILOTRH_ADMIN_PASSWORD` | (un mot de passe fort)          | Mot de passe du compte **admin** initial |
| `ANTHROPIC_API_KEY`      | `sk-ant-...` (optionnel)        | Assistant IA / OCR                       |
| `TZ`                     | `Africa/Tunis` (recommandé)     | Heure locale tunisienne (au lieu de UTC) |

`PILOTRH_DATA` est déjà réglée sur `/app/data` par le Dockerfile : ne pas y toucher.

---

## D. Première connexion

Ouvrez l'adresse `https://…up.railway.app` → page de connexion :

- Identifiant : `admin`
- Mot de passe : celui mis dans `PILOTRH_ADMIN_PASSWORD` (ou `admin` si non défini).

Puis, dans **Sécurité & accès → Comptes & rôles** : changez le mot de passe admin et
créez les comptes (RH, chef d'atelier, lecture seule).

L'espace salarié (QR) reste public à l'adresse `.../moi` (sans connexion).

---

## E. Mettre à jour l'application (quand je vous envoie une nouvelle version)

- **Méthode ligne de commande** : remplacez les fichiers du dossier par les nouveaux,
  puis relancez `railway up` dans ce dossier.
- **Méthode GitHub** : remplacez les fichiers dans le dépôt, `git commit` + `git push`.
  Railway redéploie tout seul (ou palette Ctrl + K → *Deploy Latest Commit*).

Grâce au volume, **vos données sont conservées** pendant la mise à jour.
Après le redéploiement, si l'écran ne change pas : rafraîchissez avec **Ctrl + Maj + R**.

---

## F. En cas de problème

### « PermissionError: [Errno 13] Permission denied: /app/data/backups »

Le déploiement démarre, puis échoue en boucle avec une longue trace Python qui
finit sur cette ligne. **C'est corrigé dans cette version** : reconstruisez et
redéployez, il n'y a rien à régler dans l'interface Railway.

Ce qui se passait : Railway monte le volume **au démarrage**, par-dessus le
dossier `/app/data` que l'image avait préparé, et **ce volume appartient à
root**. Le serveur, lui, tourne volontairement en utilisateur non privilégié :
il ne pouvait donc plus créer ses sous-dossiers. Le `chown` fait à la
construction de l'image était recouvert par le montage.

Le correctif : le conteneur démarre en root, un script d'entrée
(`docker-entrypoint.sh`) donne les droits sur le volume, **puis** lâche les
privilèges pour lancer uvicorn. Le serveur ne tourne toujours pas en root.

Si l'erreur persiste malgré la reconstruction :

1. Vérifiez le **Mount Path** du volume : il doit être exactement `/app/data`.
   Si vous l'avez monté ailleurs, l'application suit désormais automatiquement
   le chemin annoncé par Railway (`RAILWAY_VOLUME_MOUNT_PATH`) — mais alors
   **supprimez la variable `PILOTRH_DATA`**, sinon elle a la priorité et
   l'application écrit à côté du volume : les données seraient perdues au
   redéploiement suivant.
2. Vérifiez que Railway construit bien avec le **Dockerfile** (Settings →
   Builder), et non avec Nixpacks : le script d'entrée ne serait pas utilisé.
3. **Dépannage immédiat**, le temps de comprendre : ajoutez la variable
   `PILOTRH_ROOT` = `1`. Le serveur démarre alors en root, ce qui débloque tout
   de suite. C'est moins sûr — retirez-la dès que le point 1 ou 2 est réglé.

Le message d'erreur affiché dans les logs indique désormais lui-même ces trois
points, au lieu d'une trace Python.

- **« Application failed to respond »** : c'est le port. Le `Dockerfile` fourni utilise
  déjà le port de Railway — assurez-vous d'avoir bien redéployé la dernière version.
- **Données perdues après un redéploiement** : le volume n'est pas monté, ou pas sur
  `/app/data`. Vérifiez le Mount Path. Vérifiez aussi qu'une variable `PILOTRH_DATA`
  ne pointe pas ailleurs que le volume — c'est la cause la plus sournoise, parce que
  tout fonctionne parfaitement jusqu'au redéploiement suivant.
- **La date ou une correction n'apparaît pas** : ancienne version en cache → Ctrl + Maj + R ;
  ou vérifiez que Railway déploie bien la **bonne branche** (Settings → trigger branch).
- **La pointeuse n'envoie plus** : l'agent d'usine utilise le compte admin ; si vous
  changez le mot de passe admin, mettez-le à jour dans `pilotrh_agent.py`.
- **Vérifier les logs** : cliquez sur le service → onglet *Deploy Logs* (les erreurs y apparaissent).
