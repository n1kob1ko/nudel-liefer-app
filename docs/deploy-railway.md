# Deployment on Railway (NUD-202)

Since 2026-11-13 the app is set up on [Railway](https://railway.com): project `routenplanner` in the owner's workspace, environment `production`, region Europe West (Amsterdam). This page is the source of truth for that setup. The dedicated server (`docs/deploy.md` section 13) is the previous home; it is not touched by anything here.

Nothing in this setup lives in a `railway.json`: Railway's Config as Code is deprecated and new services cannot opt in. The settings below are applied in the Railway dashboard or through the Railway connector, and this page is where they are written down. **When a setting is changed on Railway, change it here in the same pull request.**

Contents: 1 What runs where, 2 Service settings, 3 Variables, 4 Deploying, 5 Scheduled jobs, 6 Backup, 7 Routing and geocoding, 8 Photos, 9 Moving the data from the old server, 10 Checks, 11 Costs, 12 Known limits.

## 1. What runs where

| Service    | What it is                                               | Built from                                           | Reachable                              |
| ---------- | -------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `app`      | the Next.js app                                          | repository root, Railpack (no Dockerfile)            | public, the `*.up.railway.app` address |
| `Postgres` | PostgreSQL 18, Railway's template, volume 5 GB           | image `ghcr.io/railwayapp-templates/postgres-ssl:18` | private network only                   |
| `photos`   | bucket for customer photos and order screenshots         | Railway bucket, region `ams`, private                | presigned URLs only                    |
| `backups`  | bucket for the nightly master-data dumps                 | Railway bucket, region `ams`, private                | the `backup` service only              |
| `cron`     | calls the app's `/api/cron/*` routes                     | `deploy/railway/cron` (Dockerfile)                   | nothing listens; runs every 5 minutes  |
| `backup`   | `pnpm backup:db`, master data only                       | repository root, `deploy/railway/backup/Dockerfile`  | nothing listens; runs every night      |
| `ors`      | openrouteservice 9.1.1 (routing), volume 5 GB at `/data` | `deploy/railway/ors` (Dockerfile)                    | `ors.railway.internal:8082`            |
| `photon`   | Photon 1.3.0 (geocoding), volume 5 GB at `/data`         | `deploy/railway/photon` (Dockerfile)                 | `photon.railway.internal:2322`         |

There is no nginx, no systemd unit, no `/etc/delivery-app.env` and no `/etc/hosts` entry: Railway terminates TLS, restarts a crashed service and injects the variables.

## 2. Service settings

| Service  | Root directory           | Build                                         | Pre-deploy                                                         | Start        | Schedule (UTC) | Other                                                                    |
| -------- | ------------------------ | --------------------------------------------- | ------------------------------------------------------------------ | ------------ | -------------- | ------------------------------------------------------------------------ |
| `app`    | `/`                      | `pnpm build:railway`                          | `pnpm db:migrate && pnpm bucket:cors --apply && pnpm bucket:check` | `pnpm start` | –              | health check `/api/health` (180 s), restart on failure (10 tries)        |
| `cron`   | `/deploy/railway/cron`   | Dockerfile                                    | –                                                                  | image        | `*/5 * * * *`  | restart never, watch `/deploy/railway/cron/**`                           |
| `backup` | `/`                      | Dockerfile `deploy/railway/backup/Dockerfile` | –                                                                  | image        | `23 2 * * *`   | restart never, watch paths see below                                     |
| `ors`    | `/deploy/railway/ors`    | Dockerfile                                    | –                                                                  | image        | –              | volume at `/data`, restart on failure, watch `/deploy/railway/ors/**`    |
| `photon` | `/deploy/railway/photon` | Dockerfile                                    | –                                                                  | image        | –              | volume at `/data`, restart on failure, watch `/deploy/railway/photon/**` |

- Every service and every volume is in `europe-west4-drams3a`. A new service starts in a US region by default, and so does the volume of a template (the `Postgres` volume was created in `sfo` and had to be replaced by a new one while the database was still empty; a volume cannot be moved). So: set the region of a service before its first deploy and name the region when a volume is created.
- Create services one after the other. Four created at the same moment (2026-11-13) left one of them missing and two unusable for some minutes.
- The pre-deploy command is one line joined with `&&`; Railway refuses a list of several commands.
- `app` is built by Railpack on purpose. The Content-Security-Policy is put together when the app is **built** (`next.config.ts` reads `S3_*`, `MAP_TILE_URL`, `SENTRY_DSN`), and a Railpack build sees every service variable; a Dockerfile would need each of them as a build argument. For the same reason there must never be a `Dockerfile` in the repository root: Railway would use it for `app`.
- `pnpm build:railway` runs `scripts/check-deploy-env.ts` first: a missing `CRON_SECRET`, a database on localhost, a missing bucket variable or an unknown `S3_URL_STYLE` stop the deploy with a readable list.
- `pnpm start` is plain `next start`: it listens on every interface (IPv4 and IPv6) and on `PORT`.
- Watch paths of `backup`: `/deploy/railway/backup/**`, `/scripts/backup/**`, `/scripts/lib/backup.ts`, `/src/lib/s3-url-style.ts`, `/package.json`, `/pnpm-lock.yaml`.

## 3. Variables

Values that are secrets are never written here. `${{...}}` is Railway's reference syntax: the value follows the other service, also after a password or key is rotated.

**Shared (environment):** `CRON_SECRET` (generated once, at least 32 characters).

**`app`**

| Variable                                                                                                       | Value                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                                                                         | `3000` (the public address routes to it, `cron` reads it)                                                                                                                            |
| `DATABASE_URL`                                                                                                 | `${{Postgres.DATABASE_URL}}`                                                                                                                                                         |
| `AUTH_SECRET`                                                                                                  | generated once (`openssl rand -base64 32`); a new value logs everybody out                                                                                                           |
| `CRON_SECRET`                                                                                                  | `${{shared.CRON_SECRET}}`                                                                                                                                                            |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                            | `${{photos.ENDPOINT}}`, `${{photos.BUCKET}}`, `${{photos.REGION}}`, `${{photos.ACCESS_KEY_ID}}`, `${{photos.SECRET_ACCESS_KEY}}`                                                     |
| `S3_URL_STYLE`                                                                                                 | `virtual` (a Railway bucket lives on `https://<bucket>.<endpoint host>`)                                                                                                             |
| `S3_CORS_ORIGINS`                                                                                              | `https://${{RAILWAY_PUBLIC_DOMAIN}}`; add further addresses comma separated when the app gets its own domain                                                                         |
| `ORS_BASE_URL`                                                                                                 | `http://ors.railway.internal:8082/ors`                                                                                                                                               |
| `PHOTON_URL`, `PHOTON_LANG`                                                                                    | `http://photon.railway.internal:2322`, `de`                                                                                                                                          |
| `SKIP_TYPECHECK`                                                                                               | `1` (as on the server: `pnpm typecheck` in CI is the gate)                                                                                                                           |
| `DATA_RETENTION_MODE`, `ORDER_RETENTION_MODE`, `ORPHAN_CLEANUP_MODE`                                           | `dry-run` each. **Deleting stays off until the owner asks for it.**                                                                                                                  |
| `AUDIT_RETENTION_DAYS`, `DRIVER_TEXT_RETENTION_DAYS`, `SCREENSHOT_RETENTION_DAYS`, `ORPHAN_CLEANUP_GRACE_DAYS` | `730`, `365`, `180`, `14` (the values of the server)                                                                                                                                 |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `DEEPL_API_KEY`, `OPENROUTER_API_KEY`, `SENTRY_DSN`, …                 | whatever the old server had in `/etc/delivery-app.env`; see section 9. Without them the app runs with the development map tiles, without translation and without the AI order draft. |

**`cron`:** `APP_URL` = `http://${{app.RAILWAY_PRIVATE_DOMAIN}}:${{app.PORT}}`, `CRON_SECRET` = `${{shared.CRON_SECRET}}`.

**`backup`:** `BACKUP_DATABASE_URL` = `${{Postgres.DATABASE_URL}}`, `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` / `BACKUP_S3_REGION` / `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` = the matching `${{backups.…}}` references, `BACKUP_S3_URL_STYLE` = `virtual`.

**`ors`:** `RAILWAY_RUN_UID` = `0` (a Railway volume belongs to root). Optional: `OSM_URL` (one or several addresses separated by spaces, tried in order; default: the Austria extract of Geofabrik, then the one of openstreetmap.fr), `XMS` / `XMX` (default `1g` / `4g`), `REBUILD_OSM=true` for one start to fetch the extract again, `REBUILD_GRAPHS=true` for one start to rebuild the graph.

**`photon`:** none needed. Optional: `PHOTON_INDEX_URL` (default: GraphHopper's weekly Austria index, `https://download1.graphhopper.com/public/europe/austria/photon-db-austria-1.0-latest.tar.bz2`, about 920 MB), `JAVA_OPTS` (default `-Xmx1g`), `PHOTON_LANG`.

## 4. Deploying

A push to the branch a service follows deploys it; there is no manual step and no SSH. `app` rebuilds on every push, the helper services only when their watch paths changed. The order of one `app` deploy: build (`check-deploy-env`, two `next build` passes, PWA files) → pre-deploy (migrations, CORS rule of the photo bucket, upload check against the bucket) → start → health check `/api/health` → the old container is stopped. A failed build, migration or health check leaves the running version in place.

Rollback: Railway dashboard → `app` → Deployments → the last good one → Redeploy. A migration that was already applied is not undone by that.

Logs: dashboard → service → Deployments → Logs (build, deploy, HTTP). `[cron]`, `[backup]`, `[ors]`, `[photon]` prefix the lines of the helper services.

## 5. Scheduled jobs

`vercel.json` lists seven jobs; a Railway cron service has one schedule. So `cron` runs `deploy/railway/cron/dispatch.mts` every 5 minutes: it works out which jobs fell due in the 5-minute slot that just ended and calls them on `app` over the private network with the bearer `CRON_SECRET`. The job list is in the dispatcher (the image holds nothing else) and `scripts/railway/cron-dispatch.test.ts` fails when it differs from `vercel.json`. A new cron route therefore needs a line in **both** files.

A run that finds nothing due logs one line and ends. A run in which a job failed ends with exit code 1 and shows as failed in Railway. The jobs are idempotent; an app that is being swapped by a deploy is asked once more after 20 seconds.

## 6. Backup

`backup` runs `pnpm backup:db` every night at 02:23 UTC: the same master-data dump as NUD-200 (settings, users, customers, products, standing tours, standing orders – never orders, tours or payments), written to the `backups` bucket under `db/`, 8 weeks kept. The image carries `pg_dump` 18 (`PG_MAJOR` in the Dockerfile must follow the database's major version).

Railway can also take scheduled copies of the whole database volume (service `Postgres` → Backups). That is **off**: such a copy holds orders and payments, which the owner does not want kept (NUD-200, NUD-201). It is the right tool for one deliberate copy before a risky change, deleted afterwards.

Restore: `pnpm backup:verify` with `BACKUP_S3_*` and `RESTORE_DATABASE_URL` (see `docs/runbook.md` section 5).

## 7. Routing and geocoding

- `ors` is the official image with `ORS_HOME=/data`, so the extract, the graph and the logs are on the volume. The first start downloads the OSM extract and builds the car graph (Austria: about 15 minutes, up to 4 GB of RAM); later starts take seconds. Until the graph is ready the app plans with the heuristic and says so ("Näherungswerte").
- `download.geofabrik.de` refuses connections from Railway's outbound addresses (port 443, "Connection refused", seen 2026-11-13 and reported by others in Railway's forum). That is why `OSM_URL` takes several addresses and the start script logs which one delivered the file, together with the answer's `Last-Modified` header. A refresh that finds no address keeps serving the extract already on the volume.
- `photon` unpacks the search index onto its volume on the first start (about a minute for Austria) and serves it.
- Both have no public address. `GET /api/health` on the app reports `routing.mode` and `geocoding.mode`; both must be `self-hosted`.
- New map data: `ors` → variable `REBUILD_OSM=true`, deploy, remove the variable again. `photon` → change `PHOTON_INDEX_URL` or delete the folder `photon` on the volume.

## 8. Photos

The browser uploads a photo with a PUT to a presigned URL and shows photos from presigned URLs. On the server the bucket sat behind the app's own nginx; a Railway bucket is another host, so two things follow:

- `S3_URL_STYLE=virtual`: URLs are `https://<bucket>.<endpoint host>/<key>`, and the Content-Security-Policy allows exactly that host (`src/lib/security-headers.ts`).
- The bucket needs a CORS rule for the app's address. `pnpm bucket:cors --apply` puts it on every deploy from `S3_CORS_ORIGINS` (`scripts/set-bucket-cors.ts`; without `--apply` it only shows the rule).
- `pnpm bucket:check` (`scripts/check-bucket-upload.ts`) then does what a browser does: preflight, PUT to a presigned URL and a read, each with the app's `Origin`, and deletes its test object. A deploy whose upload path is broken stops there and the running version stays.

Railway buckets have no lifecycle rules, so `scripts/set-bucket-lifecycle.ts` does not apply here; the retention cron already deletes screenshot rows together with their objects.

## 9. Moving the data from the old server

The database of the old server listens on `127.0.0.1` only, so the copy has to be pushed from there. Everything below runs **on the old server as root**; it reads the old data and writes nothing there. Do it at a moment nobody is working in the app, and stop the old app first so that nothing changes during the copy (`systemctl stop delivery-app`).

1. Railway dashboard → `Postgres` → Settings → Networking → enable the TCP proxy, copy the public connection URL (`DATABASE_PUBLIC_URL`). Remove the proxy again after step 3.
2. Stop `app` on Railway for the restore, or accept that it shows errors for a minute.
3. Database (replaces whatever the Railway database holds):

   ```bash
   set -a; . /etc/delivery-app.env; set +a
   read -rs -p "Railway DATABASE_PUBLIC_URL: " TARGET; echo
   pg_dump -Fc --no-owner --no-acl "$DATABASE_URL" > /root/nudel-move.dump
   pg_restore --clean --if-exists --no-owner --no-acl -d "$TARGET" /root/nudel-move.dump
   rm /root/nudel-move.dump
   ```

4. Photos: copy the bucket `nudel-photos` of the server's MinIO into the Railway bucket `photos` (credentials: dashboard → `photos` → Credentials). Any S3 copy tool works; the object keys must stay the same, the database refers to them.
5. Variables that only the old server knows (`/etc/delivery-app.env`): `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `DEEPL_API_KEY`, `OPENROUTER_API_KEY` and its options, `SENTRY_DSN`. Enter them in the dashboard → `app` → Variables. Do **not** copy `DATABASE_URL`, `AUTH_SECRET`, `S3_*`, `CRON_SECRET`, `ORS_*`, `PHOTON_*`.
6. Redeploy `app` (the build reads `MAP_TILE_URL` and `SENTRY_DSN`), then run the checks of section 10.

The pre-deploy step runs `prisma migrate deploy`, so a database that is behind the code is migrated on the next deploy.

## 10. Checks

- `curl -s https://<address>/api/health` → `"status":"ok"`, `database` and `storage` ok, `routing.mode` and `geocoding.mode` both `self-hosted`.
- Log in as office user, open a customer, upload a photo, reload: the photo shows. (Proves presigned URL, CORS rule and CSP together.)
- Geocode an address in the customer form and plan a tour: distances are real, not "Näherungswerte".
- `cron` → Deployments: a run every 5 minutes, exit code 0. `backup` → one successful run, an object under `db/` in the `backups` bucket.
- Log in as driver on a phone, install the app, open a stop without network.

## 11. Costs

Railway bills by use: USD 10 per GB of RAM and month, USD 20 per vCPU and month (used, not reserved), USD 0.15 per GB of volume, USD 0.015 per GB in a bucket, on top of the plan (Hobby USD 5, Pro USD 20, each including the same amount of use). Almost all of it is the RAM of `ors` and `photon`; the app, the database and the two cron services together are a few dollars. Measured figures: dashboard → project → Usage. Section to update once a full week of use is visible.

## 12. Known limits

- One region, one replica of everything; a Railway outage in Amsterdam takes the app down.
- The backups are in the same Railway project as the database. A second copy elsewhere is not set up.
- Nothing alerts when `cron` or `backup` fail; the failed run is visible in the dashboard only.
- The first login attempt limit per IP relies on the `X-Forwarded-For` header Railway sets.
