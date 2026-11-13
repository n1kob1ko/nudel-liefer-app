#!/usr/bin/env bash
# Runs ON the vServer as root (NUD-127). Installs or updates the Nudel Liefer App under
# https://<host>/delivery-app/ next to the existing sites (the quiz app stays untouched).
#
# RETIRED HOST WARNING (2026-11-04): the vServer 87.106.60.131 was retired and its data migrated
# to the dedicated server 65.109.100.79, which serves the app at the ROOT of nudel.stragas.com
# (no /delivery-app/ prefix, own nginx vhost). This script still builds the old sub-path layout and
# rewrites /etc/delivery-app.env, so running it against the new server would break the live site.
# It refuses to run for that host; a root-path variant has to be written before deploying again.
#
# Usage: bash server-setup.sh <public-ip-or-domain> /tmp/nudel-delivery-app.tgz
#
# Idempotent: re-running is the normal update path. Every step is safe to repeat; secrets are
# generated once and re-used from /etc/delivery-app.env.
set -euo pipefail

PUBLIC_HOST="$1"; ARCHIVE="$2"
APP_DIR=/opt/delivery-app
DATA_DIR=/var/lib/delivery-app
ENV_FILE=/etc/delivery-app.env
SERVICE=delivery-app
PORT=3100
BASE_PATH=/delivery-app
DB_NAME=nudel
DB_USER=nudel
BUCKET=nudel-photos
MINIO_PORT=9000
S3_PUBLIC_ENDPOINT="https://${PUBLIC_HOST}"

log(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# Hosts this script must never touch. 87.106.60.131 is retired; 65.109.100.79 runs the root-path
# deployment this script cannot produce (see the header).
case "$PUBLIC_HOST" in
  87.106.60.131)
    fail "87.106.60.131 is RETIRED (since 2026-11-04). Production is nudel.stragas.com on 65.109.100.79."
    ;;
  65.109.100.79|nudel.stragas.com)
    fail "$PUBLIC_HOST runs the root-path deployment (nginx vhost /etc/nginx/sites-available/nudel-stragas). This script builds the old /delivery-app/ sub-path layout and would overwrite /etc/delivery-app.env - refusing."
    ;;
esac

[ "$(id -u)" = "0" ] || fail "run as root"
[ -f "$ARCHIVE" ] || fail "archive not found: $ARCHIVE"

# ---------------------------------------------------------------------------------------------
log "0. Preconditions (RAM, disk)"
total_mb=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)
avail_mb=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)
free_mb=$(df -Pm / | awk 'NR==2{print $4}')
echo "RAM total ${total_mb} MB / available ${avail_mb} MB, disk free ${free_mb} MB"
if [ "$total_mb" -lt 2600 ] && ! swapon --show | grep -q .; then
  log "1. Adding a 2 GB swap file (next build needs more than ${total_mb} MB of RAM)"
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile && mkswap /swapfile
  fi
  swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  free -m | head -3
else
  log "1. Swap: nothing to do"
fi

# ---------------------------------------------------------------------------------------------
log "2. Node.js >= 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  apt-get update -y && apt-get install -y curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
NODE_BIN=$(command -v node)

log "3. pnpm 12.14.0"
if ! command -v pnpm >/dev/null || [ "$(pnpm -v 2>/dev/null | cut -d. -f1)" != "12" ]; then
  # A real global install, not only a corepack shim: the build runs as the service user, whose HOME
  # (/var/lib/delivery-app) would otherwise have to download and cache the pinned pnpm first.
  if ! npm install -g pnpm@12.14.0 >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 && corepack prepare pnpm@12.14.0 --activate >/dev/null 2>&1
  fi
fi
pnpm -v
PNPM_BIN=$(command -v pnpm)

# ---------------------------------------------------------------------------------------------
log "4. PostgreSQL 16"
if ! command -v psql >/dev/null; then
  apt-get update -y && apt-get install -y postgresql postgresql-contrib
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true
psql --version

