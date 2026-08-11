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
109 tests. Les dossiers `fastapi/`, `starlette/`, `httpx.py` et `access_parser.py`
de ce dossier sont des **doublures de test** minimales : elles permettent de tester
la couche base de données sans installer les dépendances. Ne les déployez pas.

## Mots de passe et dépannage
```
cd tests && python3 t_motdepasse.py
```
22 tests : compatibilité des empreintes créées par la v2, renforcement transparent
à la connexion, réinitialisation par variable d'environnement et par script,
conservation des codes à 4 chiffres déjà distribués.

## Interface (navigateur réel)
```
cd tests && node mock.js &        # faux serveur avec 120 salariés et 75 jours
node t_ui.js                      # nécessite playwright
```
121 tests : XSS avec un nom hostile, filtres et tri, saisie rapide, correction sur
plage de dates, graphiques sans CDN, menu mobile, parcours complet de l'espace salarié,
alertes cliquables jusqu'à la ligne surlignée, saisie du prix de l'heure ou de la
journée, colonnes Taux et Montant du rapport de paie, import de fiches de bout en bout.

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
