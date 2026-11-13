/**
 * Pure validation of the environment of a hosted build: Vercel (production or preview) or Railway
 * (NUD-202, `pnpm build:railway`). Returns human-readable problems; never includes the values
 * themselves.
 */
import { isKnownUrlStyle } from "../../src/lib/s3-url-style";
import { parseSentryDsn } from "../../src/lib/sentry-config";

export type DeployEnvResult = { errors: string[]; warnings: string[] };

const PLACEHOLDER_SECRETS = ["replace-with-openssl-rand-base64-32-output", "change-me-local-only"];

export function checkDeployEnv(env: Record<string, string | undefined>): DeployEnvResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isVercelProduction = env.VERCEL_ENV === "production";
  // Railway names the environment; a project has "production" unless somebody renamed it.
  const isRailway = Boolean(env.RAILWAY_ENVIRONMENT_NAME?.trim());
  const isProduction = isVercelProduction || env.RAILWAY_ENVIRONMENT_NAME?.trim() === "production";

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    errors.push("DATABASE_URL is not set");
  } else {
    if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
      errors.push("DATABASE_URL must start with postgresql://");
    }
    if (/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
      errors.push("DATABASE_URL points to localhost");
    }
    // Neon's pooled host (PgBouncer) does not support the advisory locks `migrate deploy` takes.
    if (/-pooler\./.test(databaseUrl) && !env.DATABASE_URL_UNPOOLED) {
      errors.push(
        "DATABASE_URL is a pooled Neon URL: also set DATABASE_URL_UNPOOLED (direct connection) for migrations",
      );
    }
  }

  const authSecret = env.AUTH_SECRET;
  if (!authSecret) errors.push("AUTH_SECRET is not set");
  else if (authSecret.length < 32 || PLACEHOLDER_SECRETS.includes(authSecret)) {
    errors.push("AUTH_SECRET is too short or still the placeholder (use: openssl rand -base64 32)");
  }

  for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"]) {
    if (!env[name]) errors.push(`${name} is not set (uploads would fail at runtime)`);
  }
  const endpoint = env.S3_ENDPOINT;
  if (endpoint) {
    if (/localhost|127\.0\.0\.1/.test(endpoint)) errors.push("S3_ENDPOINT points to localhost");
    else if (
      // The EU-jurisdiction rule belongs to the Vercel + R2 setup; a Railway bucket has its region
      // chosen when it is created.
      isVercelProduction &&
      !/^https:\/\/[0-9a-f]+\.eu\.r2\.cloudflarestorage\.com\/?$/.test(endpoint)
    ) {
      warnings.push(
        "S3_ENDPOINT is not an EU-jurisdiction R2 endpoint (https://<account-id>.eu.r2.cloudflarestorage.com)",
      );
    }
  }

  if (!isKnownUrlStyle(env.S3_URL_STYLE)) errors.push("S3_URL_STYLE must be path or virtual");

  if (isProduction && env.SEED_ADMIN_PASSWORD) {
    warnings.push("SEED_ADMIN_PASSWORD is set in the production environment: remove it");
  }
  if (isRailway && !env.CRON_SECRET) {
    // Nothing calls the cron routes on Railway but the dispatcher service, which sends this secret.
    errors.push(
      "CRON_SECRET is not set: the cron service cannot call any job (recurring orders, retention, translation retries)",
    );
  } else if (isProduction && !env.CRON_SECRET) {
    warnings.push(
      "CRON_SECRET is not set: GET /api/cron/retry-translations rejects every request, failed translations are never retried",
    );
  }
  if (isProduction && !env.DEEPL_API_KEY) {
    warnings.push(
      "DEEPL_API_KEY is not set: notes and driver texts are not translated (Fake translator with visible prefixes)",
    );
  }

  // NUD-203: without a map service the app still works, but silently on made-up data. The same
  // variables and precedence as `geocoder/index.ts` and `routing/index.ts`.
  const has = (name: string) => Boolean(env[name]?.trim());
  if (isProduction && !has("GOOGLE_MAPS_SERVER_KEY")) {
    if (!has("PHOTON_URL") && !has("ORS_API_KEY")) {
      warnings.push(
        "GOOGLE_MAPS_SERVER_KEY is not set: the address search answers with made-up coordinates (Fake geocoder)",
      );
    }
    if (!has("ORS_BASE_URL") && !has("ORS_API_KEY")) {
      warnings.push(
        "GOOGLE_MAPS_SERVER_KEY is not set: tour distances and times are estimates, the route is drawn as straight lines",
      );
    }
  }

  // NUD-094: Sentry is optional; a half-configured one is worth a warning, never a failed build.
  const dsn = env.SENTRY_DSN?.trim();
  if (dsn && !parseSentryDsn(dsn)) {
    warnings.push(
      "SENTRY_DSN is set but is not a valid DSN (https://<key>@<host>/<project id>): errors are not reported",
    );
  }
  const sentryUpload = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"].filter((n) =>
    env[n]?.trim(),
  );
  if (sentryUpload.length > 0 && sentryUpload.length < 3) {
    warnings.push(
      "Source maps are uploaded to Sentry only when SENTRY_DSN, SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are all set",
    );
  }
  if (isProduction && env.ENABLE_ERROR_TEST_PAGES?.trim()) {
    errors.push(
      "ENABLE_ERROR_TEST_PAGES must not be set in production (test pages that raise errors)",
    );
  }
  return { errors, warnings };
}
