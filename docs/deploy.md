# Deployment (Vercel + Neon + Cloudflare R2)

Target setup (backlog decision D4): Vercel project in `fra1` (Frankfurt), Neon Postgres in EU (Frankfurt), Cloudflare R2 bucket in the EU jurisdiction. Budget target: under 50 EUR per month.

This guide is written for a person without developer background. Everything an agent can prepare is already in the repo: `vercel.json`, the `build:vercel` script (runs the environment check, then `prisma migrate deploy`, then `next build`), `GET /api/health`, and the seed options. Menu names in the three web consoles change from time to time; if a label differs slightly, look for the closest one.

**Rules:** never paste a key, password or connection string into git, a ticket, a chat or an email. Put secrets only into the Vercel environment variable form (section 5) and into your password manager.

Contents: 0 Overview and costs, 1 GitHub, 2 Neon, 3 Cloudflare R2, 4 Vercel project, 5 Environment variables, 6 First deploy, 7 Seed production once, 8 Preview deployments, 9 Verify, 10 Troubleshooting, 11 Security configuration, 12 Monitoring (Sentry, uptime), 13 Backups.

Day-to-day operation (rollback, restore, key rotation, outages, logs) is in [`runbook.md`](./runbook.md).

## 0. Overview and costs

| Service       | Purpose                | Plan to choose                                                                                                                                                           |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub        | code, triggers deploys | Free                                                                                                                                                                     |
| Vercel        | hosts the app          | **Pro (about 20 USD per user per month).** The free Hobby plan is for non-commercial use only, so it must not be used for a real client project.                         |
| Neon          | PostgreSQL             | Free plan is enough to start (0.5 GB). Move to Launch (usage based, typically a few USD) when the database grows or you need longer point-in-time restore (see NUD-094). |
| Cloudflare R2 | photos and screenshots | Free tier: 10 GB stored per month, no egress fees. R2 asks for a payment method when you enable it; staying within the free tier costs nothing.                          |

Prices are from memory and may have changed: check each pricing page before you enter a payment method. Creating accounts and adding payment methods is your decision; the agent never does it.

## 1. GitHub repository (once)

The project currently exists only on your computer.

1. Sign in at github.com, click **+** (top right) then **New repository**. Name: `nudel-liefer-app`. Visibility: **Private**. Do not add README, .gitignore or license. Click **Create repository**.
2. On your computer, in the project folder, run the two commands GitHub shows under "push an existing repository" (`git remote add origin ...` and `git push -u origin main`).
3. In the repository: **Settings > Branches > Add branch protection rule** for `main` (optional but recommended): require a pull request and the status check `check` (from `.github/workflows/ci.yml`).

Tip for the first push: CI runs on GitHub for the first time. NUD-001 and NUD-004 list "CI green" as an open check; once it is green, tell the agent so those tickets can be closed.

## 2. Neon (database, EU Frankfurt)

1. Go to neon.com, **Sign up** (GitHub login is fine).
2. **Create project** (or "New project"):
   - Project name: `nudel-liefer-app`
   - Postgres version: **16** (or newer; the app is developed against 16)
   - Cloud provider: **AWS**
   - Region: **Europe (Frankfurt) - aws-eu-central-1**. This is the one region that matters for GDPR; it cannot be changed later.
   - Click **Create**.
3. Neon creates a branch called `main` (production) with a database `neondb`. Keep these defaults, or rename the database to `nudel` under **Databases**.
4. Copy two connection strings, both for branch `main`: on the project dashboard click **Connect**.
   - Turn **Connection pooling ON** and copy the string. This is `DATABASE_URL` (host contains `-pooler`).
   - Turn **Connection pooling OFF** and copy the string. This is `DATABASE_URL_UNPOOLED` (direct connection, used for migrations and for the one-time seed).
   - Both must end with `?sslmode=require`. Keep them in your password manager for now.
5. Create the shared staging branch for preview deployments (see section 8): **Branches > Create branch**. Name: `staging`, parent: `main` (production is still empty at this point, so the branch holds no real data). Copy its two connection strings the same way (pooled and direct).

Backups: Neon keeps a short history (free plan about 6 hours, paid plans longer) that you can restore from under **Backup & Restore** (point-in-time restore, `runbook.md` section 4). On top of that a weekly logical backup goes to R2 (section 13).

## 3. Cloudflare R2 (photos, EU jurisdiction)

1. Go to cloudflare.com, **Sign up**. In the dashboard left menu click **R2 Object Storage** (under "Storage & databases"). If asked, enable R2 and add a payment method (free tier, see section 0).
2. **Create bucket**:
   - Bucket name: `nudel-photos`
   - Location: choose **Specify jurisdiction** and then **European Union (EU)**. Do not pick "Automatic": data could be stored outside the EU, and the jurisdiction cannot be changed afterwards.
   - Default storage class: **Standard**. Click **Create bucket**.
3. Keep the bucket **private**: on the bucket's **Settings** page make sure **Public access** shows "Disabled" for both the `r2.dev` subdomain and custom domains. The app shows photos through short-lived signed links.
4. Create a second bucket the same way (also EU jurisdiction) named `nudel-photos-staging` for preview deployments.
5. Note the **Account ID**: R2 overview page, right-hand side ("Account details"). The S3 endpoint for EU buckets is
   `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`
   (this is `S3_ENDPOINT`; note the `.eu.` part - without it the EU buckets are not found).
6. Create an API token for the production bucket: R2 overview, **Manage API tokens** (or **API** > **Manage API Tokens**) > **Create API token**.
   - Token name: `nudel-photos-production`
   - Permissions: **Object Read & Write**
   - Specify bucket(s): **Apply to specific buckets only** > `nudel-photos`
   - TTL: forever (or set a reminder to rotate it)
   - Click **Create API Token**. The next page shows **Access Key ID** and **Secret Access Key** exactly once. Copy both into your password manager now. (Ignore the "Token value" and the "URL for jurisdiction" shown there; the app needs Access Key ID, Secret Access Key and the endpoint from step 5.)
   - Repeat for `nudel-photos-staging` with the name `nudel-photos-staging`.
