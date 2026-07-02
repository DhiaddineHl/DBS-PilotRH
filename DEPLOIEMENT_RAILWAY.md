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

- **« Application failed to respond »** : c'est le port. Le `Dockerfile` fourni utilise
  déjà le port de Railway — assurez-vous d'avoir bien redéployé la dernière version.
- **Données perdues après un redéploiement** : le volume n'est pas monté, ou pas sur
  `/app/data`. Vérifiez le Mount Path.
- **La date ou une correction n'apparaît pas** : ancienne version en cache → Ctrl + Maj + R ;
  ou vérifiez que Railway déploie bien la **bonne branche** (Settings → trigger branch).
- **La pointeuse n'envoie plus** : l'agent d'usine utilise le compte admin ; si vous
  changez le mot de passe admin, mettez-le à jour dans `pilotrh_agent.py`.
- **Vérifier les logs** : cliquez sur le service → onglet *Deploy Logs* (les erreurs y apparaissent).
