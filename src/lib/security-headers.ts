import { DEV_TILE_URL, isTileCacheEnabled } from "./map-config";
import { usesPathStyle } from "./s3-url-style";
import { sentryIngestSource } from "./sentry-config";

type Env = Record<string, string | undefined>;
export type HeaderEntry = { key: string; value: string };

/**
 * Host source (CSP syntax) of the map tile server from `MAP_TILE_URL`. A subdomain placeholder
 * (`https://{s}.tile.example.org/...`) becomes a wildcard (`https://*.tile.example.org`).
 * Returns null when the URL has no usable origin.
 */
export function tileSource(tileUrl: string | undefined): string | null {
  const match = /^(https?):\/\/([^/?#]+)/i.exec((tileUrl?.trim() || DEV_TILE_URL).trim());
  if (!match) return null;
  const scheme = match[1]!.toLowerCase();
  const labels = match[2]!.split(".");
  const placeholder = labels.findIndex((label) => label.includes("{"));
  if (placeholder === -1) return `${scheme}://${match[2]!.toLowerCase()}`;
  const rest = labels.slice(placeholder + 1);
  return rest.length > 0 ? `${scheme}://*.${rest.join(".").toLowerCase()}` : null;
}

/**
 * Origins the browser talks to for photos and screenshots: it uploads (PUT) to and shows images
 * (GET) from presigned URLs on the object store (MinIO / Cloudflare R2 `S3_ENDPOINT`, or AWS S3).
 * A virtual-hosted bucket (`S3_URL_STYLE=virtual`, a Railway bucket) lives on its own sub-domain of
 * the endpoint, so that host is the origin - the bare endpoint would block every upload.
 */
export function storageSources(env: Env): string[] {
  const endpoint = env.S3_ENDPOINT?.trim();
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (usesPathStyle(endpoint, env.S3_URL_STYLE)) return [url.origin];
      const bucket = env.S3_BUCKET?.trim();
      return bucket ? [`${url.protocol}//${bucket}.${url.host}`] : [];
    } catch {
      return [];
    }
  }
  const bucket = env.S3_BUCKET?.trim();
  const region = env.S3_REGION?.trim();
  if (bucket && region) {
    return [`https://${bucket}.s3.${region}.amazonaws.com`, `https://s3.${region}.amazonaws.com`];
  }
  return [];
}

/** Per-request inputs of the page policy (NUD-110). Both are absent for everything that is not a page. */
export type CspOptions = {
  dev?: boolean;
  /** Base64 nonce of this request; Next.js puts it on the scripts it streams for this response. */
  nonce?: string;
  /** CSP hash sources (`sha256-...`) of the inline scripts in the prerendered shells. */
  scriptHashes?: readonly string[];
};

const NONCE_PATTERN = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;
const HASH_PATTERN = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

/** `script-src` sources. Production never contains `'unsafe-inline'` (NUD-110). */
export function scriptSources(options: CspOptions & { dev: boolean }): string[] {
  // Development: Next.js HMR / React debugging need inline code and eval. A nonce would switch
  // `'unsafe-inline'` off, so development never uses one.
  if (options.dev) return ["'self'", "'unsafe-inline'", "'unsafe-eval'"];
  const sources = ["'self'"];
  if (options.nonce !== undefined) {
    if (!NONCE_PATTERN.test(options.nonce)) throw new Error("CSP nonce is not base64");
    sources.push(`'nonce-${options.nonce}'`);
  }
  for (const hash of options.scriptHashes ?? []) {
    if (!HASH_PATTERN.test(hash)) throw new Error(`CSP script hash is malformed: ${hash}`);
    sources.push(`'${hash}'`);
  }
  return sources;
}

/**
 * Content-Security-Policy (NUD-093, script part reworked in NUD-110).
 *
 * `script-src` has no `'unsafe-inline'` in production. HTML pages (served through `src/proxy.ts`)
 * get a fresh per-request nonce, which Next.js copies onto every inline script it streams while
 * rendering (hydration data, Suspense completions, the part of a partially prerendered page that is
 * rendered per request), plus the SHA-256 hashes of the few inline scripts inside the prebuilt
 * shells (those cannot carry a nonce; see `scripts/csp-script-hashes.ts` and docs/deploy.md
 * section 11). Everything that is not a page gets `script-src 'self'`.
 * `style-src` keeps `'unsafe-inline'` because Leaflet positions its panes and markers with inline
 * styles. Development additionally needs `'unsafe-eval'`, inline scripts and websockets for HMR.
 */
export function buildCsp(env: Env, options: CspOptions = {}): string {
  const dev = options.dev ?? env.NODE_ENV !== "production";
  const storage = storageSources(env);
  const tiles = tileSource(env.MAP_TILE_URL);
  // NUD-094: the browser SDK posts error events straight to the DSN's ingest host. Nothing is
  // allowed without a (valid) SENTRY_DSN.
  const sentry = sentryIngestSource(env.SENTRY_DSN);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSources({ ...options, dev })],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...storage, ...(tiles ? [tiles] : [])]],
    ["font-src", ["'self'", "data:"]],
    [
      "connect-src",
      [
        "'self'",
        ...storage,
        ...(sentry ? [sentry] : []),
        // NUD-108: with MAP_TILE_CACHE the service worker fetches the tiles itself; that fetch is
        // checked against connect-src (not img-src).
        ...(tiles && isTileCacheEnabled(env) ? [tiles] : []),
        ...(dev ? ["ws:", "wss:"] : []),
      ],
    ],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    // Violations end up in the server log (one line each); essential for a report-only rollout.
    // The URI is base-path aware: on the vServer the app is served under /delivery-app, and a
    // relative "/api/csp-report" would be posted to the nginx root and answered with 404 — which
    // is exactly what happened until 2026-10-28 (NUD-120).
    ["report-uri", [`${basePathOf(env)}/api/csp-report`]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** `NEXT_PUBLIC_BASE_PATH` as `/delivery-app`, or `""` when the app is served at the root. */
export function basePathOf(env: Env): string {
  const raw = env.NEXT_PUBLIC_BASE_PATH?.trim();
  if (!raw) return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "");
}

/** `CSP_REPORT_ONLY=true` sends the policy as report-only: nothing is blocked, violations are logged. */
export function isCspReportOnly(env: Env): boolean {
  return env.CSP_REPORT_ONLY?.trim().toLowerCase() === "true";
}

export function cspHeader(env: Env, options: CspOptions = {}): HeaderEntry {
  return {
    key: isCspReportOnly(env) ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
    value: buildCsp(env, options),
  };
}

/** Security headers other than the CSP; the same for every response. */
export function commonSecurityHeaders(): HeaderEntry[] {
  return [
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    // Origin only to other sites: the tile provider sees our host (allowed-origins check of the
    // API key) but never a path with ids.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Driver photos use <input capture>, which needs no permission; camera stays allowed for our
    // own origin only (no embedded frames exist). Geolocation is allowed for our own origin only
    // for the one-off "Parkplatz festlegen" position fix (NUD-144); there is no tracking (D19),
    // no microphone, no payment.
    {
      key: "Permissions-Policy",
      value:
        "camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
}

/**
 * All security headers with the static policy (no nonce, no hashes): what API routes, static files
 * and the worker get. HTML pages get their policy from `src/proxy.ts`. `CSP_REPORT_ONLY=true` is the
 * switch for rolling out a changed policy.
 */
export function securityHeaders(env: Env = process.env): HeaderEntry[] {
  return [cspHeader(env), ...commonSecurityHeaders()];
}
