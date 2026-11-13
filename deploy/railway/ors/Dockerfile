# openrouteservice for Railway (NUD-202, docs/deploy-railway.md).
# Railway service: root directory /deploy/railway/ors, volume at /data, no public domain; the app
# reaches it as http://ors.railway.internal:8082/ors (ORS_BASE_URL).
FROM openrouteservice/openrouteservice:v9.1.1

# ORS_HOME moves everything the image writes (extract, graphs, logs) onto the volume. XMX 4g is
# what the Austria car graph needs while it is built; serving needs less.
ENV ORS_HOME=/data \
    ORS_CONFIG_LOCATION=/app/ors-config.yml \
    XMS=1g \
    XMX=4g

COPY ors-config.yml /app/ors-config.yml
COPY start.sh /app/start.sh
RUN chmod 755 /app/start.sh

EXPOSE 8082
ENTRYPOINT ["/app/start.sh"]