7. CORS (required, otherwise the browser cannot upload): open bucket `nudel-photos` > **Settings** > **CORS Policy** > **Add CORS policy** > JSON tab, and paste the following. Replace the origin with your real production URL (add your own domain too once it exists; list every origin from which people open the app). No trailing slash.

   ```json
   [
     {
       "AllowedOrigins": ["https://<your-production-domain>"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["content-type", "content-length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   For `nudel-photos-staging` (previews have a different URL per deployment and R2 does not accept wildcard subdomains) use `"AllowedOrigins": ["*"]`. That bucket only ever contains test data. Never use `*` for the production bucket.

## 4. Vercel project (region fra1)

1. Go to vercel.com, **Sign up** with GitHub. Upgrade to **Pro** (section 0) under **Settings > Billing** before you put real data in.
2. **Add New... > Project**, pick the GitHub repository `nudel-liefer-app` (click "Adjust GitHub App Permissions" if it is not listed) and **Import**.
3. On the configure screen:
   - Framework Preset: **Next.js** (detected). Root Directory: leave empty (`./`).
   - Build and Output Settings: leave as they are. `vercel.json` in the repository already sets install command `pnpm install --frozen-lockfile`, build command `pnpm build:vercel` and region `fra1`.
   - Do **not** click Deploy yet. Open **Environment Variables** and enter the variables of section 5, or click Deploy (it will fail the first build with a clear list of missing variables, which is harmless) and enter them afterwards under **Settings > Environment Variables**.
4. **Settings > Functions > Function Region**: confirm **Frankfurt, Germany (West) - fra1** (it follows `vercel.json`; a change here takes effect on the next deployment).
5. **Settings > General > Node.js Version**: **22.x**.
6. **Settings > Git**: Production Branch = `main`. Every push to `main` now deploys to production, every pull request gets a preview deployment.
7. **Settings > Deployment Protection**: keep "Vercel Authentication" enabled for **Preview** deployments (only logged-in team members can open previews). Production stays public (drivers and the office use it).

## 5. Environment variables

Enter them under **Settings > Environment Variables**. For each variable choose the environments shown in the table (checkboxes Production / Preview / Development). Mark every secret as **Sensitive** when Vercel offers it. Do not set anything for "Development" (local work uses `.env`).

| Variable                | Production value                                              | Preview value                     | Sensitive |
| ----------------------- | ------------------------------------------------------------- | --------------------------------- | --------- |
| `DATABASE_URL`          | Neon `main`, **pooled** string (section 2 step 4)             | Neon `staging`, **pooled** string | yes       |
| `DATABASE_URL_UNPOOLED` | Neon `main`, **direct** string                                | Neon `staging`, **direct** string | yes       |
| `AUTH_SECRET`           | new random value: run `openssl rand -base64 32` in a terminal | a **different** random value      | yes       |
| `S3_ENDPOINT`           | `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`            | same                              | no        |
| `S3_REGION`             | `auto`                                                        | `auto`                            | no        |
| `S3_BUCKET`             | `nudel-photos`                                                | `nudel-photos-staging`            | no        |
| `S3_ACCESS_KEY_ID`      | token `nudel-photos-production`                               | token `nudel-photos-staging`      | yes       |
| `S3_SECRET_ACCESS_KEY`  | token `nudel-photos-production`                               | token `nudel-photos-staging`      | yes       |

Notes:

- Vercel lets you add the same variable name twice with different environments ticked (one entry for Production, one for Preview).
- Do **not** set `SEED_ADMIN_PASSWORD` in Vercel. It is only needed for the one-time seed on your computer (section 7).
- Translation (NUD-070): set `DEEPL_API_KEY` (and optionally `DEEPL_API_PLAN`) and `CRON_SECRET` (`openssl rand -base64 32`) for Production; the cron job in `vercel.json` retries failed translations every 10 minutes and needs the Vercel Pro plan (see `docs/env.md`). The build only warns when they are missing.
- Retention (NUD-093): `CRON_SECRET` is also required for `GET /api/cron/retention` (daily, deletes order screenshots after `SCREENSHOT_RETENTION_DAYS`, default 180, and old failed-login rows). Details in `docs/privacy.md`; add the bucket lifecycle rule of section 11.3. Audit log retention (NUD-111): `GET /api/cron/audit-retention` (daily, `AUDIT_RETENTION_DAYS`, default 730) needs the same `CRON_SECRET`; the migration `20261018130000_audit_log_retention` must be applied. Recurring orders (NUD-149): `GET /api/cron/recurring-orders` (daily 02:27 UTC, `Settings.recurringLeadDays`, default 14) needs the same `CRON_SECRET`; it is idempotent. Driver text retention (NUD-112): `GET /api/cron/data-retention` (daily, `DRIVER_TEXT_RETENTION_DAYS`, default 365) needs the same `CRON_SECRET` and only reports (`dry-run`) until `DATA_RETENTION_MODE=delete` is set; `docs/privacy.md` section 6.
- `MAP_TILE_URL` and `S3_*` also decide the Content-Security-Policy (section 11.1): they are read when the app is **built**, so redeploy after changing them.
- Monitoring (NUD-094): `SENTRY_DSN` (and, for readable stack traces, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) - section 12. All optional.
- Orphaned objects (NUD-094): `ORPHAN_CLEANUP_MODE` (default `dry-run`) and `ORPHAN_CLEANUP_GRACE_DAYS`, `runbook.md` section 10. Needs `CRON_SECRET`.
- `ENABLE_ERROR_TEST_PAGES` must **not** exist in Production (the build stops if it does).
- Variables for later tickets (`ORS_API_KEY`) are added by those tickets.
- Changing a variable only affects new deployments: after a change click **Deployments > ... > Redeploy**.

## 6. First deploy

1. **Deployments > Redeploy** (or push a commit to `main`). Open the build log; you should see, in this order: `[deploy-env] ok`, Prisma applying the migrations (`prisma migrate deploy`), then the Next.js build.
2. If the first lines say `[deploy-env] error: ...`, fix the listed variables (section 5) and redeploy. The check never prints values.
3. When the deployment is "Ready", click **Visit**. You see the login page. Copy the production URL and add it to the R2 CORS policy of `nudel-photos` (section 3 step 7) if you have not done so.

Each deployment runs `prisma migrate deploy` against its database before building. Migrations are applied automatically and never reset data; a failed migration fails the build, and the previous deployment stays live.

## 7. Seed production once

The migrations create empty tables. One command creates the settings row (placeholder depot), the first admin and six placeholder products. Run it **once**, on your computer, after the first successful deploy (so the tables exist). It needs Node 22 and pnpm; if you do not have them, ask a developer to run it with you.

1. In a terminal in the project folder, run `pnpm install` (once).
2. Run the following block. It asks for the values without echoing them, so nothing lands in your shell history. Use the **direct** (unpooled) Neon string of branch `main`, pick a strong admin password (at least 16 characters, from your password manager) and your real admin email address.

   ```bash
   read -rs -p "Neon main DIRECT url: " DATABASE_URL && echo
   read -rs -p "Admin password: " SEED_ADMIN_PASSWORD && echo
   read -r -p "Admin email: " SEED_ADMIN_EMAIL
   export DATABASE_URL SEED_ADMIN_PASSWORD SEED_ADMIN_EMAIL SEED_DRIVERS=false
   pnpm db:seed
   unset DATABASE_URL SEED_ADMIN_PASSWORD SEED_ADMIN_EMAIL SEED_DRIVERS
   ```

3. Expected output: `Seed finished`. `SEED_DRIVERS=false` is important: without it four demo drivers with the well-known PIN `123456` would exist on production. Drivers are created in the admin area (NUD-008).
4. Running it again is harmless (it only creates what is missing), but it does not change an existing password. Do not run it with other values to "reset" the admin.
5. Sign in on the production URL with that email and password. You land on the admin dashboard.

For `staging` (previews) do the same once with the staging direct URL, a throw-away password and without `SEED_DRIVERS=false` (the demo drivers are useful there).

## 8. Preview deployments: decision

Every pull request already gets its own Vercel preview URL. Which database do previews use?

- **Chosen for v1: one shared Neon branch `staging`** (created in section 2 step 5, seeded with fake data), used by all previews through the Preview-scoped variables of section 5, with the separate R2 bucket `nudel-photos-staging`. Reasons: production data (customers, addresses, password hashes) never reaches previews; no extra moving parts or Vercel marketplace integration; free. Each preview build runs `prisma migrate deploy` against `staging`, so previews always get the newest migrations.
- **Known downside:** two open pull requests with different migrations share one database and can break each other's preview. Acceptable with one developer and short-lived PRs. If it starts hurting, reset staging: Neon > Branches > `staging` > **Reset from parent** (this copies production, so re-seed/anonymise afterwards), or recreate the branch.
- **Alternative (not chosen now): a Neon branch per PR** via Neon's Vercel integration (Vercel project > Integrations > Neon, option "create a database branch for each preview deployment"). Technically feasible and gives full isolation, but those branches are copies of production data unless the parent is a clean branch, which has to be confirmed in the integration settings. Revisit after the first real customers are loaded.

## 9. Verify

1. Open `https://<production-url>/api/health`. Expected (HTTP 200):

   ```json
   {
     "status": "ok",
     "checks": {
       "database": { "status": "ok", "latencyMs": 12 },
       "storage": { "status": "ok", "mode": "s3", "latencyMs": 80 }
     },
     "release": "a1b2c3d",
     "region": "fra1"
   }
   ```

   `region` must be `fra1`. A failing dependency gives HTTP 503 and `"status": "error"` (the response never contains secrets or error details; the reason is in **Vercel > Logs**). This URL is public on purpose and is the one to give to an uptime monitor (NUD-094).

