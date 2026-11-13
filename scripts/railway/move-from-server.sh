#!/usr/bin/env bash
#
# Moves the data of the old dedicated server to Railway (NUD-202, docs/deploy-railway.md section 9):
# the database, the photos, and at the end it shows the provider variables to enter on Railway.
#
# Runs ON THE OLD SERVER as root, where the database and MinIO listen on 127.0.0.1:
#
#   curl -fsSL https://raw.githubusercontent.com/n1kob1ko/nudel-liefer-app/main/scripts/railway/move-from-server.sh -o /root/umzug.sh && bash /root/umzug.sh
#
# It only reads on the old server (the dump is a temporary file, removed again) and REPLACES the
# Railway database and adds to the Railway photo bucket. It can be run again: the database is
# replaced again, photos that are already there are skipped.
#
# The one thing it asks for is the "Railway line" (hidden input), a single value that holds where
# to write:
#
#   <public database URL>|<bucket endpoint>|<bucket region>|<bucket name>|<access key id>|<secret access key>
#
# On Railway it is a variable made of references, so nobody has to type its parts (section 9).
#
# Options: --skip-db, --skip-photos, --yes (no question before the database is replaced).
# For tests: ENV_FILE, APP_DIR, MOVE_TARGET (instead of the hidden input), MOVE_S3_URL_STYLE.
set -euo pipefail
umask 077

ENV_FILE=${ENV_FILE:-/etc/delivery-app.env}
APP_DIR=${APP_DIR:-/opt/delivery-app}
SKIP_DB=0
SKIP_PHOTOS=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --skip-db) SKIP_DB=1 ;;
    --skip-photos) SKIP_PHOTOS=1 ;;
    --yes) ASSUME_YES=1 ;;
    *)
      echo "Unbekannte Option: $arg (erlaubt: --skip-db, --skip-photos, --yes)" >&2
      exit 1
      ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
fail() {
  printf '\nFEHLER: %s\n' "$*" >&2
  exit 1
}

# libpq refuses Prisma's own URL parameters (?schema=..., ?connection_limit=...): keep only sslmode.
libpq_url() {
  local url=$1 base=${1%%\?*} sslmode
  sslmode=$(printf '%s' "$url" | grep -oE '[?&]sslmode=[a-z-]+' | head -n1 | cut -d= -f2 || true)
  if [ -n "$sslmode" ]; then printf '%s?sslmode=%s' "$base" "$sslmode"; else printf '%s' "$base"; fi
}

# "table rows" for every table of the public schema, exact counts.
table_counts() {
  psql "$1" -X -At -F ' ' -v ON_ERROR_STOP=1 -c "
    select c.relname,
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege(c.oid, 'SELECT')
    order by c.relname" </dev/null
}
# Tables the app's own database user may not read: left-over manual copies made by another role
# (seen: "StandingTourCustomer_backup_20261105"). The app does not know them; they stay behind.
unreadable_tables() {
  psql "$1" -X -At -v ON_ERROR_STOP=1 -c "
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and not has_table_privilege(c.oid, 'SELECT')
    order by c.relname" </dev/null
}
sum_rows() { awk '{ n += $2 } END { print n + 0 }'; }

# ---------------------------------------------------------------------------------------------
say "Umzug nach Railway: Vorbereitung"

[ -r "$ENV_FILE" ] || fail "$ENV_FILE ist nicht lesbar. Bist du als root auf dem alten Server angemeldet?"
for tool in psql pg_dump pg_restore; do
  command -v "$tool" >/dev/null || fail "$tool fehlt auf diesem Server."
done
if [ "$SKIP_PHOTOS" = 0 ]; then
  command -v node >/dev/null || fail "node fehlt auf diesem Server."
  [ -d "$APP_DIR/node_modules/@aws-sdk/client-s3" ] ||
    fail "$APP_DIR/node_modules/@aws-sdk/client-s3 fehlt (wird für die Fotos gebraucht)."
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

SOURCE_DB=$(libpq_url "${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}")
[ -n "$SOURCE_DB" ] || fail "In $ENV_FILE steht keine DATABASE_URL."

