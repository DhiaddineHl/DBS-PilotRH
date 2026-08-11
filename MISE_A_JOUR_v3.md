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
3. **complète les réglages** — jours fériés, portée de l'arrondi, plage de pause —
   **sans modifier aucune de vos valeurs existantes**.

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
correctement. Son accès à l'espace salarié est retiré au passage (l'ancien QR pointait
vers l'historique de l'autre personne) : régénérez-lui un QR depuis sa fiche.

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

### 1.4 Vérifier que le volume est bien monté

Le volume Railway **doit** être monté sur `/app/data`. Sinon tout est perdu à chaque
redéploiement : effectif, historique, comptes, jetons — et **toutes les cartes QR
imprimées deviennent invalides**. Vérifiez après déploiement :

```
GET /api/health/detail   →  {"data_dir":"/app/data", "sauvegardes":1, ...}
```

### 1.5 Créer un compte de service pour l'agent d'usine

L'agent ne doit plus utiliser le mot de passe administrateur (il est écrit en clair
sur un PC d'usine). Dans **Sécurité & accès**, créez un compte :

- identifiant : `agent`
- rôle : **RH**
- mot de passe : dédié

Puis sur le PC d'usine, définissez `PILOTRH_LOGIN=agent` et `PILOTRH_PASSWORD=…`
(ou modifiez les deux lignes en haut de `pilotrh_agent.py`).

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

Une vraie application **native** (APK sur le Play Store, notifications push,
lecteur QR intégré, mode hors ligne complet) reste un projet distinct — comptez
2 à 3 semaines. À faire seulement si vous voulez les notifications push.

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
demo/                           deux fichiers HTML autonomes (voir §0)
outils/faire_demo.py            régénère ces fichiers depuis le code réel
outils/integrer_sauvegarde.py   reprend une sauvegarde de l'ancienne version
app.py                          serveur (FastAPI + SQLite)
reinit_admin.py                 dépannage : réinitialise un mot de passe hors ligne
mdb_import.py                   lecture .mdb + calendrier (fériés, repos, clôture)
fiches_import.py                modèle Excel des fiches + relecture (création / mise à jour)
static/index.html               coquille de l'interface RH
static/moi.html                 espace salarié (installable)
static/login.html               connexion
static/assets/
  pilotrh-core.js               MOTEUR DE CALCUL — partagé RH / espace salarié
  pilotrh-ui.css                styles
  pilotrh-app.js                état, réseau fiable, chargement fenêtré, présences
  pilotrh-views.js              rapports, personnel, absences, congés, RSE, IA
  pilotrh-saisie.js             saisie rapide, correction par plage, import, réglages
  pilotrh-coms.js               notes de service et sondages
  sw.js, manifest.webmanifest   application installable
```

Le calcul des heures était **dupliqué** entre l'interface RH et l'espace salarié, et
les deux copies avaient déjà divergé : une ouvrière pouvait lire un nombre d'heures
différent de celui transmis au comptable. Il n'existe plus qu'une implémentation,
dans `pilotrh-core.js`.

---

## 8. Tests

**520 tests automatisés** accompagnent cette version :

| Suite | Nombre | Ce qu'elle vérifie |
|---|---|---|
| Moteur de calcul (`node`) | 72 | pause partielle, fériés, repos travaillé, badge unique, `hM`/`hsM`, arrondi cumul vs jour, Ramadan, échappement, **mode de paie et taux (heure / journée, repli sur le taux par défaut)** |
| Import et calendrier (`python`) | 28 | correction du sexe, protections anti-écrasement, fériés, mois clos, collision d'identifiants, démissions |
| Serveur (`python`) | 109 | fuite de `_secret`, élévation de privilèges, écritures concurrentes, sauvegardes, sondages, anti-force brute, SSRF, audit, **modèle de fiches et import en masse (aperçu sans écriture, droits, pointages intacts)** |
| Import de fiches (`python`) | 82 | en-têtes tolérants, dates et nombres, listes de référence, doublons, cellule vide sans effet, `-` qui efface, aller-retour du classeur prérempli sans aucun changement, 120 fiches |
| Interface (navigateur réel) | 121 | XSS avec un nom hostile, filtres et tri, saisie rapide, correction par plage, graphiques sans CDN, menu mobile, espace salarié, **alertes cliquables jusqu'à la ligne surlignée, saisie du taux, colonnes Taux / Montant, parcours complet d'import de fiches** |
| Données réelles (`file://`) | 11 | reprise d'une sauvegarde de l'ancienne version : effectif, réglages, périodes, plages de pause, totaux de paie |
| Démonstration hors ligne (`file://`) | 57 | ouverture sans serveur, modification réelle des données, saisie rapide, correction par plage, messagerie, export CSV, mobile, espace salarié, **alertes cliquables** |
| Arrondi (`node`) | 18 | écart entre arrondi par jour et arrondi sur le cumul, sur des arrivées réalistes |
| Mots de passe et dépannage (`python`) | 22 | compatibilité des empreintes de la v2, renforcement transparent, réinitialisation par variable et par script, conservation des codes à 4 chiffres |

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