# Secrets: generated once, re-used on every later run (a new DB password would lock the service out
# and a new AUTH_SECRET would log everyone out).
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
AUTH_SECRET_VALUE="${AUTH_SECRET:-$(openssl rand -base64 32)}"
CRON_SECRET_VALUE="${CRON_SECRET:-$(openssl rand -base64 32)}"
MINIO_ROOT_USER="${S3_ACCESS_KEY_ID:-nudelstorage}"
MINIO_ROOT_PASSWORD="${S3_SECRET_ACCESS_KEY:-$(openssl rand -hex 24)}"

id deliveryapp >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin deliveryapp
mkdir -p "$DATA_DIR"

sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END \$\$;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi
echo "database ${DB_NAME} / role ${DB_USER} ready"

# ---------------------------------------------------------------------------------------------
log "5. MinIO (object storage, mandatory in production)"
if ! command -v docker >/dev/null; then
  fail "docker is missing - install it or switch this step to the MinIO static binary"
fi
if [ "$(docker inspect -f '{{.State.Running}}' delivery-app-minio 2>/dev/null || echo false)" != "true" ]; then
  docker rm -f delivery-app-minio >/dev/null 2>&1 || true
  docker run -d --name delivery-app-minio --restart unless-stopped \
    -p "127.0.0.1:${MINIO_PORT}:9000" \
    -v delivery-app-minio:/data \
    -e MINIO_ROOT_USER="$MINIO_ROOT_USER" \
    -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
    chainguard/minio:latest server /data >/dev/null
fi
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${MINIO_PORT}/minio/health/live" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:${MINIO_PORT}/minio/health/live" >/dev/null || fail "MinIO did not become healthy"
docker run --rm --network host -e "MC_HOST_local=http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:${MINIO_PORT}" \
  chainguard/minio-client:latest mb --ignore-existing "local/${BUCKET}" >/dev/null
echo "minio up on 127.0.0.1:${MINIO_PORT}, bucket ${BUCKET} present"

# ---------------------------------------------------------------------------------------------
log "6. Code -> $APP_DIR"
rm -rf "$APP_DIR.new" && mkdir -p "$APP_DIR.new"
tar -xzf "$ARCHIVE" -C "$APP_DIR.new"
[ -f "$APP_DIR.new/.env" ] && fail "refusing: the archive contains .env (secrets must not be on the server)"
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$APP_DIR.new" "$APP_DIR"
mkdir -p "$APP_DIR/.next"
chown -R deliveryapp:deliveryapp "$APP_DIR" "$DATA_DIR"

