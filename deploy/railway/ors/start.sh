#!/usr/bin/env bash
# openrouteservice on Railway (NUD-202): fetches the OSM extract onto the volume on the first
# start, then hands over to the image's own entrypoint, which builds the car graph (Austria: about
# 15 minutes and 4 GB of RAM, once) and serves on port 8082 under /ors.
#
# OSM_URL may hold several addresses separated by spaces; they are tried in order and the first
# complete download wins. The default has two because download.geofabrik.de refuses connections
# from Railway's outbound addresses (seen 2026-11-13, "Connection refused" on port 443).
#
# A changed OSM_URL downloads the extract again and rebuilds the graph. To refresh the same
# extract (newer map data), start the service once with REBUILD_OSM=true.
set -euo pipefail

DATA="${ORS_HOME:-/data}"
OSM_URL="${OSM_URL:-https://download.geofabrik.de/europe/austria-latest.osm.pbf https://download.openstreetmap.fr/extracts/europe/austria-latest.osm.pbf}"
OSM_FILE="${DATA}/files/osm-extract.osm.pbf"
# Written only after a complete download: a file that broke off is never taken for the extract.
MARKER="${DATA}/files/osm-extract.url"

mkdir -p "${DATA}/files"
if [ "${REBUILD_OSM:-false}" = "true" ] || [ ! -s "${OSM_FILE}" ] ||
  [ "$(cat "${MARKER}" 2>/dev/null || true)" != "${OSM_URL}" ]; then
  rm -f "${OSM_FILE}.partial"
  fetched=""
  for url in ${OSM_URL}; do
    echo "[ors] downloading the OSM extract: ${url}"
    # -S prints the answer's headers, so the log shows the age of the file (Last-Modified).
    if wget -q -S -O "${OSM_FILE}.partial" "${url}" && [ -s "${OSM_FILE}.partial" ]; then
      fetched="${url}"
      break
    fi
    echo "[ors] no download from ${url}" >&2
    rm -f "${OSM_FILE}.partial"
  done
  if [ -n "${fetched}" ]; then
    mv "${OSM_FILE}.partial" "${OSM_FILE}"
    echo "${OSM_URL}" > "${MARKER}"
    echo "[ors] extract ready from ${fetched} ($(du -h "${OSM_FILE}" | cut -f1)); the graph is rebuilt from it"
    export REBUILD_GRAPHS=true
  elif [ -s "${OSM_FILE}" ] && [ -s "${MARKER}" ]; then
    # The marker keeps the old value, so the next start tries the download again.
    echo "[ors] no address in OSM_URL delivered the extract; serving the one already on the volume" >&2
  else
    echo "[ors] no address in OSM_URL delivered the extract" >&2
    # Without this pause the restart policy would use up its attempts within seconds.
    sleep 30
    exit 1
  fi
else
  echo "[ors] OSM extract already on the volume ($(du -h "${OSM_FILE}" | cut -f1))"
fi

exec /entrypoint.sh "$@"
