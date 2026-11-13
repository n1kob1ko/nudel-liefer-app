#!/usr/bin/env bash
# Installs the nightly database backup on the production server (NUD-197). Run as root ON THE
# SERVER, from the deployed app:
#
#   bash /opt/delivery-app/deploy/backup/install.sh
#
# It is safe to run again (after a deploy that changed the unit files, or on a new server). It
#   1. creates /var/backups/nudel/db (owner deliveryapp, 0700) and leaves everything else in
#      /var/backups/nudel untouched,
#   2. creates /etc/nudel-backup.env (root, 0600) with the off-site settings commented out - an
#      existing file is never overwritten,
#   3. installs and enables nudel-backup.service + nudel-backup.timer,
#   4. takes one backup right away and shows the result.
# It never prints a secret, never touches the database (pg_dump only reads) and never restarts
# the app.
set -euo pipefail

APP_DIR=/opt/delivery-app
APP_USER=deliveryapp
APP_ENV=/etc/delivery-app.env
BACKUP_ENV=/etc/nudel-backup.env
BACKUP_DIR=/var/backups/nudel
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root (sudo bash $0)"
command -v systemctl >/dev/null || die "systemd is required"
id "$APP_USER" >/dev/null 2>&1 || die "the user $APP_USER does not exist: is this the app server?"
[ -f "$APP_ENV" ] || die "$APP_ENV is missing: is this the app server?"
[ -f "$APP_DIR/scripts/backup/pg-backup.ts" ] || die "$APP_DIR/scripts/backup/pg-backup.ts is missing: deploy the app first"
grep -q "BACKUP_LOCAL_DIR" "$APP_DIR/scripts/lib/backup.ts" \
  || die "the app in $APP_DIR is older than NUD-197 (no BACKUP_LOCAL_DIR): deploy the current version first"
[ -f "$APP_DIR/node_modules/tsx/dist/cli.mjs" ] || die "$APP_DIR/node_modules/tsx is missing: run 'pnpm install --frozen-lockfile' in $APP_DIR (docs/deploy.md 13.0)"
[ -x /usr/bin/node ] || die "/usr/bin/node is missing"
command -v pg_dump >/dev/null || die "pg_dump is missing: apt install postgresql-client"
command -v pg_restore >/dev/null || die "pg_restore is missing: apt install postgresql-client"

say "1. backup folder $BACKUP_DIR/db"
mkdir -p "$BACKUP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$BACKUP_DIR/db"

say "2. $BACKUP_ENV (off-site bucket, optional)"
if [ -e "$BACKUP_ENV" ]; then
  echo "exists, left as it is"
else
  ( umask 077; cat > "$BACKUP_ENV" <<'ENV'
# Off-site copy of the nightly database backup (NUD-197). Read by nudel-backup.service only.
# Without these four lines the backups exist only on this server, in /var/backups/nudel/db.
# Fill them in (no quotes, no spaces around "="), remove the "#", then run:
#   systemctl start nudel-backup && journalctl -u nudel-backup -n 20 --no-pager
#
# Cloudflare R2: endpoint https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com (EU jurisdiction),
# a PRIVATE bucket used for backups only, and an API token limited to that bucket
# (Object Read & Write). Any other S3-compatible storage works the same way.
#BACKUP_S3_ENDPOINT=
#BACKUP_S3_BUCKET=nudel-backups
#BACKUP_S3_ACCESS_KEY_ID=
#BACKUP_S3_SECRET_ACCESS_KEY=
#
# Optional. Region of the bucket (R2: auto) and how long backups are kept (weeks).
#BACKUP_S3_REGION=auto
#BACKUP_RETENTION_WEEKS=8
ENV
  )
  chown root:root "$BACKUP_ENV"
  chmod 600 "$BACKUP_ENV"
  echo "created (all settings commented out)"
fi

say "3. systemd units"
install -o root -g root -m 644 "$HERE/nudel-backup.service" /etc/systemd/system/nudel-backup.service
install -o root -g root -m 644 "$HERE/nudel-backup.timer" /etc/systemd/system/nudel-backup.timer
systemctl daemon-reload
systemctl enable --now nudel-backup.timer >/dev/null
systemctl list-timers nudel-backup.timer --no-pager | sed -n '1,2p'

say "4. first backup (this can take a minute)"
if systemctl start nudel-backup.service; then
  journalctl -u nudel-backup.service -n 12 --no-pager -o cat
  echo
  ls -l "$BACKUP_DIR/db"
  say "DONE. The backup now runs every night at 02:23 UTC."
  grep -Eq '^BACKUP_S3_BUCKET=.+' "$BACKUP_ENV" \
    || echo "NOTE: no off-site copy yet. Fill in $BACKUP_ENV to copy every backup to a bucket as well."
else
  journalctl -u nudel-backup.service -n 30 --no-pager -o cat || true
  die "the first backup failed (see the lines above); the timer stays installed and tries again every night"
fi