if [ -z "${MOVE_TARGET:-}" ]; then
  echo "Füge jetzt die Railway-Zeile ein (sie wird nicht angezeigt) und drücke Enter."
  read -rs -p "Railway-Zeile: " MOVE_TARGET || true
  echo
fi
MOVE_TARGET=$(printf '%s' "$MOVE_TARGET" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
case "$MOVE_TARGET" in
  *'${{'*) fail 'Die Zeile enthält noch "${{...}}": das ist die Formel, nicht der Wert. In Railway den Wert der Variable kopieren.' ;;
esac
IFS='|' read -r TARGET_DB T_ENDPOINT T_REGION T_BUCKET T_KEY T_SECRET T_REST <<<"$MOVE_TARGET"
if [ -z "${T_SECRET:-}" ] || [ -n "${T_REST:-}" ]; then
  fail "Die Railway-Zeile hat nicht die erwarteten 6 Teile. Bitte noch einmal kopieren und einfügen."
fi
case "$TARGET_DB" in
  postgres://* | postgresql://*) ;;
  *) fail "Die Railway-Zeile beginnt nicht mit einer Datenbank-Adresse (postgresql://...)." ;;
esac
case "$T_ENDPOINT" in
  https://* | http://127.0.0.1:* | http://localhost:*) ;;
  *) fail "Der zweite Teil der Railway-Zeile ist keine https-Adresse." ;;
esac
TARGET_DB=$(libpq_url "$TARGET_DB")
[ "$TARGET_DB" != "$SOURCE_DB" ] || fail "Ziel und Quelle sind dieselbe Datenbank."

psql "$SOURCE_DB" -X -At -c 'select 1' </dev/null >/dev/null 2>&1 || fail "Die alte Datenbank antwortet nicht."
# pg_dump must not be older than the server it reads: prefer the client of the server's own version.
server_major=$(psql "$SOURCE_DB" -X -At -c "select current_setting('server_version_num')::int / 10000" </dev/null)
if [ -x "/usr/lib/postgresql/$server_major/bin/pg_dump" ]; then
  PATH="/usr/lib/postgresql/$server_major/bin:$PATH"
fi
client_major=$(pg_dump --version | grep -oE '[0-9]+' | head -n1)
[ "$client_major" -ge "$server_major" ] ||
  fail "pg_dump ist Version $client_major, die Datenbank Version $server_major. Es fehlt postgresql-client-$server_major."
psql "$TARGET_DB" -X -At -c 'select 1' </dev/null >/dev/null 2>&1 ||
  fail "Die Railway-Datenbank ist von hier nicht erreichbar (Adresse, Passwort oder der öffentliche Zugang fehlt)."

