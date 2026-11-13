#!/usr/bin/env bash
# Photon geocoder on Railway (NUD-202): unpacks the search index onto the volume on the first
# start (Austria: about 1 GB to download), then serves on port 2322.
#
# A changed PHOTON_INDEX_URL downloads the new index. The old one is replaced only after the new
# one is completely unpacked, so a download that breaks off leaves the service as it was.
set -euo pipefail

DATA="${PHOTON_DATA_DIR:-/data}"
INDEX_URL="${PHOTON_INDEX_URL:-https://download1.graphhopper.com/public/europe/austria/photon-db-austria-1.0-latest.tar.bz2}"
MARKER="${DATA}/photon/index.url"

if [ ! -d "${DATA}/photon/photon_data" ] ||
  [ "$(cat "${MARKER}" 2>/dev/null || true)" != "${INDEX_URL}" ]; then
  echo "[photon] downloading the search index: ${INDEX_URL}"
  rm -rf "${DATA}/photon.partial"
  mkdir -p "${DATA}/photon.partial"
  curl -fSL --retry 3 --retry-delay 5 "${INDEX_URL}" | tar -xj -C "${DATA}/photon.partial"
  if [ ! -d "${DATA}/photon.partial/photon_data" ]; then
    echo "[photon] the archive holds no photon_data folder - wrong PHOTON_INDEX_URL?" >&2
    exit 1
  fi
  rm -rf "${DATA}/photon"
  mv "${DATA}/photon.partial" "${DATA}/photon"
  echo "${INDEX_URL}" > "${MARKER}"
  echo "[photon] index ready ($(du -sh "${DATA}/photon/photon_data" | cut -f1))"
else
  echo "[photon] index already on the volume ($(du -sh "${DATA}/photon/photon_data" | cut -f1))"
fi

# shellcheck disable=SC2086 # JAVA_OPTS is a list of options
exec java ${JAVA_OPTS:--Xmx1g} -jar /app/photon.jar serve \
  -data-dir "${DATA}/photon" \
  -listen-ip 0.0.0.0 -listen-port 2322 \
  -default-language "${PHOTON_LANG:-de}"