log "7. Env file $ENV_FILE"
# Snapshot first: the block below is the complete list of keys this script manages. Operator-added
# keys (ANTHROPIC_API_KEY, ORS_API_KEY, DEEPL_API_KEY, MAP_TILE_URL, SENTRY_DSN, PHOTON_URL, ...)
# are NOT in it, and until 2026-10-28 the plain overwrite silently dropped them on every deploy -
# which would turn the AI order draft, real routing and the tile provider off without a word.
if [ -f "$ENV_FILE" ]; then cp -a "$ENV_FILE" "${ENV_FILE}.prev"; fi
cat > "$ENV_FILE" <<ENV
# Written by deploy/server-setup.sh (NUD-127). chmod 600. Never commit these values.
# Keys this script does not know are preserved from the previous file (see the loop below).
NODE_ENV=production
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
AUTH_SECRET=${AUTH_SECRET_VALUE}
S3_ENDPOINT=${S3_PUBLIC_ENDPOINT}
S3_REGION=us-east-1
S3_BUCKET=${BUCKET}
S3_ACCESS_KEY_ID=${MINIO_ROOT_USER}
S3_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD}
CRON_SECRET=${CRON_SECRET_VALUE}
AUDIT_RETENTION_DAYS=730
DRIVER_TEXT_RETENTION_DAYS=365
DATA_RETENTION_MODE=dry-run
SCREENSHOT_RETENTION_DAYS=180
ORPHAN_CLEANUP_MODE=dry-run
ORPHAN_CLEANUP_GRACE_DAYS=14
# The sub-path is part of the build AND of the running config: next start re-reads next.config.ts
# (basePath, headers), and the value must equal the one the client bundles were built with. Both
# come from this file so they cannot drift.
NEXT_PUBLIC_BASE_PATH=${BASE_PATH}
ENV
if [ -f "${ENV_FILE}.prev" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in \#*|"") continue ;; esac
    key="${line%%=*}"
    if [ -n "$key" ] && ! grep -q "^${key}=" "$ENV_FILE"; then
      printf '%s\n' "$line" >> "$ENV_FILE"
    fi
  done < "${ENV_FILE}.prev"
  rm -f "${ENV_FILE}.prev"
fi
# 640, not 600: the cron entries of docs/deploy.md 13.1 run as `deliveryapp` and source this file,
# so the service group must be able to read it. With 600 every scheduled job died on
# "cannot open /etc/delivery-app.env: Permission denied" (recurring orders, translation retries,
# retention, orphan cleanup) and kept exiting 2 without anybody noticing (NUD-167).
chmod 640 "$ENV_FILE"
chown root:deliveryapp "$ENV_FILE"

log "8. Dependencies, migrations, build (this takes several minutes)"
# The env file is exported into the shell (values are base64/hex, no quoting traps) and inherited by
# runuser; only HOME has to be set for the service user's own pnpm/prisma caches.
set -a; . "$ENV_FILE"; set +a
run_as_app() { runuser -u deliveryapp -- env HOME="$DATA_DIR" "$@"; }
cd "$APP_DIR"
# DATABASE_URL and NEXT_PUBLIC_BASE_PATH are passed explicitly as well: `runuser` normally keeps the
# environment, but if it ever did not, an unprefixed build would ship a broken app. The variable that
# decides the build must not depend on that subtlety.
run_as_app "$PNPM_BIN" install --frozen-lockfile
run_as_app env DATABASE_URL="$DATABASE_URL" "$PNPM_BIN" db:migrate
# Heap 2.5 GB (the default of ~1 GB ran out of memory with the grown app; swap covers the rest) and no
# second type-check pass inside `next build` (tsc runs before every deploy, see next.config.ts).
run_as_app env NEXT_PUBLIC_BASE_PATH="$BASE_PATH" SKIP_TYPECHECK=1 NODE_OPTIONS="--max-old-space-size=2560" "$PNPM_BIN" build
chown -R deliveryapp:deliveryapp "$APP_DIR"

log "9. systemd unit"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Nudel Liefer App (Next.js)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=deliveryapp
Group=deliveryapp
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=PORT=${PORT}
Environment=HOSTNAME=127.0.0.1
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} node_modules/next/dist/bin/next start
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/.next ${DATA_DIR}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

