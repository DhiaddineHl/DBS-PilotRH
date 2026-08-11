FROM python:3.12-slim

# Fuseau horaire : sans lui le conteneur est en UTC alors que l'usine est en
# UTC+1 — les horodatages d'audit et la bascule de « aujourd'hui » décalaient
# d'une heure, et la fenêtre d'import pouvait écarter un pointage de fin de poste.
ENV TZ=Africa/Tunis \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PILOTRH_DATA=/app/data

# util-linux fournit setpriv, qui sert à lâcher les privilèges root au démarrage
# une fois les droits du volume ajustés (voir docker-entrypoint.sh).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata util-linux \
 && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# uvicorn ne tourne pas en root : tout défaut d'écriture de fichier s'exercerait
# sinon avec les pleins droits dans le conteneur.
#
# Le conteneur DÉMARRE toutefois en root, volontairement : un volume (Railway,
# Docker, Kubernetes) est monté au démarrage par-dessus /app/data et appartient à
# root, ce qui recouvre le chown fait ici. Le script d'entrée ajuste donc les
# droits du volume puis lâche les privilèges avant de lancer uvicorn. Sans cela,
# le déploiement échouait sur « Permission denied: /app/data/backups ».
RUN useradd -r -u 10001 -m pilotrh \
 && mkdir -p /app/data/photos /app/data/docs /app/data/backups \
 && chown -R pilotrh:pilotrh /app/data \
 && chmod +x /app/docker-entrypoint.sh

EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/health',timeout=4).status==200 else 1)"

# Le script d'entrée ajuste les droits du volume, puis lance uvicorn en
# utilisateur non privilégié. --forwarded-allow-ips y est restreint : accepter
# X-Forwarded-* de n'importe qui permettait d'usurper l'adresse IP dans les
# journaux et de faire croire au serveur qu'il était en HTTPS.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
