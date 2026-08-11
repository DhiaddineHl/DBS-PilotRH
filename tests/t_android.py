# -*- coding: utf-8 -*-
"""Vérifie l'application Android sans installer le SDK.

Deux choses sont contrôlées :

  1. Que le code de l'application **compile** — confronté aux doublures de
     tests/android_stubs/, qui reprennent les signatures réelles du SDK. Une
     faute de frappe ou une méthode mal appelée est donc vue ici, sans attendre
     la compilation complète sur GitHub.
  2. Que la **normalisation de l'adresse du serveur** est juste. C'est la seule
     vraie logique de l'application, et c'est celle qui peut empêcher toutes les
     ouvrières de se connecter : une adresse locale doit rester en http, un nom
     de domaine passer en https, la barre finale et le port être traités.

Le test s'ignore proprement si le JDK n'est pas installé.
"""
import os
import shutil
import subprocess
import sys
import tempfile

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
SOURCE = os.path.join(RACINE, "android", "app", "src", "main")
STUBS = os.path.join(ICI, "android_stubs")

ok = ko = 0


def t(nom, got, exp):
    global ok, ko
    if got == exp:
        ok += 1
    else:
        ko += 1
        print("  ECHEC  %s\n    attendu %r\n    obtenu  %r" % (nom, exp, got))


def tv(nom, cond, detail=""):
    t(nom + ((" :: %s" % detail) if (not cond and detail) else ""), bool(cond), True)


if not shutil.which("javac") or not shutil.which("java"):
    print("  (JDK absent — vérification de l'application Android ignorée)")
    print("\n=========================\n  0 réussis · 0 échoués")
    sys.exit(0)

print("\n--- Le projet Android est complet ---")
attendus = [
    "android/settings.gradle", "android/build.gradle", "android/app/build.gradle",
    "android/gradle.properties", "android/gradlew", "android/gradle/wrapper/gradle-wrapper.jar",
    "android/app/src/main/AndroidManifest.xml",
    "android/app/src/main/java/tn/dbsfashion/pilotrh/MainActivity.java",
    "android/app/src/main/res/values/strings.xml",
    "android/app/src/main/res/values/styles.xml",
    "android/app/src/main/res/xml/network_security_config.xml",
    "android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png",
    ".github/workflows/apk.yml",
]
for rel in attendus:
    tv("présent : %s" % rel, os.path.exists(os.path.join(RACINE, rel)))
tv("le script gradlew est exécutable", os.access(os.path.join(RACINE, "android", "gradlew"), os.X_OK))

manifeste = open(os.path.join(SOURCE, "AndroidManifest.xml"), encoding="utf-8").read()
tv("permission Internet demandée", "android.permission.INTERNET" in manifeste)
tv("aucune permission superflue (caméra, contacts, position)",
   not any(x in manifeste for x in ("CAMERA", "READ_CONTACTS", "ACCESS_FINE_LOCATION",
                                    "READ_EXTERNAL_STORAGE", "RECORD_AUDIO")))
tv("le scan de la carte QR ouvre l'application (filtre sur /moi)",
   'android:pathPrefix="/moi"' in manifeste)
tv("l'activité est exportée pour pouvoir être lancée", 'android:exported="true"' in manifeste)
tv("configuration réseau déclarée", "networkSecurityConfig" in manifeste)

src = open(os.path.join(SOURCE, "java", "tn", "dbsfashion", "pilotrh", "MainActivity.java"),
          encoding="utf-8").read()
tv("le stockage local est activé (sinon il faut rescanner la carte à chaque fois)",
   "setDomStorageEnabled(true)" in src)
tv("le contenu mixte est refusé", "MIXED_CONTENT_NEVER_ALLOW" in src)
tv("les deux variantes d'erreur sont traitées (Android 6+ et antérieurs)",
   src.count("onReceivedError") >= 2)
tv("le bouton retour navigue dans l'historique avant de quitter",
   "canGoBack()" in src and "goBack()" in src)
tv("aucune adresse de serveur codée en dur",
   "railway" not in src.lower() and "http://192.168" not in src)
tv("aucune bibliothèque externe (ni AndroidX, ni Kotlin)",
   "androidx" not in src and "kotlin" not in src.lower())

gradle = open(os.path.join(RACINE, "android", "app", "build.gradle"), encoding="utf-8").read()
tv("aucune dépendance déclarée", "implementation " not in gradle)
tv("Android 6 minimum (parc réel de l'atelier)", "minSdk 23" in gradle)

