# PilotRH — Serveur RH · DBS Fashion

Application RH pour usine textile, **installée sur votre serveur** (pas un simple fichier HTML).
Le serveur lit **directement** la base de la pointeuse ZKTeco (`.mdb`), stocke les données dans
une base **SQLite** locale, et conserve **photos et documents** sur le disque.

---

## 1. Installation la plus simple — Docker (recommandé)

Prérequis : Docker + Docker Compose installés sur le serveur.

```bash
cd pilotrh_server

# (optionnel) activer l'OCR et l'assistant IA
cp .env.example .env
#   puis éditez .env et renseignez ANTHROPIC_API_KEY

docker compose up -d --build
```

Ouvrez ensuite **http://IP_DU_SERVEUR:8000** dans un navigateur (PC, tablette, smartphone
du réseau local). Au premier démarrage, la base fournie (`seed/attBackup.mdb`) est importée
automatiquement : vos employées et l'historique de pointage sont déjà là.

Pour arrêter / redémarrer / voir les logs :
```bash
docker compose down
docker compose restart
docker compose logs -f
```

---

## 2. Installation sans Docker (Python)

Prérequis : Python 3.10+

```bash
cd pilotrh_server
python -m venv venv
source venv/bin/activate            # Windows : venv\Scripts\activate
pip install -r requirements.txt

# (optionnel) IA
export ANTHROPIC_API_KEY=sk-ant-xxxx   # Windows : set ANTHROPIC_API_KEY=...

uvicorn app:app --host 0.0.0.0 --port 8000
```

Accès : **http://IP_DU_SERVEUR:8000**

---

## 3. Mise à jour du pointage

### a) Synchronisation automatique depuis le partage réseau (recommandé)

Le serveur peut lire **directement** le `.mdb` de la pointeuse sur le réseau, sans aucune
manipulation. Il suffit d'indiquer le chemin du fichier via `PILOTRH_MDB_PATH`.

**Sur Linux** — monter le partage Windows de la pointeuse puis pointer dessus :
```bash
sudo mkdir -p /mnt/pointeuse
sudo mount -t cifs //IP_DU_PC_POINTEUSE/ZKTeco /mnt/pointeuse \
     -o username=USER,password=PASS,ro,vers=3.0
```
Puis dans `docker-compose.yml`, ajoutez le volume et la variable :
```yaml
    volumes:
      - ./data:/app/data
      - /mnt/pointeuse:/mnt/pointeuse:ro          # partage de la pointeuse (lecture seule)
    environment:
      - PILOTRH_MDB_PATH=/mnt/pointeuse/attBackup.mdb
      - PILOTRH_SYNC_MINUTES=60                    # relecture auto toutes les 60 min
```

**Sur Windows** (serveur Windows, sans Docker) :
```bat
set PILOTRH_MDB_PATH=\\IP_DU_PC_POINTEUSE\ZKTeco\attBackup.mdb
uvicorn app:app --host 0.0.0.0 --port 8000
```

Le serveur relit le fichier **au démarrage**, puis **automatiquement** dès qu'il change
(toutes les `PILOTRH_SYNC_MINUTES`). Dans l'app, le bouton **« Synchroniser »** (écran
Présences) force une mise à jour immédiate. L'état de synchronisation est visible sur
`GET /api/health`.

### b) Dépôt manuel du fichier

Si vous préférez : **Présences → Importer pointage** → glissez le `.mdb` (ou un CSV).

> Règle de pointage : premier badge du jour = **entrée**, dernier badge = **sortie**.
> Les fiches déjà créées ne sont pas écrasées (poste, catégorie, salaire, photo conservés).

---

## 4. Horaires de travail (entièrement paramétrables)

Écran **Présences → ⚙ Paramètres horaires**. Vous réglez :

**Semaine de référence** — pour chaque jour (Lun→Dim) : ouvré ou non, heure de début,
heure de fin, pause, tolérance de retard, délai avant heures sup. Le **samedi** peut donc
avoir un horaire différent (ex. 07:30→13:00), le **dimanche** est chômé par défaut.

**Périodes spéciales** — vous ajoutez des périodes datées qui remplacent la semaine de
référence sur leur plage : **Juillet–Août en séance unique** (ex. 07:00→14:00),
**Ramadan**, etc. Chaque période a ses propres horaires Lun→Ven et Samedi.

**Règles de calcul appliquées :**
- Les heures sont comptées **à partir de l'heure de début** : une arrivée à 7h15 pour un
  début à 7h30 ne fait rien gagner (l'avance n'est pas payée).
- **Retard** si l'arrivée dépasse début + tolérance.
- **Heures supplémentaires** : seulement au-delà de l'heure de fin + un **délai de grâce**
  (ex. 15 min). Une sortie à 16h37 (fin 16h30) ne génère aucune heure sup.
  - **Mode B (par défaut)** : une fois le délai franchi, les heures sup. sont comptées
    **depuis l'heure de fin** (sortie 16h50 → 20 min de sup.).
  - *Mode A* (option) : comptées à partir de fin + délai (sortie 16h50 → 5 min).
- **Pause** déduite. Le bon régime horaire est choisi **automatiquement selon la date**
  du pointage (semaine, samedi, ou période spéciale active).

**Ouvrières** payées en **heures** · **Cadres** en **jours travaillés** (réglé par fiche).

---

## 5. Historique & traçabilité (important pour les RH / inspection du travail)