2. Sign in on `/de/login` with the seeded admin. You reach the admin dashboard.
3. Neon console > Branches > `main` > **Tables** shows the app's tables, and `_prisma_migrations` lists the applied migrations.
4. Upload check: upload a customer photo and check that it appears in the R2 bucket (Objects) and that opening the object's plain URL without a signature is denied (section 11.3 automates this).
5. Tell the agent: production URL and the result of `/api/health`. The ticket NUD-007 can then be closed.

## 10. Troubleshooting

| Symptom                                                          | Likely cause and fix                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Build log: `[deploy-env] error: ...`                             | A variable is missing or still a placeholder. Fix it in section 5 and redeploy.                                                               |
| Build fails in `prisma migrate deploy` with a timeout or lock    | `DATABASE_URL_UNPOOLED` is missing or is the pooled string. It must be the **direct** one (no `-pooler` in the host name).                    |
| `/api/health` returns 503, `database: error`                     | Wrong `DATABASE_URL`, Neon compute suspended and still waking up (retry once), or Neon project deleted. See Vercel Logs.                      |
| `/api/health` returns 503, `storage: error`                      | Wrong bucket name, endpoint without `.eu.`, or token not scoped to that bucket. See Vercel Logs.                                              |
| Photo upload fails in the browser with a CORS error              | The app's origin is missing in the bucket's CORS policy (section 3 step 7), or has a trailing slash.                                          |
| Login works locally but not on Vercel                            | `AUTH_SECRET` missing in that environment, or you changed it (all sessions become invalid, which is fine). Redeploy after changing variables. |
| `Seed finished` never appears / `SEED_ADMIN_PASSWORD is not set` | The variable was not exported in the same terminal session; repeat the block of section 7.                                                    |

