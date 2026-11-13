# Dedicated end-to-end database (NUD-162)

Some Playwright specs own a day of the database they read, and one of them needs the demo data. Run
against the developer's database, they abort with "Precondition failed" as soon as it holds a tour
for today, and `tour-split.spec.ts` used to fail on "0 tour tabs" without saying why. This page
describes the supported way to run them: **a database of its own, prepared by one command**.

Nothing here deletes, migrates or even opens your development or production database. The command
refuses to run when `E2E_DATABASE_URL` names the same host/port/database as `DATABASE_URL` (or as
`DATABASE_URL_UNPOOLED`, `BACKUP_DATABASE_URL`, `RESTORE_DATABASE_URL`,
`PARKING_IMPORT_DATABASE_URL`).

> **Runs before NUD-162 left debris in the demo database** (QA 2026-10-29, F16): `E2E Fahrer`,
> `Osteria … e2es…` customers and `E2E …` vehicles, plus hand-made `A3 Prüf…` rows.
> `node_modules\.bin\tsx.cmd scripts/archive-test-data.ts` lists them, `--apply` deactivates them
> (soft delete only — orders, stops and tours are never touched). NUD-188 archived the ones found on
> 2026-10-29.

## 1. What the specs need

| Spec             | Needs                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- |
| `mvp-happy-path` | demo seed: confirmed depot pin, demo drivers, catalog products; **no tour for today** |
| `late-orders`    | base seed: admin + `NUDELN-BEUTEL` / `NUDELN-KARTON`; **no tour for today**           |
| `tour-split`     | base seed: admin + `NUDELN-KARTON`; **no tour on the day it plans**                   |
| everything else  | base seed; most specs create and delete their own rows                                |

The checks run before the first browser step and print what is missing, which database it is
(`host:port/name`, never the password) and the command that fixes it.

## 2. One-time setup

1. Create an empty PostgreSQL database next to the dev one, e.g. on the local Docker/embedded
   Postgres (`docker-compose.yml`, port 5123):

   ```bash
   createdb -h localhost -p 5123 -U postgres nudel_e2e     # or: docker exec -it <pg> createdb -U postgres nudel_e2e
   ```

   Any name and server works, including a throwaway Neon branch — it must only be a database of its
   own.

2. Put the URL in `.env` (git-ignored) next to `DATABASE_URL`:

   ```dotenv
   E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5123/nudel_e2e
   ```

   `playwright.config.ts` and `pnpm e2e:db:reset` read it from there (or from the shell). Without the
   variable nothing changes: the suite keeps using `DATABASE_URL`, exactly as before NUD-162.

3. Prepare the database:

   ```bash
   pnpm e2e:db:reset
   ```

## 3. `pnpm e2e:db:reset`

One command, and it only ever touches `E2E_DATABASE_URL`:

1. prints the target as `host:port/name` and refuses to continue if it is a protected database;
2. `prisma migrate reset --force` — drops everything in that database and applies every migration
   (the base seed configured in `prisma.config.ts` runs as part of it);
3. runs the base seed and `seedDemo({ photos: false })` — admin, Settings with a **confirmed depot
   pin**, demo drivers (`fahrer-de`, `driver-hans`, `driver-en`, `driver-sr`, `driver-cs`,
   `driver-new`), catalog products, vehicles, 20 demo customers and their confirmed orders **for the
   next delivery day**. Today stays free of orders, so no tour exists for it;
4. prints the seed summary and the reminder to run the suite with the variable still set.

It needs `SEED_ADMIN_PASSWORD` (from `.env`, default `change-me-local-only`) and no S3/MinIO, because
the demo photos are skipped. It never touches the object storage.

Run it again whenever a spec complains about a tour for today or about missing seed data: it always
produces the same clean starting point. It takes well under a minute on a local Postgres.

## 4. Running the suite

```bash
pnpm test:e2e tests/e2e/late-orders.spec.ts tests/e2e/mvp-happy-path.spec.ts tests/e2e/tour-split.spec.ts
```

`playwright.config.ts` copies `E2E_DATABASE_URL` into `DATABASE_URL` in the Playwright process (the
specs open their own `pg` connections) and passes it to the webServer command, so app and assertions
read the same rows. `reuseExistingServer: !CI` and the `E2E_PREBUILT` switch are unchanged, see
[`env.md`](./env.md).

Four caveats:

- **A reused server keeps its own database.** Locally (`without CI`) Playwright reuses a server that
  already listens on the port; that process was started with its own environment, so it still talks
  to `DATABASE_URL`. Stop a `pnpm dev` on the port first, or run with `CI=1` (fresh server, but then
  use a free `PORT=` and expect the build time, see `E2E_PREBUILT`).
- **The specs without the "today" requirement are indifferent.** They work on either database; run
  them with or without `E2E_DATABASE_URL`.
- **One worker.** `playwright.config.ts` sets `workers: 1`. The specs share one database and several
  own something that exists only once in it (the settings row, "today" of the dashboard and of the
  driver app, the vehicles of the planning dialog); side by side they changed each other's
  preconditions and a full run failed in different places every time. `--workers=N` on the command
  line still wins for specs you know to be independent.
- **Settings written by a spec need `expireSettingsCache()`.** The server caches the settings row
  (`getSettings`, "use cache") and only its own save action expires that copy. A spec that writes
  `"Settings"` straight to the database (confirmed depot, departure checklist) calls
  `expireSettingsCache()` from `tests/e2e/helpers/settings.ts` after the write and after the restore;
  without it the pages keep the value the server read first. The helper posts to
  `/api/dev/settings-cache`, which exists only with `ENABLE_ERROR_TEST_PAGES=true` (see
  [`env.md`](./env.md)).

## 5. Reading the messages

| Message starts with                                              | Cause                                                 | Fix                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `Precondition failed: … has not applied N migration(s)`          | the database is behind `prisma/migrations`            | `pnpm db:migrate` (or `pnpm e2e:db:reset`)                 |
| `Precondition failed: … is not seeded — missing …`               | no base seed                                          | `pnpm db:seed` (or `pnpm e2e:db:reset`)                    |
| `Precondition failed: the depot pin is not confirmed …`          | no demo seed                                          | `pnpm db:seed --demo --no-photos` (or `pnpm e2e:db:reset`) |
| `Precondition failed: … tour already exists for today …`         | another spec or a manual run created a tour for today | `pnpm e2e:db:reset`                                        |
| `Precondition failed: …/api/dev/settings-cache answered 404 …`   | the server runs without `ENABLE_ERROR_TEST_PAGES`     | start it with `ENABLE_ERROR_TEST_PAGES=true`               |
| `E2E_DATABASE_URL is not set …`                                  | the variable is missing                               | section 2 above                                            |
| `E2E_DATABASE_URL points at the same database as DATABASE_URL …` | the e2e variable was pointed at the dev database      | use a database of its own                                  |

## 6. Cleaning up

The database is disposable: drop it when you no longer need it
(`dropdb -h localhost -p 5123 -U postgres nudel_e2e`) and remove `E2E_DATABASE_URL` from `.env`. The
suite falls back to `DATABASE_URL` again.

## 7. CI

The CI workflow keeps its own database per job (it migrates and seeds it in the job), so
`E2E_DATABASE_URL` is optional there; setting it to that job's database is harmless and makes the
"same database" guard cover it.
