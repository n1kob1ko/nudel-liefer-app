# Railway Hosting Preparation (NUD-202) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the repository needs so that the app can run on Railway instead of the dedicated server, without creating anything on Railway yet and without changing how the current server works.

**Architecture:** One Railway project, region Europe West. The app is built from the repository root by Railpack (all service variables are present at build time, which the CSP in `next.config.ts` needs). PostgreSQL 18 comes from Railway's template, photos go to a private Railway bucket (virtual-hosted URLs, browser uploads through presigned PUT + a CORS rule). Four helper services are built from Dockerfiles in `deploy/railway/`: `cron` (one dispatcher run every 5 minutes instead of seven schedules), `backup` (nightly master-data dump into a second bucket), `ors` and `photon` (routing and geocoding with their data on a volume, reached over the private network).

**Tech Stack:** Next.js 16, pnpm 12, Prisma 7, AWS SDK v3, Node 22 type stripping (the cron dispatcher is one `.ts` file without dependencies), Docker.

**Spec:** `docs/deploy-railway.md` (written in Task 7; the service table there is the source of truth for the settings applied through the Railway connector).

## Global Constraints

- Nothing in this plan creates, buys or changes anything on Railway or on the server `65.109.100.79`.
- The current server keeps working unchanged: every new variable is optional and its default is today's behaviour (`S3_URL_STYLE` unset = path style whenever `S3_ENDPOINT` is set).
- No `railway.json` / `railway.toml`: Config as Code is deprecated and new services cannot opt in (Railway docs, read 2026-11-13). No `Dockerfile` in the repository root, or Railway would use it for the app instead of Railpack.
- The master-data rule of NUD-200 stays: the backup never holds orders, tours or payments, also on Railway.
- No secrets in the repository, the docs or the plan. Variables that carry secrets are Railway references (`${{Postgres.DATABASE_URL}}`) or generated in the dashboard.
- Files keep their line endings (`pnpm-lock.yaml` is CRLF and must not change).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` stay green.

## Review Focus

1. A bucket with virtual-hosted URLs: the CSP must allow `https://<bucket>.<endpoint host>`, not the bare endpoint, or every photo upload is blocked in the browser. Test in Task 1.
2. A dispatcher run that starts late or twice in one 5-minute slot must neither skip the daily jobs nor run them twice. Test in Task 4 (slot arithmetic, not wall-clock minutes).
3. One failing cron route must not stop the others, and the run must end with exit code 1 so that Railway shows it as failed. Test in Task 4.
4. An unknown `S3_URL_STYLE` value (`Virtual `, `vhost`) must fail the deploy check instead of silently signing path-style URLs. Test in Task 1 and Task 3.
5. A second start of `ors` / `photon` must not download the data again, and a download that broke off must not be taken for complete. Verified by hand in Task 6 (marker file written only after success).

---

### Task 1: S3 URL style (virtual-hosted buckets)

**Files:**
- Create: `src/lib/s3-url-style.ts`, `src/lib/s3-url-style.test.ts`
- Modify: `src/server/storage/s3.ts`, `src/lib/security-headers.ts` (+ tests), `scripts/lib/backup.ts` (+ test), `scripts/backup/store.ts`, `scripts/set-bucket-lifecycle.ts`, `scripts/check-storage-private.ts`

**Interfaces:**
- Produces: `usesPathStyle(endpoint: string | undefined, style: string | undefined): boolean` (`virtual` -> false, otherwise `Boolean(endpoint)`), `isKnownUrlStyle(style: string | undefined): boolean` (unset, `path`, `virtual`; trimmed, case-insensitive), `S3Config.pathStyle: boolean`, `BackupConfig.s3.pathStyle: boolean`.
- Variables: `S3_URL_STYLE`, `BACKUP_S3_URL_STYLE`.

- [ ] Tests first: `usesPathStyle`, `readS3Config` (`pathStyle`), `storageSources({S3_ENDPOINT:"https://t3.storageapi.dev", S3_BUCKET:"photos-abc", S3_URL_STYLE:"virtual"})` equals `["https://photos-abc.t3.storageapi.dev"]`, `readBackupConfig` rejects an unknown `BACKUP_S3_URL_STYLE`.
- [ ] Implement, run `pnpm test src/lib src/server/storage scripts/lib/backup.test.ts`, commit.

### Task 2: CORS rule for the photo bucket

**Files:**
- Create: `scripts/lib/bucket-cors.ts`, `scripts/lib/bucket-cors.test.ts`, `scripts/set-bucket-cors.ts`

