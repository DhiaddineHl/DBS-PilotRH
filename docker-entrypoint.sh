#!/bin/sh
# Démarrage de PilotRH dans un conteneur.
#
# Pourquoi ce script existe : un volume (Railway, Docker, Kubernetes) est monté
# AU DÉMARRAGE, par-dessus le dossier que l'image avait préparé, et il appartient
# à root. Le `chown` fait à la construction de l'image est donc recouvert, et un
# conteneur qui tourne en utilisateur non privilégié se heurte à
# « Permission denied: /app/data/backups » dès l'import du module.
#
# La solution : ce script démarre en root, donne les droits sur le volume, PUIS
# lâche les privilèges pour lancer uvicorn en utilisateur normal. Le serveur
# lui-même ne tourne jamais en root — sauf si vous l'exigez avec PILOTRH_ROOT=1.
set -e

DOSSIER="${PILOTRH_DATA:-${RAILWAY_VOLUME_MOUNT_PATH:-/app/data}}"
UTILISATEUR="pilotrh"
UID_APP=10001
GID_APP=10001

# Les sous-dossiers doivent exister AVANT le changement de propriétaire, sinon
# c'est l'application qui essaie de les créer, sans en avoir le droit.
mkdir -p "$DOSSIER/photos" "$DOSSIER/docs" "$DOSSIER/backups" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  chown -R "$UID_APP:$GID_APP" "$DOSSIER" 2>/dev/null || \
    echo "PilotRH : impossible de changer le propriétaire de $DOSSIER — on tente quand même."
else
  echo "PilotRH : conteneur démarré sans les droits root, le volume ne peut pas être ajusté."
fi

# Commande à lancer. Si l'hébergeur fournit sa propre commande de démarrage
# (Railway → Settings → Custom Start Command, ou `docker run image …`), on la
# respecte : sans cela, un réglage laissé en place dans l'interface Railway
# serait ignoré en silence.
if [ "$#" -gt 0 ]; then
  COMMANDE="$*"
  echo "PilotRH : commande de démarrage fournie par l'hébergeur — $COMMANDE"
else
  COMMANDE="uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=${PILOTRH_TRUSTED_PROXY:-127.0.0.1}"
fi

# Dépannage : PILOTRH_ROOT=1 laisse le serveur en root. Cela débloque une
# installation coincée sur les droits, mais tout défaut d'écriture s'exercerait
# alors avec les pleins pouvoirs dans le conteneur : à n'utiliser qu'en transit.
if [ "${PILOTRH_ROOT:-0}" = "1" ] || [ "$(id -u)" != "0" ]; then
  [ "${PILOTRH_ROOT:-0}" = "1" ] && echo "PilotRH : PILOTRH_ROOT=1 — le serveur tourne en root (déconseillé durablement)."
  exec sh -c "$COMMANDE"
fi

if command -v setpriv >/dev/null 2>&1; then
  exec setpriv --reuid="$UID_APP" --regid="$GID_APP" --clear-groups sh -c "$COMMANDE"
elif command -v su-exec >/dev/null 2>&1; then
  exec su-exec "$UTILISATEUR" sh -c "$COMMANDE"
elif command -v gosu >/dev/null 2>&1; then
  exec gosu "$UTILISATEUR" sh -c "$COMMANDE"
else
  # Dernier recours : plutôt tourner en root que ne pas démarrer du tout, mais
  # le dire clairement dans les journaux.
  echo "PilotRH : ni setpriv ni su-exec ni gosu — le serveur démarre en root."
  exec sh -c "$COMMANDE"
fi