## 11. Security configuration (NUD-093)

### 11.1 Security headers and Content-Security-Policy

Every response (pages, API routes, static files, the service worker) carries these headers, built in
`src/lib/security-headers.ts`: the CSP of **pages** is set by `src/proxy.ts` (per-request nonce, see
11.1a), everything else by `next.config.ts`:

| Header                                      | Value / purpose                                                                                                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`                   | see below                                                                                                                                                                                                                               |
| `Strict-Transport-Security`                 | `max-age=63072000; includeSubDomains` (two years, no `preload`: submit to the preload list only deliberately)                                                                                                                           |
| `X-Frame-Options` and CSP `frame-ancestors` | `DENY` / `'none'`: the app can never be framed                                                                                                                                                                                          |
| `X-Content-Type-Options`                    | `nosniff`                                                                                                                                                                                                                               |
| `Referrer-Policy`                           | `strict-origin-when-cross-origin`: other sites (the tile server) see only our host name                                                                                                                                                 |
| `Permissions-Policy`                        | `camera=(self)`, `geolocation=(self)`, everything else off (`microphone`, `payment`, `usb`, ...). Geolocation is used only for the one-off position fix of "Parkplatz festlegen" (NUD-144, no tracking, D19). Driver photos use `<input capture>` which needs no permission; the camera entry only keeps a future `getUserMedia` working on our own origin |
| `Cross-Origin-Opener-Policy`                | `same-origin`                                                                                                                                                                                                                           |

The policy: `default-src 'self'`; `script-src 'self'` + (pages only) `'nonce-<per request>'` and the
hashes of the prebuilt shells, never `'unsafe-inline'` (11.1a); `style-src 'self' 'unsafe-inline'`;
`img-src 'self' data: blob:` + the **storage origin** (from `S3_ENDPOINT`, or the AWS S3 host from
`S3_BUCKET` + `S3_REGION`) + the **tile origin** (from `MAP_TILE_URL`; `{s}` subdomains become a
wildcard); `connect-src 'self'` + the storage origin (browser uploads `PUT` and downloads photos for the
offline copy); `worker-src 'self'`; `manifest-src 'self'`; `object-src 'none'`; `frame-src 'none'`;
`frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `report-uri /api/csp-report`.

`'unsafe-inline'` for **styles** stays: Leaflet positions panes and markers with inline styles. The
remaining directives (`object-src`, `base-uri`, `form-action`, `frame-ancestors`, host allow-lists for
images, connections and workers) limit what injected markup could do.

### 11.1a Strict script policy: nonce + hashes (NUD-110)