**Interfaces:**
- Produces: `corsRules(origins: readonly string[]): CORSRule[]` (methods GET, HEAD, PUT; header `content-type`; expose `ETag`; max age 3600) and `parseOrigin(value: string): string` (throws unless the value is a bare `https://host[:port]` origin, `http://localhost[:port]` allowed).
- CLI: `tsx scripts/set-bucket-cors.ts --origin https://app.example [--origin ...] [--apply]`, dry run by default, same exit codes as `set-bucket-lifecycle.ts`.

- [ ] Tests first (rule shape, origin with a path or a wildcard is refused), implement, commit.

### Task 3: Deploy check and package scripts for Railway

**Files:**
- Modify: `scripts/lib/deploy-env.ts` (+ test), `scripts/check-deploy-env.ts`, `package.json`

- [ ] `checkDeployEnv`: production also when `RAILWAY_ENVIRONMENT_NAME === "production"`; the R2 endpoint warning only for Vercel; error for an unknown `S3_URL_STYLE`; on Railway a missing `CRON_SECRET` is an error (the dispatcher cannot work without it).
- [ ] `check-deploy-env.ts` also runs when `RAILWAY_ENVIRONMENT_NAME` is set.
- [ ] Scripts: `"build:railway": "tsx scripts/check-deploy-env.ts && pnpm build"`, `"start:railway": "next start --hostname ::"`.
- [ ] Verify by hand: `pnpm build` without a reachable database, then `PORT=3111 pnpm start:railway` answers on `127.0.0.1` and `[::1]`.

### Task 4: Cron dispatcher

**Files:**
- Create: `deploy/railway/cron/dispatch.ts`, `deploy/railway/cron/Dockerfile`, `scripts/railway/cron-dispatch.test.ts`

**Interfaces:**
- Produces: `CRON_JOBS: readonly { path: string; schedule: string }[]` (same seven entries as `vercel.json`, asserted by the test), `matchesCron(expression: string, at: Date): boolean` (5 fields, UTC, `*`, `*/n`, numbers, lists, ranges), `dueJobs(now: Date, slotMinutes = 5): string[]` (paths whose schedule matches a minute of the slot that ended at the last multiple of `slotMinutes` before or at `now`), `runDue(options: { now: Date; baseUrl: string; secret: string; fetchImpl: typeof fetch; log: (line: string) => void }): Promise<{ ok: string[]; failed: string[] }>`.
- Variables of the service: `APP_URL`, `CRON_SECRET`. Railway schedule: `*/5 * * * *`. Exit code 1 when a call failed or a variable is missing.

- [ ] Tests first: list equals `vercel.json`; 03:20:40 UTC yields `retention` (03:17) and not `audit-retention` (03:37); 03:21 and 03:24 yield the same slot; Sunday 04:10 yields `orphan-cleanup`, Monday does not; every 10th minute yields `retry-translations` exactly once per two slots; a 500 from one route still calls the others and lands in `failed`.
- [ ] Implement, run with `node deploy/railway/cron/dispatch.ts` against the locally started app, build the image, commit.

### Task 5: Backup image

**Files:**
- Create: `deploy/railway/backup/Dockerfile`

- [ ] `node:22-bookworm-slim` + `postgresql-client-18` from PGDG + `pnpm install --frozen-lockfile`; `CMD ["pnpm", "backup:db"]`. Railway schedule `23 2 * * *`, variables `BACKUP_DATABASE_URL`, `BACKUP_S3_*`, `BACKUP_S3_URL_STYLE=virtual`.
- [ ] Build it, run it against a local PostgreSQL 18 and MinIO, commit.

### Task 6: Routing and geocoding images

**Files:**
- Create: `deploy/railway/ors/Dockerfile`, `deploy/railway/ors/start.sh`, `deploy/railway/ors/ors-config.yml`, `deploy/railway/photon/Dockerfile`, `deploy/railway/photon/start.sh`

- [ ] `ors`: `openrouteservice/openrouteservice:v9.1.1`, volume at `/data`, first start downloads `OSM_URL` (default the Geofabrik Austria extract) to `/data/osm`, graphs in `/data/graphs`, port 8082, `XMS`/`XMX` from the environment.
- [ ] `photon`: `eclipse-temurin:21-jre` + `photon-1.3.0.jar`, volume at `/data`, first start downloads and unpacks `PHOTON_INDEX_URL`, port 2322.
- [ ] Both: marker file after a complete download, `set -eu`, download to `*.partial` first. Build both images; start each once as far as this machine's network allows.

### Task 7: Documentation

**Files:**
- Create: `docs/deploy-railway.md`
- Modify: `docs/env.md`, `.env.example`, `AGENTS.md`, `backlog.md` (ticket NUD-202, decision log)

- [ ] `docs/deploy-railway.md`: service table (source, root directory, build/start/pre-deploy, schedule, volume, variables as names and references), first deploy, moving the data and photos from the server, switching the address, checks after the first deploy, costs, rollback.
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check`, commit, open the PR.