WORK=$(mktemp -d /root/nudel-move.XXXXXX 2>/dev/null || mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------------------------------------
if [ "$SKIP_DB" = 0 ]; then
  say "Datenbank"
  table_counts "$SOURCE_DB" >"$WORK/source.counts"
  unreadable_tables "$SOURCE_DB" >"$WORK/source.skipped"
  exclude=()
  while IFS= read -r table; do
    [ -n "$table" ] || continue
    echo "Bleibt zurück (gehört nicht zur App, für sie nicht lesbar): $table"
    exclude+=("--exclude-table=public.\"$table\"")
  done <"$WORK/source.skipped"
  table_counts "$TARGET_DB" >"$WORK/target-before.counts"
  echo "Alter Server:  $(wc -l <"$WORK/source.counts") Tabellen, $(sum_rows <"$WORK/source.counts") Zeilen"
  echo "Railway jetzt: $(wc -l <"$WORK/target-before.counts") Tabellen, $(sum_rows <"$WORK/target-before.counts") Zeilen (wird ersetzt)"
  if [ "$ASSUME_YES" = 0 ]; then
    answer=""
    read -r -p "Railway-Datenbank jetzt durch die Daten des alten Servers ersetzen? Tippe ja: " answer || true
    [ "$answer" = "ja" ] || fail "Abgebrochen, nichts wurde geändert."
  fi

  echo "Lese die alte Datenbank ..."
  pg_dump -Fc --no-owner --no-acl "${exclude[@]}" -d "$SOURCE_DB" -f "$WORK/nudel.dump" </dev/null
  echo "Schreibe nach Railway ..."
  psql "$TARGET_DB" -X -q -v ON_ERROR_STOP=1 -c 'drop schema if exists public cascade; create schema public;' </dev/null 2>/dev/null
  restore_status=0
  pg_restore --no-owner --no-acl -d "$TARGET_DB" "$WORK/nudel.dump" </dev/null 2>"$WORK/restore.log" || restore_status=$?
  rm -f "$WORK/nudel.dump"

  table_counts "$TARGET_DB" >"$WORK/target.counts"
  if ! diff "$WORK/source.counts" "$WORK/target.counts" >"$WORK/counts.diff"; then
    echo "Tabellen mit anderer Zeilenzahl (< alter Server, > Railway):"
    grep -E '^[<>]' "$WORK/counts.diff" || true
    # Only the error lines: a CONTEXT line could quote a row.
    grep -E 'error:' "$WORK/restore.log" | head -n 10 || true
    fail "Die Datenbank auf Railway stimmt nicht mit dem alten Server überein."
  fi
  if [ "$restore_status" != 0 ]; then
    echo "Hinweis: pg_restore meldete $(grep -c 'error:' "$WORK/restore.log" || true) Meldung(en); die Zeilenzahlen stimmen trotzdem:"
    grep -E 'error:' "$WORK/restore.log" | head -n 5 || true
  fi
  echo "OK: $(wc -l <"$WORK/target.counts") Tabellen, $(sum_rows <"$WORK/target.counts") Zeilen, jede Tabelle hat dieselbe Zeilenzahl wie auf dem alten Server."
else
  say "Datenbank: übersprungen (--skip-db)"
fi

# ---------------------------------------------------------------------------------------------
if [ "$SKIP_PHOTOS" = 0 ]; then
  say "Fotos"
  if [ -z "${S3_BUCKET:-}" ] || [ -z "${S3_ACCESS_KEY_ID:-}" ] || [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; then
    fail "In $ENV_FILE fehlen S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY."
  fi
  (
    cd "$APP_DIR"
    MOVE_T_ENDPOINT=$T_ENDPOINT MOVE_T_REGION=$T_REGION MOVE_T_BUCKET=$T_BUCKET \
      MOVE_T_KEY=$T_KEY MOVE_T_SECRET=$T_SECRET MOVE_T_STYLE=${MOVE_S3_URL_STYLE:-virtual} \
      node - <<'JS'
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const env = process.env;
const make = (endpoint, region, key, secret, pathStyle) =>
  new S3Client({
    endpoint: endpoint || undefined,
    region: region || "auto",
    forcePathStyle: pathStyle,
    credentials: { accessKeyId: key, secretAccessKey: secret },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
// The old server's rule: path style whenever an endpoint is set (MinIO).
const sourceStyle = (env.S3_URL_STYLE || "").trim().toLowerCase();
const source = make(
  env.S3_ENDPOINT,
  env.S3_REGION,
  env.S3_ACCESS_KEY_ID,
  env.S3_SECRET_ACCESS_KEY,
  sourceStyle === "virtual" ? false : Boolean(env.S3_ENDPOINT),
);
const target = make(
  env.MOVE_T_ENDPOINT,
  env.MOVE_T_REGION,
  env.MOVE_T_KEY,
  env.MOVE_T_SECRET,
  env.MOVE_T_STYLE !== "virtual",
);
const sourceBucket = env.S3_BUCKET;
const targetBucket = env.MOVE_T_BUCKET;

async function listAll(client, bucket) {
  const sizes = new Map();
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) sizes.set(object.Key, object.Size ?? 0);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return sizes;
}

async function copy(key) {
  const got = await source.send(new GetObjectCommand({ Bucket: sourceBucket, Key: key }));
  const body = Buffer.from(await got.Body.transformToByteArray());
  await target.send(
    new PutObjectCommand({
      Bucket: targetBucket,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: got.ContentType,
      CacheControl: got.CacheControl,
    }),
  );
}

// Never the error's own text: it can carry a signed request.
const reason = (error) =>
  `${error?.name ?? "Error"}${error?.$metadata?.httpStatusCode ? ` (HTTP ${error.$metadata.httpStatusCode})` : ""}`;

async function main() {
  let have;
  let there;
  try {
    have = await listAll(source, sourceBucket);
  } catch (error) {
    console.error(`Der alte Foto-Speicher antwortet nicht: ${reason(error)}`);
    return 2;
  }
  try {
    there = await listAll(target, targetBucket);
  } catch (error) {
    console.error(`Der Railway-Speicher antwortet nicht: ${reason(error)}`);
    return 2;
  }
  const todo = [...have.keys()].filter((key) => there.get(key) !== have.get(key));
  const bytes = [...have.values()].reduce((sum, size) => sum + size, 0);
  console.log(
    `Alter Server: ${have.size} Dateien (${(bytes / 1e6).toFixed(1)} MB). Auf Railway schon da: ${have.size - todo.length}. Zu kopieren: ${todo.length}.`,
  );
  let done = 0;
  const failed = [];
  const worker = async () => {
    for (;;) {
      const key = todo.shift();
      if (key === undefined) return;
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await copy(key);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) failed.push(`${key}: ${reason(lastError)}`);
      done += 1;
      if (done % 50 === 0) console.log(`  ${done} kopiert ...`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const after = await listAll(target, targetBucket);
  const missing = [...have.keys()].filter((key) => after.get(key) !== have.get(key));
  if (failed.length > 0 || missing.length > 0) {
    for (const line of failed.slice(0, 10)) console.error(`  nicht kopiert: ${line}`);
    console.error(
      `${missing.length} von ${have.size} Dateien fehlen auf Railway. Den Befehl mit --skip-db noch einmal starten: er macht dort weiter.`,
    );
    return 2;
  }
  console.log(`OK: alle ${have.size} Dateien sind auf Railway, jede mit derselben Größe.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`Fotos: unerwarteter Fehler (${reason(error)})`);
    process.exit(2);
  },
);
JS
  ) || fail "Die Fotos sind nicht vollständig auf Railway."
else
  say "Fotos: übersprungen (--skip-photos)"
fi

# ---------------------------------------------------------------------------------------------
say "Schlüssel der Anbieter"
# What only this server knows and Railway needs. Everything else in the file (database, bucket,
# AUTH_SECRET, CRON_SECRET, ORS_*, PHOTON_*) has its own value on Railway and is not copied. The
# OpenRouter key is not carried over either: the language model is Claude now (ANTHROPIC_API_KEY,
# NUD-207), with a key of its own that is entered on Railway directly.
WANTED="MAP_TILE_URL MAP_TILE_ATTRIBUTION MAP_TILE_CACHE DEEPL_API_KEY DEEPL_API_PLAN SENTRY_DSN SENTRY_ENVIRONMENT"
lines=""
for name in $WANTED; do
  value=${!name:-}
  [ -n "$value" ] || continue
  case "$value" in
    *[!A-Za-z0-9_./:@%+=,{}?\&~-]*)
      case "$value" in
        *"'"*) value="\"$(printf '%s' "$value" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')\"" ;;
        *) value="'$value'" ;;
      esac
      ;;
  esac
  lines="$lines$name=$value"$'\n'
done
if [ -n "$lines" ]; then
  echo "Diese Zeilen in Railway eintragen: Dienst \"app\" > Variables > Raw Editor, unten anfügen, speichern."
  echo "Sie sind geheim: nicht in einen Chat kopieren."
  echo "-----8<-----"
  printf '%s' "$lines"
  echo "-----8<-----"
else
  echo "In $ENV_FILE steht keiner der Anbieter-Schlüssel (Karte, DeepL, Sentry)."
fi

say "Fertig"
echo "Dieser Server wurde nur gelesen, die alte App läuft weiter."
echo "Was ab jetzt noch in der alten App eingetragen wird, kommt nicht mehr mit."
