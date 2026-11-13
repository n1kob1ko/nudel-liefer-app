// The specs read DATABASE_URL / SEED_ADMIN_PASSWORD straight from the environment (Vitest loads
// dotenv in vitest.config.ts, Playwright does not), so without this `pnpm test:e2e` fails on a
// machine that only has a `.env` file. dotenv never overwrites variables that are already set, so
// the CI workflow's env block still wins.
import "dotenv/config";

import { existsSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { E2E_DATABASE_VAR, resolveE2eDatabase } from "./scripts/lib/e2e-database";

/**
 * NUD-162: several specs own "today" of the database they read (`late-orders`, `mvp-happy-path`)
 * or a whole day (`tour-split`), so they cannot run against a database that already has tours for
 * it. `E2E_DATABASE_URL` points the whole run at a database of its own: it REPLACES `DATABASE_URL`
 * for this process (the specs open their own connections) and is passed to the webServer command,
 * so app and assertions read the same rows. The database is prepared by `pnpm e2e:db:reset`
 * (docs/e2e-database.md). Without the variable nothing changes: the run uses `DATABASE_URL`.
 *
 * A run that reuses a server already listening on the port (`reuseExistingServer`, unchanged)
 * tests that server's own database — stop a `pnpm dev` on the port, or set `CI=1`.
 */
const e2eDatabaseUrl = process.env[E2E_DATABASE_VAR]?.trim();
if (e2eDatabaseUrl) {
  // Idempotent: setting DATABASE_URL below makes the guard trip on the second evaluation of this
  // file in the same process (Playwright re-reads the config per retry / worker), which failed every
  // retry of a run against a dedicated database. The marker short-circuits that re-check.
  if (process.env.NUDEL_E2E_DATABASE_RESOLVED !== "1") {
    const resolution = resolveE2eDatabase(process.env);
    if (!resolution.ok) {
      throw new Error(`E2E_DATABASE_URL is set but unusable:\n- ${resolution.errors.join("\n- ")}`);
    }
    process.env.DATABASE_URL = resolution.url;
    // `prisma.config.ts` and the tooling prefer the unpooled URL; an empty value keeps a leftover
    // Neon/production URL in .env out of this run.
    process.env.DATABASE_URL_UNPOOLED = "";
    process.env.NUDEL_E2E_DATABASE_RESOLVED = "1";
  }
} else {
  console.warn(
    `[e2e] ${E2E_DATABASE_VAR} is not set: this run uses DATABASE_URL, and the specs that own ` +
      `"today" (late-orders, mvp-happy-path) need it to be free of tours. See docs/e2e-database.md.`,
  );
}

const port = Number(process.env.PORT ?? 3000);

/**
 * NUD-161: without `E2E_PREBUILT` the CI webServer command builds the app inside the start window.
 * `pnpm build` is two `next build` passes plus the PWA and CSP-hash steps — measured on 2026-10-28
 * at about 3 min on the dev machine, so the former 180 s left no margin and the first run timed out.
 * The timeout is only a ceiling: the run stops as soon as the command exits non-zero, so a broken
 * build is still reported immediately.
 */
const DEV_WEB_SERVER_TIMEOUT_MS = 180_000;
const CI_WEB_SERVER_TIMEOUT_MS = 600_000;

/**
 * NUD-161: `CI=1 E2E_PREBUILT=1` reuses the production build that is already in `.next` instead of
 * building a second time inside the webServer command. That is for a machine that starts the suite
 * more than once (build once, then run several specs / several `pnpm test:e2e` calls).
 *
 * It only skips the build; `reuseExistingServer` stays `!CI`, so a server that already listens on
 * the port is still never reused — the run fails loudly instead of testing a foreign app.
 */
const prebuilt = Boolean(process.env.CI) && process.env.E2E_PREBUILT === "1";

if (prebuilt && !existsSync(join(process.cwd(), ".next", "BUILD_ID"))) {
  throw new Error(
    "E2E_PREBUILT=1 is set but .next/BUILD_ID is missing. Run `pnpm build` first, " +
      "or drop E2E_PREBUILT to let the webServer command build the app itself.",
  );
}

const webServerCommand = !process.env.CI
  ? `pnpm dev -p ${port}`
  : prebuilt
    ? `pnpm start -p ${port}`
    : `pnpm build && pnpm start -p ${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  /**
   * One worker: the specs share one database, and several of them own something that exists only
   * once in it: the settings row (depot confirmation, departure checklist), "today" of the
   * dashboard and of the driver app, the vehicles of the planning dialog. Side by side they changed
   * each other's preconditions, so a full run failed in different places every time (first full CI
   * run, 2026-11-13). `--workers=N` on the command line still wins for specs known to be
   * independent.
   */
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    /**
     * NUD-153: the tablet layout audit. Two orientations as committed projects, so the audit is part
     * of the suite instead of a throwaway script. `tests/e2e/tablet-layout.spec.ts` walks the other
     * device sizes (iPad Air 820x1180, Android 800x1280) with `page.setViewportSize` inside the same
     * projects — adding four more projects would multiply the run without covering a new layout.
     *
     * `testMatch` keeps the tablet projects to the audit: without it every other spec would run a
     * third and fourth time in `pnpm test:e2e`. Chromium with `hasTouch` (not the `iPad …` device
     * presets, which are WebKit) so one browser is enough; `isMobile` stays off because Chromium's
     * mobile emulation changes the visual viewport, and the audit measures CSS pixels.
     */
    {
      name: "tablet-portrait",
      testMatch: /tablet-layout\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
        hasTouch: true,
      },
    },
    {
      name: "tablet-landscape",
      testMatch: /tablet-layout\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 2,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? CI_WEB_SERVER_TIMEOUT_MS : DEV_WEB_SERVER_TIMEOUT_MS,
    env: {
      // Every spec runs from the same address and several log in wrongly on purpose (the
      // rate-limit tests). Without this the shared per-IP counter (20 failures / 15 min) fills up
      // and every later login in the run is rejected as rate limited. The per-identifier limit the
      // rate-limit tests actually assert is unchanged. Ignored when a server is reused.
      LOGIN_MAX_FAILURES_PER_IP: "1000000",
      // The hidden error pages and the settings-cache hook the specs use after writing the settings
      // row themselves (tests/e2e/helpers/settings.ts). Ignored when a server is reused.
      ENABLE_ERROR_TEST_PAGES: "true",
      // NUD-162: the server of this run reads the same database the specs assert on (ignored when
      // a server is reused: that one keeps the environment it was started with).
      ...(e2eDatabaseUrl ? { DATABASE_URL: e2eDatabaseUrl } : {}),
    },
  },
});
