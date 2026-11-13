import { readFileSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { commonSecurityHeaders, cspHeader } from "./src/lib/security-headers";
import { isSentryEnabled, sentryEnvironment, sentryRelease } from "./src/lib/sentry-config";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const sentryDsn = isSentryEnabled(process.env.SENTRY_DSN) ? process.env.SENTRY_DSN!.trim() : "";

/**
 * NUD-110: `scripts/csp-script-hashes.ts write` stores the hashes of the inline scripts in the
 * prerendered shells (and the build ID of the first pass) between the two `next build` passes of
 * `pnpm build`. The hashes are inlined into the proxy bundle (`process.env.CSP_SCRIPT_HASHES`);
 * both are absent on the first pass and in development.
 */
function readCspBuildFile(): { buildId?: string; hashes: string } {
  try {
    const file = JSON.parse(
      readFileSync(path.join(process.cwd(), ".csp-script-hashes.json"), "utf8"),
    ) as { buildId?: unknown; common?: unknown; locales?: unknown };
    return {
      buildId: typeof file.buildId === "string" ? file.buildId : undefined,
      hashes: JSON.stringify({ common: file.common, locales: file.locales }),
    };
  } catch {
    return { hashes: "" };
  }
}
const cspBuildFile = readCspBuildFile();

/**
 * NUD-123: Next blocks requests to dev-only assets and endpoints from origins other than the one the
 * dev server was started with (`localhost`), so a visit via `http://127.0.0.1:3100` renders a page
 * whose client runtime never starts - every button does nothing and the HMR socket is rejected
 * (`ERR_INVALID_HTTP_RESPONSE`). Loopback is always allowed; a phone or a tunnel on the LAN adds its
 * hostname through `DEV_ALLOWED_ORIGINS` (comma separated, hostnames only, no scheme and no port).
 * Development only: the option has no effect on a build.
 */
const allowedDevOrigins = ["127.0.0.1"]
  .concat(
    (process.env.DEV_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  )
  .filter((hostname, index, all) => all.indexOf(hostname) === index);

/**
 * Self-hosting under a sub-path (`/delivery-app/`): empty (and therefore without any effect) unless
 * `NEXT_PUBLIC_BASE_PATH` is set, so development and the Vercel deployment keep serving the origin
 * root. It is a build-time value (Next inlines it into the client bundles) and must be the same for
 * `pnpm build` and `pnpm start`. `src/lib/base-path.ts` normalises it exactly like this (no trailing
 * slash); `scripts/build-pwa.ts` inlines it into the service worker.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  poweredByHeader: false,
  allowedDevOrigins,
  // The vServer build (deploy/server-setup.sh, 2 GB RAM) runs out of memory in Next's type-check pass.
  // `pnpm typecheck` (tsc, incl. tests) is the gate before every deploy, so the server build skips it
  // when SKIP_TYPECHECK=1. Never set this in CI or on a dev machine.
  typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1" },
  // The build ID is part of the flight data inlined in static pages, whose script hashes the second
  // pass bakes into the proxy: both passes must use the same ID (a fresh random one per `pnpm
  // build`, because `reset` removes the file first).
  generateBuildId: async () => cspBuildFile.buildId ?? null,
  cacheComponents: true,
  partialPrefetching: true,
  // NUD-094: the Sentry SDK patches Node internals at run time and must be loaded from
  // node_modules, not bundled (bundling breaks its own hooks and prints a warning at start).
  serverExternalPackages: ["@sentry/nextjs"],
  // NUD-198: the bill PDF reads its fonts from `assets/fonts` at run time. The server at
  // /opt/delivery-app has the whole project folder; a traced deployment (Vercel, a standalone
  // build) only gets the folder through this line.
  outputFileTracingIncludes: { "/api/admin/payments/export": ["./assets/fonts/*"] },
  // NUD-094: the browser needs the DSN (public by design: it only allows sending events). It is
  // inlined at build time; an empty value removes the Sentry code from the client bundle.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: sentryDsn,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentryDsn ? sentryEnvironment(process.env) : "",
    NEXT_PUBLIC_SENTRY_RELEASE: sentryDsn ? (sentryRelease(process.env) ?? "") : "",
    CSP_SCRIPT_HASHES: cspBuildFile.hashes,
    // Same value as `basePath` above, so server and client code read one build-time constant
    // (src/lib/base-path.ts) instead of the raw environment.
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  async headers() {
    // Custom-route sources are prefixed with `basePath` by Next itself while the routes manifest is
    // built - verified in the built `.next/routes-manifest.json`, where `/:path*` became
    // `/delivery-app/:path*`. The sources below therefore stay UNPREFIXED: adding the prefix here
    // doubles it (`/delivery-app/delivery-app/...`) and the rule never fires under a sub-path. The
    // middleware matcher (src/proxy.ts) is prefixed the same way, which keeps the CSP source and the
    // matcher the exact complement of each other with and without a base path.
    return [
      {
        // NUD-093: HSTS, framing, referrer and permissions policy for every response.
        source: "/:path*",
        headers: commonSecurityHeaders(),
      },
      {
        // NUD-093 / NUD-110: the CSP of everything the proxy does not see (its matcher skips API
        // routes, Next.js internals and files with an extension): no nonce, no hashes, so
        // `script-src 'self'`. Pages get their CSP, with a per-request nonce, from src/proxy.ts. The
        // policy is built from MAP_TILE_URL / S3_* / SENTRY_DSN when the server starts or builds
        // (see docs/deploy.md). Keep the pattern the exact complement of the proxy matcher.
        source: "/:path((?:api|_next|_vercel).*|.*\\..*)",
        headers: [cspHeader(process.env)],
      },
      {
        // The service worker script must never be served from the HTTP cache, or an update
        // (a new precache list after a deploy) would not reach installed apps (NUD-080).
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/:file(offline\\.html|offline\\.js)",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        // NUD-127: the help page is generated after `next build` and is not content-hashed, so a
        // deploy has to reach the browser (same reasoning as offline.html / offline.js).
        source: "/:file(hand-off\\.html|hand-off\\.css|hand-off\\.js|hand-off-data\\.js)",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const config = withNextIntl(nextConfig);

/**
 * NUD-094: the Sentry build plugin (source map upload) is applied ONLY when everything it needs is
 * present: a DSN, the auth token, organisation and project. Without them the app is built exactly
 * as before; error reporting still works at run time (without readable stack traces).
 */
const uploadSourceMaps = Boolean(
  sentryDsn &&
  process.env.SENTRY_AUTH_TOKEN?.trim() &&
  process.env.SENTRY_ORG?.trim() &&
  process.env.SENTRY_PROJECT?.trim(),
);

async function resolveConfig() {
  if (!uploadSourceMaps) return config;
  const { withSentryConfig } = await import("@sentry/nextjs/config");
  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG!.trim(),
    project: process.env.SENTRY_PROJECT!.trim(),
    authToken: process.env.SENTRY_AUTH_TOKEN!.trim(),
    // Quiet build output unless the upload fails; no usage telemetry to Sentry about the build.
    silent: true,
    telemetry: false,
    release: { name: sentryRelease(process.env) },
    // Maps are uploaded and then removed from the build output: they must not be served.
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    widenClientFileUpload: false,
    suppressOnRouterTransitionStartWarning: true,
    // No /monitoring tunnel: events go to Sentry directly (allowed in the CSP, docs/deploy.md).
    tunnelRoute: false,
  });
}

export default resolveConfig;
