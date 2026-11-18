# PilotRH v3.0 — ce qui change et comment déployer

*Cette note prévaut sur le README pour tout ce qu'elle traite.*

---

## 0. Essayer sans rien installer

Deux fichiers HTML autonomes sont fournis dans le dossier `demo/` :

| Fichier | Ce qu'il montre |
|---|---|
| `PilotRH_demo.html` | l'interface RH complète, **sans serveur ni mot de passe** |
| `PilotRH_demo_salarie.html` | l'espace salarié en vue téléphone (code : **123456**) |
| `PilotRH_arrondi.html` | simulateur d'arrondi : pourquoi arrondir chaque journée fausse la paie |

**Double-cliquez le fichier**, il s'ouvre dans votre navigateur. Aucune installation,
aucune connexion Internet. Ils embarquent le vrai code de l'application ; seuls les
appels au serveur sont remplacés par un jeu de **données fictives** (86 salariés
inventés, 95 jours de pointage). Vous pouvez tout modifier — corriger des heures,
valider un congé, publier une note, lancer un sondage : **rien n'est enregistré**,
tout repart de zéro au rechargement.

Ce qui ne peut pas fonctionner hors ligne, et qui le dit clairement : les PDF,
l'assistant IA, la lecture de documents et l'import `.mdb` — ils sont produits par
le serveur. Les exports CSV, eux, fonctionnent.

Pour régénérer les fichiers après une modification du code :

```
python outils/faire_demo.py
```

---

## 0 bis. Reprendre une sauvegarde de l'ancienne version

```
python outils/integrer_sauvegarde.py ma_sauvegarde.json
```

L'outil produit un rapport à l'écran, un fichier `..._corrigee.json` à restaurer, et
`demo/PilotRH_mes_donnees.html` : **vos vraies données dans la nouvelle interface**,
en fichier autonome, pour comparer les chiffres avant de toucher au serveur.

Il fait trois choses au fichier :

1. **retire les comptes (`users`) et la clé de signature (`_secret`)** — l'ancien
   export les écrivait en clair sur le disque ; quiconque obtenait le fichier pouvait
   fabriquer un cookie administrateur ;
2. **sépare les identifiants d'employées attribués deux fois** (voir §1.7) ;
3. **complète les réglages** — jours fériés, portée de l'arrondi, plage de pause,
   taux de rémunération à zéro — **sans modifier aucune de vos valeurs existantes** ;
4. **conserve les jetons et les codes des cartes QR** : sur vos 97 fiches, 95 cartes
   restent utilisables sans réimpression (voir §0 ter).

> **Important :** la restauration de la v3 remet aussi **les pointages**. L'ancienne
> version les ignorait en silence lors d'un import de sauvegarde : on restaurait les
> fiches et on perdait tout l'historique. Ils sont désormais envoyés par lots de
> 4 000, avec une progression à l'écran, et l'opération est reprenable si le réseau
> coupe.

### 1.7 Un identifiant d'employée attribué deux fois

L'ancienne version numérotait les nouvelles fiches à partir du **nombre** d'employées.
Après une suppression, le compteur recréait donc un identifiant déjà pris. Comme la
clé du pointage est `(date, identifiant)`, les deux personnes concernées **partageaient
le même historique** : un seul des deux pointages était conservé chaque jour.

L'outil de migration sépare les fiches et attribue un identifiant neuf à la seconde.
L'historique ne peut pas être démêlé après coup, mais il n'est pas perdu : le
rapprochement à l'import se fait sur le **matricule**, donc **réimportez votre `.mdb`
après la restauration** et l'historique de la fiche déplacée sera reconstruit
correctement.

**L'accès à l'espace salarié est retiré aux DEUX fiches concernées**, pas seulement à
celle qui est déplacée. La raison : les deux personnes ne partageaient qu'une fiche,
donc **une seule carte QR a été imprimée**, et rien ne dit laquelle des deux la
détient physiquement. Laisser le jeton à la fiche conservée ferait courir le risque
qu'une ouvrière ouvre l'espace personnel de l'autre et y lise ses heures et son
salaire. Deux cartes à réimprimer valent mieux qu'une fuite. Toutes les **autres**
cartes continuent de fonctionner telles quelles.

---

## 0 ter. Les cartes QR déjà distribuées continuent-elles de fonctionner ?

**Oui.** C'est vérifié sur votre sauvegarde réelle : sur 97 fiches, **95 cartes
fonctionnent sans rien changer**, avec leur code actuel. Les 2 seules à réimprimer
sont les deux fiches de l'identifiant dupliqué (§1.7), et c'est pour une raison de
confidentialité, pas de compatibilité.

Ce qui garantit cette continuité :

- **Le jeton de la carte n'est jamais régénéré.** Au démarrage, le serveur n'attribue
  un jeton et un code qu'aux fiches **qui n'en ont pas**. Une fiche déjà pourvue est
  laissée telle quelle.
- **L'adresse encodée dans le QR est inchangée** : `https://votre-serveur/moi?t=JETON`.
  Les cartes imprimées restent lisibles à l'identique.
- **Les codes à 4 chiffres déjà distribués restent valides.** Les nouveaux codes créés
  sont à 6 chiffres, mais rien n'impose de longueur à la saisie : vos 97 codes actuels
  sont tous à 4 chiffres et fonctionnent. Inutile de redistribuer quoi que ce soit en
  main propre.
- **L'ancienne forme d'appel est conservée.** Un téléphone qui a gardé en mémoire
  l'ancienne page continue de fonctionner : l'ancien appel `GET /api/me?t=…` répond en
  demandant simplement de repasser par la nouvelle forme, et la page s'en charge.
- **L'export puis la restauration d'une sauvegarde conservent jetons et codes** : la
  migration ne les touche pas, sauf dans le cas du doublon ci-dessus.

Ce qui change côté téléphone, sans casser l'existant : le jeton **n'apparaît plus dans
l'adresse** (il est retiré de l'URL dès la première ouverture et mémorisé sur
l'appareil), et le code passe dans le corps de la requête au lieu de la barre
d'adresse. Il ne finit donc plus dans les journaux du serveur ni dans l'historique
d'un téléphone partagé.

Un seul cas où une carte cesse de fonctionner de votre plein gré : si vous cliquez
**Régénérer le QR et le code** sur une fiche (fait pour une carte perdue).

---

## 1. À faire avant de déployer — dans l'ordre

### 1.1 Purger la base de la pointeuse du dépôt Git

