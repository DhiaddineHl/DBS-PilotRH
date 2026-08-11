# L'espace salarié sur téléphone — application installable et fichier APK

Deux façons de mettre PilotRH sur le téléphone des salariées. Elles affichent
**exactement le même écran** — celui servi par le serveur (`/moi`) — donc il n'y
a qu'un seul calcul des heures et jamais deux versions à corriger.

| | Application installable (PWA) | Fichier APK |
|---|---|---|
| Ce qu'il faut faire | rien : c'est déjà en place | compiler une fois (5 min, gratuit) |
| Comment ça s'installe | scan du QR → « Installer » | envoyer le fichier `.apk` par WhatsApp / Bluetooth |
| iPhone | oui | non (Android seulement) |
| Mise à jour | automatique | il faut renvoyer un nouveau fichier |
| Scan de la carte QR | ouvre le navigateur puis propose d'installer | ouvre **directement l'application** |
| Play Store | non concerné | non nécessaire |

**Recommandation : commencez par la PWA.** Elle ne demande aucun travail, se met
à jour toute seule et fonctionne aussi sur iPhone. L'APK a un intérêt précis :
un fichier que vous distribuez vous-même, une icône installée sans que l'ouvrière
ait à trouver le menu du navigateur, et le scan de carte qui ouvre l'application.

---

## 1. L'application installable (PWA) — déjà prête

### Ce qui a été corrigé dans cette version

Le service worker (le composant qui permet l'installation et le démarrage hors
ligne) était servi depuis `/assets/sw.js`. Or **la portée d'un service worker se
limite au dossier d'où il est téléchargé** : depuis `/assets/`, il n'avait aucune
autorité sur `/moi`. Conséquences réelles :

- l'espace salarié ne démarrait **pas** sans réseau, alors que c'était annoncé ;
- Android refusait souvent de proposer « Ajouter à l'écran d'accueil ».

Il est maintenant servi depuis la racine (`/sw.js`, avec l'en-tête
`Service-Worker-Allowed: /`), et le manifeste depuis `/manifest.webmanifest`.
L'ancien enregistrement resté sur les téléphones déjà équipés est supprimé
automatiquement à la première ouverture.

Deux autres ajouts au passage :

- un **bandeau rouge « Pas de réseau »** en haut de l'écran, et le rechargement
  automatique dès que la connexion revient — l'atelier a un réseau qui tombe ;
- sur **iPhone**, une explication du geste à faire (Partager → « Sur l'écran
  d'accueil »), parce qu'iOS ne propose jamais l'installation de lui-même.

### Comment une ouvrière installe l'application

1. Elle scanne sa carte QR avec l'appareil photo du téléphone.
2. Elle saisit son code personnel à 6 chiffres (une seule fois par téléphone).
3. Un bandeau noir propose **Installer** en bas de l'écran → elle appuie.
   - Sur **Android / Chrome** : l'icône PilotRH apparaît sur l'écran d'accueil.
   - Sur **iPhone / Safari** : bouton Partager, puis « Sur l'écran d'accueil ».

Ensuite, l'application s'ouvre par l'icône, sans rescanner la carte : le jeton
personnel est mémorisé dans le téléphone.

> **À vérifier une fois** : le serveur doit être en **https**. Un service worker
> ne s'installe pas sur une adresse en `http://` (sauf `localhost`). Sur Railway
> c'est le cas par défaut ; sur une installation locale dans l'atelier, la PWA ne
> s'installera pas — c'est là que l'APK est utile.

---

## 2. Le fichier APK

### Ce que fait l'application

Une coquille autour de `/moi`, volontairement minimale : **aucune bibliothèque
externe**, pas d'AndroidX, pas de Kotlin. Le fichier pèse quelques dizaines de
kilo-octets et ne demande que deux permissions, Internet et l'état du réseau —
ni caméra, ni contacts, ni position.

Ce qu'elle ajoute par rapport au navigateur :

- **Le scan de la carte QR ouvre l'application** (filtre d'intention sur `/moi`),
  qui mémorise le jeton. Plus jamais besoin de rescanner la carte.
- Une icône sur l'écran d'accueil sans passer par un menu de navigateur.
- Un écran d'erreur en français qui distingue « pas de réseau » de « le serveur
  ne répond pas », avec un bouton **Réessayer**.
- Un petit bouton **⋯** en bas à gauche : Rafraîchir · Changer l'adresse du
  serveur · Ouvrir l'espace RH · **Effacer mon accès** (quand un téléphone change
  de main).
