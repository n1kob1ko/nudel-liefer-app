#!/usr/bin/env bash
# openrouteservice on Railway (NUD-202): fetches the OSM extract onto the volume on the first
# start, then hands over to the image's own entrypoint, which builds the car graph (Austria: about
# 15 minutes and 4 GB of RAM, once) and serves on port 8082 under /ors.
#
# A changed OSM_URL downloads the new extract and rebuilds the graph. To refresh the same extract
# (newer map data), start the service once with REBUILD_OSM=true.
set -euo pipefail

DATA="${ORS_HOME:-/data}"
OSM_URL="${OSM_URL:-https://download.geofabrik.de/europe/austria-latest.osm.pbf}"
OSM_FILE="${DATA}/files/osm-extract.osm.pbf"
# Written only after a complete download: a file that broke off is never taken for the extract.
MARKER="${DATA}/files/osm-extract.url"

mkdir -p "${DATA}/files"
if [ "${REBUILD_OSM:-false}" = "true" ] || [ ! -s "${OSM_FILE}" ] ||
  [ "$(cat "${MARKER}" 2>/dev/null || true)" != "${OSM_URL}" ]; then
  echo "[ors] downloading the OSM extract: ${OSM_URL}"
  rm -f "${OSM_FILE}.partial" "${MARKER}"
  wget -q -O "${OSM_FILE}.partial" "${OSM_URL}"
  mv "${OSM_FILE}.partial" "${OSM_FILE}"
  echo "${OSM_URL}" > "${MARKER}"
  echo "[ors] extract ready ($(du -h "${OSM_FILE}" | cut -f1)); the graph is rebuilt from it"
  export REBUILD_GRAPHS=true
else
  echo "[ors] OSM extract already on the volume ($(du -h "${OSM_FILE}" | cut -f1))"
fi

exec /entrypoint.sh "$@"