log "10. nginx"
setup_nginx() {
  cat > /etc/nginx/snippets/delivery-app.conf <<'NGX'
# The bare prefix has no page of its own: do NOT send /delivery-app to /delivery-app/. Next answers
# /delivery-app/ with its own 308 back to /delivery-app (trailing-slash rule, before the middleware),
# so the two would loop forever. Both forms go to the office entry point; the app picks the locale.
location = /delivery-app  { return 302 /delivery-app/admin; }
location = /delivery-app/ { return 302 /delivery-app/admin; }
location /delivery-app/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "";
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_buffer_size 16k;
    proxy_buffers 8 16k;
    proxy_busy_buffers_size 32k;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    client_max_body_size 20m;
    location = /delivery-app/sw.js { proxy_pass http://127.0.0.1:3100; add_header Cache-Control "no-cache, no-store, must-revalidate" always; }
    location = /delivery-app/offline.html { proxy_pass http://127.0.0.1:3100; add_header Cache-Control "no-cache" always; }
    location = /delivery-app/offline.js { proxy_pass http://127.0.0.1:3100; add_header Cache-Control "no-cache" always; }
    location /delivery-app/_next/static/ { proxy_pass http://127.0.0.1:3100; add_header Cache-Control "public, max-age=31536000, immutable" always; }
}
location /nudel-photos/ {
    proxy_pass http://127.0.0.1:9000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20m;
    add_header Cache-Control "private, max-age=0, no-store" always;
}
NGX
  cat > /etc/nginx/snippets/delivery-app-redirect.conf <<'NGX'
location ^~ /delivery-app { return 301 https://$host$request_uri; }
NGX
  local bak=/root/nginx-backup-$(date +%Y%m%d-%H%M%S)
  cp -a /etc/nginx "$bak"; echo "nginx backup: $bak"

  python3 - <<'PYIN'
import glob, os, re
files = [f for f in glob.glob('/etc/nginx/sites-enabled/*') + glob.glob('/etc/nginx/conf.d/*.conf')
         if os.path.isfile(f)]
for f in files:
    src = open(f).read()
    out, i, changed = [], 0, False
    for m in re.finditer(r'(?m)^[ \t]*server[ \t]*\{', src):
        depth, j = 0, m.end() - 1
        while j < len(src):
            if src[j] == '{': depth += 1
            elif src[j] == '}':
                depth -= 1
                if depth == 0: break
            j += 1
        body = src[m.end():j]
        if 'delivery-app' in body:
            continue
        body_nc = re.sub(r'#.*', '', body)
        https = re.search(r'listen\s+[^;]*(443|ssl)', body_nc)
        inc = 'snippets/delivery-app.conf' if https else 'snippets/delivery-app-redirect.conf'
        out.append(src[i:m.end()]); out.append('\n    include %s;  # added by the delivery-app deploy' % inc); i = m.end(); changed = True
    if changed:
        out.append(src[i:]); open(f, 'w').write(''.join(out)); print('updated', f)
PYIN
  if nginx -t; then
    systemctl reload nginx
  else
    echo "nginx config test failed - restoring the backup"
    rm -rf /etc/nginx; cp -a "$bak" /etc/nginx; nginx -t && systemctl reload nginx; exit 1
  fi
}
if systemctl is-active --quiet nginx; then
  setup_nginx
else
  fail "nginx is not active - configure the reverse proxy by hand (see deploy/delivery-app.nginx.conf)"
fi

log "11. Health checks"
sleep 3
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 40 --no-pager; fail "service not active"; }
curl -fsS "http://127.0.0.1:${PORT}${BASE_PATH}/api/health" | tee /tmp/health.json
grep -q '"status":"ok"' /tmp/health.json || fail "health check is not ok"
curl -fsS -o /dev/null -w "https://${PUBLIC_HOST}${BASE_PATH}/ -> HTTP %{http_code}\n" "https://${PUBLIC_HOST}${BASE_PATH}/"
curl -fsS -o /dev/null -w "https://${PUBLIC_HOST}/quiz/ -> HTTP %{http_code} (must stay as before)\n" "https://${PUBLIC_HOST}/quiz/" || true

cat <<DONE

Done.
  Office:  https://${PUBLIC_HOST}${BASE_PATH}/de/login
  Driver:  https://${PUBLIC_HOST}${BASE_PATH}/de/driver/login
  Health:  https://${PUBLIC_HOST}${BASE_PATH}/api/health

Next (once, as the office): the depot pin must be confirmed before any tour can be created.
Seeding an admin/demo data is a separate, deliberate step - see the ticket notes.
Rollback: mv ${APP_DIR} ${APP_DIR}.failed && mv ${APP_DIR}.old ${APP_DIR} && systemctl restart ${SERVICE}
          (migrations are forward-only and are NOT rolled back)
Logs:     journalctl -u ${SERVICE} -n 200 -f
DONE
