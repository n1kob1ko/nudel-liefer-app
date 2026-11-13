# Photon geocoder (Komoot) for Railway (NUD-202, docs/deploy-railway.md).
# Railway service: root directory /deploy/railway/photon, volume at /data, no public domain; the
# app reaches it as http://photon.railway.internal:2322 (PHOTON_URL).
FROM eclipse-temurin:21-jre

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl bzip2 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Photon ships as a jar, not as an image. 1.3.0 reads the "1.0" index format.
ADD https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar /app/photon.jar
COPY start.sh /app/start.sh
RUN chmod 755 /app/start.sh

EXPOSE 2322
ENTRYPOINT ["/app/start.sh"]
