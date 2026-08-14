# Tests de PilotRH v3

## Moteur de calcul (le plus important — vérifie la paie)
```
node tests/t_engine.js
```
72 tests : pause partielle, jours fériés, repos travaillé, badge unique,
heures saisies à la main, arrondi sur le cumul, mode Ramadan, échappement HTML,
mode de paie (à l’heure / à la journée) et taux avec repli sur le taux par défaut.

## Import et calendrier
```
cd tests && python3 t_mdb.py
```
28 tests : correction du sexe, protections anti-écrasement, fériés, mois clôturé,
collision d'identifiants après suppression, démissions.

## Import des fiches du personnel (modèle Excel)
```
cd tests && python3 t_fiches.py
```
82 tests : en-têtes tolérants (casse, accents, synonymes), dates et nombres,
listes de référence, matricules en double, **cellule vide qui ne modifie rien**,
« - » qui efface un champ, aller-retour du classeur prérempli sans aucun
changement, pointages intacts, 120 fiches d'un coup.

## Serveur
```
cd tests && python3 t_app.py
```
203 tests, dont le **portier d'authentification exercé tel quel** : tout endpoint
de l'espace salarié doit passer sans session (c'est l'oubli qui empêchait les votes
de partir), tout le reste doit rester fermé, et un compte en lecture seule ne doit
rien pouvoir écrire. Les dossiers `fastapi/`, `starlette/`, `httpx.py` et `access_parser.py`
de ce dossier sont des **doublures de test** minimales : elles permettent de tester
la couche base de données sans installer les dépendances. Ne les déployez pas.

## Mots de passe et dépannage
```
cd tests && python3 t_motdepasse.py
```
34 tests : compatibilité des empreintes créées par la v2, renforcement transparent
à la connexion, réinitialisation par variable d'environnement et par script, et
surtout : **une carte QR de la v2 avec son code à 4 chiffres ouvre encore l'espace
salarié** (bon code accepté, mauvais code refusé, ancien appel GET toléré, jeton
jamais régénéré au démarrage).

## Interface (navigateur réel)
```
cd tests && node mock.js &        # faux serveur avec 120 salariés et 75 jours
node t_ui.js                      # nécessite playwright
```
151 tests : XSS avec un nom hostile, filtres et tri, saisie rapide, correction sur
plage de dates, graphiques sans CDN, menu mobile, parcours complet de l'espace salarié,
alertes cliquables jusqu'à la ligne surlignée, saisie du prix de l'heure ou de la
journée, colonnes Taux et Montant du rapport de paie, import de fiches de bout en bout, vote d'une salariée suivi jusqu'à la réponse HTTP
et jusqu'à sa remontée côté RH, réglages de la pointeuse et alerte « pointeuse muette ».

## Déploiement en conteneur (Railway, Docker)
```
cd tests && python3 t_deploiement.py
```
36 tests sur la panne « Permission denied: /app/data/backups » : résolution du
dossier de données (`PILOTRH_DATA`, puis `RAILWAY_VOLUME_MOUNT_PATH`), message
d'erreur qui explique quoi faire au lieu d'afficher une trace, et surtout le
**script d'entrée réellement exécuté** — droits du volume ajustés, privilèges
lâchés, uvicorn lancé sous l'utilisateur 10001. Les cas nécessitant de simuler un
utilisateur non privilégié sont ignorés proprement si le test ne tourne pas en root.

## Reprise d'une sauvegarde de l'ancienne version
```
cd tests && python3 t_reprise.py
```
26 tests : séparation des identifiants attribués deux fois, **révocation de l'accès
des deux fiches concernées** (une seule carte avait été imprimée, on ne sait pas qui
la détient) et **conservation de toutes les autres cartes QR**, réglages complétés
sans qu'aucune valeur existante ne soit modifiée.

## Application Android (APK)
```
cd tests && python3 t_android.py
```
49 tests, sans installer le SDK Android : le projet est complet, `MainActivity.java`
**compile réellement** (confronté aux doublures de `android_stubs/`, qui reprennent
les signatures du SDK), aucune permission superflue n'est demandée, aucune adresse
de serveur n'est codée en dur, et la normalisation de l'adresse saisie au premier
démarrage est vérifiée cas par cas (nom de domaine → https, adresse locale → http,
port conservé, barre finale retirée, saisie absurde refusée). Le test s'ignore si
le JDK est absent.

## Arrondi
```
cd tests && node t_arrondi.js
```
18 tests : écart mesuré entre l'arrondi appliqué à chaque journée et l'arrondi
appliqué au cumul de la période, sur des heures d'arrivée réalistes.

## Démonstration hors ligne
```
python3 ../outils/faire_demo.py    # régénère les fichiers de demo/
node t_demo.js                     # 57 tests sur file://
```
Vérifie que les deux fichiers HTML autonomes s'ouvrent sans serveur, que les données
sont réellement modifiables, et que ce qui exige le serveur est expliqué au lieu
d'échouer en silence.

## Vos données réelles
```
python3 ../outils/integrer_sauvegarde.py ma_sauvegarde.json
node t_donnees_reelles.js
```
`integrer_sauvegarde.py` nettoie une sauvegarde de l'ancienne version (retire les
comptes et la clé de session, sépare les identifiants attribués deux fois, complète
les réglages) et produit `demo/PilotRH_mes_donnees.html` : vos vraies données dans
la nouvelle interface, hors ligne. `t_donnees_reelles.js` vérifie que ce fichier
s'ouvre et que vos réglages ont bien été reprisés. Il s'ignore si le fichier
n'existe pas.
