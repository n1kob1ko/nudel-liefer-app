import { describe, expect, it } from "vitest";

import { checkDeployEnv } from "./deploy-env";

const good = {
  VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/nudel?sslmode=require",
  DATABASE_URL_UNPOOLED: "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/nudel?sslmode=require",
  AUTH_SECRET: "a".repeat(44),
  S3_ENDPOINT: "https://0123456789abcdef.eu.r2.cloudflarestorage.com",
  S3_BUCKET: "nudel-photos",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
  CRON_SECRET: "c".repeat(44),
  DEEPL_API_KEY: "deepl-key:fx",
  GOOGLE_MAPS_SERVER_KEY: "AIza-test-key",
};

describe("checkDeployEnv", () => {
  it("accepts a complete production environment", () => {
    expect(checkDeployEnv(good)).toEqual({ errors: [], warnings: [] });
  });

  it("reports every missing variable without echoing values", () => {
    const { errors } = checkDeployEnv({ VERCEL_ENV: "production" });
    expect(errors.join("\n")).toMatch(/DATABASE_URL/);
    expect(errors.join("\n")).toMatch(/AUTH_SECRET/);
    expect(errors.join("\n")).toMatch(/S3_BUCKET/);
  });

  it("rejects localhost URLs and the placeholder secret", () => {
    const { errors } = checkDeployEnv({
      ...good,
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/nudel",
      AUTH_SECRET: "replace-with-openssl-rand-base64-32-output",
      S3_ENDPOINT: "http://localhost:9000",
    });
    expect(errors).toHaveLength(3);
    expect(JSON.stringify(errors)).not.toContain("postgres:postgres");
  });

  it("requires the unpooled URL when DATABASE_URL is a Neon pooler URL", () => {
    const { errors } = checkDeployEnv({ ...good, DATABASE_URL_UNPOOLED: undefined });
    expect(errors).toHaveLength(1);
  });

  it("warns about a non-EU R2 endpoint and a leftover seed password in production only", () => {
    const prod = checkDeployEnv({
      ...good,
      S3_ENDPOINT: "https://0123456789abcdef.r2.cloudflarestorage.com",
      SEED_ADMIN_PASSWORD: "x",
    });
    expect(prod.errors).toEqual([]);
    expect(prod.warnings).toHaveLength(2);
    const preview = checkDeployEnv({
      ...good,
      VERCEL_ENV: "preview",
      S3_ENDPOINT: "https://0123456789abcdef.r2.cloudflarestorage.com",
    });
    expect(preview.warnings).toEqual([]);
  });

  it("warns (production only) when the translation secrets are missing", () => {
    const prod = checkDeployEnv({ ...good, CRON_SECRET: undefined, DEEPL_API_KEY: undefined });
    expect(prod.errors).toEqual([]);
    expect(prod.warnings.join("\n")).toMatch(/CRON_SECRET/);
    expect(prod.warnings.join("\n")).toMatch(/DEEPL_API_KEY/);
    const preview = checkDeployEnv({
      ...good,
      VERCEL_ENV: "preview",
      CRON_SECRET: undefined,
      DEEPL_API_KEY: undefined,
    });
    expect(preview.warnings).toEqual([]);
  });

  it("warns (production only) when no map service answers: made-up pins, estimated tours (NUD-203)", () => {
    const without = { ...good, GOOGLE_MAPS_SERVER_KEY: undefined };
    const { errors, warnings } = checkDeployEnv(without);
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toMatch(/GOOGLE_MAPS_SERVER_KEY.*address/i);
    expect(warnings.join("\n")).toMatch(/GOOGLE_MAPS_SERVER_KEY.*tour/i);
    expect(checkDeployEnv({ ...without, GOOGLE_MAPS_SERVER_KEY: "  " }).warnings).toHaveLength(2);

    // The older providers still count.
    expect(
      checkDeployEnv({ ...without, PHOTON_URL: "http://photon:2322", ORS_BASE_URL: "http://ors" })
        .warnings,
    ).toEqual([]);
    expect(checkDeployEnv({ ...without, ORS_API_KEY: "k" }).warnings).toEqual([]);
    // A preview build needs none.
    expect(checkDeployEnv({ ...without, VERCEL_ENV: "preview" }).warnings).toEqual([]);
    // The value is never echoed.
    expect(JSON.stringify(checkDeployEnv(good))).not.toContain("AIza");
  });

  it("checks the optional Sentry settings (NUD-094)", () => {
    const ok = checkDeployEnv({ ...good, SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/12" });
    expect(ok).toEqual({ errors: [], warnings: [] });
    const bad = checkDeployEnv({ ...good, SENTRY_DSN: "not-a-dsn" });
    expect(bad.errors).toEqual([]);
    expect(bad.warnings.join("\n")).toMatch(/SENTRY_DSN/);
    expect(bad.warnings.join("\n")).not.toContain("not-a-dsn");
    const partial = checkDeployEnv({
      ...good,
      SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/12",
      SENTRY_AUTH_TOKEN: "tok",
    });
    expect(partial.warnings.join("\n")).toMatch(/Source maps/);
    expect(partial.warnings.join("\n")).not.toContain("tok");
  });

  it("refuses the error test pages in production only", () => {
    expect(checkDeployEnv({ ...good, ENABLE_ERROR_TEST_PAGES: "true" }).errors.join()).toMatch(
      /ENABLE_ERROR_TEST_PAGES/,
    );
    expect(
      checkDeployEnv({ ...good, VERCEL_ENV: "preview", ENABLE_ERROR_TEST_PAGES: "true" }).errors,
    ).toEqual([]);
  });
  describe("on Railway (NUD-202)", () => {
    const railway = {
      RAILWAY_ENVIRONMENT_NAME: "production",
      DATABASE_URL: "postgresql://postgres:pw@postgres.railway.internal:5432/railway",
      AUTH_SECRET: "a".repeat(44),
      S3_ENDPOINT: "https://t3.storageapi.dev",
      S3_BUCKET: "photos-abc",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_URL_STYLE: "virtual",
      CRON_SECRET: "c".repeat(44),
      DEEPL_API_KEY: "deepl-key:fx",
      GOOGLE_MAPS_SERVER_KEY: "AIza-test-key",
    };

    it("accepts a complete environment without asking for an R2 endpoint", () => {
      expect(checkDeployEnv(railway)).toEqual({ errors: [], warnings: [] });
    });

    it("treats a missing CRON_SECRET as an error: the dispatcher cannot call any job", () => {
      const { errors } = checkDeployEnv({ ...railway, CRON_SECRET: undefined });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/CRON_SECRET/);
    });

    it("still warns about production leftovers", () => {
      const { errors, warnings } = checkDeployEnv({ ...railway, SEED_ADMIN_PASSWORD: "x" });
      expect(errors).toEqual([]);
      expect(warnings.join("\n")).toMatch(/SEED_ADMIN_PASSWORD/);
    });
  });

  it("refuses an unknown S3_URL_STYLE instead of signing path-style URLs silently", () => {
    const { errors } = checkDeployEnv({ ...good, S3_URL_STYLE: "vhost" });
    expect(errors).toEqual(["S3_URL_STYLE must be path or virtual"]);
    expect(checkDeployEnv({ ...good, S3_URL_STYLE: " Virtual " }).errors).toEqual([]);
  });
});