- **Tout l'historique des pointages est conservé** dans une table dédiée et n'est **jamais
  écrasé** — vous pouvez consulter le pointage d'une employée d'il y a un mois ou d'un an
  (fiche employée → Historique de pointage, avec choix de la plage de dates).
- Chaque modification (pointage corrigé, import, synchronisation, photo…) est inscrite dans
  un **journal d'audit** horodaté avec l'auteur (écran **Sécurité & accès**).
- Les données sont dans **`data/`** : `pilotrh.db` (SQLite : employées, **tous les
  pointages**, paramètres, audit), `photos/`, `docs/`. **Sauvegarde = copier `data/`.**
- Export/import JSON complet possible depuis **Sécurité & accès**.

> Conseil : planifiez une copie automatique du dossier `data/` (ex. tâche quotidienne)
> vers un autre disque ou un partage réseau, pour ne jamais risquer de perdre l'historique.

---

## 6. Rapports

- **PDF journalier** : présents / retards / absents (entrée, sortie, heures, H.sup).
- **PDF de paie mensuel** : synthèse par employée, prête pour le comptable.
- Export **CSV** également. Liste du jour **filtrable** (statut, service, atelier, nom) et **triable**.

---

## 7. Espace salarié (QR code + PIN)

Chaque ouvrière peut consulter **son propre pointage du mois** (présences, retards,
absences, heures) en lecture seule, sans accès à l'administration.

- Dans **Sécurité & accès → Espace salarié**, téléchargez le **PDF des QR codes**
  (une carte par employée, avec son nom et son **code à 4 chiffres**). Imprimez et
  distribuez — c'est un document **confidentiel**.
- L'ouvrière scanne sa carte → la page `/moi` s'ouvre → elle saisit son code → elle voit
  son mois. Le QR seul ne suffit pas : le code à 4 chiffres protège l'accès.
- Elle peut **signaler une erreur** : le message arrive aux RH (visible dans le journal
  d'audit) sans modifier automatiquement le pointage.
- Le calcul est strictement le même que côté administration (mêmes horaires, même Mode B).

---

## 8. Déploiement sur Railway (accès depuis l'extérieur de l'usine)

PilotRH est **indépendant** : déployez-le comme **service séparé** (sa propre URL), même
si vous avez déjà PilotPro. Pour le relier, mettez simplement un lien depuis PilotPro.

**À configurer impérativement sur Railway :**

1. **Mot de passe admin** — variable `PILOTRH_ADMIN_PASSWORD`. Sans elle, n'importe qui
   ayant l'URL accède à l'administration. Avec elle, l'admin demande un mot de passe
   (identifiant : `admin`) ; **l'espace salarié `/moi` reste public** (protégé par QR + PIN).
2. **Volume persistant** — montez un volume sur **`/app/data`**. Sinon SQLite (donc tout
   l'historique des pointages et les codes) serait effacé à chaque redéploiement.
3. **Faire remonter le pointage** — un serveur Railway ne voit pas la pointeuse de l'usine.
   Lancez **`push_pointeuse.py`** sur un PC de l'usine (qui voit le `.mdb`) : il envoie le
   fichier au serveur dès qu'il change. Configuration en haut du script (URL, chemin du
   `.mdb`, mot de passe admin). Sur Windows : Planificateur de tâches au démarrage.

> Railway fournit le HTTPS automatiquement : les liens des QR et les codes ne circulent
> jamais en clair.

---

## 9. Ce que fait l'application

- **Présences** jour par jour, saisie/correction manuelle, navigation par date
- **Paramètres horaires** : heure d'entrée, tolérance de retard, seuil d'heures
  supplémentaires, pause — tout est recalculé automatiquement
- **Calcul différencié** : ouvrières en **heures**, cadres en **jours travaillés**
- **Rapports & paie** : rapport journalier + rapport mensuel téléchargeables pour le comptable
- **Fiches employées** complètes, avec **photo** (stockée sur le serveur)
- **Documents** : numérisation + lecture IA (OCR) qui classe et met à jour les absences
- **Assistant IA** RH (questions en langage naturel sur la base)
- **Alertes**, **RSE**, **rôles & sécurité**

---

## 5. Données & sauvegarde

Tout est dans le dossier **`data/`** :
- `pilotrh.db` — base SQLite (employées, pointages, paramètres…)
- `photos/` — photos des employées
- `docs/` — documents numérisés

**Sauvegarde** = copier le dossier `data/`. Restauration = remettre le dossier en place.
Vous pouvez aussi exporter/importer la base en JSON depuis **Sécurité & accès**.

---

## 6. Configuration

| Variable d'environnement | Rôle | Défaut |
|---|---|---|
| `ANTHROPIC_API_KEY` | Active OCR + assistant IA | (vide) |
| `PILOTRH_DATA` | Dossier de données | `./data` |
| `PILOTRH_MODEL` | Modèle IA | `claude-sonnet-4-6` |

Fenêtre d'import `.mdb` par défaut : 2026-03-01 → 2026-06-30 (modifiable dans `mdb_import.py`,
constantes `DEFAULT_DU` / `DEFAULT_AU`).

---

## 7. Évolutions possibles

- Multi-utilisateurs avec comptes et permissions réels (actuellement mono-poste)
- Import `.mdb` planifié automatiquement (lecture directe depuis le partage réseau de la pointeuse)
- Modèle de base de données normalisé (tables dédiées) si le volume devient très important
- Connexion au module Paie / à l'ERP usine (PilotPro)