- L'adresse du serveur est demandée **une seule fois** au premier démarrage, puis
  mémorisée. Elle n'est pas codée en dur : la même application sert pour une
  installation hébergée et pour une installation locale.

Android 6 (2015) et plus — c'est-à-dire l'ensemble du parc encore en service.

### Le compiler sans rien installer (recommandé)

Le fichier `.apk` ne peut pas être produit ici : sa compilation exige le SDK
Android de Google, qui pèse plus d'un gigaoctet. Le projet est donc livré **prêt
à compiler**, avec une recette qui le construit dans le cloud, gratuitement.

1. Déposez le projet sur **GitHub** (dépôt privé, c'est très bien).
2. Onglet **Actions** → dans la colonne de gauche, **Application Android (APK)**
   → bouton **Run workflow**.
3. Renseignez votre **domaine** (par exemple `pilotrh-dbs.up.railway.app`,
   sans `https://`). C'est ce qui permet au scan de carte QR d'ouvrir
   l'application. Laissé vide, l'application fonctionne quand même — le scan
   continuera simplement d'ouvrir le navigateur.
4. Trois à cinq minutes plus tard, en bas de la page du travail terminé, section
   **Artifacts** : `PilotRH-APK`. Téléchargez, dézippez : vous avez le `.apk`.

### Le compiler sur votre PC

Installez [Android Studio](https://developer.android.com/studio), ouvrez le
dossier `android/`, laissez-le télécharger ce qui manque, puis :

```
cd android
./gradlew assembleDebug          # Windows : gradlew.bat assembleDebug
```

Le fichier sort dans `android/app/build/outputs/apk/debug/app-debug.apk`.

### L'installer sur les téléphones

Envoyez le `.apk` par WhatsApp, Bluetooth, ou posez-le sur une clé USB. À
l'ouverture, Android demande d'autoriser « l'installation d'applications de cette
source » : c'est normal pour une application distribuée hors Play Store, il faut
accepter une fois.

L'APK produit par la recette ci-dessus est signé avec la clé de **débogage** :
il s'installe directement, il est parfait pour un usage interne. Il ne peut pas
être publié sur le Play Store en l'état.

### Signer l'application (seulement pour le Play Store)

Uniquement si vous voulez un jour publier sur le Play Store, ou garantir que les
mises à jour futures remplacent proprement l'installation existante :

```
keytool -genkey -v -keystore pilotrh.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias pilotrh
```

Puis dans `android/app/build.gradle` :

```gradle
android {
    signingConfigs {
        release {
            storeFile file("/chemin/vers/pilotrh.jks")
            storePassword "…"
            keyAlias "pilotrh"
            keyPassword "…"
        }
    }
    buildTypes {
        release { signingConfig signingConfigs.release }
    }
}
```

**Conservez le fichier `.jks` et ses mots de passe hors du dépôt Git et dans un
endroit sûr** : perdu, il devient impossible de publier une mise à jour de
l'application, et il faut en republier une nouvelle sous un autre nom.

---

## 3. Ce que l'application ne fait pas

- **Elle ne pointe pas.** Le badgeage reste celui de la pointeuse. Laisser une
  ouvrière déclarer ses heures depuis son téléphone changerait la nature du
  registre et sa valeur en cas de litige.
- **Elle ne contient aucun calcul.** Tout vient du serveur, donc une correction
  de paie n'a jamais à être portée deux fois.
- **Elle ne remplace pas l'interface RH.** Le menu ⋯ ouvre l'espace RH dans le
  navigateur, où il est fait pour être utilisé.
- **Elle ne stocke rien hors ligne pour l'instant** au-delà de la coquille : sans
  réseau, elle affiche un message clair au lieu de chiffres possiblement périmés.

## 4. Où sont les fichiers

```
android/                                   projet Android (Java, sans dépendance)
  app/src/main/AndroidManifest.xml         permissions + filtre du scan de carte QR
  app/src/main/java/.../MainActivity.java  toute l'application (une seule classe)
  app/src/main/res/values/strings.xml      textes en français + DOMAINE À RENSEIGNER
  app/src/main/res/xml/…                   politique réseau (http local autorisé)
.github/workflows/apk.yml                  fabrique l'APK sur GitHub, gratuitement
static/moi.html                            l'espace salarié (le même pour tous)
static/assets/sw.js                        service worker, servi depuis /sw.js
static/assets/manifest.webmanifest         manifeste, servi depuis /manifest.webmanifest
tests/t_android.py                         vérifie que l'application compile
tests/android_stubs/                       doublures Android (tests seulement)
```
