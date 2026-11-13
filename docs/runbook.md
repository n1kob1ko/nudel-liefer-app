# Runbook

For the person who operates the app. First setup is in [`deploy.md`](./deploy.md), variables in [`env.md`](./env.md), data handling in [`privacy.md`](./privacy.md).

Contents: 1 Where things are, 2 Deploy, 3 Roll back, 4 Restore the database (Neon point-in-time), 5 Restore from the weekly backup, 6 Rotate keys, 7 Sentry, 8 Reset the admin password, 9 If a service is down, 10 Orphaned storage objects, 11 Reading /api/health, 12 Logs, 13 Open human steps.

Commands run from the repository root with `pnpm` (Node 22+). Production connection strings are secrets: put them in the shell only for the one command (`DATABASE_URL_UNPOOLED=... pnpm ...`), never into a file in the repository.

## 1. Where things are

| What                                    | Where                                                        |
| --------------------------------------- | ------------------------------------------------------------ |
| Code, CI, backup check                  | GitHub repository (`.github/workflows/ci.yml`, `backup.yml`) |
| App, environment variables, logs, crons | Vercel project                                               |
| Database                                | Neon project, branch `main`                                  |
| Photos, screenshots                     | Cloudflare R2 bucket `nudel-photos`                          |
| Nightly backups (master data only)      | On the server: `/var/backups/nudel/db/` (section 5)          |
| Errors                                  | Sentry project (optional)                                    |

## 2. Deploy

1. Merge to `main` (CI must be green). Vercel builds and deploys Production automatically. The build runs the database migrations first; a failed migration stops the build and the previous deployment keeps serving.
2. Watch Vercel > **Deployments** until _Ready_, then check `/api/health` (section 11) and log in as admin.
3. Migrations only move forward. Before merging a migration that deletes or rewrites data, take a manual backup (section 5.1).

## 3. Roll back

Code: Vercel > **Deployments** > the last good deployment > **...** > **Promote to Production** (instant, no rebuild). Then revert the commit on `main` so the next push does not redeploy the bad code.

The database is **not** rolled back by this. If the bad deployment ran a migration that the old code cannot work with, restore the database too (section 4) or ship a fix forward. Environment-variable mistakes: fix the variable and **Redeploy** (variables are read at build or start).

## 4. Restore the database (Neon point-in-time)

Use for "someone deleted data / a migration went wrong a few hours or days ago".