print("\n--- Compilation du code de l'application ---")
tmp = tempfile.mkdtemp(prefix="pilotrh-apk-")
try:
    # R.java est normalement généré par le SDK : on le fabrique depuis strings.xml
    import re
    chaines = re.findall(r'<string name="([^"]+)"',
                         open(os.path.join(SOURCE, "res", "values", "strings.xml"),
                              encoding="utf-8").read())
    pkg = os.path.join(tmp, "tn", "dbsfashion", "pilotrh")
    os.makedirs(pkg)
    with open(os.path.join(pkg, "R.java"), "w", encoding="utf-8") as f:
        f.write("package tn.dbsfashion.pilotrh;\npublic final class R {\n"
                "  public static final class string {\n")
        for i, n in enumerate(chaines):
            f.write("    public static final int %s=%d;\n" % (n, 0x7f040000 + i))
        f.write("  }\n}\n")
    tv("les chaînes de l'interface sont toutes en français et nommées", len(chaines) >= 20,
       "%d chaînes" % len(chaines))

    shutil.copy(os.path.join(SOURCE, "java", "tn", "dbsfashion", "pilotrh", "MainActivity.java"), pkg)
    for racine_stub, _, fichiers in os.walk(os.path.join(STUBS, "android")):
        for fic in fichiers:
            if not fic.endswith(".java"):
                continue
            rel = os.path.relpath(os.path.join(racine_stub, fic), STUBS)
            dest = os.path.join(tmp, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy(os.path.join(racine_stub, fic), dest)

    sources = []
    for racine_src, _, fichiers in os.walk(tmp):
        sources += [os.path.join(racine_src, f) for f in fichiers if f.endswith(".java")]
    classes = os.path.join(tmp, "_classes")
    r = subprocess.run(["javac", "-nowarn", "-d", classes] + sources,
                       capture_output=True, text=True)
    tv("MainActivity.java compile sans erreur", r.returncode == 0,
       (r.stderr or r.stdout)[:600])
    if r.returncode != 0:
        print("\n=========================")
        print("  %d réussis · %d échoués" % (ok, ko))
        sys.exit(1)

    print("\n--- Normalisation de l'adresse du serveur ---")
    essai = os.path.join(tmp, "Essai.java")
    open(essai, "w", encoding="utf-8").write("""
public class Essai {
  public static void main(String[] a) throws Exception {
    java.lang.reflect.Method m = Class.forName("tn.dbsfashion.pilotrh.MainActivity")
        .getDeclaredMethod("normaliser", String.class);
    m.setAccessible(true);
    for (String s : a) System.out.println(String.valueOf(m.invoke(null, "null".equals(s) ? null : s)));
  }
}
""")
    r = subprocess.run(["javac", "-nowarn", "-cp", classes, "-d", classes, essai],
                       capture_output=True, text=True)
    tv("le banc d'essai compile", r.returncode == 0, (r.stderr or r.stdout)[:400])

    cas = [
        ("pilotrh-dbs.up.railway.app", "https://pilotrh-dbs.up.railway.app", "un nom de domaine passe en https"),
        ("https://pilotrh-dbs.up.railway.app", "https://pilotrh-dbs.up.railway.app", "https déjà présent : inchangé"),
        ("https://pilotrh-dbs.up.railway.app/", "https://pilotrh-dbs.up.railway.app", "barre finale retirée"),
        ("https://pilotrh-dbs.up.railway.app/moi", "https://pilotrh-dbs.up.railway.app", "le chemin est ignoré"),
        ("192.168.1.20:8000", "http://192.168.1.20:8000", "adresse locale : http, port conservé"),
        ("10.0.0.5:8000", "http://10.0.0.5:8000", "plage 10.x : http"),
        ("localhost:8000", "http://localhost:8000", "localhost : http"),
        ("http://192.168.1.20:8000/", "http://192.168.1.20:8000", "http local déjà écrit"),
        ("  pilotrh.example.com  ", "https://pilotrh.example.com", "espaces autour de l'adresse"),
        ("pilot rh.example.com", "https://pilotrh.example.com", "espace au milieu supprimé"),
        ("", "null", "adresse vide refusée"),
        ("null", "null", "valeur absente refusée"),
        ("://", "null", "adresse absurde refusée"),
        ("https://", "null", "schéma sans hôte refusé"),
    ]
    r = subprocess.run(["java", "-cp", classes, "Essai"] + [c[0] for c in cas],
                       capture_output=True, text=True)
    lignes = [l for l in r.stdout.splitlines() if l != ""]
    if len(lignes) != len(cas):
        tv("le banc d'essai s'exécute", False, (r.stderr or r.stdout)[:400])
    else:
        for (entree, attendu, libelle), obtenu in zip(cas, lignes):
            t("%s (« %s »)" % (libelle, entree), obtenu, attendu)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print("\n--- Fabrication de l'APK en ligne (GitHub Actions) ---")
wf = open(os.path.join(RACINE, ".github", "workflows", "apk.yml"), encoding="utf-8").read()
tv("déclenchable à la main", "workflow_dispatch" in wf)
tv("le domaine du serveur est demandé au lancement", "domaine" in wf)
tv("l'APK installable (debug) est produit", "assembleDebug" in wf)
tv("l'APK de publication est tenté aussi", "assembleRelease" in wf)
tv("le fichier est publié en téléchargement", "upload-artifact" in wf)

print("\n=========================")
print("  %d réussis · %d échoués" % (ok, ko))
sys.exit(1 if ko else 0)