**Decision.** `script-src` has no `'unsafe-inline'` in production. The app uses cache components /
partial prerendering (PPR), where Next.js 16.4.2 documents nonces as incompatible
(`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`: "Partial Prerendering
(PPR) is incompatible with nonce-based CSP since static shell scripts won't have access to the
nonce"). Measured against the real build, the incompatibility is narrower than that sentence:

- A nonce in the CSP **request** header is applied by Next.js to every inline script it renders **per
  request**, including the resume part of a PPR page (hydration data, Suspense completions). That is
  most of the inline scripts.
- The **prebuilt** part cannot carry a nonce: in a PPR shell exactly two inline scripts, a fixed
  `requestAnimationFrame(...)` line and the Turbopack chunk list (`id="_R_"`, identical on every page
  of one build); in the four fully static pages (`/<locale>` home, `/<locale>/driver/offline-shell`)
  and `_not-found` / `_global-error` also their flight data (`self.__next_f.push(...)`).
- These are fixed text per build, so they are allowed by **SHA-256 hash**. `src/proxy.ts` therefore
  sends `script-src 'self' 'nonce-<random per response>' 'sha256-...'` (about 2 KB of header: hashes
  of the common documents plus those of the request's locale), and
  `script-src 'self'` for everything the proxy does not see (API, `/_next`, files, `sw.js`).
- The experimental `experimental.sri` is **not** an option: Next.js implements it in the webpack
  plugin only (`build/webpack/plugins/subresource-integrity-plugin.js`), this app builds with Turbopack, and
  SRI covers `<script src>` files, not the inline scripts that are the problem. `'strict-dynamic'`
  is not used (`'self'` already covers the chunk files).

**How the hashes get into the proxy.** The proxy bundle is built before the prerendered HTML exists,
and the hashes depend on the build output, so `pnpm build` / `pnpm build:vercel` run
`csp-script-hashes reset` -> `next build` -> `csp-script-hashes write` (hashes of every inline script
in `.next/server/app/**/*.html` and the build ID into git-ignored `.csp-script-hashes.json`) ->
`next build` (second pass: `next.config.ts` inlines the hashes into the proxy and reuses the first
build ID, which is part of the flight data of static pages) -> `build-pwa` -> `csp-script-hashes check`.
`check` **fails the build** if the final output hashes differ from the ones the proxy was built with, if
a static file in `public/` has an inline script, or if no hashes were found. So a deployment can never
ship a policy that does not match its pages. Consequences:

- Build with `pnpm build` (never `next build` alone for production): the second pass doubles the
  build time (about 15 s more here, 35 s in total). The Sentry source-map upload (if configured) runs in both passes.
- A Next.js / React upgrade that adds another inline script to the shells is handled automatically
  (hashed); one that makes the output differ between two identical builds fails the `check` step.
- Offline page: `public/offline.html` has no inline script or handler any more; its script is
  `public/offline.js` (precached next to it). Anything new in `public/*.html` must do the same.
- Do not add `next/script` inline scripts, `dangerouslySetInnerHTML` scripts or inline event handlers
  (`onclick="..."` attributes); they would be blocked. Inline `<script>` that Next.js renders per request
  get the nonce automatically.
- Development (`pnpm dev`) keeps `'unsafe-inline'` and `'unsafe-eval'` (HMR) and uses no nonce.
- The nonce is 128 random bits per response (`crypto.getRandomValues`) and also sent in the request
  header Next.js reads. The hashes only allow scripts the build itself produced; an injected script with
  other text is blocked (e2e `security-headers.spec.ts`, "injected inline script").
- Revisit when Next.js supports build-time hashes for PPR shells natively (then delete the two-pass build).

- Configuration is read when the app is built or started: after changing `MAP_TILE_URL` or `S3_*`
  redeploy. A wrong value shows up as blocked tiles or photos and as `[csp-violation]` lines in the log.
- **Violation reports:** browsers post violations to `POST /api/csp-report`, which writes one log
  line each (`[csp-violation] directive=... blocked=... document=...`, query strings removed). Search
  the Vercel logs for `csp-violation` after every deploy that touches the map, storage or scripts.
- **Report-only rollout:** set `CSP_REPORT_ONLY=true` and redeploy to send the policy as
  `Content-Security-Policy-Report-Only` (nothing is blocked, violations are only reported; pages read it
  per request, API routes and files when the app is built). Remove the variable to enforce. The shipped
  default is **enforcing**. The first deployment of NUD-110 should go out report-only: check the Vercel
  logs for `csp-violation` on the login, admin and driver pages and the installed PWA before enforcing.
- Zod's JIT probe (`new Function`) would be reported as a script violation; `src/instrumentation-client.ts`
  switches it off in the browser. Do not add `'unsafe-eval'` to production.
- Not verified from here: how a real Vercel deployment serves these headers (config headers are
  supported by Vercel for all routes, but check once with `curl -sI https://<production-url>/de/login`
  after the first deploy), HSTS on a custom domain, behaviour in real mobile browsers.

### 11.2 Signed URL lifetimes (reviewed)

| URL                                                                                   | Lifetime  | Where                                                                                                                                            |
| ------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Upload (`PUT`, one object, type and size signed)                                      | 5 minutes | `POST /api/uploads`; `UPLOAD_URL_TTL_SECONDS`                                                                                                    |
| Read URLs on admin pages (photos, screenshots) and the driver stop page               | 1 hour    | `Storage.getReadUrl` default; `READ_URL_TTL_SECONDS`                                                                                             |
| Photo URLs in the driver's tour copy (`/api/driver/tour/today`, `/api/driver/photos`) | 12 hours  | `DRIVER_PHOTO_URL_TTL_SECONDS`: one working day, so a phone that loaded the tour in the morning can still download or show photos in the evening |

Every URL is generated per request for an object key the server validated; keys are random UUIDs and
never guessable. The 12 hour URLs exist only inside the response to an authenticated driver and in the
phone's offline copy, which is deleted at the login page. `src/server/storage/url-lifetimes.test.ts`
pins the three values; change them only together with this table.

### 11.3 The bucket is not public

- Create the bucket private and keep **Public access** disabled (section 3 step 3): no `r2.dev`
  subdomain, no custom domain on the bucket. The API token is scoped to this one bucket with
  Object Read & Write.
- Verify from any computer with the production values: `S3_ENDPOINT=... S3_BUCKET=nudel-photos pnpm exec tsx scripts/check-storage-private.ts`
  sends anonymous requests to the bucket listing and to an object path and expects `401`/`403` for both
  (exit code 0). Run it after the first deploy and whenever bucket settings change. (It was run only
  against a local fake S3 during development; the real R2 bucket must be checked once by a human.)
- Lifecycle rule (R2 dashboard > bucket > **Settings** > **Object lifecycle rules** > add rule): prefix
  `screenshots/`, delete objects 190 days after upload. This is the backstop for screenshots that were
  uploaded but never attached to an order and so have no row for the retention job (`docs/privacy.md`
  section 3). Do not add a rule for `customers/`.

### 11.4 Dependencies

CI runs `pnpm audit --audit-level=high` and fails on high or critical advisories. Findings that cannot
be fixed are listed in `pnpm-workspace.yaml` under `auditConfig.ignoreGhsas` with the reason (currently
one: `braces` in the ESLint toolchain, development only, no patched release exists). Review that list
whenever the audit step fails or a dependency is updated.

### 11.5 Other protections worth knowing

- Server actions are protected by Next.js' own Origin/Host comparison; the route handlers that change
  state (`/api/uploads`, `/api/admin/customers/import/parse`, `/api/driver/sync`, `/api/driver/photos`)
  additionally reject a foreign `Origin` or a cross-site `Sec-Fetch-Site` with `403 bad_origin`.
- Every server action and route handler is listed in the authorization matrix test with the expected
  answer for anonymous, driver and admin; the test fails when a new one is missing.
- Login: 5 failures per user name and 20 per IP address per 15 minutes (database backed); the client
  IP is the first entry of `x-forwarded-for`, which Vercel sets itself. Behind another proxy make sure
  it overwrites the header, otherwise only the per-user limit protects.

## 12. Monitoring (NUD-094)

### 12.1 Sentry (optional)

Without `SENTRY_DSN` the app does not load the Sentry SDK and sends nothing anywhere. With it, errors
of the server (pages, server actions, route handlers, via `src/instrumentation.ts`) and of the
browsers (uncaught errors, error pages) are sent to Sentry after `src/lib/sentry-scrub.ts` has
removed everything personal (what exactly: `docs/privacy.md` section 4). Errors only: no tracing,
session replay or profiling.

1. Create a Sentry account and an organisation. Choose the **EU data region** (the organisation's region is fixed at creation; the DSN host then ends in `de.sentry.io`).
2. Create a project, platform **Next.js**. Skip the setup wizard: the code is already in the repository (the wizard would try to change files). Copy the **DSN** from _Settings > Projects > (project) > Client Keys (DSN)_.
3. Vercel > **Settings > Environment Variables**: add `SENTRY_DSN` for Production and Preview (not Sensitive, it is public by design; a separate Sentry project for Preview keeps test noise out). **Redeploy**: the browser copy of the DSN is fixed at build time, and the CSP is built from it.
4. Readable stack traces (optional, recommended): in Sentry create an **Internal Integration** (_Settings > Developer Settings > Custom Integrations_) with permission _Release: Admin_ and _Organization: Read_, copy its token, and add `SENTRY_AUTH_TOKEN` (**Sensitive**, Production and Preview), `SENTRY_ORG` and `SENTRY_PROJECT` (the slugs) to Vercel. The build then uploads the source maps for the release (= the git commit) and removes them from the build output; they are never served. **Without the token (or if any of the four variables is missing) the build is exactly the one without Sentry and nothing is uploaded**; errors still arrive, with minified stack traces. The Vercel build log says nothing about Sentry when the upload is off; with it on, an upload error fails the build.
5. Test it: `runbook.md` section 7 ("Check that Sentry works"). In Sentry, create an alert rule _Issues > Alerts > Create alert_: "A new issue is created" -> send e-mail to the team.

What to know:

- **Content-Security-Policy:** the host of the DSN is added to `connect-src` automatically (section 11.1); nothing else is widened. A DSN change needs a redeploy. Reports of blocked sends would appear as `[csp-violation]` lines.
- **Service worker / offline:** the worker does not touch Sentry requests. A phone without network cannot send; those errors are lost (they are not queued) and the typical offline error ("Failed to fetch", "Load failed", aborted requests) is filtered out on purpose. The Sentry browser code is one more precached file (about 150 KB compressed) for the driver app, downloaded once per deployment.
- **Cost:** the free _Developer_ plan (5,000 errors a month) is enough to start. Errors that repeat endlessly are grouped into one issue, but each still counts; mute or fix a noisy issue instead of raising the quota.
- Local check without a Sentry account: `docs/runbook.md` section 7, "Check Sentry locally".

### 12.2 Uptime monitor

`GET https://<production-url>/api/health` answers 200 when database and storage work and 503 otherwise (section 9). Point an external monitor at it: e.g. UptimeRobot (free plan, 5-minute interval) or Better Stack, alert by e-mail/SMS after 2 failed checks. Optionally add the keyword `"status":"ok"` as the expected content. Vercel's own status page and Neon's/Cloudflare's status pages are linked in `runbook.md` section 9.

## 13. Backups (NUD-094)

Two layers:

| Layer                      | What                                                                   | Restore                                                   | Retention                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon point-in-time restore | continuous history of the database                                     | Neon console, minutes (`runbook.md` section 4)            | free plan about 6 hours; paid plans up to 7 days (Launch) or 30 days (Scale) - check the current numbers in the Neon console under _Backup & Restore_ |
| Weekly logical backup      | `pg_dump` of the whole database to R2 (`.github/workflows/backup.yml`) | `pg_restore` into a new database (`runbook.md` section 5) | 8 weeks; the newest 4 backups are never deleted                                                                                                       |

Photos and screenshots are objects in the photo bucket and are **not** part of either layer (R2 is replicated by Cloudflare, but a deleted or overwritten object is gone). Acceptable for v1: photos can be taken again; losing the database cannot be repaired that way.

### 13.1 One-time setup (human)

1. **Backup bucket** (Cloudflare R2): create bucket `nudel-backups` in the **EU jurisdiction**, keep it private (same as section 3 steps 2-3). No CORS rule (nothing in a browser touches it), no lifecycle rule (the script prunes; a bucket rule could delete everything if the schedule ever stalls).
2. **Token:** R2 > Manage API tokens > Create API token: name `nudel-backups`, permission **Object Read & Write**, specify bucket `nudel-backups` only. Copy Access Key ID and Secret Access Key (shown once). Never reuse the photo token.
3. **Read-only database role** (Neon console > project > **Roles**; or the SQL editor on branch `main`): create role `backup_reader` with a long password and run in the SQL editor:

   ```sql
   GRANT pg_read_all_data TO backup_reader;
   ```

   `pg_read_all_data` lets the role read every table and sequence and nothing more (PostgreSQL 14 and newer, Neon has it). Copy the **direct** (unpooled, no `-pooler`) connection string for this role and branch `main`, with `?sslmode=require`.

4. **GitHub environment:** repository > **Settings > Environments > New environment**, name **`backup`**. (Optional: restrict it to the `main` branch under _Deployment branches_.) Under _Environment secrets_ add:

   | Secret                                                    | Value                                              |
   | --------------------------------------------------------- | -------------------------------------------------- |
   | `BACKUP_DATABASE_URL`                                     | the `backup_reader` direct connection string       |
   | `BACKUP_S3_ENDPOINT`                                      | `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` |
   | `BACKUP_S3_BUCKET`                                        | `nudel-backups`                                    |
   | `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | the `nudel-backups` token                          |

   Optional variables can be set as secrets too: `BACKUP_PREFIX` (default `db/`), `BACKUP_RETENTION_WEEKS` (default 8) - only if you also add them to the `env:` block of the workflow.

5. **First run:** repository > **Actions > Database backup > Run workflow**. Both jobs (_backup_, then _verify_, the automatic test restore) must be green; the run summary shows file name, size and checksum. Check in R2 that `db/nudel-<date>.dump` exists.
6. If the Neon project is not on PostgreSQL 16, change `PG_MAJOR` at the top of `.github/workflows/backup.yml` to the project's major version (the script stops with a clear message when `pg_dump` is older than the server).

The schedule is Sundays 02:23 UTC. A failed run sends GitHub's standard e-mail to the people who watch the repository's Actions; check that your address receives them (GitHub > Settings > Notifications > Actions). Do not rely on it alone: look at the _Actions_ tab once a month (`runbook.md` section 5.4, the restore drill).

---

## 13. Self-hosting on the dedicated server (`https://nudel.stragas.com`, root path)

> **RETIRED (2026-11-04):** everything from §13.1 down describes the deployment that ran on the
> vServer **`87.106.60.131`** under the sub-path `/delivery-app/`. That host is gone. Production now
> runs on the dedicated server **`65.109.100.79`** at the **root** of <https://nudel.stragas.com>,
> with its own nginx vhost `/etc/nginx/sites-available/nudel-stragas` and no path prefix;
> PostgreSQL, MinIO, openrouteservice and Photon all live on that one host, TLS via
> `certbot --nginx`. `deploy/server-setup.sh` still builds the old sub-path layout and therefore
> **refuses to run against the new host** — a root-path variant has to be written before `deploy.bat`
> is usable again. Until then, deploy by hand:

### 13.0 Deploying to the current server (by hand)

The Turbopack build inlines pnpm store paths into the server chunks, so a `.next` built on another
machine fails with `Cannot find module '@prisma/client-<hash>'`. **Always build on the server.**

```bash
# 1. ship the source (tracked files only), from the repo root
tar -czf /tmp/nudel-src.tgz --exclude=node_modules --exclude=.next/cache --exclude=.git --exclude=.env .
scp /tmp/nudel-src.tgz root@65.109.100.79:/root/

# 2. on the server
systemctl stop delivery-app
tar -xzf /root/nudel-src.tgz -C /opt/delivery-app
cd /opt/delivery-app && set -a && . /etc/delivery-app.env && set +a
runuser -u deliveryapp -- env HOME=/var/lib/delivery-app pnpm install --frozen-lockfile
runuser -u deliveryapp -- env HOME=/var/lib/delivery-app DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy
runuser -u deliveryapp -- env HOME=/var/lib/delivery-app SKIP_TYPECHECK=1 NODE_OPTIONS=--max-old-space-size=8192 pnpm build
systemctl start delivery-app
curl -s http://127.0.0.1:3100/api/health        # {"status":"ok",...}
```

Never export `NEXT_PUBLIC_BASE_PATH` on this host: the app is served from the root. The service
reaches MinIO and ORS/Photon on `127.0.0.1` and resolves its own S3 endpoint through
`/etc/hosts` (`127.0.0.1 nudel.stragas.com`) — removing that line breaks photo uploads.

---

### 13.1 The retired vServer deployment (sub-path `/delivery-app/`)

This was the alternative to Vercel/Neon/R2 above: the app ran on the client's own vServer, behind the
existing nginx, under the path prefix `https://<server>/delivery-app/`. The full specification, the
server facts and the open decisions live in
[`docs/handoff-vserver-deploy-and-help.md`](./handoff-vserver-deploy-and-help.md); this section is the
short version.

| Piece | Where |
| --- | --- |
| One-command deploy (Windows) | `deploy.bat` ? `deploy/deploy.ps1` (`REMOTE_IP` / `REMOTE_USER` from `.env`, an SSH key is installed on first run) |
| Server side | `deploy/server-setup.sh` (idempotent; Node 22, pnpm, swap, PostgreSQL 16, MinIO in Docker, build, systemd, nginx include, health check) | |
| nginx | `deploy/delivery-app.nginx.conf` (kept in the repo for review; the script writes the same snippet) |
| systemd | `deploy/delivery-app.service`, port **3100**, `HOSTNAME=127.0.0.1` |
| Sub-path build | `NEXT_PUBLIC_BASE_PATH=/delivery-app` — read by `next.config.ts` and inlined at build time; it must also be in the service env so `next start` routes the prefix |

Layout on the server: `/opt/delivery-app` (built in place), `/opt/delivery-app.old` (rollback),
`/var/lib/delivery-app`, `/etc/delivery-app.env` (`chmod 600`, root:deliveryapp), the systemd unit
above and `/etc/nginx/snippets/delivery-app.conf`.

Things that are different from the Vercel path and must not be forgotten:

- **Object storage is mandatory** in production (`src/server/storage/index.ts` throws without `S3_*`).
  The reference setup runs MinIO in Docker on `127.0.0.1:9000` and publishes **only the photo bucket**
  through nginx (`location /nudel-photos/`), with `S3_ENDPOINT=https://<server>` (no path). Do not use a
  path-prefixed proxy such as `/delivery-app-s3/`: presigned URLs are signed over the exact request
  path, so a prefix-stripping proxy makes every upload fail with `SignatureDoesNotMatch`.
- **A trusted certificate is required for the PWA.** Service workers only run in a secure context; on
  this server the IP address has its own Let's Encrypt certificate (`/etc/letsencrypt-ip/`, renewed by
  `certbot-ip.timer`). `nginx -t` plus a browser check must confirm it after any nginx change.
- **`/quiz` and the other sites on that nginx must keep working**: the deploy backs up `/etc/nginx`,
  only *adds* an `include` to the existing server blocks and rolls back automatically when `nginx -t`
  fails.
- **Routing and geocoding live on the developer PC**, not on this server (NUD-156/157): the vServer reaches openrouteservice and Photon as `127.0.0.1:8082` / `127.0.0.1:2322` through a reverse SSH tunnel, configured by `ORS_BASE_URL` / `PHOTON_URL` in `/etc/delivery-app.env`. That is a stopgap while the box has 2 GB. `deploy.bat` prints whether both are reachable; details and the hand-over checklist: `deploy/local-services/README.md`, `docs/runbook.md` section 14, `AGENTS.md`.
- Backups are a local `pg_dump` (there is no Neon PITR here); the retention jobs stay in `dry-run`
  until the operator changes them.
- After the first deploy the office has to confirm the **depot pin** before any tour can be created.

**Build memory.** The vServer has 2 GB RAM. `deploy/server-setup.sh` therefore builds with `NODE_OPTIONS=--max-old-space-size=2560` and `SKIP_TYPECHECK=1` (Next's own type-check pass ran out of heap on 2026-10-27: "JavaScript heap out of memory ... Failed to type check"). `pnpm typecheck` stays the gate before every deploy; never set `SKIP_TYPECHECK` in CI or locally.

### 13.1 Scheduled jobs on the vServer (replaces the `vercel.json` crons)

Vercel calls the `/api/cron/*` routes by itself; on the vServer nothing does, so **without these
entries recurring orders (NUD-149), translation retries and the retention jobs never run.** Every
route needs the bearer `CRON_SECRET` (the value in `/etc/delivery-app.env`) and is idempotent.

1. Helper script `/usr/local/bin/delivery-app-cron` (`chmod 755`, owner root):

   ```sh
   #!/bin/sh
   # usage: delivery-app-cron <route>   e.g. recurring-orders
   set -eu
   . /etc/delivery-app.env
   exec curl -fsS --max-time 120 -H "Authorization: Bearer ${CRON_SECRET}" \
     "http://127.0.0.1:3100/delivery-app/api/cron/$1" >/dev/null
   ```

2. `/etc/cron.d/delivery-app` (same schedule as `vercel.json`, in UTC; the `deliveryapp` user must be
   allowed to read `/etc/delivery-app.env`):

   ```cron
   */10 * * * * deliveryapp /usr/local/bin/delivery-app-cron retry-translations
   27 2 * * *   deliveryapp /usr/local/bin/delivery-app-cron recurring-orders
   17 3 * * *   deliveryapp /usr/local/bin/delivery-app-cron retention
   37 3 * * *   deliveryapp /usr/local/bin/delivery-app-cron audit-retention
   47 3 * * *   deliveryapp /usr/local/bin/delivery-app-cron data-retention
   7 4 * * 0    deliveryapp /usr/local/bin/delivery-app-cron orphan-cleanup
   ```

3. Check once by hand: `sudo -u deliveryapp /usr/local/bin/delivery-app-cron recurring-orders; echo $?`
   must print `0` (non-zero means a wrong secret, port or base path). A systemd timer with
   `EnvironmentFile=/etc/delivery-app.env` does the same if cron is not installed.


### 13.2 One-off day import from a CSV (NUD-155)

For a day whose route only exists on paper: `scripts/import-day-orders.ts` turns a CSV
(`customerNumber;menge;Kiste;notizen`) into confirmed orders. It is one file, so `scp` is enough
(no rebuild), and it reads `DATABASE_URL` from `/etc/delivery-app.env`:

```bash
cd /opt/delivery-app && set -a && . /etc/delivery-app.env && set +a
pnpm tsx scripts/import-day-orders.ts tag.csv            # dry run, writes nothing
pnpm tsx scripts/import-day-orders.ts tag.csv --apply    # creates the orders
```

Format, options, safety rules and the office steps afterwards: [`docs/day-import.md`](./day-import.md).

### 13.4 Self-hosted ORS and Photon (routing and geocoding without a quota)

The hosted OpenRouteService key of 2026-10-27 answered `429` after ~80 lookups and `403` for the
rest of the day, so neither planning nor a customer import could rely on it. Both services now
run **on the development PC** and the vServer reaches them through a reverse SSH tunnel — the
2 GB box has no room for a JVM plus an Austria graph.

| Service | Where | The server sees |
| --- | --- | --- |
| openrouteservice v9.1.1 (Docker) | dev PC, `127.0.0.1:8082` | `ORS_BASE_URL=http://127.0.0.1:8082/ors` |
| Photon 1.3.0 Austria index (Docker) | dev PC, `127.0.0.1:2322` | `PHOTON_URL=http://127.0.0.1:2322` |

`deploy/local-services/` holds the start scripts, the ORS config and the tunnel; the README there
is the operator guide. The data lives **outside the repository** (default
`C:\Users\niko\Desktop\nudel-infra`, override `NUDEL_INFRA_DIR`).

**Requirements on the development PC.** ORS: ~4 GB RAM for the Austria car graph, ~2 GB of disk
for the graph plus 800 MB for the OSM extract (`austria-latest.osm.pbf` from Geofabrik). Photon:
the jar (94 MB) plus an Austria index (~1 GB) under `C:\ors-local`, ~1.5 GB RAM while serving. The
first ORS start builds the graph (here: ~14 min on 8 cores) and the first Photon start unpacks the
index; both are cached afterwards, so later starts take seconds.

**What the self-hosted ORS cannot do.** It serves `routing, matrix, isochrones, snapping, matching,
export, health, status` — and **no `/optimization`**: the VROOM proxy was dropped from the image
(checked against v9.1.1, v8.0.0 and v7.2.1), and VROOM itself is a separate service that needs an
OSRM graph. Self-hosted ORS therefore replaces the *hosted* directions and matrix, not the VROOM
optimizer; the tour order keeps coming from the app's own heuristic, while distances, driving
times and the route line now come from real roads.

**If the PC or the tunnel is down**, routing silently falls back to the heuristic (the tour shows
"Näherungswerte") and geocoding to the Fake. `GET /delivery-app/api/health` reports
`routing.mode` / `geocoding.mode` (`self-hosted`, `hosted`, `heuristic`, `fake`).
