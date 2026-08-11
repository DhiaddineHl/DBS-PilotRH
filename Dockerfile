FROM python:3.12-slim

# Fuseau horaire : sans lui le conteneur est en UTC alors que l'usine est en
# UTC+1 — les horodatages d'audit et la bascule de « aujourd'hui » décalaient
# d'une heure, et la fenêtre d'import pouvait écarter un pointage de fin de poste.
ENV TZ=Africa/Tunis \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PILOTRH_DATA=/app/data

RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# uvicorn ne tourne plus en root : tout défaut d'écriture de fichier s'exerçait
# sinon avec les pleins droits dans le conteneur.
RUN useradd -r -u 10001 -m pilotrh \
 && mkdir -p /app/data/photos /app/data/docs /app/data/backups \
 && chown -R pilotrh:pilotrh /app/data
USER pilotrh

EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/health',timeout=4).status==200 else 1)"

# --forwarded-allow-ips est restreint : accepter X-Forwarded-* de n'importe qui
# permettait d'usurper l'adresse IP dans les journaux et de faire croire au
# serveur qu'il était en HTTPS.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=${PILOTRH_TRUSTED_PROXY:-127.0.0.1}"]
