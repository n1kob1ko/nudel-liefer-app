# Deployment on Railway (NUD-202, NUD-203)

Since 2026-11-13 the app is set up on [Railway](https://railway.com): project `routenplanner` in the owner's workspace, environment `production`, region Europe West (Amsterdam). This page is the source of truth for that setup. The dedicated server (`docs/deploy.md` section 13) is the previous home; it is not touched by anything here.

Nothing in this setup lives in a `railway.json`: Railway's Config as Code is deprecated and new services cannot opt in. The settings below are applied in the Railway dashboard or through the Railway connector, and this page is where they are written down. **When a setting is changed on Railway, change it here in the same pull request.**

Contents: 1 What runs where, 2 Service settings, 3 Variables, 4 Deploying, 5 Scheduled jobs, 6 Backup, 7 Routing and geocoding (Google Maps), 8 Photos, 9 Moving the data from the old server, 10 Checks, 11 Costs, 12 Known limits.

## 1. What runs where

| Service    | What it is                                       | Built from                                           | Reachable                              |
| ---------- | ------------------------------------------------ | ---------------------------------------------------- | -------------------------------------- |
| `app`      | the Next.js app                                  | repository root, Railpack (no Dockerfile)            | public, the `*.up.railway.app` address |
| `Postgres` | PostgreSQL 18, Railway's template, volume 5 GB   | image `ghcr.io/railwayapp-templates/postgres-ssl:18` | private network only                   |
| `photos`   | bucket for customer photos and order screenshots | Railway bucket, region `ams`, private                | presigned URLs only                    |
| `backups`  | bucket for the nightly master-data dumps         | Railway bucket, region `ams`, private                | the `backup` service only              |
| `cron`     | calls the app's `/api/cron/*` routes             | `deploy/railway/cron` (Dockerfile)                   | nothing listens; runs every 5 minutes  |
| `backup`   | `pnpm backup:db`, master data only               | repository root, `deploy/railway/backup/Dockerfile`  | nothing listens; runs every night      |

Address search and road routes come from Google Maps Platform (Geocoding API, Routes API), called by `app` with the owner's key; nothing of that runs on Railway (section 7).

There is no nginx, no systemd unit, no `/etc/delivery-app.env` and no `/etc/hosts` entry: Railway terminates TLS, restarts a crashed service and injects the variables.

## 2. Service settings

| Service  | Root directory         | Build                                         | Pre-deploy                                                                                        | Start        | Schedule (UTC) | Other                                                             |
| -------- | ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------ | -------------- | ----------------------------------------------------------------- |
| `app`    | `/`                    | `pnpm build:railway`                          | `pnpm db:migrate && pnpm bucket:cors --apply && pnpm bucket:check && pnpm maps:check --warn-only` | `pnpm start` | –              | health check `/api/health` (180 s), restart on failure (10 tries) |
| `cron`   | `/deploy/railway/cron` | Dockerfile                                    | –                                                                                                 | image        | `*/5 * * * *`  | restart never, watch `/deploy/railway/cron/**`                    |
| `backup` | `/`                    | Dockerfile `deploy/railway/backup/Dockerfile` | –                                                                                                 | image        | `23 2 * * *`   | restart never, watch paths see below                              |

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
| `GOOGLE_MAPS_SERVER_KEY`                                                                                       | the owner's Google Maps Platform key (secret; section 7). Optional beside it: `GOOGLE_MAPS_LANGUAGE` (`de`), `GOOGLE_MAPS_REGION` (`at`)                                             |
| `ANTHROPIC_API_KEY`                                                                                            | the owner's Claude API key (secret; Console → API keys, NUD-207). It switches on "Mit KI auslesen" (order draft from a photo or pasted text) and the translation of notes. Optional beside it: `ANTHROPIC_MODEL` (`claude-opus-5-5`), `ANTHROPIC_EFFORT` (`low`). Not set until the owner enters it. |
| `SKIP_TYPECHECK`                                                                                               | `1` (as on the server: `pnpm typecheck` in CI is the gate)                                                                                                                           |
| `ORDER_RETENTION_MODE`                                                                                         | `delete` since 2026-11-13: paid orders are deleted 30 days after the payment (see below the table).                                                                                  |
| `DATA_RETENTION_MODE`, `ORPHAN_CLEANUP_MODE`                                                                   | `dry-run` each. **These two stay off until the owner asks for them.**                                                                                                                |
| `AUDIT_RETENTION_DAYS`, `DRIVER_TEXT_RETENTION_DAYS`, `SCREENSHOT_RETENTION_DAYS`, `ORPHAN_CLEANUP_GRACE_DAYS` | `730`, `365`, `180`, `14` (the values of the server)                                                                                                                                 |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `DEEPL_API_KEY`, `SENTRY_DSN`, …                                       | whatever the old server had in `/etc/delivery-app.env`; see section 9. Without them the app runs with the development map tiles and without DeepL (Claude translates when its key is set). |

**Deleting paid orders is on.** The owner asked for it on 2026-11-13 ("löschregel soll an sein"), so `ORDER_RETENTION_MODE` is `delete` since 17:21 UTC: the daily job of 03:57 UTC deletes orders, their stops and tours and the monthly "paid" notes 30 days after the payment; what is not paid stays (NUD-201, `docs/runbook.md` section 10). The counting run on the moved data just before the switch reported 0 orders and 0 stops, so the first run deletes nothing. `dry-run` stops it again; nothing that is deleted comes back, and the backup does not hold orders.

**`cron`:** `APP_URL` = `http://${{app.RAILWAY_PRIVATE_DOMAIN}}:${{app.PORT}}`, `CRON_SECRET` = `${{shared.CRON_SECRET}}`.

**`backup`:** `BACKUP_DATABASE_URL` = `${{Postgres.DATABASE_URL}}`, `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` / `BACKUP_S3_REGION` / `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` = the matching `${{backups.…}}` references, `BACKUP_S3_URL_STYLE` = `virtual`.

## 4. Deploying

A push to the branch a service follows deploys it; there is no manual step and no SSH. `app` rebuilds on every push, the helper services only when their watch paths changed. The order of one `app` deploy: build (`check-deploy-env`, two `next build` passes, PWA files) → pre-deploy (migrations, CORS rule of the photo bucket, upload check against the bucket, Google check) → start → health check `/api/health` → the old container is stopped. A failed build, migration or health check leaves the running version in place.

Rollback: Railway dashboard → `app` → Deployments → the last good one → Redeploy. A migration that was already applied is not undone by that.

Logs: dashboard → service → Deployments → Logs (build, deploy, HTTP). `[cron]` and `[backup]` prefix the lines of the helper services.

## 5. Scheduled jobs

`vercel.json` lists seven jobs; a Railway cron service has one schedule. So `cron` runs `deploy/railway/cron/dispatch.mts` every 5 minutes: it works out which jobs fell due in the 5-minute slot that just ended and calls them on `app` over the private network with the bearer `CRON_SECRET`. The job list is in the dispatcher (the image holds nothing else) and `scripts/railway/cron-dispatch.test.ts` fails when it differs from `vercel.json`. A new cron route therefore needs a line in **both** files.

A run that finds nothing due logs one line and ends. A run in which a job failed ends with exit code 1 and shows as failed in Railway. The jobs are idempotent; an app that is being swapped by a deploy is asked once more after 20 seconds.

## 6. Backup

`backup` runs `pnpm backup:db` every night at 02:23 UTC: the same master-data dump as NUD-200 (settings, users, customers, products, standing tours, standing orders – never orders, tours or payments), written to the `backups` bucket under `db/`, 8 weeks kept. The image carries `pg_dump` 18 (`PG_MAJOR` in the Dockerfile must follow the database's major version). First run on 2026-11-13 (15:06 UTC, schedule set to that minute once and set back): 14 tables with data, 11 left out, one object under `db/`. A redeploy does not run the job; only the schedule does.

Railway can also take scheduled copies of the whole database volume (service `Postgres` → Backups). That is **off**: such a copy holds orders and payments, which the owner does not want kept (NUD-200, NUD-201). It is the right tool for one deliberate copy before a risky change, deleted afterwards.

Restore: `pnpm backup:verify` with `BACKUP_S3_*` and `RESTORE_DATABASE_URL` (see `docs/runbook.md` section 5).

## 7. Routing and geocoding (Google Maps)

Owner's decision of 2026-11-13 (NUD-203): address search and road routes come from **Google Maps Platform**, so that no map service of our own has to run. The map the users see stays the Leaflet map with the tiles of `MAP_TILE_URL`.

**What the app asks Google**

- **Geocoding API**, once per address the office looks up (customer form, parking queue, customer import). The answer is kept in the app's memory for repeated lookups of the same text, and the pin the office confirms is stored with the customer.
- **Routes API** (`computeRoutes`), whenever a tour is planned or re-ordered. The visiting order is the app's own heuristic; Google delivers distance and driving time of every leg and the line on the map. One request holds at most 10 stops between its two ends, so a tour of up to 10 stops is one request, 25 stops are three.
- A standing tour is a template in the app. Using it plans a tour and asks Google again; results of Google are not kept in a cache table.
- Google not answering within 8 s, refusing the key or being over a limit: the tour is planned with the estimate and says so ("Näherungswerte"); the address search shows its error and the office can set the pin by hand.

**The key (👤 owner, once)**

1. [console.cloud.google.com](https://console.cloud.google.com): create a project, add a billing account (credit card; the billing address decides which terms apply, see below).
2. "APIs & Services" → "Library": enable **Geocoding API** and **Routes API**. Nothing else is needed (no Maps JavaScript API, no map key for the browser).
3. "APIs & Services" → "Credentials" → "Create credentials" → "API key". Under "API restrictions" choose "Restrict key" and tick exactly those two APIs. An IP restriction is not possible: it needs a fixed outbound address, which `app` does not have in this setup.
4. Recommended: "APIs & Services" → "Quotas", a daily limit for both APIs (for example 300 requests per day each: 30 days of that stay below the free 10,000 per month), and a budget alert under "Billing" → "Budgets & alerts".
5. Railway → `app` → Variables → `GOOGLE_MAPS_SERVER_KEY` = the key → Deploy. Never into the repository, a chat or this page.

Done on 2026-11-13. The first deploy with the key was refused by Google (`REQUEST_DENIED`, `HTTP 403`) although the key was right (a wrong key makes the Routes API answer HTTP 400, not 403): Google had not released the project for billed requests yet. After the owner had dealt with that in the Google Cloud console, the same key answered without a change on our side (deploy of 17:06 UTC: `[maps-check] ok   geocode`, `ok   route: 2 legs, 13.8 km, 37 min, a line of 191 points`). A refusal with a valid key therefore points at the billing account of the Google project first.

**Then (the switch)**

1. `GET /api/health` → `routing.mode` and `geocoding.mode` are `google`.
2. The deploy log of `app` (pre-deploy) shows two lines of `pnpm maps:check` (`scripts/check-google-maps.ts`): `[maps-check] ok   geocode: …` and `[maps-check] ok   route: …`. That is one real address search and one real route with fixed public test data (two billed requests per deploy), asked without the caches and the fallback, so a refused key shows as `FAIL` with the reason (`REQUEST_DENIED`, `HTTP 403`, …) instead of being covered by the estimate. Health alone only says that a key is set. The step runs with `--warn-only`: a deploy does not wait for Google, the line is the signal. By hand: `pnpm maps:check` (exit code 2 on a failure).
3. Geocode an address in the customer form, plan a tour: real distances, a route along roads, "Google Maps" in the map's attribution.
4. Until 2026-11-13 two services of our own stood in for Google on Railway: `ors` (openrouteservice 9.1.1) and `photon` (Photon 1.3.0), each with a 5 GB volume, built from `deploy/railway/ors` and `deploy/railway/photon`. With Google answering they are not asked any more (the key wins over `ORS_BASE_URL` and `PHOTON_URL`), so their folders are gone from the repository (last in commit `3dbc863`), and the two services, their volumes `ors-data` and `photon-data` and the variables `ORS_BASE_URL`, `PHOTON_URL`, `PHOTON_LANG` of `app` were removed by the owner in the dashboard on 2026-11-13 (the Railway connector cannot confirm a deletion, so deleting a service or a volume is the owner's step). The one volume left, `postgres-data`, is the database: never remove it. The app can still talk to a self-hosted openrouteservice and Photon through those variables (`docs/env.md`); the dedicated server did.

**Terms (read on 2026-11-13; not legal advice)**

- The owner's billing address is in Austria, so Google's terms for the European Economic Area apply (in force since 2025-07-08): [Geocoding API](https://developers.google.com/maps/comms/eea/geocoding), [Routes API](https://developers.google.com/maps/comms/eea/routes). They drop the rule "no use with a non-Google map": latitude, longitude and place id of a geocoding hit and the route line may be shown on our map.
- Still not allowed on or next to a map: Google's address text of a hit, and a route's description and steps. That is why a candidate of the address search is labelled with the address the office typed, and why the route request never asks for steps. Both are asserted by tests.
- Google's content has to be recognisable as such: every map carries "Routing & Geocoding: Google Maps" in its attribution while the key is set (`src/lib/map-config.ts`).
- With a billing address outside the EEA the global terms apply, which forbid showing Google's results on another map. Then this setup must not be used as it is.

## 8. Photos

The browser uploads a photo with a PUT to a presigned URL and shows photos from presigned URLs. On the server the bucket sat behind the app's own nginx; a Railway bucket is another host, so two things follow:

- `S3_URL_STYLE=virtual`: URLs are `https://<bucket>.<endpoint host>/<key>`, and the Content-Security-Policy allows exactly that host (`src/lib/security-headers.ts`).
- The bucket needs a CORS rule for the app's address. `pnpm bucket:cors --apply` puts it on every deploy from `S3_CORS_ORIGINS` (`scripts/set-bucket-cors.ts`; without `--apply` it only shows the rule).
- `pnpm bucket:check` (`scripts/check-bucket-upload.ts`) then does what a browser does: preflight, PUT to a presigned URL and a read, each with the app's `Origin`, and deletes its test object. A deploy whose upload path is broken stops there and the running version stays.

Railway buckets have no lifecycle rules, so `scripts/set-bucket-lifecycle.ts` does not apply here; the retention cron already deletes screenshot rows together with their objects.

## 9. Moving the data from the old server

The database and the photo store of the old server listen on `127.0.0.1` only, so the copy is pushed from there by one script, `scripts/railway/move-from-server.sh`. It only reads on the old server (the old app keeps running) and **replaces** the Railway database and adds to the Railway photo bucket. It can be run again: the database is replaced again, photos that are already there are skipped.

**Before (on Railway)**

1. `Postgres` → Settings → Networking → enable the TCP proxy (port 5432). The database is then reachable from the internet with its password; remove the proxy again when the move is done.
2. One variable that holds everything the script needs, made of references so that nobody types a secret. On the service `backup` (a variable there restarts nothing that serves users):

   ```
   MOVE_TARGET=postgresql://${{Postgres.PGUSER}}:${{Postgres.POSTGRES_PASSWORD}}@${{Postgres.RAILWAY_TCP_PROXY_DOMAIN}}:${{Postgres.RAILWAY_TCP_PROXY_PORT}}/${{Postgres.PGDATABASE}}|${{photos.ENDPOINT}}|${{photos.REGION}}|${{photos.BUCKET}}|${{photos.ACCESS_KEY_ID}}|${{photos.SECRET_ACCESS_KEY}}
   ```

   Its **value** (dashboard → `backup` → Variables → copy) is the "Railway line" the script asks for. Delete the variable after the move.

**The move (on the old server as root)**

```bash
curl -fsSL https://raw.githubusercontent.com/n1kob1ko/nudel-liefer-app/main/scripts/railway/move-from-server.sh -o /root/umzug.sh && bash /root/umzug.sh
```

The script reads `/etc/delivery-app.env`, asks for the Railway line (hidden input), shows the row counts of both databases and asks before it replaces the Railway one. Then:

- **Database:** `pg_dump` of the old database into a temporary file, the `public` schema on Railway dropped and restored from it, the file removed. It compares the row count of every table on both sides and stops when one differs. A table the app's database user may not read (a manual copy made by another role, on the old server `StandingTourCustomer_backup_20261105`) is named and left behind: the app does not know it.
- **Photos:** every object of the old bucket is copied under the same key (the database refers to the keys), with its content type; at the end the listing of both buckets is compared. `--skip-db` runs only this part again.
- **Provider variables:** it prints the lines of `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `MAP_TILE_CACHE`, `DEEPL_API_KEY`, `DEEPL_API_PLAN`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT` as far as the old server has them. They go into the dashboard → `app` → Variables → Raw Editor. `DATABASE_URL`, `AUTH_SECRET`, `S3_*`, `CRON_SECRET`, `ORS_*`, `PHOTON_*` are **not** copied: Railway has its own or does not need them.

**After (on Railway)**

1. Redeploy `app`: the pre-deploy step runs `prisma migrate deploy`, which brings the restored database (the old server was some migrations behind) up to the code; the build reads `MAP_TILE_URL` and `SENTRY_DSN`.
2. Remove the TCP proxy of `Postgres` and the variable `MOVE_TARGET`.
3. Run the checks of section 10 and log in with an account of the old server (the users came with the database; everybody has to log in again, because `AUTH_SECRET` is new).

The script was tried on 2026-11-13 against a local copy of this setup: a database in the state of the old server (migrations up to `20261103211400_payments`) restored over a migrated one and then migrated to the current code, and 131 objects between two buckets.

## 10. Checks

- `curl -s https://<address>/api/health` → `"status":"ok"`, `database` and `storage` ok, `routing.mode` and `geocoding.mode` both `google`.
- Log in as office user, open a customer, upload a photo, reload: the photo shows. (Proves presigned URL, CORS rule and CSP together.)
- Geocode an address in the customer form and plan a tour: distances are real, not "Näherungswerte". The candidate of the address search shows the address as typed, the map's attribution names Google Maps.
- `cron` → Deployments: a run every 5 minutes, exit code 0. `backup` → one successful run, an object under `db/` in the `backups` bucket.
- Log in as driver on a phone, install the app, open a stop without network.

## 11. Costs

Railway bills by use: USD 10 per GB of RAM and month, USD 20 per vCPU and month (used, not reserved), USD 0.15 per GB of volume, USD 0.015 per GB in a bucket, on top of the plan (Hobby USD 5, Pro USD 20, each including the same amount of use). The app, the database and the two cron services together are a few dollars; the two map services that were most of the bill (their RAM) are gone since Google answers. Measured figures: dashboard → project → Usage. Section to update once a full week of use is visible.

Google Maps Platform (price list of 2026-11-12): Geocoding API and Routes API "Compute Routes Essentials" each have 10,000 free requests per month, after that USD 5 per 1,000. The app stays in "Essentials" by design (at most 10 stops between the ends of a request, no traffic, no reordering by Google; the next class costs USD 10 per 1,000 with 5,000 free). Estimate, not measured: three tours a day of about 25 stops, each planned and re-ordered a few times, are some 50 route requests a day, about 1,500 a month, and a handful of address lookups; both far inside the free amount. Measured figures: Google Cloud console → "APIs & Services" → "Metrics".

## 12. Known limits

- Address search and real road distances depend on Google: without its answer the office sets pins by hand and tours are estimates. A daily quota on the key (section 7) has the same effect once it is used up.
- What Google delivered stays in the app in two places: the pin of a customer (confirmed or moved by the office on the map) and the legs and line of a planned tour (until the tour is deleted). Google's terms describe keeping coordinates as a cache of up to 30 days; whether a pin the office confirmed counts as such a cache was not clarified. If it must be strict: a job that looks the stored addresses up again every month would be the way.
- One region, one replica of everything; a Railway outage in Amsterdam takes the app down.
- The backups are in the same Railway project as the database. A second copy elsewhere is not set up.
- Nothing alerts when `cron` or `backup` fail; the failed run is visible in the dashboard only.
- The first login attempt limit per IP relies on the `X-Forwarded-For` header Railway sets.