`seed/attBackup.mdb` contient **environ 85 vraies identités** de votre personnel, et le
catalogue Access comporte les tables `TEMPLATE` et `FINGERID` (gabarits d'empreintes).
Ce fichier ne doit pas rester dans un dépôt Git ni dans une image Docker.

```bash
# 1. le retirer du suivi (le fichier reste sur votre disque)
git rm --cached seed/attBackup.mdb
git commit -m "Retire la base pointeuse du depot"

# 2. le purger de TOUT l'historique (sinon il reste récupérable)
pip install git-filter-repo
git filter-repo --path seed/attBackup.mdb --invert-paths --force
git push --force origin main
```

Le nouveau `.gitignore` exclut désormais `*.mdb` et `*.db`, et le nouveau
`.dockerignore` empêche que le fichier — ou un `.env` avec votre clé Anthropic —
finisse dans l'image.

Le serveur n'amorce plus la base depuis ce fichier si vous mettez `PILOTRH_SEED=0`.
Sur une instance neuve, importez votre `.mdb` depuis l'écran **Présences → Importer pointage**.

### 1.2 Identifiants — et un cas où vous pourriez être bloqué

**Interface RH : identifiant `admin`**, mot de passe = celui de la variable
`PILOTRH_ADMIN_PASSWORD`. Il n'y a **plus** de `admin`/`admin` par défaut.

**Attention à un cas précis sur votre déploiement actuel.** Dans la v2, si
`PILOTRH_ADMIN_PASSWORD` n'était pas définie **au tout premier démarrage**, le
compte était créé avec le mot de passe `admin`, et la définir plus tard ne changeait
rien : votre connexion ne fonctionnait alors que grâce à une porte dérobée
(`Authorization: Basic n'importe:<mot de passe>` donnait le rôle admin en ignorant
l'identifiant). **Cette porte dérobée est supprimée en v3.** Si vous étiez dans ce
cas, votre mot de passe habituel ne fonctionnera plus après la mise à jour — et
l'agent d'usine non plus.

Deux façons de s'en sortir, à choisir selon l'hébergement :

**Sur Railway** — variable d'environnement, le temps d'un redéploiement :

```
PILOTRH_RESET_ADMIN=VotreNouveauMotDePasse
```

Au démarrage, le mot de passe du compte `admin` est remis à cette valeur et un
message le confirme dans les journaux. **Retirez ensuite la variable** : tant
qu'elle est présente, le mot de passe est réécrit à chaque redémarrage.

**En local (Windows / Docker)** — script fourni, sans rien à installer :

```
python reinit_admin.py --liste          affiche les comptes existants
python reinit_admin.py                  réinitialise « admin »
python reinit_admin.py --compte rh1     réinitialise un autre compte
python reinit_admin.py --data /app/data si la base est ailleurs
```

`--liste` indique aussi quels comptes utilisent encore l'ancien hachage.

**Espace salarié : pas d'identifiant.** Chaque salarié a un QR personnel plus un
code. Les codes à 4 chiffres déjà distribués **restent valides** — vos cartes
imprimées continuent de fonctionner. Les nouveaux comptes reçoivent un code à
6 chiffres. Pour refaire l'accès d'une personne (carte perdue) : sa fiche →
*Régénérer le QR et le code*.

**Mode local Windows** : `2_Demarrer_PilotRH.bat` active `PILOTRH_OPEN=1`, qui
désactive toute authentification. Il n'y a donc ni identifiant ni mot de passe à
saisir, et c'est acceptable **uniquement** parce que le serveur écoute exclusivement
sur `127.0.0.1`. Si vous le rendez accessible depuis le réseau, retirez cette ligne.

### 1.3 Définir le mot de passe administrateur

Le compte `admin/admin` n'existe plus. Si `PILOTRH_ADMIN_PASSWORD` n'est pas définie
au premier démarrage, le serveur génère un mot de passe aléatoire et l'affiche
**une seule fois** dans les journaux :

```
====================================================================
PILOTRH_ADMIN_PASSWORD n'est pas définie.
Compte admin créé avec un mot de passe ALÉATOIRE : xY7-pQ2mK
Notez-le maintenant, il ne sera plus affiché.
====================================================================
```

Variables à définir sur Railway :

| Variable | Valeur | Pourquoi |
|---|---|---|
| `PILOTRH_ADMIN_PASSWORD` | 8 caractères minimum | obligatoire |
| `PILOTRH_SESSION_SECRET` | chaîne aléatoire longue | sort la clé de signature de la base ; la changer déconnecte toutes les sessions |
| `PILOTRH_PUBLIC_URL` | `https://votre-app.up.railway.app` | les QR codes étaient construits depuis l'en-tête `Host` du client, falsifiable |
| `TZ` | `Africa/Tunis` | horodatages et bascule de journée |
| `PILOTRH_TRUSTED_PROXY` | l'IP de l'edge Railway, ou `127.0.0.1` | n'accepter `X-Forwarded-*` que du proxy |
| `PILOTRH_RESET_ADMIN` | temporaire | réinitialise le mot de passe `admin` puis **à retirer** |

### 1.4 bis Déploiement Railway : les droits sur le volume

Si votre déploiement échoue en boucle sur
`PermissionError: [Errno 13] Permission denied: /app/data/backups`, **c'est corrigé
dans cette version** : reconstruisez, il n'y a rien à régler dans l'interface.

La cause : Railway monte le volume **au démarrage**, par-dessus le `/app/data` que
l'image avait préparé, et ce volume **appartient à root**. Le serveur tournant
volontairement en utilisateur non privilégié, il ne pouvait plus créer ses
sous-dossiers ; le `chown` fait à la construction de l'image était recouvert par le
montage. C'est un piège classique des volumes, et il ne se voyait pas en local.

Trois changements :

1. un script d'entrée (`docker-entrypoint.sh`) démarre en root, donne les droits sur
   le volume, **puis lâche les privilèges** pour lancer uvicorn — le serveur ne tourne
   toujours pas en root ;
2. l'application suit désormais **le chemin réellement annoncé par Railway**
   (`RAILWAY_VOLUME_MOUNT_PATH`) si `PILOTRH_DATA` n'est pas réglée. Un volume monté
   ailleurs que `/app/data` était auparavant ignoré : l'application écrivait dans le
   conteneur et **tout disparaissait au redéploiement suivant, sans le moindre
   avertissement** ;
3. l'erreur, si elle survient encore, affiche **quoi vérifier** (point de montage,
   builder Docker, variable de dépannage `PILOTRH_ROOT=1`) au lieu d'une trace Python.

Le démarrage vérifie aussi qu'il peut **réellement écrire** dans le dossier, et non
seulement qu'il existe. Il échoue franchement si ce n'est pas le cas : mieux vaut un
refus de démarrer qu'une application qui tourne en écrivant dans un dossier éphémère.

### 1.4 Vérifier que le volume est bien monté

Le volume Railway **doit** être monté sur `/app/data`. Sinon tout est perdu à chaque
redéploiement : effectif, historique, comptes, jetons — et **toutes les cartes QR
imprimées deviennent invalides**. Vérifiez après déploiement :

```
GET /api/health/detail   →  {"data_dir":"/app/data", "sauvegardes":1, ...}
```

### 1.5 Installer l'agent de la pointeuse

Plus de compte de service à créer ni de mot de passe à recopier : *Sécurité & accès →
Pointeuse → Télécharger le kit de l'agent*. Le kit contient sa propre clé d'accès, qui
n'autorise que l'envoi de pointages. Marche à suivre : section 3 quinquies et
`CONNEXION_POINTEUSE.md`.

### 1.6 Réglages à faire dès la première connexion

Écran **Présences → icône engrenage** :

1. **Plage de pause** par jour (colonnes « Pause de » / « Pause à »). Les valeurs
   marquées *déduit* ont été estimées automatiquement — mettez vos horaires réels
   (par exemple 12:00 → 12:30).
2. **Jours fériés** : les fêtes à date fixe sont préremplies. Ajoutez les fêtes
   religieuses de l'année (Aïd El Fitr, Aïd El Idha, Mouled, Ras El Am El Hejri)
   avec leur date et leur nombre de jours.
3. **Arrondi** : vérifiez qu'il est appliqué *sur le cumul de la période* et non
   par journée.

---

## 2. Ce qui change dans les chiffres de paie

**Les totaux vont bouger par rapport à la v2.** Voici exactement pourquoi, pour que
vous puissiez le vérifier vous-même sur un mois de contrôle.

| # | Avant | Maintenant |
|---|-------|------------|
| **Jours fériés** | Le personnel sans pointage sortait **absent** le 1er mai, le 20 mars, pendant l'Aïd — dans les KPI, les états d'absence et les PDF. | Statut **« férié »** distinct. Exclu des absences. Les heures pointées un férié sont comptées **entièrement en heures supplémentaires**. |
| **Repos hebdomadaire** | Idem : dimanche sans pointage = absence potentielle. | Statut **« repos »**. Un dimanche travaillé compte tout en heures supplémentaires, **et une sortie badgée au milieu de la journée n'est plus payée** (l'ancien calcul faisait `dernier badge − premier badge`). |
| **Pause déjeuner** | Déduite systématiquement. Une autorisation 07:55 → 11:00 se voyait retirer 30 minutes jamais prises. | Déduite **au prorata du temps réellement travaillé pendant la plage de pause**. Demi-journée → aucune déduction. |
| **Sortie manquante** | 1 seul badge = **0 h payée, statut « présente », aucune alerte**. | Journée marquée **« à vérifier »**, comptée dans un bandeau, listée avant la paie, et l'export PDF demande confirmation. |
| **Arrondi** | Appliqué **par jour** → dérive jusqu'à **3 h par personne et par mois**, dans les deux sens. | Appliqué **sur le cumul de la période**. Le mode par jour reste disponible. Voir l'annexe A et le simulateur `demo/PilotRH_arrondi.html`. |
| **Heures saisies à la main** | `hM` remplaçait les heures mais **pas** les heures sup. : corriger « 8 h » pour quelqu'un sorti à 19:00 payait 8 h **+ 2 h 30 de sup**. | `hM` met les heures sup. calculées à zéro. Une colonne **H. sup. éditable** (`hsM`) permet de les saisir explicitement. |
| **Congés validés** | Restaient comptés **absents** dans les rapports et les états. | La validation **inscrit les journées « congé »** dans le pointage (jours ouvrés uniquement, fériés et mois clos exclus), avec un récapitulatif avant écriture. |
| **Badges doublés** | Deux lectures du doigt à 2 minutes d'écart coupaient la journée en deux. | Dédupliqués à moins de 5 minutes, comme le fait déjà l'import `.mdb`. |
| **Dépassement de minuit** | `%24` repliait silencieusement les valeurs. | Signalé (`01:00 (+1j)`) au lieu d'être masqué. Le travail de nuit reste à traiter (voir §6). |
| **Import CSV** | Écrasait **toutes** les corrections manuelles et les congés validés, marquait absentes les personnes absentes du fichier, et rattachait les dates illisibles à la journée affichée. | Respecte les protections par défaut, ne marque plus personne absent sans que vous le demandiez, **ignore et liste** les dates illisibles et les lignes non rapprochées. |
| **Fichier `.xlsx`** | Déclenchait `simulateImport()` : la journée réelle était **remplacée par des données fabriquées**, avec un message qui ressemblait à un succès. | Refusé avec une explication (enregistrez en CSV, ou envoyez le `.mdb`). |
| **Courbe d'absentéisme** | Six valeurs **codées en dur** (4,2 / 3,8 / 5,1 / 4,6 / 3,9 / 4,4). | Calculée par le serveur sur vos pointages. Idem turn-over et parité d'encadrement dans le rapport RSE. |
| **Exports PDF / CSV de paie** | Forçaient le mois entier en ignorant la période affichée. Une sélection 15/05 → 14/06 produisait un rapport du 01/06 au 30/06, sans le signaler. | Portent **exactement** sur la période affichée, et mentionnent le régime, l'arrondi et l'auteur. |
| **CSV** | `join(';')` sans échappement : un nom contenant `;` décalait toutes les colonnes. Le matricule différait entre CSV et PDF. | Échappement conforme, matricule unifié partout. |

### Clôture de mois

Nouveau. Depuis **Rapports & paie**, bouton *Clôturer*. Un mois clos n'est plus
modifiable — ni par la saisie, ni par un import de la pointeuse, ni par un
changement de paramètres. C'est la seule façon d'empêcher qu'un réglage modifié en
octobre change des heures déjà payées en janvier. Réouverture possible, et tracée.

---

## 3. Nouvelles interfaces de saisie

### Saisie rapide (Présences → *Saisie rapide*)