1. Neon console > project > **Backup & Restore**. The history window depends on the plan (free: about 6 hours; paid: up to 7 or 30 days; check the console, it shows the earliest possible time).
2. Choose the point in time (shortly before the damage; check the UTC time against the app's data) and first restore into a **new branch** (_Restore to a new branch_), not over `main`. Look at the data with the SQL editor.
3. If it is right: restore `main` to that time (_Restore branch_ > _main_ > timestamp). Neon keeps the replaced state as a backup branch named `main_old_<time>`; do not delete it for a few days.
4. Connection strings of `main` stay the same after an in-place restore, so no variable changes. After a restore into a different branch you would have to change `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel and redeploy.
5. Everything written after the chosen time is lost. Tell the dispatchers which deliveries and notes to enter again. Drivers' queued offline taps from before the incident are applied when their phones reconnect; check for duplicates.
6. After restoring data older than 24 h, the retention job (`/api/cron/retention`) will delete again what was already deleted; nothing to do. See `privacy.md` for what a restored copy contains.

## 5. Restore from the nightly backup

Backups are custom-format dumps `nudel-<UTC timestamp>.dump` in `/var/backups/nudel/db/` on the production server, made every night at 02:23 UTC by the systemd timer `nudel-backup.timer` (`deploy/backup/`, NUD-200), kept 8 weeks (the newest 4 never expire). Setup: `deploy.md` section 13.1.

**They hold master data only**: settings, users and working hours, vehicles, products, customers with parking spots and photo records, standing tours and standing orders. Orders, tours, stops, payments, monthly invoices and the change history are **never** in a backup (decision of the owner; the list is `BACKED_UP_TABLES` in `scripts/lib/backup.ts`). A restore therefore brings back a working app without any order, tour or payment. Photos are not in it either.

### 5.1 Take a backup now

On the server, as root:

```bash
systemctl start nudel-backup && journalctl -u nudel-backup -n 20 --no-pager
ls -l /var/backups/nudel/db
```

The log ends with `[backup] done: db/nudel-<time>.dump (...)` and names the tables it left out.

**Before a risky migration** (one that deletes or rewrites data) the nightly backup is not enough, because it has no orders. Take a one-off full dump by hand and delete it once the migration has proved itself, so that no copy of the orders stays behind:

```bash
sudo -u postgres pg_dump --format=custom --file=/var/lib/postgresql/before-migration.dump nudel
# back out: restore it into a NEW database (section 5.2 step 1), then
#   sudo -u postgres pg_restore --no-owner --dbname=nudel_restore /var/lib/postgresql/before-migration.dump
# afterwards: rm /var/lib/postgresql/before-migration.dump
```

### 5.2 Restore into a new database

1. Create a new **empty** database. On the server: `sudo -u postgres createdb -O <app role> nudel_restore` (the app role is the user name in `DATABASE_URL` of `/etc/delivery-app.env`).
2. Pick the dump: the newest file in `/var/backups/nudel/db/`. Treat it as confidential (it contains password hashes and customer data).
3. Check and restore with the tested script, which refuses a target that is not empty and the live database. On the server (`cd /opt/delivery-app && set -a && . /etc/delivery-app.env && set +a` first):

   ```
   RESTORE_DATABASE_URL='postgresql://<app role>:<password>@127.0.0.1:5432/nudel_restore' \
   pnpm backup:verify --file /var/backups/nudel/db/<file>
   ```

   It restores in one transaction (all or nothing) and checks: all migrations finished, an active admin exists, exactly one Settings row, no LoginAttempt rows, row counts. It prints the counts; the order, tour and payment tables are 0, compare the others with what you expect.

4. Point the app at it: `systemctl stop delivery-app`, change the database name in `DATABASE_URL` in `/etc/delivery-app.env`, `systemctl start delivery-app`, check `/api/health`, log in. Keep the damaged database until you are sure; drop it later.
5. Run `pnpm admin:reset-password` (section 8) if the admin password is unknown. Sessions survive a restore (they are signed with `AUTH_SECRET`).
6. Photos: the objects in `nudel-photos` are untouched. Rows from the dump refer to them by key; a photo uploaded after the backup exists as an unreferenced object (the orphan job deals with it, section 10).

Do not run `pg_restore` by hand against a database that has data: the script exists to prevent exactly that.

### 5.3 Notes

- `pg_dump` / `pg_restore` must be at least the version of the database server. On the server they come with PostgreSQL itself.
- The backup only reads. It uses the app's `DATABASE_URL` unless `/etc/nudel-backup.env` sets `BACKUP_DATABASE_URL` (a read-only role).
- The backups are on the same machine as the database. They do not survive the loss of the server (`deploy.md` section 13.2 describes the optional second copy, which is not set up).

### 5.4 Restore drill (every quarter, 30 minutes)

1. Run section 5.2 steps 1-3 into a throwaway database with the newest dump.
2. Check the printed counts of customers, users and standing tours against the live database; open a connection and look at one customer.
3. Drop the throwaway database (`sudo -u postgres dropdb nudel_restore`). Write the date of the drill into the log of your choice (a ticket comment is enough).

### 5.5 When the backup fails

Nothing sends an alert for the backup on the server; look once a month.

| Sign | Meaning | Do |
| --- | --- | --- |
| No file of last night in `/var/backups/nudel/db` | The timer is off or the run failed. | `systemctl status nudel-backup.timer nudel-backup.service`, `journalctl -u nudel-backup -n 50 --no-pager`. |
| `journalctl` shows `folder ...: FAILED` | Disk full or the folder's owner changed. | `df -h /var/backups`, then `bash /opt/delivery-app/deploy/backup/install.sh` (repairs the folder). |
| `journalctl` shows `dump contains data that must be left out` | The dump would have held orders or payments; nothing was stored. | A bug: do not work around it, fix `scripts/backup/core.ts`. |
| Only with the optional bucket: GitHub e-mail "Database backup check" failed | _half-configured_: a secret is missing in the environment `backup`. _N hours old_: the job on the server stopped or cannot reach the bucket. | `deploy.md` section 13.2; on the server `journalctl -u nudel-backup -n 50 --no-pager` names the failing destination. |

## 6. Rotate keys

Always: change the value at the provider, set the new value in Vercel (Production and, if used, Preview), **Redeploy**, check `/api/health`, then revoke the old value.

| Secret                                      | Effect and steps                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                               | Signs all sessions. **Changing it logs out everyone** (admins and all drivers); drivers with queued offline taps log in again and the taps are still sent afterwards. Generate: `openssl rand -base64 32`. Do it when it may have leaked or an admin laptop was lost.                                    |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Cloudflare R2 > Manage API tokens: create a new token for `nudel-photos` (Object Read & Write), put both values in Vercel, redeploy, check health shows storage ok, then delete the old token. Signed photo links already in open pages stop working after the old token is deleted; reloading fixes it. |
| `ORS_API_KEY`                               | openrouteservice dashboard: create a new key, set it, redeploy, delete the old key. While missing or invalid the app falls back to estimated distances (marked approximate).                                                                                                                             |
| `DEEPL_API_KEY`                             | DeepL account > API keys: create, set, redeploy, delete the old key. While missing or invalid, texts are saved untranslated and retried (section 9).                                                                                                                                                     |
| `CRON_SECRET`                               | Vercel sends it to the cron routes automatically from the variable; set a new random value (`openssl rand -hex 32`), redeploy. It also protects `/api/monitoring/test-error`. Anything that calls these routes by hand needs the new value.                                                              |
| `SENTRY_AUTH_TOKEN`                         | Sentry > Developer Settings > the integration > create a new token, set it in Vercel, delete the old one. Only needed at build time.                                                                                                                                                                     |
| `BACKUP_*`                                  | Only if the optional bucket is used (`deploy.md` section 13.2): create the new bucket token first, put it into `/etc/nudel-backup.env` on the server **and** into GitHub > Settings > Environments > `backup`, run `systemctl start nudel-backup` and the workflow once, then revoke the old token.                                                                                                                             |
| Database password                           | Neon console > Roles > reset password, update `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel, redeploy. Do the same for `backup_reader` in the `backup` environment.                                                                                                                               |

## 7. Sentry

### Check that Sentry works (production or preview)

Only with `SENTRY_DSN` set and the deployment built after that.

1. `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/monitoring/test-error`  
   Expected: `{"status":"sent","eventId":"...","delivered":true}`. `{"status":"disabled"}` means no valid DSN in this build. 401 means a wrong secret (without the header the route always answers 401).
2. In Sentry the issue `MonitoringTestError` appears within a minute.
3. Server-side crash path: add `?mode=throw`; the response is a 500 and the issue `MonitoringTestError (thrown)` appears, proving the automatic error hook works.
4. Browser path: open the app, open the developer console and run `setTimeout(() => { throw new Error("sentry browser test") })`. The issue shows platform _javascript_. If it does not arrive, look in the console for a blocked request (CSP `connect-src`): the DSN host must be there; redeploy after changing the DSN.
5. Resolve the test issues in Sentry.

The event must not contain cookies, a request body, query strings or user data; open the event and look at _Request_ and _User_.

### Check Sentry locally (no Sentry account)

This is how the code was verified. Start the mock ingest `pnpm tsx scripts/mock-sentry-ingest.ts` (port 9999, writes events to a JSONL file), build with `SENTRY_DSN=http://key@localhost:9999/1`, run with the same value and `CRON_SECRET`, then `E2E_SENTRY_LOG=<jsonl path> pnpm exec playwright test tests/e2e/sentry-ingest.spec.ts`.

### Source maps

Uploaded only when the four variables `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are all set (see `deploy.md` section 12). Without them stack traces are minified but everything else works.

## 8. Reset the admin password

If an admin is locked out (forgotten password or lockout after failed attempts).

```
DATABASE_URL_UNPOOLED='postgresql://...production direct string...' \
pnpm admin:reset-password --email admin@example.com
```

- It asks twice for the new password without showing it (10 to 200 characters), asks you to retype the e-mail address of the account, and prints only the database host and name so you can see **which** database it touches.
- Non-interactive: `ADMIN_NEW_PASSWORD` in the environment, or one line on standard input, and `--yes`. There is deliberately **no** `--password` option: a password in the command line ends up in shell history and process lists.
- Only accounts with the admin role are changed. It also clears the lockout counter of that account. `--reactivate` switches an inactive admin back to active. An unknown or ambiguous e-mail address changes nothing.
- The password is never printed or logged. Other sessions of that user keep working until they expire; to end them, rotate `AUTH_SECRET` (section 6).
- Afterwards log in and change the password in the app.
- Driver PINs are reset by an admin in the app (Drivers > driver), not with this tool.

## 9. If a service is down

First check `/api/health` (section 11) to see which part is meant. Status pages: Vercel (vercel-status.com), Neon (neonstatus.com), Cloudflare (cloudflarestatus.com), DeepL (deepl.com/status), openrouteservice (via its dashboard / forum).

| Down                        | What users see                                                                                                                                                                 | What to do                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **openrouteservice** (ORS)  | Route optimisation falls back to a straight-line heuristic. The result is marked _approximate_; distances/times are estimates. Drivers can still work.                         | Nothing urgent. Do not re-optimise many routes during the outage if exact times matter. After recovery re-optimise open days. Check the quota in the ORS dashboard if only some requests fail (HTTP 429).                                                                 |
| **DeepL** (NUD-070)         | Texts that need translation (notes, messages) are saved at once and shown in the original language, marked as pending translation. Nothing is lost and nobody is blocked.      | Nothing. The job `/api/cron/translate` retries every 10 minutes and fills in the translations when DeepL is back. If it lasts longer than a day check the key and the usage limit in the DeepL account (456 = quota used up); raise the limit or wait for the next month. |
| **Neon** (database)         | Everything that loads data fails; `/api/health` is 503 with database failing; drivers see the friendly error page (their taps are queued in the phone and sent when it works). | Check the Neon status page; free-plan databases wake up in seconds after idle, so a short first-request delay is normal. If the project is paused/over quota, open the console. For lasting loss use section 4 or 5. Do not redeploy as a fix.                            |
| **R2** (storage)            | Photos and screenshots do not load or upload; `/api/health` is 503 with storage failing. Deliveries and routes still work.                                                     | Check Cloudflare status and the R2 token (expired or deleted token: section 6). Photo uploads are queued in the phone and retried.                                                                                                                                        |
| **Vercel**                  | App unreachable.                                                                                                                                                               | Wait for Vercel; nothing in this repository helps.                                                                                                                                                                                                                        |
| **Sentry**                  | Nothing visible to users.                                                                                                                                                      | The app does not wait for Sentry.                                                                                                                                                                                                                                         |
| **GitHub Actions** | Nothing visible to users; the nightly backup runs on the server and does not need GitHub. | Wait for GitHub. |

## 10. Orphaned storage objects

Uploads that never became a database row (cancelled or failed action) remain in the bucket. `/api/cron/orphan-cleanup` (Sundays 04:07 UTC, Vercel cron, bearer `CRON_SECRET`) finds them.

- Default is **dry-run**: it only logs `[orphan-cleanup]` lines with counts (listed, referenced, candidates, would delete). Nothing is deleted.
- Safeguards even in delete mode: only keys of the app's own shape (`customers/...` photos and `screenshots/...`), only objects older than `ORPHAN_CLEANUP_GRACE_DAYS` (default 14, minimum 7), anything referenced by a Photo or Screenshot row is kept, the reference is checked again immediately before each delete, at most 50 deletions and 10,000 listed objects per run, and the run stops without deleting when 20 or more objects are candidates and more than half of them are orphans (this looks like a broken database connection or a wrong bucket, not cleanup).
- Switch on: read two or three weekly dry-run reports in Vercel Logs (search `orphan-cleanup`). If the numbers are small and plausible, set `ORPHAN_CLEANUP_MODE=delete` and redeploy. Set it back to `dry-run` to stop.
- Run by hand: `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/orphan-cleanup`. A result `aborted: "suspicious_ratio"` means look at it, do not force it.
- Deleted objects cannot be recovered (the bucket has no versioning). That is why delete mode is a conscious switch.

### Audit log retention (NUD-111)

`/api/cron/audit-retention` (daily 03:37 UTC, bearer `CRON_SECRET`) deletes `AuditLog` entries older than `AUDIT_RETENTION_DAYS` (default 730, minimum 90) in batches of 1000, at most 20 000 per run. It is the only way entries are ever removed; the database trigger refuses everything else and refuses even the job for entries younger than 90 days.

- Look at the result: Vercel Logs, search `audit-retention` (`deleted`, `batches`, `more: true` = backlog continues tomorrow). A `503` / `status: error` means the database refused or was unreachable; nothing partial is harmful, the next run continues.
- Run by hand: `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/audit-retention`.
- A change of period is only the variable and a redeploy. Lowering it deletes the surplus at the next run, and deleted entries come back only from a backup (sections 4 and 5), so lower it deliberately.
- Do not disable the trigger by hand to clean up; use the route.

### Driver text retention (NUD-112)

`/api/cron/data-retention` (daily 03:47 UTC, bearer `CRON_SECRET`) removes the free text of driver problem reports (`Stop.problemNote`: original, German translation, pending marker) of stops completed more than `DRIVER_TEXT_RETENTION_DAYS` ago (default 365, minimum 30). Reason, status, quantities, tours and orders are never touched by this job; deleting whole orders is the next job.

- Default is **dry-run**: the log line `[data-retention] {...}` shows `expired` (texts that would go) and `scrubbed: 0`. Read two or three reports (Vercel Logs, search `data-retention`); if the numbers are plausible, set `DATA_RETENTION_MODE=delete` and redeploy. Set it back to `dry-run` (or `off`) to stop.
- Run by hand: `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/data-retention`. `more: true` = backlog continues tomorrow (10 000 texts per run). `503` / `status: error`: database unreachable, nothing partial is harmful.
- Removed texts come back only from a backup (sections 4 and 5); after a restore the next run removes them again.
- The audit entry of the report keeps the note cut to 200 characters until the audit retention deletes it (`docs/privacy.md` section 6).

### Deleting settled orders (NUD-201)

`/api/cron/order-retention` (daily 03:57 UTC, bearer `CRON_SECRET`) deletes orders, their stops and tours and the monthly "paid" notes `ORDER_RETENTION_DAYS` (default 30, minimum 7) after they were paid. The client decided on 2026-11-13 that nothing of this is kept. What is not paid is never deleted; customers, products, settings, standing tours and standing orders are never touched. The exact rules are in `docs/audit-and-retention.md`.

- Default is **dry-run**: the log line `[order-retention] {...}` shows `orders` and `stops` that would go and deletes nothing. Tours, paid notes and corrections are not counted in dry-run (always 0 there); they follow from the orders. **Switching it on cannot be undone**: deleted orders and bills come back only from a backup that still contains them. Before switching on: read two or three dry-run reports, make sure every month that really is paid is marked paid and every month that is not is not, and tell the office that a paid month disappears 30 days later (the bill page and the paid history say so once the job is on). If a bill is still needed, download it as PDF or CSV first.
- Switch on: set `ORDER_RETENTION_MODE=delete` in the environment file, restart the app, and make sure the cron line of `docs/deploy.md` section 13.1 exists. Set it back to `dry-run` (or `off`) to stop; nothing that is already deleted comes back.
- Run by hand: `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/order-retention`. `more: true` = backlog continues tomorrow (5 000 orders per run). `status: partial` = some screenshot files could not be removed; the screenshot job retries them. `503` / `status: error`: database unreachable, a lock that was not granted in time, or an unusable `ORDER_RETENTION_DAYS` (the log line says which); a batch is one transaction, so nothing half-deleted is left. Two runs at once are safe: they take their batches in turn.
- The first run after switching on deletes everything that is paid for more than 30 days at once, however old.
- An order that does not go although it is paid shares a stop with something unpaid (for example open cash at the same stop); it goes when that is settled. A cash order also stays while its stop was never ticked off on a released tour (nobody knows whether it was delivered and paid): have the stop completed or cancel the order. A month that was marked paid and taken back again counts as open and stays.
- Before switching on, check the standing orders with a limit ("nach N Lieferungen"): the migration of NUD-201 must be applied first (it stores how many deliveries each rule has made; `pnpm db:migrate` does it with every deploy).
- The change log (`AuditLog`) keeps its own period (`AUDIT_RETENTION_DAYS`, default 730, minimum 90): its entries about deleted orders (ids, changed quantities, amounts, cut notes) stay until then. Lower the variable if the client wants them gone sooner.

### Access and erasure requests (NUD-112)

A person asks what the app holds about them, or asks for their name to be removed. Find it, then remove or correct it. The operator decides; this list is the app's side. Backups expire on their own (8 weeks).

1. **Find** (Neon SQL editor, read only, replace `%Name%`): `SELECT id, "customerNumber" FROM "Customer" WHERE notes::text ILIKE '%Name%' OR name ILIKE '%Name%';` then the same for `"Order"."internalNote"` and `"Stop"."problemNote"::text`; users: `SELECT id, "displayName", username, email FROM "User" WHERE "displayName" ILIKE '%Name%';`. Photos and chat screenshots have no text: look at the customer's photos in the admin area and the order screenshot of the affected orders.
2. **Customer notes and order internal notes:** edit the text in the admin area (customer page, order form). The audit log keeps the old order note cut to 200 characters until its retention (730 days) deletes it; it cannot be edited (append-only).
3. **Driver problem text:** the daily job removes it after 365 days. Earlier: `UPDATE "Stop" SET "problemNote" = NULL WHERE id = '<stop id>';` (only this column; nothing else on the stop). The audit copy stays as in 2.
4. **Screenshot of a chat:** removed automatically after 180 days. Earlier: delete the object `screenshots/<key>` in the R2 bucket (key from `SELECT "storageKey" FROM "Screenshot" WHERE id = '...'`), then `DELETE FROM "Screenshot" WHERE id = '...';` (the order stays, its screenshot link becomes empty).
5. **Photo of a person (customer photos):** replace it in the admin area (customer page > photos); the old photo stays as history. To erase it: delete the object `customers/<key>` in R2 and then `DELETE FROM "Photo" WHERE id = '...' AND "isCurrent" = false;` (a current photo must be replaced first so the customer is not left without one).
6. **User account (staff, driver):** delete it in the admin area (menu of the row, "Löschen", NUD-206): the account row with name and login is removed, its tours lose the driver and its other records go to the deleting admin. Deactivating keeps the row: then the name stays because history refers to it; erasing the name itself is a decision for the operator and its advisor (a pseudonymised display name such as "Former driver" via `UPDATE "User" SET "displayName" = 'Former driver' WHERE id = '...';`, e-mail / user name must stay unique).
7. Write down date, request and what was done outside the app.

## 11. Reading /api/health

`GET /api/health` needs no login and returns no secrets.

```
{ "status": "ok", "checks": { "database": { "status": "ok" }, "storage": { "status": "ok", "mode": "s3" } } }
```

- HTTP 200, `status: ok`: database and storage answer.
- HTTP 503, `status: error` with the failing check named: see section 9 for that service. The page of the app can still be served from the cache for a moment.
- No answer or 5xx from Vercel itself: the deployment is down; see Vercel status and section 3.
- It does not test ORS, DeepL or Sentry on purpose (their failure is handled by fallbacks). Use the uptime monitor of `deploy.md` section 12.2.

## 12. Logs

- Vercel > project > **Logs** (retention depends on plan, short on free: copy what you need). Filter by _Error_ / by text.
- Useful search words: `[csp-violation]` (blocked resources, no query strings), `[orphan-cleanup]`, `[retention]` (deleted old screenshots, counts), `[data-retention]` (driver texts, counts), `[order-retention]` (deleted settled orders, counts), `[audit-retention]`, `translate` (DeepL retries), `migrate` (build log).
- Build and migration output: Vercel > **Deployments** > the deployment > **Build Logs**.
- Cron runs: Vercel > **Settings > Cron Jobs** (and the Logs, source _Cron_).
- Application errors with stack traces and release: Sentry (section 7), if configured.
- Backup runs: on the server `journalctl -u nudel-backup`.
- Database queries and size: Neon console > Monitoring.
- Logs never contain passwords, PINs, cookies or signed URLs (checked by tests); report it if you ever see one.

## 13. Open human steps (NUD-094)

The code is verified locally with substitutes; these need your accounts:

1. **Sentry:** create the EU project, set `SENTRY_DSN` (and the token variables), redeploy, run section 7, add the e-mail alert rule.
2. **Uptime monitor** for `/api/health` (`deploy.md` section 12.2).
3. **Backups:** `deploy.md` section 13.1 (`install.sh` on the server), then the first restore drill (section 5.4).
4. **Neon point-in-time:** open _Backup & Restore_ once and note the real history window of your plan here in section 4.
5. **Orphan cleanup:** read the first dry-run reports, then decide on `ORPHAN_CLEANUP_MODE=delete`.
6. Check that `postgresql-client-16` installs on the GitHub runner (first CI run after merge) and that `PG_MAJOR` matches the Neon version.

## 14. Self-hosted ORS and Photon (dev PC + tunnel)

> **⛔ OBSOLETE since 2026-11-04 — read as history, not as instructions.**
> openrouteservice and Photon now run **on the dedicated server `65.109.100.79`** itself
> (containers `nudel-ors`, `photon-austria`, plus `nominatim` as Photon's data source), reached as
> `127.0.0.1:8082` / `127.0.0.1:2322`. There is **no reverse SSH tunnel any more**, and the old
> vServer `87.106.60.131` (and its 2 GB RAM constraint) is retired. `tunnel.ps1` now exits with an
> explanation instead of forwarding. To operate the services, work on the server, not on the dev PC.

Routing and geocoding run on the **development PC** (`deploy/local-services/README.md`), not on the
vServer. Everything below is on that PC unless it says otherwise.

**Health**

```powershell
# routing: {"status":"ready"}   geocoding: a FeatureCollection with one hit
curl.exe -s http://127.0.0.1:8082/ors/v2/health
curl.exe -s "http://127.0.0.1:2322/api?q=Wien&limit=1"
# the tunnel holds both forwards on the server, and the app reports what it uses
ssh root@<server> "ss -ltnp | grep -E ':8082|:2322'"
ssh root@<server> "curl -s http://127.0.0.1:3100/delivery-app/api/health"
```

**Start / stop**

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local-services\start-ors.ps1      # ~10 s when the graph exists
powershell -ExecutionPolicy Bypass -File deploy\local-services\start-photon.ps1
powershell -ExecutionPolicy Bypass -File deploy\local-services\tunnel.ps1         # keeps itself alive
docker stop nudel-ors photon-austria ; docker start nudel-ors photon-austria       # pause / resume
```

The tunnel is registered for autostart (`HKCU\…\Run` → `NudelLieferApp-Tunnel`); the containers
have `--restart unless-stopped`, so they come back with Docker after a reboot. Both must be
verified separately after a deploy or a Docker Desktop restart: **a deploy starts neither.**

**This is a stopgap, not the final hosting.** Production depends on this PC being awake while the
client's server is the 2 GB box. At the hand-over the app must run against ORS/Photon on a host that
can carry them, or against a paid `ORS_API_KEY`; then remove `ORS_BASE_URL` / `PHOTON_URL` from
`/etc/delivery-app.env`, restart the service, drop the tunnel and its autostart entry. The ordered
checklist is in `deploy/local-services/README.md` ("This is a stopgap, not the final setup").

**Rebuild the ORS graph** (after a new OSM extract, or when the graph is corrupt — takes ~15 min):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local-services\start-ors.ps1 -Rebuild
```

**Rebuild the Photon index**: delete `C:\ors-local\photon\photon_data` and restart the container
(it unpacks `photon-db-austria-1.0.tar.bz2` again).

**Symptoms**

| Symptom | Cause / fix |
| --- | --- |
| Tour shows "Näherungswerte" | Tunnel down, ORS container down, or `ORS_BASE_URL` missing in `/etc/delivery-app.env`. The app keeps working — check `routing.mode` in `/api/health`, but note that it only reports the configuration; curl `127.0.0.1:8082/ors/v2/health` from the server for the truth. |
| Geocoding silently invents coordinates | Photon down while the tunnel is up — and `geocoding.mode` stays `self-hosted`, because it only reads the env: `docker ps` shows `photon-austria` exited. `docker start photon-austria`, then `ssh root@<server> "curl -s 'http://127.0.0.1:2322/api?q=Wien&limit=1'"` must return a hit. Seen on 2026-10-31: the container predated the `--restart` flag, so Docker never brought it back; `docker update --restart unless-stopped photon-austria` fixed it. |
| New customers get no Adresspunkt | `PHOTON_URL` unset or Photon down (`geocoding.mode` = `fake`). `tsx scripts/geocode-customers.ts` fills them (dry run first). |
| `ssh: connect … ExitOnForwardFailure` | The ports are already forwarded on the server (an old tunnel is still alive): `pkill -f 'ssh.*8082:127.0.0.1:8082'` on the server, then start the tunnel again. |
| ORS answers 503 for a long time | The graph is still building (`docker logs -f nudel-ors`); after a `-Rebuild` this is normal for ~15 min. |
| `bind: address already in use` on the dev PC | Another program uses 8082/2322 (Photon already ran on 2322); stop it or change the port in the scripts **and** the tunnel together. |