- Une ligne par salarié, matricule affiché, filtres service / atelier / « non saisis seulement »
- **Clavier** : `P` présent, `A` absent, `C` congé, `M` mission, `Entrée` pour descendre
- **Actions en masse** : cocher plusieurs lignes → Présent / Absent / Congé / Mission
- **Tous présents** aux horaires par défaut, modifiables en haut de l'écran
- **Copier la veille** (remonte jusqu'à 10 jours pour trouver la dernière journée saisie)
- Compteur `saisis / effectif` en permanence, et enregistrement en une seule requête

### Correction sur une plage de dates (fiche du salarié → *Corriger sur une plage de dates*)

- Une ligne par jour sur la période choisie, avec le régime du jour (ouvré / repos / férié / mois clos)
- Édition en ligne de l'entrée, la sortie, les heures et les heures supplémentaires
- **Sélections rapides** : tout / jours ouvrés / absences / à vérifier
- **Appliquer à la sélection** : un statut et un horaire (ou un nombre d'heures) sur tous les jours cochés d'un coup
- Récapitulatif en bas : jours travaillés, heures, heures sup., retards, absences
- Bouton *déprotéger* par journée, qui **conserve désormais les heures saisies à la main**
  (l'ancien « annuler la protection » les supprimait)

Accessible aussi depuis la liste des absences et depuis un signalement de salarié.

### Les alertes mènent à la correction

Chaque ligne de la page *Notifications* — et des quatre alertes du tableau de bord —
est désormais **cliquable** et ouvre directement l'endroit où corriger :

| Alerte | Un clic ouvre |
|---|---|
| Pointage à vérifier | la liste des journées incomplètes ; chaque ligne propose *Corriger* (feuille du jour, **ligne de la personne surlignée**) et *Saisir les heures* (correction sur la plage du jour) |
| Signalements salariés | l'écran *Sécurité & accès*, positionné sur le tableau des signalements |
| Fiches incomplètes | la liste du personnel, **filtre « à compléter » déjà appliqué** |
| Document manquant / Fin de période / Anniversaire | la fiche de la personne concernée |
| Absence injustifiée | la feuille de pointage du jour, sur la ligne de la personne |

Le libellé de l'action apparaît à droite au survol, la ligne est atteignable au
clavier (`Tab` puis `Entrée`), et la ligne visée reste surlignée quelques secondes
le temps qu'on la repère dans le tableau.

Avant, une alerte décrivait le problème mais laissait retrouver soi-même la personne
et la date.

---

## 3 bis. Rémunération : à l'heure ou à la journée, fiche par fiche

Les ouvrières sont payées **à l'heure** suivant la convention, les cadres **à la
journée travaillée**. Jusqu'ici l'application déduisait cette base de la seule
*catégorie*, sans jamais permettre de saisir un prix : `salaire` n'entrait dans
aucun calcul.

**Ce qui est ajouté sur chaque fiche** (bloc *Rémunération*, en création comme en
modification) :

- **Payé(e)** : `À l'heure` ou `À la journée`. Laissé tel quel, le mode continue
  d'être déduit de la catégorie (Cadre → journée) : rien ne change pour les fiches
  existantes.
- **Prix d'une heure (TND)** et **Prix d'une journée (TND)** — seul celui qui
  correspond au mode est utilisé, l'autre est grisé.
- **Salaire mensuel de référence** : information de dossier, n'entre dans aucun calcul.

**Taux par défaut** (Paramètres horaires → *Rémunération*) : un prix de l'heure et un
prix de la journée qui s'appliquent aux fiches sans taux propre. On saisit le taux de
la convention une fois, pas 97 fois. Une fiche avec son propre taux l'emporte toujours.

**Comment la quantité est calculée sur la période affichée :**

| Mode | Quantité | Montant estimé |
|---|---|---|
| À l'heure | heures normales **+** heures supplémentaires | quantité × prix de l'heure |
| À la journée | jours travaillés **+** jours fériés travaillés | quantité × prix de la journée |

Les colonnes **Taux** et **Montant estimé** apparaissent dans *Rapports & paie*
(triables, avec un total en bas), dans le **PDF de paie**, dans le **CSV de paie**
(avec le mode et la quantité) et dans l'export CSV du personnel. La fiche affiche
l'estimation du mois en cours.

> **Ce sont des montants indicatifs** : quantité constatée × taux. Aucune majoration
> légale des heures supplémentaires (+25 / +50 / +75 %), aucune retenue, aucune prime.
> Voir §6 : ce n'est pas encore un bulletin de paie.

---

## 3 ter. Créer et corriger les fiches en masse (modèle Excel)

Saisir 97 fiches une par une dans l'interface prend des heures. Personnel →
**Importer des fiches** ouvre un parcours en trois temps.

**1. Prendre le modèle.** Deux boutons :

- *Modèle vierge* — le classeur avec les 24 colonnes, une ligne d'exemple grisée,
  des **listes déroulantes** (poste, catégorie, service, atelier, contrat, situation,
  niveau, sexe, mode de paie) et un onglet **Notice** qui explique chaque champ.
- *Mes N fiches actuelles* — le même classeur **déjà rempli avec vos fiches**. C'est
  le plus pratique : on complète dans Excel les colonnes qui manquent (mode de paie,
  prix de l'heure, CNSS, dates de naissance…) au lieu de tout retaper.

**2. Renvoyer le fichier rempli** (`.xlsx` ou `.csv`, glisser-déposer accepté).

**3. Lire l'aperçu, puis appliquer.** L'application affiche, **avant toute écriture**,
un tableau ligne par ligne : *à créer*, *à mettre à jour* (avec les champs concernés
nommés en français), *inchangée*, *erreur* (avec le motif). Les lignes en erreur
remontent en tête. Rien n'est écrit tant que vous n'avez pas validé.

**Les trois règles à retenir :**

1. Le **matricule** est la clé de rapprochement — celui du badge sur la pointeuse.
   Déjà connu → la fiche est mise à jour. Inconnu → une fiche est créée, avec son
   accès QR et son code.
2. Une cellule **vide ne change rien**. On peut donc ne remplir qu'une colonne sur
   tout l'effectif. Pour *effacer* un champ, on écrit `-` dans la cellule.
3. **Rien d'autre n'est touché** : aucun pointage, aucun congé, aucun accès QR
   existant, et **aucune fiche n'est supprimée** — les personnes absentes du fichier
   sont laissées telles quelles (elles sont simplement comptées dans l'aperçu).

Détails de tolérance : dates en `JJ/MM/AAAA` ou vraies dates Excel, virgule ou point
décimal, en-têtes acceptés sans tenir compte de la casse, des accents ni de la
ponctuation (`N° CNSS`, `n cnss`, `NCNSS`), synonymes courants reconnus
(`Badge` → Matricule, `GSM` → Téléphone, `Fonction` → Poste), colonnes inconnues
signalées et ignorées, doublons de matricule dans le fichier refusés en nommant la
première ligne fautive, matricule d'une personne démissionnaire signalé avant
recréation. Réservé aux comptes **administrateur** et **RH**.

---

## 3 quater. Pointeuse : réglages et surveillance dans l'application

L'adresse de la pointeuse ne se réglait nulle part dans l'interface : il fallait modifier un
fichier Python sur le PC de l'atelier, ou passer par des variables d'environnement. Un encadré
**« Pointeuse & synchronisation »** apparaît maintenant dans *Sécurité & accès* :

- adresse IP, port, mot de passe de communication, **fréquence de remontée** ;
- **délai d'alerte** : au bout de combien d'heures sans pointage l'application vous prévient ;
- l'**état de la liaison** — dernier pointage reçu, par quelle voie (agent d'usine, lecture
  réseau directe, fichier importé, dossier surveillé), nombre de badges, et le message exact de
  la dernière tentative en échec ;
- un bouton **« Télécharger le kit de l'agent »** (voir 3 quinquies) ;
- un bouton **« Tester et importer maintenant »**, affiché **seulement** si ce serveur peut
  réellement joindre la pointeuse — sur un hébergeur public il ne peut pas, et l'encadré
  l'explique au lieu de proposer un bouton qui échouerait toujours.

**Une nouvelle alerte « Pointeuse muette »** remonte dans les Notifications dès que rien n'est
arrivé depuis le délai fixé, et un clic mène à l'encadré. C'est le signal qui manquait : sur les
données réelles, des journées entières où *tout l'effectif* n'avait qu'un seul badge (87
personnes sur 88 le 14/05/2026) sont passées inaperçues jusqu'à la paie, faute d'être averti que
la remontée s'était arrêtée.

Le dernier contact est enregistré **quelle que soit la voie d'entrée** — c'est ce qui rend
l'alerte fiable. Un chef d'atelier voit l'état de la liaison mais ni l'adresse de l'appareil ni
son mot de passe de communication ; seuls l'administrateur et les RH peuvent modifier les
réglages. La lecture directe continue de refuser toute adresse non locale.

### Correction : le compte de l'agent était refusé (erreur 403)

Le panneau vous demande de créer le compte `agent` en **Chef d'atelier** — c'est le bon
réglage, un compte qui remonte des pointages n'a aucune raison de pouvoir supprimer une fiche
ou imprimer les cartes QR. Mais côté serveur, `/api/punches` et `/api/import-mdb` exigeaient
encore un compte **RH**. L'agent envoyait donc ses pointages, le serveur répondait *403 —
action non autorisée*, et rien ne remontait, sans que rien n'explique pourquoi.

Remonter les pointages est désormais explicitement du ressort du chef d'atelier. Un compte
**Lecture seule** reste refusé, et la suppression de fiches comme l'impression des cartes QR
restent réservées à l'administrateur et aux RH.

**Si vous aviez déjà créé le compte en RH pour contourner le problème**, vous pouvez le
repasser en *Chef d'atelier* (Sécurité & accès → Comptes & rôles) : il aura exactement les
droits nécessaires, et pas plus.

---

## 3 quinquies. L'agent de la pointeuse, refait pour être fiable

La version précédente de l'agent avait trois points faibles, et c'est l'un d'eux qui l'a
empêché de démarrer chez vous :

- il fallait **installer Python, puis des modules** (`pyzk`, `requests`) avec `pip` sur le PC
  de l'atelier — première cause de « rien ne se lance » ;
- il fallait **éditer un fichier Python** à la main pour y mettre l'adresse et un mot de passe ;
- le module `pyzk` abandonnait si le **ping** était filtré sur le réseau, même quand la
  pointeuse répondait parfaitement, et une seule date abîmée dans sa mémoire faisait échouer
  toute la lecture.

Ce qui change :

- **Un kit à télécharger depuis PilotRH** (*Sécurité & accès → Pointeuse*), déjà rempli :
  adresse du serveur et clé d'accès. On l'extrait sur le PC, on double-clique. Rien à éditer.
- **Rien à installer.** Si Python manque, le kit télécharge une version portable dans son propre
  dossier (sans droits administrateur). La lecture de la pointeuse est écrite avec la seule
  bibliothèque standard de Python (`zkproto.py`) : plus de `pyzk`, plus de `pip`.
- **Une clé d'accès propre à l'agent**, qui n'ouvre que l'envoi de pointages — ni les données RH,
  ni les comptes, ni les dossiers. Plus de compte de service à créer ni de rôle à choisir (c'était
  la cause du refus 403 de la version d'avant). « Changer la clé » la révoque aussitôt.
- **Les réglages viennent de PilotRH** : l'adresse de la pointeuse et la fréquence sont
  redemandées à chaque remontée. Les changer ne demande plus d'aller à l'atelier.
- **L'agent rend compte** : PilotRH affiche sur quel PC il tourne, quand il a donné des nouvelles,
  le modèle de la pointeuse, sa dernière panne avec « Que faire », et un **décalage d'horloge**
  de la pointeuse (alerte au-delà de 5 minutes).
- **Il se relance seul** : nouvelle tentative après 2, 5, 10 minutes en cas d'échec ; relance si le
  programme s'arrête ; démarrage automatique avec Windows (un double-clic) ; un seul agent à la
  fois sur un PC.
- **Il n'envoie que ce qui a changé** : l'historique complet une fois par jour, sinon les 60
  derniers jours et seulement s'il y a du nouveau. Les corrections manuelles restent protégées.
- **`DIAGNOSTIC.bat`** vérifie chaque maillon dans l'ordre (PC, configuration, serveur, clé,
  réseau, dialogue avec la pointeuse, horloge), s'arrête au premier qui casse, dit quoi faire,
  et enregistre son compte rendu dans `diagnostic.txt`. Il n'envoie aucun pointage.
- Les fichiers `.bat` sont en fins de ligne Windows et sans accents : les deux défauts qui font
  qu'un `.bat` « s'ouvre et se referme » sans rien dire. Lancé depuis l'intérieur du ZIP, le kit
  le détecte et explique quoi faire au lieu de se fermer.

**Les anciens fichiers** (`pilotrh_agent.py` à la racine, `push_pointeuse.py`,
`installer_agent.bat`, `lancer_agent_pointeuse.bat`, `DIAGNOSTIC_POINTEUSE.bat`,
`diagnostic_pointeuse.py`) sont retirés : supprimez-les du PC de l'atelier et remplacez-les par
le kit.

**Limite honnête** : le dialogue avec la pointeuse est vérifié contre une pointeuse simulée qui
parle le protocole ZKTeco (elle-même validée par la bibliothèque de référence), sur tous les
formats de mémoire connus et sur les pannes courantes — mais pas face à votre appareil, ni les
`.bat` sur un vrai Windows. Si le diagnostic bute sur un cas non prévu, `diagnostic.txt` contient
ce qu'il faut pour corriger.

## 3 sexies. Corrections de pointage en masse

Nouvel écran *Pilotage → Corrections en masse*. Il regroupe par famille et par journée les
pointages anormaux relevés sur vos données réelles :

| Famille | Ce qui est détecté |
|---|---|
| Sortie non badgée | un seul badge dans la journée (la journée compte 0 h) |
| Badges impairs | 3 ou 5 badges : un passage oublié |
| Heures de nuit | un badge avant 05 h 30, ou une première entrée après 20 h |
| Démarrage anticipé | arrivée au moins 30 minutes avant l'horaire prévu |

Une journée où la moitié des présentes ont la même anomalie est marquée **« Collective »** : ce
n'est pas un oubli, c'est la pointeuse ou sa remontée. Le bandeau rappelle de **réimporter un
fichier récent avant de corriger à la main**.

On coche une journée entière (ou une seule personne), on choisit la correction — fixer la sortie
ou l'entrée (à l'heure prévue ce jour-là ou à une heure précise), appliquer l'horaire prévu,
compter un nombre d'heures, marquer absent — puis **« Aperçu »** : nombre de journées, heures
avant / après, ligne par ligne. **Rien n'est écrit avant validation.** Une correction impossible
(une sortie à 16 h 30 pour une entrée badgée à 22 h) n'est pas appliquée et l'aperçu dit pourquoi.

Les journées corrigées sont **protégées des réimports**, tracées dans le journal avec le motif
saisi, et **la dernière correction s'annule** d'un clic (chaque journée retrouve exactement son
état d'avant). Les journées déjà corrigées à la main ne sont plus proposées ; celles d'un mois
clôturé sont listées mais non modifiables.

**Démarrage collectif à 6 h 30** : plutôt que de retoucher 90 lignes, « Horaire exceptionnel… »
déclare l'horaire réellement pratiqué ce jour-là. Toute la journée est recalculée sans toucher à
un seul badge ; l'horaire apparaît dans *Horaires → Périodes*, où on peut le modifier ou le
supprimer. L'arrondi reste appliqué jour par jour, comme avant.

## 3 septies. Suivi de l'assiduité par personne

Nouvel écran *Personnel → Assiduité*. Sur la période choisie (ce mois, 3 mois, 12 mois, ou des
dates libres), pour chaque personne : taux d'absentéisme, absences **injustifiées** et
**justifiées** (couvertes par un justificatif de la vue Absences), retards et minutes perdues,
pointages incomplets, et une colonne par mois. Deux graphiques : absences et retards par mois,
absences selon le jour de la semaine.

- Les fériés, les jours de repos et les congés ne sont pas des absences. Une personne arrivée
  en cours de période n'est comptée qu'à partir de son embauche (ou de sa première présence).
- **Seuils de signalement** réglables (par défaut : 3 retards ou 2 absences injustifiées sur la
  période), avec un filtre « seulement les personnes signalées ».
- Le **détail** d'une personne montre une frise jour par jour et la liste datée des événements,
  signale quand les absences tombent surtout un même jour de la semaine, et mène en un clic à la
  journée concernée.
- Deux exports CSV : la synthèse par personne, et le détail de chaque événement.
- Depuis le détail : **« Questionnaire — retards »** ou **« — absences »** ouvre directement un
  document prérempli avec les dates relevées (voir ci-dessous).

## 3 octies. Dossier disciplinaire et documents en arabe

Nouvel écran *Personnel → Discipline*, et un bloc **Dossier disciplinaire** dans la fiche de
chaque personne. Réservé aux rôles **Administrateur et RH** : le chef d'atelier et la lecture
seule n'y ont pas accès, ni à l'écran ni par le serveur. Ces données ne sont jamais envoyées avec
l'état général de l'application.

**Huit pièces**, chacune avec son modèle en arabe : استجواب (questionnaire, demande
d'explications), لفت نظر (observation), إنذار (avertissement), توبيخ (blâme), قرار إيقاف عن العمل
(mise à pied), تنبيه بوجوب الالتحاق بالعمل (mise en demeure de reprendre le travail), استدعاء
للمثول أمام مجلس التأديب (convocation au conseil de discipline), محضر معاينة (PV de constat).

**Prérempli** : en-tête de la société en arabe et en français, référence (`Q-2026-001`,
`AV-2026-001`…), date en toutes lettres, nom (en arabe si renseigné dans la fiche), matricule,
CIN, poste traduit, accords au féminin ou au masculin (السيدة / السيد, المعنية / المعني), motif
choisi dans une liste de 12, et **les faits relevés dans le pointage** — chaque retard avec sa
date, son jour et l'heure d'arrivée, chaque absence avec sa date. Un avertissement qui fait suite
à un questionnaire le cite, et dit si la réponse a été reçue ou non ; les sanctions déjà remises
sont rappelées ; une mise à pied calcule sa fin et le jour de reprise en sautant les jours non
travaillés.

**Le texte reste à vous** : il est modifiable avant impression, avec un aperçu à côté. Une fois
remis, il est figé avec la pièce — un modèle modifié plus tard ne réécrit pas ce qui a été
signé. Les modèles eux-mêmes se personnalisent (*En-tête et modèles*).

**Le suivi** : brouillon → remis → signé, refus de signer, ou classé sans suite ; date de remise ;
réponse de l'intéressée au questionnaire ; note interne ; « Donner une suite… » prépare la pièce
suivante en reprenant motif et faits. Une pièce remise ne peut être supprimée que par
l'administrateur (on peut la classer sans suite). Chaque action est inscrite au journal d'audit.
Le bloc de la fiche résume les 12 derniers mois et rappelle, par exemple, qu'une sanction sans
questionnaire récent est plus fragile.

À l'impression : format A4, de droite à gauche, zone de réponse manuscrite sur le questionnaire,
signatures de l'intéressée et de la direction, et la mention des deux témoins en cas de refus de
signer.

> **À faire une fois** : renseigner l'en-tête de la société (*En-tête et modèles*), puis faire
> **relire les modèles par votre conseil juridique**. Ce sont des bases de travail rédigées selon
> l'usage courant en Tunisie, pas un avis juridique ; la mise à pied et le conseil de discipline
> obéissent à la convention collective applicable à votre secteur. PilotRH prépare les documents
> et garde l'historique ; il ne décide d'aucune sanction.

## 3 nonies. Espace salarié : « Mes absences et retards »

Dans l'espace salarié (carte QR, application installable et APK), l'onglet *Mon pointage* a une
nouvelle carte **Mes absences et retards**. L'ouvrière choisit **Ce mois**, **Cette année**
(du 1er janvier à aujourd'hui, affichée d'office) ou **Choisir les dates**, et voit :

- ses **jours d'absence**, dont ceux couverts par un justificatif ;
- ses **retards** et le temps total ;
- ses jours travaillés et ses jours de congé ;
- sous « Voir les dates », chaque absence et chaque retard, avec l'heure d'arrivée.

Ce sont **exactement les chiffres de la vue RH *Assiduité*** : les deux écrans utilisent le même
calcul (`bilanAssiduite` dans `pilotrh-core.js`), et un test compare les deux sur les mêmes
données. Les fériés, repos et congés ne sont jamais des absences ; un jour non encore importé ne
devient pas une absence.

Côté sécurité : même protection que le reste de l'espace (jeton de la carte **et** code personnel,
blocage après plusieurs mauvais codes). Elle ne reçoit que ses propres jours ; de ses justificatifs
seulement le type et les dates — **jamais la note du service RH**, qui peut contenir un motif
médical. Période limitée à 400 jours, l'avenir est coupé à aujourd'hui.

Pour un nouvel affichage sur les téléphones qui ont installé l'application, rien à faire : elle
se met à jour d'elle-même à l'ouverture suivante.

## 3 decies. Personnes inscrites sur la pointeuse mais absentes de l'application

Constat : des personnes enregistrées sur la pointeuse n'apparaissaient pas après l'import, et il
fallait les recréer à la main avec leurs pointages. L'import les écartait **sans rien dire**, dans
quatre cas :

| Cas | Avant | Maintenant |
|---|---|---|
| Inscrite sur la pointeuse **sans nom** (seulement un numéro de badge) | tous ses pointages jetés | fiche créée « Badge 207 », à compléter ; pointages importés |
| **Nouvelle recrue** qui n'a badgé qu'un ou deux jours | invisible jusqu'au 3ᵉ jour, ces journées perdues | fiche créée dès le 1ᵉʳ badge, premier jour importé |
| Fiche **créée à la main** avant le 3ᵉ jour de badge | ses pointages n'arrivaient pas | ils arrivent dès le premier jour |
| **Badge redonné** à une recrue après une démission | bloqué pour toujours | signalé, la fiche se crée en un clic |
| « 0412 » dans la fiche, « 412 » sur la pointeuse | une seconde fiche en double | reconnues comme la même personne |

Ce qui change aussi :

- La fiche créée par l'import prend comme date d'embauche le **premier jour badgé** (et non la
  date de l'import), et la personne n'est plus marquée « absente » sur les jours d'avant son
  arrivée.
- **Rapport d'import** : après un import `.mdb`, une fenêtre liste les fiches créées (« Compléter
  la fiche → ») et les badges qui pointent sans être importés, avec la raison en clair. Le même
  rapport est dans *Sécurité & accès → Pointeuse* pour les imports faits par l'agent.
- **Deux alertes** : « Badges non importés » et « Nouvelles fiches à compléter ».
- **« Créer la fiche »** pour un badge redonné : la fiche est créée tout de suite, le badge est
  retiré de la liste des sorties, et ses pointages arrivent au prochain passage de l'agent. Rien à
  ressaisir à la main.
- Une démission est désormais **datée** : c'est ce qui permet de reconnaître un badge qui badge
  encore après le départ de sa titulaire. Une démission reste respectée : le badge n'est jamais
  réintégré d'office, seulement signalé.
- Restent écartés, et comptés dans le rapport : le badge n° 0 (test), et les anciens badges sans
  aucun pointage depuis 5 mois et sans fiche (personnes parties).

À faire une fois après la mise à jour : lancer un import (ou attendre le passage de l'agent),
puis ouvrir le rapport : les personnes jusqu'ici invisibles y apparaissent. **Vérifiez les fiches
que vous aviez créées à la main** : si leur matricule est bien le numéro de badge, leurs pointages
s'y rattachent ; sinon, corrigez le matricule pour éviter une seconde fiche.

---

## 4. Notes de service, sondages, application installable

### Notes de service
Écran **Sécurité & accès → Ouvrir la messagerie**. Rédigez une note, ciblez tout le
personnel ou un service / atelier / catégorie, avec une date de fin de visibilité et
un marqueur « important ». Chaque salarié la voit dans son espace QR, onglet
**Notes**, et l'ouverture vaut **accusé de lecture** : vous voyez qui a lu, qui n'a
pas lu, avec export CSV.

### Sondages
Même écran, onglet **Sondages**. Question + 2 à 8 réponses, ciblage identique,
mode anonyme (totaux seulement) ou nominatif. Un seul vote par personne, résultats
en direct, clôture manuelle, export CSV.

### Un vote de salariée ne partait pas — corrigé

**Symptôme :** une ouvrière répond à un sondage depuis son espace, un message
« non connecté » s'affiche, et la réponse n'arrive jamais côté RH.

**Cause :** les deux endpoints de l'espace salarié `/api/me/vote` (répondre à un
sondage) et `/api/me/lu` (accusé de lecture d'une note) n'avaient pas été ajoutés à
la liste des chemins publics. Le portier d'authentification les bloquait donc avant
même d'atteindre le code, avec un `401 non_connecte` — alors que ces deux endpoints
vérifient eux-mêmes le jeton de la carte QR et n'ont pas besoin de session RH.

Les **accusés de lecture des notes de service** étaient touchés par le même oubli :
la colonne « lu par » restait donc vide quoi qu'il arrive.

**Pourquoi les tests ne l'avaient pas vu :** ils appelaient les fonctions
directement, sans traverser le portier. Trois garde-fous ont été ajoutés, en plus du
correctif :

1. un test **énumère les routes réellement déclarées** et refuse tout `/api/me/...`
   absent de la liste publique — l'oubli ne peut plus se reproduire pour un futur
   endpoint ;
2. le **portier lui-même est maintenant exercé** dans les tests (18 cas : ce qui doit
   passer sans session, ce qui doit rester fermé, ce qu'un compte en lecture seule
   peut faire) ;
3. le faux serveur des tests de navigateur applique **la même règle publique** que le
   vrai : il répondait « ok » à tout, ce qui masquait le problème.

Et côté ouvrière, les messages techniques sont désormais **traduits** : `non_connecte`
devenait un bandeau incompréhensible ; elle lit maintenant « Votre accès n'a pas été
reconnu. Rescannez votre carte QR… », et une coupure réseau dit « Pas de réseau »
au lieu d'une erreur brute.

### Application installable (le « Android » sans passer par le Play Store)
L'espace salarié est maintenant une application installable. La salariée scanne son
QR **une fois**, une invitation « Installer l'application » s'affiche, et elle obtient
une icône PilotRH sur son écran d'accueil. Ensuite :

- plus besoin de rescanner le QR (le jeton est mémorisé sur l'appareil)
- démarrage instantané même avec un réseau d'usine médiocre
- mises à jour automatiques, aucune réinstallation

Le jeton **n'apparaît plus dans l'adresse** : il est retiré de l'URL dès la première
ouverture, et le code passe désormais dans le corps de la requête. Il ne finit donc
plus dans les journaux du serveur ni dans l'historique d'un téléphone partagé.

**Un bogue corrigé au passage, et il n'était pas mineur.** Le service worker — le
composant qui rend l'application installable et permet le démarrage hors ligne —
était servi depuis `/assets/sw.js`. Or la portée d'un service worker est limitée au
dossier d'où il est téléchargé : depuis `/assets/`, il n'avait **aucune autorité sur
`/moi`**. L'espace salarié ne démarrait donc pas sans réseau, alors que c'était
annoncé, et Android refusait souvent de proposer « Ajouter à l'écran d'accueil ».
Il est désormais servi depuis la racine (`/sw.js`, en-tête `Service-Worker-Allowed: /`),
le manifeste depuis `/manifest.webmanifest`, et l'ancien enregistrement resté sur les
téléphones déjà équipés est supprimé automatiquement à la première ouverture.

Deux ajouts pour le réseau de l'atelier, qui tombe régulièrement : un **bandeau
rouge « Pas de réseau »** en haut de l'écran, et le rechargement automatique dès que
la connexion revient. Sur **iPhone**, le geste à faire est expliqué (Partager → « Sur
l'écran d'accueil »), parce qu'iOS ne propose jamais l'installation de lui-même.

### Messagerie : écrire à une seule personne, et recevoir une réponse

Les notes de service ne partaient qu'à un groupe (tout le personnel, un service,
un atelier) et personne ne pouvait répondre. C'était un panneau d'affichage, pas une
messagerie. Deux ajouts :

- **Écrire à une seule ouvrière** : une liste déroulante « Une seule personne » en tête
  du ciblage. La choisir désactive les filtres de groupe, pour qu'il n'y ait aucun doute
  sur qui recevra le message. Côté salariée, il porte la mention **« pour vous »**.
- **La salariée peut répondre** : sous chaque message, un champ de réponse. Ses réponses
  s'affichent en bulles dans sa conversation, et remontent côté RH sous le message, avec
  son matricule, son nom et l'heure — les non lues sont mises en avant.

Une précaution importante : sur un message envoyé à tout l'atelier, **chaque salariée ne
voit que ses propres réponses**. Sans cela, une remarque personnelle (« je serai absente
ce jour-là ») deviendrait publique devant ses collègues. Le service RH, lui, voit tout.
Le nombre de réponses par personne et par message est plafonné à 20.

### Notifications sur le téléphone — son, vibration, et une conversation qui s'ouvre

L'application Android sait maintenant **prévenir la salariée** quand le service RH lui
écrit, et un écran de réglages en français lui laisse choisir :

- **activer ou non** les notifications ;
- le **son** : silencieux, son par défaut, sonnerie, alarme — chaque choix est **joué
  immédiatement** pour qu'elle entende avant de valider ;
- la **vibration**, essayée elle aussi au moment du choix ;
- la **fréquence de vérification** (15 min à 4 h) ;
- une plage **« ne pas déranger »** (la nuit, par exemple), qui sait passer minuit ;
- une **notification d'essai**, et un accès direct aux réglages Android de l'application.

Un clic sur la notification ouvre **directement la conversation**, pas l'écran du
pointage. La notification s'efface dès que les messages sont lus.

**Comment c'est fait, et ce que cela implique.** Une notification « poussée » à la
seconde, comme WhatsApp, passe obligatoirement par les serveurs de Google (Firebase) :
compte Google, clé de serveur, services Google Play sur chaque téléphone, et vos messages
qui transitent par un tiers. J'ai choisi l'autre voie : l'application **demande** au
serveur, toutes les 30 minutes par défaut, s'il y a du nouveau — via un point d'appel
volontairement minuscule (`/api/me/nouveautes`) qui ne renvoie ni pointage ni heures.
Aucune dépendance, aucun tiers, mais **le message arrive au prochain réveil, pas dans la
seconde**. Android impose d'ailleurs un minimum d'environ 15 minutes pour préserver la
batterie. Si vous voulez l'instantanéité un jour, il faudra passer par Firebase — c'est
un projet distinct.

Deux détails techniques qui ont dicté la conception : depuis Android 8, **le son et la
vibration appartiennent au canal de notification**, et un canal créé ne peut plus être
modifié par l'application. Changer de son revient donc à créer un nouveau canal — c'est
ce que fait l'application, en supprimant les anciens pour ne pas encombrer les réglages
du téléphone. Et sans le receveur `BOOT_COMPLETED`, les notifications s'arrêtaient
silencieusement après un redémarrage.

Le jeton personnel nécessaire à la vérification est **lu depuis la page** (`localStorage`)
plutôt que par une passerelle JavaScript : aucune page web ne peut ainsi atteindre quoi
que ce soit de l'application.

### Fichier APK — projet livré, prêt à compiler

Un vrai projet Android accompagne maintenant cette version, dans `android/`. C'est
une coquille autour de `/moi` : **aucune bibliothèque externe** (pas d'AndroidX, pas
de Kotlin), un fichier de quelques dizaines de kilo-octets, deux permissions
seulement (Internet, état du réseau) — ni caméra, ni contacts, ni position. Android 6
et plus, soit tout le parc encore en service.

Ce que l'APK apporte par rapport à la PWA :

- **le scan de la carte QR ouvre directement l'application**, qui mémorise le jeton ;
- une icône installée par un fichier que vous distribuez vous-même (WhatsApp,
  Bluetooth, clé USB), sans que l'ouvrière ait à trouver un menu de navigateur ;
- un écran d'erreur en français qui distingue « pas de réseau » de « le serveur ne
  répond pas », avec un bouton *Réessayer* ;
- un menu ⋯ discret : Rafraîchir · Changer l'adresse du serveur · Ouvrir l'espace RH ·
  **Effacer mon accès** (quand un téléphone change de main) ;
- il fonctionne sur une installation **locale en http**, là où une PWA ne s'installe
  pas (un service worker exige https).

L'adresse du serveur est demandée **une seule fois** au premier démarrage : la même
application sert pour une installation hébergée et pour l'ordinateur de l'atelier.

**Le fichier `.apk` lui-même n'est pas fourni** : sa compilation exige le SDK Android
de Google (plus d'un gigaoctet). Le projet est livré prêt à compiler, avec une recette
GitHub Actions (`.github/workflows/apk.yml`) qui le construit **dans le cloud,
gratuitement, en 3 à 5 minutes**, sans rien installer sur votre PC — vous renseignez
votre domaine au lancement et vous téléchargez le fichier. Android Studio marche aussi.
Tout est détaillé dans **ANDROID_ET_PWA.md**, y compris la signature pour le Play Store.

Ce qui reste hors périmètre : les **notifications push** (elles demandent un service
de messagerie Firebase et une décision sur ce qu'on notifie) et un **lecteur QR
intégré** à l'application — inutile ici, puisque le scan avec l'appareil photo ouvre
déjà l'application.

---

## 5. Fiabilité, sécurité, performance

### Plus de perte de données silencieuse
Tous les enregistrements finissaient par `.catch(()=>{})` : une coupure réseau, un
refus « lecture seule » ou une erreur serveur laissaient l'écran afficher une
correction **jamais enregistrée**. Désormais toute écriture qui échoue est conservée
dans une file, signalée par un bandeau rouge permanent, et réessayable en un clic.
Fermer l'onglet avec des modifications en attente demande confirmation.

De même, un échec de chargement ne vide plus la base en mémoire : un écran d'erreur
explicite bloque toute écriture, pour éviter d'écraser vos vraies données par un état vide.

### Base de données
`journal_mode=WAL`, `busy_timeout`, **un seul verrou d'écriture** autour de toute
séquence lire-modifier-écrire, index sur `pointage(emp, d)` et sur `audit(ts)`,
migration exécutée une seule fois au démarrage. Vérifié par test : 8 écrivains
simultanés × 25 jours, aucune perte ; 6 × 12 écritures sur la fiche, aucune perte.
Avant, deux postes RH simultanés s'écrasaient mutuellement.

### Sauvegardes
L'interface annonçait « Sauvegarde auto quotidienne » — **aucune ligne de code ne
l'implémentait**. Maintenant : `sqlite3.backup()` (copie cohérente même pendant les
écritures), rotation sur 30 fichiers, dans `data/backups/`, plus un bouton
*Sauvegarder maintenant* et l'état visible dans l'écran d'administration.

> **Reste à faire de votre côté :** une copie **hors du serveur**. Un volume Railway
> perdu emporte aussi ses sauvegardes. Prévoyez une récupération périodique vers
> un stockage externe.

### Performance
`/api/state` renvoyait **tout l'historique** — environ 7 Mo pour 100 salariés sur
3 ans, 13 Mo pour 200 — à chaque ouverture de l'application. Il ne renvoie plus
qu'une fenêtre de 70 jours ; le reste est chargé à la demande selon l'écran affiché.
Chaque appel de l'espace salarié déclenchait **deux balayages complets** de la table
des pointages : l'index y met fin. La vue Absences calculait deux fois 200 jours
d'historique par personne à chaque frappe dans la recherche.

Chart.js venait d'un CDN : sans Internet tous les graphiques disparaissaient
silencieusement (contradictoire avec le mode local « sans Internet »), et un CDN
compromis exécutait du code dans la session administrateur. Les graphiques sont
maintenant dessinés en SVG par l'application, sans aucun script tiers.

### Failles corrigées au passage
Ces corrections tombaient sous la main en réécrivant les fichiers concernés :

- **`/api/state` livrait `_secret`** — la clé HMAC qui signe les cookies — **et les
  empreintes de mots de passe**. Un compte « Lecture seule » pouvait forger un
  cookie administrateur en deux minutes, sans laisser de trace.
- **`POST /api/state-meta` acceptait la clé `users`** : un chef d'atelier pouvait
  s'octroyer le rôle admin et supprimer tous les comptes au passage.
- **Porte dérobée `ADMIN_PW`** : `Authorization: Basic n'importe:<mot de passe>`
  donnait le rôle admin, **en ignorant l'identifiant**, et survivait au changement
  de mot de passe dans l'interface.
- **XSS stockée** déclenchable **sans authentification** depuis l'espace salarié, et
  aussi par le nom d'une employée (champ libre sur la pointeuse). Il n'y avait
  **aucune fonction d'échappement** dans tout le front. Tout est échappé, et le nom
  hostile est vérifié par test automatisé.
- **`/photos/` public** avec des noms séquentiels : tout le trombinoscope était
  téléchargeable sans compte.
- **`/api/qr-codes.pdf` ouvert à tous les rôles** : un seul appel exfiltrait jeton +
  code de chaque salariée. Restreint aux RH, et **le code n'est plus imprimé sur la
  carte** (QR et code sur le même support ne font pas deux facteurs — une photo
  suffisait). Une liste séparée des codes est disponible pour remise en main propre.
- **Code à 4 chiffres sans anti-force brute**, tiré avec `random` : 10 000 requêtes
  suffisaient. Désormais 6 chiffres tirés avec `secrets`, blocage exponentiel.
  *Les codes à 4 chiffres déjà distribués restent valides* — les cartes imprimées
  continuent de fonctionner.
- **Écriture de fichier arbitraire** sous Windows via `/api/employee/{id}/photo`
  (`..\..\..\Windows\Temp\evil`), en mode local **sans authentification**.
- **SSRF** : `/api/pull-device` faisait contacter par le serveur n'importe quelle
  adresse et n'importe quel port. Restreint aux adresses privées, port 4370.
- **`/api/ai` était un proxy Anthropic ouvert** sans quota : facture arbitraire.
- **Balisage ReportLab non échappé** dans les PDF (`<img src="…"/>` était interprété).
- **Journal d'audit falsifiable** : l'auteur était déclaré par le client. Il vient
  maintenant de la session, avec le rôle et l'adresse IP, et les connexions,
  déconnexions et échecs sont journalisés.
- **Aucun moyen de révoquer l'accès d'une salariée** sans éditer la base à la main :
  bouton *Régénérer le QR et le code* sur sa fiche.
- **Conteneur en root**, pas de `.dockerignore`, pas de fuseau horaire, dépendances
  de mi-2024 avec des dénis de service multipart connus.

Le hachage des mots de passe passe de 100 000 à 210 000 itérations PBKDF2. Les
empreintes existantes **restent acceptées** (l'ancien format est reconnu) et sont
réenregistrées au format renforcé à la première connexion réussie de chaque
utilisateur — personne n'a à changer son mot de passe.

> **Non traité, et volontairement :** le remplacement du modèle d'autorisation
> « préfixe d'URL » par un contrôle explicite par route. Le modèle actuel autorise
> par défaut tout ce qui n'est pas listé, ce qui est fragile pour l'avenir. Les
> endpoints existants sont couverts, mais toute route ajoutée demain sera ouverte
> par défaut. À reprendre.

---

## 6. Ce qui reste à faire pour une paie conforme

Ces points n'ont pas été traités — ils demandent des décisions de votre part sur les
règles à appliquer.

1. **Majoration légale des heures supplémentaires.** Le Code du travail tunisien
   distingue le régime 48 h (**+75 %**) et les régimes inférieurs (**+25 %** jusqu'à
   48 h, puis **+50 %**). Aujourd'hui les heures sup. sont calculées **par jour** et
   agrégées en un total indifférencié : il n'existe **aucun seuil hebdomadaire de
   48 h**, donc aucune heure ne peut être qualifiée légalement.
2. **Travail de nuit** (21 h – 6 h) : non tracé, et le shift de nuit reste incalculable
   (les badges sont triés en minutes de journée, une prise de poste à 20:00 pour une
   sortie à 04:00 est lue à l'envers).
3. **Le calcul monétaire s'arrête à « quantité × taux ».** Le prix de l'heure et
   celui de la journée sont maintenant saisissables et un montant estimé figure dans
   les rapports (voir §3 bis), mais il n'y a toujours ni majoration légale des heures
   supplémentaires, ni retenue pour absence ou retard, ni IRPP/CSS, ni primes
   (présence, transport, panier, rendement), ni acomptes, ni bulletin de paie.
4. **CNSS** : le champ numéro d'affiliation existe maintenant sur la fiche, mais il
   n'y a ni déclaration trimestrielle ni état des salaires bruts.
5. **Solde de congés** : `congesDu / congesAu / congesCoef` n'alimentent que l'espace
   salarié. Pas d'état « acquis / pris / restants » côté RH, ni de modélisation du
   droit légal tunisien.
6. **Export XLSX** : les exports de rapports restent en CSV. Le format XLSX n'est
   utilisé que dans un sens, pour le modèle de fiches du personnel (§3 ter).

---

## 7. Structure des fichiers

```
android/                        projet Android prêt à compiler (voir ANDROID_ET_PWA.md)
.github/workflows/apk.yml       fabrique le fichier .apk sur GitHub, gratuitement
demo/                           deux fichiers HTML autonomes (voir §0)
outils/faire_demo.py            régénère ces fichiers depuis le code réel
outils/integrer_sauvegarde.py   reprend une sauvegarde de l'ancienne version
app.py                          serveur (FastAPI + SQLite)
docker-entrypoint.sh            droits du volume puis abandon des privilèges root
reinit_admin.py                 dépannage : réinitialise un mot de passe hors ligne
mdb_import.py                   lecture .mdb + calendrier (fériés, repos, clôture)
fiches_import.py                modèle Excel des fiches + relecture (création / mise à jour)
zkproto.py                      dialogue avec la pointeuse (port 4370), sans aucun module à installer
agent_usine/                    kit de l'agent (servi tel quel par « Télécharger le kit »)
outils/faire_bat.py             régénère les .bat du kit (fins de ligne Windows, sans accents)
static/index.html               coquille de l'interface RH
static/moi.html                 espace salarié (installable)
static/login.html               connexion
static/assets/
  pilotrh-core.js               MOTEUR DE CALCUL — partagé RH / espace salarié
  pilotrh-ui.css                styles
  pilotrh-app.js                état, réseau fiable, chargement fenêtré, présences
  pilotrh-views.js              rapports, personnel, absences, congés, RSE, IA
  pilotrh-saisie.js             saisie rapide, correction par plage, import, réglages, pointeuse
  pilotrh-coms.js               notes de service et sondages
  pilotrh-suivi.js              assiduité par personne, corrections en masse
  pilotrh-discipline.js         dossiers disciplinaires, documents en arabe
  sw.js, manifest.webmanifest   application installable (servis depuis / , voir §4)
```

Le calcul des heures était **dupliqué** entre l'interface RH et l'espace salarié, et
les deux copies avaient déjà divergé : une ouvrière pouvait lire un nombre d'heures
différent de celui transmis au comptable. Il n'existe plus qu'une implémentation,
dans `pilotrh-core.js`.

---

## 8. Tests

**1 461 tests automatisés** accompagnent cette version (dont 14 qui ne tournent qu'avec votre propre sauvegarde) :

| Suite | Nombre | Ce qu'elle vérifie |
|---|---|---|
| Moteur de calcul (`node`) | 84 | pause partielle, fériés, repos travaillé, badge unique, `hM`/`hsM`, arrondi cumul vs jour, Ramadan, échappement, **mode de paie et taux (heure / journée, repli sur le taux par défaut)**, **bilan d'assiduité d'une personne** (justificatifs, jour non importé, date d'embauche, férié) |
| Import et calendrier (`python`) | 55 | correction du sexe, protections anti-écrasement, fériés, mois clos, collision d'identifiants, démissions, **personnes de la pointeuse jamais écartées en silence** : inscrite sans nom, recrue d'un seul jour, fiche saisie à la main, zéros en tête, badge redonné après une démission, badge 0, anciens badges, fichier `.mdb` avec un nom vide |
| Serveur (`python`) | 392 | fuite de `_secret`, élévation de privilèges, écritures concurrentes, sauvegardes, sondages, anti-force brute, SSRF, audit, modèle de fiches et import en masse, le portier d'authentification exercé pour de vrai, **messagerie (message personnel, réponse, cloisonnement des réponses entre collègues, appel léger de l'application)**, **réglages et surveillance de la pointeuse** (bornes des valeurs, rôles, silence détecté), **clé de l'agent** (n'ouvre que l'envoi de pointages, révocable), **kit téléchargeable** (contenu, fins de ligne), **rapport de l'agent**, lecture directe sans `pyzk`, **dossiers disciplinaires** (accès refusé au chef d'atelier et à la lecture seule, numérotation, suppression, audit, jamais dans l'état général), **« mes absences et retards »** (jeton + code, code d'une collègue refusé, ses seuls jours, note RH jamais transmise, bornes de période, anti-force brute), **rapport d'import** (fiches créées, badges écartés, date de sortie, « Créer la fiche » puis rattachement des pointages sans doublon, rôles) |
| Import de fiches (`python`) | 82 | en-têtes tolérants, dates et nombres, listes de référence, doublons, cellule vide sans effet, `-` qui efface, aller-retour du classeur prérempli sans aucun changement, 120 fiches |
| Interface (navigateur réel) | 207 | XSS avec un nom hostile, filtres et tri, saisie rapide, correction par plage, graphiques sans CDN, menu mobile, espace salarié, alertes cliquables jusqu'à la ligne surlignée, saisie du taux, colonnes Taux / Montant, import de fiches, vote d'une salariée suivi jusqu'à sa remontée côté RH, **panneau de la pointeuse : kit, état de l'agent, dernière panne, horloge décalée**, **espace salarié : absences et retards par mois, année ou dates choisies, mêmes chiffres que la vue RH, affichage téléphone**, **rapport d'import et alertes « badges non importés » / « nouvelles fiches »** |
| Données réelles (`file://`) | 14 | reprise d'une sauvegarde de l'ancienne version : effectif, réglages, périodes, plages de pause, totaux de paie |
| Démonstration hors ligne (`file://`) | 65 | ouverture sans serveur, modification réelle des données, saisie rapide, correction par plage, messagerie, export CSV, mobile, espace salarié, **alertes cliquables**, **assiduité, corrections, document arabe hors ligne** |
| Arrondi (`node`) | 18 | écart entre arrondi par jour et arrondi sur le cumul, sur des arrivées réalistes |
| Application Android (`python` + `javac`) | 80 | le projet compile réellement, aucune permission superflue, aucune adresse codée en dur, normalisation de l'adresse du serveur, **notifications : canal par son et vibration, plage « ne pas déranger » qui passe minuit, réveil inexact, pas de renotification en boucle, aucune passerelle JavaScript exposée** |
| Agent de la pointeuse (`python`) | 109 | l'agent **réellement lancé** face à une fausse pointeuse et à un faux serveur : premier envoi complet, rien de renvoyé sans nouveauté, journée envoyée entière, badge en attente renvoyé après une panne serveur, chaque panne nommée à l'écran **et** remontée à PilotRH (pointeuse injoignable, mot de passe de communication, clé refusée, serveur absent, adresse fausse, serveur non mis à jour, page qui n'est pas PilotRH), diagnostic pas à pas sans aucun envoi, méthode `.mdb`, un seul agent à la fois, console Windows en vieille page de code, **les `.bat` : fins de ligne Windows, ASCII pur, chaque `goto` a son étiquette** |
| Dialogue avec la pointeuse (`python`) | 77 | `zkproto.py` contre une pointeuse simulée **elle-même validée par la bibliothèque de référence `pyzk`** : les 6 formats de mémoire, 110 000 badgeages, réseau lent qui découpe les réponses, petite mémoire en un bloc, pointeuse vide, ancien modèle sans tampon, UDP seul, mot de passe de communication (calcul identique à `pyzk`), date impossible ignorée sans tout bloquer, pannes nommées (port fermé, appareil muet, coupure en plein transfert, autre appareil à l'adresse), bibliothèque standard seule |
| Assiduité, corrections, discipline (navigateur réel) | 182 | **calculs vérifiés sur des données faites à la main** (tolérance, justificatifs, congés, arrivée en cours de période, taux), détection des quatre familles et du caractère collectif, **chaque règle de correction cas par cas** (dont les refus), documents arabes (accords, pluriels, antécédents, suite d'un questionnaire avec ou sans réponse, fin de mise à pied qui saute le dimanche, échappement), puis les écrans : de l'assiduité au questionnaire prérempli, suite en avertissement, **ce qui part réellement vers le serveur** à la validation, annulation exacte, horaire exceptionnel d'un jour, mois clos, rôles |
| Reprise d'une sauvegarde (`python`) | 26 | séparation des identifiants dupliqués, **révocation des accès des deux fiches concernées et conservation de toutes les autres cartes**, réglages complétés sans être modifiés |
| Déploiement en conteneur (`python` + `sh`) | 36 | résolution du dossier de données, message d'erreur utile sur un volume non accessible, **le script d'entrée est réellement lancé** : droits du volume ajustés puis privilèges lâchés, uvicorn en utilisateur non root |
| Mots de passe et dépannage (`python`) | 34 | compatibilité des empreintes de la v2, renforcement transparent, réinitialisation par variable et par script, **une carte QR de la v2 avec son code à 4 chiffres ouvre encore l'espace salarié**, ancien appel `GET` toléré |

Points vérifiés qui méritent d'être signalés : un nom d'employée contenant
`<img src=x onerror=...>` — cas réaliste, le nom vient d'un champ libre sur la
pointeuse — est affiché comme du texte et n'exécute rien ; et l'écart d'arrondi
entre le mode « par jour » et le mode « cumul » est mesuré à **3 heures sur 26 jours**
avec un pas de 15 minutes.


---

## Annexe A — l'arrondi, avec des chiffres

Tous les nombres de cette annexe sont produits par le moteur de calcul de PilotRH.
Le simulateur `demo/PilotRH_arrondi.html` permet de les refaire avec vos propres
réglages.

### Le mécanisme

Arrondir **chaque journée**, c'est faire 26 arrondis dans un mois : leurs erreurs
**s'additionnent**. Arrondir **le cumul**, c'est un seul arrondi : l'erreur reste
inférieure au pas d'arrondi, quel que soit le nombre de jours.

Un point à garder en tête : les heures normales s'arrêtent à l'heure de fin de poste.
Ce sont donc les **minutes d'arrivée** qui font varier le total des heures normales,
et l'heure de sortie qui fait varier les heures supplémentaires. Une ouvrière qui
badge à 07:37 pour un poste 07:30 → 16:30 avec 30 minutes de pause a travaillé
**8 h 23**, pas 8 h 30.

### Exemple 1 — arrivée à 07:37, pas de 15 minutes, au plus proche

| | Par jour | Sur 26 jours |
|---|---|---|
| Travail réel | 8 h 23 (503 min) | **217 h 58** |
| Arrondi à la journée | 8 h 30 (510 min) → **+7 min** | **221 h 00** (+3 h 02) |
| Arrondi sur le cumul | — | **218 h 00** (+0 h 02) |

Chaque jour ajoute 7 minutes non travaillées, **toujours dans le même sens**. Au bout
du mois, l'usine paie 3 heures qui n'ont pas été faites. Le même arrondi appliqué au
cumul se trompe de 2 minutes.

### Exemple 2 — arrivée à 07:38, soit une minute plus tard

| | Par jour | Sur 26 jours |
|---|---|---|
| Travail réel | 8 h 22 (502 min) | **217 h 32** |
| Arrondi à la journée | 8 h 15 (495 min) → **−7 min** | **214 h 30** (−3 h 02) |
| Arrondi sur le cumul | — | **217 h 30** (−0 h 02) |

502 minutes s'arrondissent vers le bas, 503 vers le haut. **Une minute de badge fait
basculer le mois de 3 heures dans l'autre sens.**

### Ce que ça donne côté bulletins

Deux ouvrières, un pas de 15 minutes au plus proche :

| | Badge | Travail réel du mois | Payé, arrondi par jour | Payé, arrondi sur le cumul |
|---|---|---|---|---|
| Amal | 07:37 | 217 h 58 | **221 h 00** | 218 h 00 |
| Sonia | 07:38 | 217 h 32 | **214 h 30** | 217 h 30 |
| **Écart** | 1 min | **26 minutes** | **6 h 30** | **0 h 30** |

Elles ont travaillé à 26 minutes près. L'arrondi par journée creuse un écart de
**6 h 30** entre leurs bulletins. C'est le genre d'écart qu'une ouvrière remarque en
comparant sa fiche avec sa voisine, et qu'on ne sait pas justifier.

### Exemple 3 — « à l'inférieur », le réglage le plus risqué

Arrivée à 07:31, soit **une minute de retard**, pas de 15 minutes à l'inférieur :

| | Par jour | Sur 26 jours |
|---|---|---|
| Travail réel | 8 h 29 (509 min) | **220 h 34** |
| Arrondi à la journée | 8 h 15 (495 min) → **−14 min** | **214 h 30** (−6 h 04) |
| Arrondi sur le cumul | — | **220 h 30** (−0 h 04) |

Une minute de retard coûte 14 minutes de salaire, chaque jour. À l'inférieur appliqué
à la journée se trompe **toujours** au détriment du personnel : c'est exactement ce
qu'un contrôle de l'inspection du travail cherche.

### Exemple 4 — le problème vaut aussi pour les heures supplémentaires

Sortie à 18:07 pour un poste finissant à 16:30 : 1 h 37 d'heures supplémentaires.

| | Par jour | Sur 26 jours |
|---|---|---|
| Réel | 1 h 37 (97 min) | **42 h 02** |
| Arrondi à la journée | 1 h 30 (90 min) → **−7 min** | **39 h 00** (−3 h 02) |
| Arrondi sur le cumul | — | **42 h 00** (−0 h 02) |

3 heures supplémentaires effectuées et non payées dans le mois.

### Pourquoi ça touche surtout les plus régulières

Quand les minutes d'arrivée **varient** au hasard, les erreurs changent de signe et se
compensent en partie. Sur un mois d'arrivées dispersées entre 07:26 et 07:55 :

| Réglage | Réel | Arrondi par jour | Arrondi sur le cumul | Écart entre les deux |
|---|---|---|---|---|
| 15 min, au plus proche | 217 h 48 | 218 h 15 (+0 h 27) | 217 h 45 (−0 h 03) | **0 h 30** |
| 15 min, à l'inférieur | 217 h 48 | 215 h 00 (−2 h 48) | 217 h 45 (−0 h 03) | **2 h 45** |
| 30 min, au plus proche | 217 h 48 | 219 h 00 (+1 h 12) | 218 h 00 (+0 h 12) | **1 h 00** |
| 30 min, à l'inférieur | 217 h 48 | 211 h 00 (−6 h 48) | 217 h 30 (−0 h 18) | **6 h 30** |

Mais une ouvrière qui prend le même bus arrive à la même minute tous les jours : ses
erreurs vont **toutes dans le même sens** et atteignent le maximum théorique. Autrement
dit, l'arrondi journalier pénalise ou avantage le plus fortement **les personnes les
plus régulières** — l'inverse de ce qu'on veut.

### Plafond de l'erreur, par personne et par mois (26 jours)

| Réglage | Erreur max/jour | Arrondi par jour | Arrondi sur le cumul |
|---|---|---|---|
| 5 min, au plus proche | 2,5 min | jusqu'à **1 h 05** | au maximum 0 h 03 |
| 15 min, au plus proche | 7,5 min | jusqu'à **3 h 15** | au maximum 0 h 08 |
| 15 min, à l'inférieur | 14 min | jusqu'à **6 h 04** | au maximum 0 h 14 |
| 30 min, au plus proche | 15 min | jusqu'à **6 h 30** | au maximum 0 h 15 |
| 30 min, à l'inférieur | 29 min | jusqu'à **12 h 34** | au maximum 0 h 29 |

Le plafond de la colonne « par jour » **grandit avec le nombre de jours**. Celui de la
colonne « sur le cumul » ne bouge jamais.

### À l'échelle de l'atelier

Avec 86 personnes régulières et un pas de 15 minutes au plus proche, l'écart peut
atteindre 3 h 15 par personne, soit environ **280 heures par mois** et **3 350 heures
par an** pour l'usine. Ce n'est plus une imprécision d'arrondi, c'est un poste de charge.

### Réglage conseillé

Arrondi **sur le cumul de la période**, au plus proche, pas de 15 minutes — ou pas
d'arrondi du tout, ce qui est encore plus simple à expliquer et à défendre. C'est le
défaut de PilotRH v3, dans **Présences → engrenage → Calcul**. Le mode « chaque
journée » reste disponible si une convention l'impose, mais il est signalé dans
l'interface et mentionné sur tous les exports.
