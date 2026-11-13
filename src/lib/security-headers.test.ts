import { describe, expect, it } from "vitest";

import {
  basePathOf,
  buildCsp,
  commonSecurityHeaders,
  cspHeader,
  scriptSources,
  securityHeaders,
  storageSources,
  tileSource,
} from "./security-headers";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ") ?? [];

describe("tileSource", () => {
  it("uses the OSM default when MAP_TILE_URL is unset", () => {
    expect(tileSource(undefined)).toBe("https://tile.openstreetmap.org");
    expect(tileSource("  ")).toBe("https://tile.openstreetmap.org");
  });
  it("takes the origin of a configured provider, keeping query keys out", () => {
    expect(tileSource("https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=SECRET")).toBe(
      "https://api.maptiler.com",
    );
    expect(tileSource("http://localhost:4010/tiles/{z}/{x}/{y}.png")).toBe("http://localhost:4010");
  });
  it("turns a subdomain placeholder into a wildcard", () => {
    expect(tileSource("https://{s}.tile.example.org/{z}/{x}/{y}.png")).toBe(
      "https://*.tile.example.org",
    );
    expect(tileSource("https://tiles-{s}.example.org/{z}/{x}/{y}.png")).toBe(
      "https://*.example.org",
    );
  });
  it("returns null for something that is not an http(s) URL", () => {
    expect(tileSource("javascript:alert(1)")).toBeNull();
    expect(tileSource("//cdn.example/{z}.png")).toBeNull();
  });
});

describe("storageSources", () => {
  it("uses the endpoint origin (MinIO / R2, path style)", () => {
    expect(
      storageSources({ S3_ENDPOINT: "https://abc.eu.r2.cloudflarestorage.com/some/path" }),
    ).toEqual(["https://abc.eu.r2.cloudflarestorage.com"]);
    expect(storageSources({ S3_ENDPOINT: "http://localhost:9000" })).toEqual([
      "http://localhost:9000",
    ]);
  });
  it("uses the bucket sub-domain of the endpoint for a virtual-hosted bucket (Railway)", () => {
    expect(
      storageSources({
        S3_ENDPOINT: "https://t3.storageapi.dev",
        S3_BUCKET: "photos-abc",
        S3_URL_STYLE: "virtual",
      }),
    ).toEqual(["https://photos-abc.t3.storageapi.dev"]);
    // Without a bucket name there is no host to allow: nothing rather than the bare endpoint.
    expect(
      storageSources({ S3_ENDPOINT: "https://t3.storageapi.dev", S3_URL_STYLE: "virtual" }),
    ).toEqual([]);
  });
  it("derives AWS S3 hosts without an endpoint", () => {
    expect(storageSources({ S3_BUCKET: "b", S3_REGION: "eu-central-1" })).toEqual([
      "https://b.s3.eu-central-1.amazonaws.com",
      "https://s3.eu-central-1.amazonaws.com",
    ]);
  });
  it("is empty when nothing is configured or the endpoint is garbage", () => {
    expect(storageSources({})).toEqual([]);
    expect(storageSources({ S3_ENDPOINT: "not a url" })).toEqual([]);
  });
});

describe("buildCsp", () => {
  const prod = {
    NODE_ENV: "production",
    S3_ENDPOINT: "https://abc.eu.r2.cloudflarestorage.com",
    MAP_TILE_URL: "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=K",
  };

  it("locks down framing, plugins, base URI and forms", () => {
    const csp = buildCsp(prod);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "frame-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
  });

  it("posts violations to the report endpoint under the configured base path (NUD-120)", () => {
    expect(directive(buildCsp(prod), "report-uri")).toEqual(["/api/csp-report"]);
    const sub = { ...prod, NEXT_PUBLIC_BASE_PATH: "/delivery-app" };
    expect(directive(buildCsp(sub), "report-uri")).toEqual(["/delivery-app/api/csp-report"]);
    // Tolerated shapes of the same value: no leading slash, trailing slashes, surrounding blanks.
    for (const value of ["delivery-app", "/delivery-app/", "  /delivery-app//  "]) {
      expect(basePathOf({ NEXT_PUBLIC_BASE_PATH: value })).toBe("/delivery-app");
    }
    expect(basePathOf({})).toBe("");
  });

  it("allows the tile and storage origins from the environment, nothing else external", () => {
    const csp = buildCsp(prod);
    expect(directive(csp, "img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://abc.eu.r2.cloudflarestorage.com",
      "https://api.maptiler.com",
    ]);
    expect(directive(csp, "connect-src")).toEqual([
      "'self'",
      "https://abc.eu.r2.cloudflarestorage.com",
    ]);
    expect(csp).not.toContain("SECRET");
    expect(csp).not.toContain("key=");
    expect(csp).not.toMatch(/\*(?!\.)/);
  });

  it("allows the Sentry ingest host in connect-src only when SENTRY_DSN is a valid DSN (NUD-094)", () => {
    const withDsn = buildCsp({
      ...prod,
      SENTRY_DSN: "https://publickey@o123.ingest.de.sentry.io/456",
    });
    expect(directive(withDsn, "connect-src")).toEqual([
      "'self'",
      "https://abc.eu.r2.cloudflarestorage.com",
      "https://o123.ingest.de.sentry.io",
    ]);
    // The key and the project id never end up in the header; nothing else is widened.
    expect(withDsn).not.toContain("publickey");
    expect(directive(withDsn, "script-src")).toEqual(["'self'"]);
    expect(directive(withDsn, "img-src")).toEqual(directive(buildCsp(prod), "img-src"));
    for (const bad of [
      "",
      "   ",
      "not a dsn",
      "ftp://k@host/1",
      "https://host/1",
      "https://k@host/x",
    ]) {
      expect(directive(buildCsp({ ...prod, SENTRY_DSN: bad }), "connect-src"), bad).toEqual(
        directive(buildCsp(prod), "connect-src"),
      );
    }
  });

  it("allows eval and websockets only in development", () => {
    expect(directive(buildCsp(prod), "script-src")).toEqual(["'self'"]);
    expect(directive(buildCsp(prod), "connect-src")).not.toContain("ws:");
    const dev = buildCsp({ NODE_ENV: "development" });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
  });
});

describe("securityHeaders", () => {
  const find = (headers: ReturnType<typeof securityHeaders>, key: string) =>
    headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

  it("sends the full set", () => {
    const headers = securityHeaders({ NODE_ENV: "production" });
    expect(find(headers, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(find(headers, "Strict-Transport-Security")).toMatch(/^max-age=\d{8,}/);
    expect(find(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(find(headers, "X-Frame-Options")).toBe("DENY");
    expect(find(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const permissions = find(headers, "Permissions-Policy")!;
    expect(permissions).toContain("camera=(self)");
    expect(permissions).toContain("geolocation=(self)");
    expect(permissions).toContain("microphone=()");
  });

  it("switches to report-only on request", () => {
    const headers = securityHeaders({ NODE_ENV: "production", CSP_REPORT_ONLY: "true" });
    expect(find(headers, "Content-Security-Policy")).toBeUndefined();
    expect(find(headers, "Content-Security-Policy-Report-Only")).toContain("default-src 'self'");
  });
});

describe("connect-src and the opt-in tile cache (NUD-108)", () => {
  const env = { NODE_ENV: "production", MAP_TILE_URL: "https://t.example/{z}/{x}/{y}.png" };
  it("does not allow the tile host to connect by default (images only)", () => {
    expect(directive(buildCsp(env), "connect-src")).not.toContain("https://t.example");
    expect(directive(buildCsp(env), "img-src")).toContain("https://t.example");
  });
  it("allows it for the service worker only with MAP_TILE_CACHE=1", () => {
    expect(directive(buildCsp({ ...env, MAP_TILE_CACHE: "1" }), "connect-src")).toContain(
      "https://t.example",
    );
  });
});

// NUD-110
describe("script-src without 'unsafe-inline'", () => {
  const prod = { NODE_ENV: "production" };
  const nonce = "dC4aLV1QWj0Hc+zHA98/zA==";
  const hash = "sha256-0GFkk+3XvOIs1EPnW+Xu+mcSrXckV7bNnbgaA4G3Rf4=";

  it("is 'self' only for everything that is not a page (API, files, worker)", () => {
    expect(directive(buildCsp(prod), "script-src")).toEqual(["'self'"]);
    expect(
      directive(buildCsp({ ...prod, SENTRY_DSN: "https://k@o1.ingest.sentry.io/2" }), "script-src"),
    ).toEqual(["'self'"]);
  });

  it("allows exactly the nonce of the request and the hashes of the shells for pages", () => {
    const csp = buildCsp(prod, { nonce, scriptHashes: [hash, "sha384-abc+/="] });
    expect(directive(csp, "script-src")).toEqual([
      "'self'",
      `'nonce-${nonce}'`,
      `'${hash}'`,
      "'sha384-abc+/='",
    ]);
  });

  it("never contains 'unsafe-inline', 'unsafe-eval', 'strict-dynamic' or a wildcard in production", () => {
    for (const options of [{}, { nonce }, { nonce, scriptHashes: [hash] }]) {
      for (const env of [
        prod,
        { ...prod, CSP_REPORT_ONLY: "true" },
        { ...prod, MAP_TILE_CACHE: "1" },
      ]) {
        const sources = directive(buildCsp(env, options), "script-src");
        for (const forbidden of [
          "'unsafe-inline'",
          "'unsafe-eval'",
          "'strict-dynamic'",
          "*",
          "https:",
          "http:",
          "data:",
        ]) {
          expect(sources).not.toContain(forbidden);
        }
        expect(sources.every((s) => s === "'self'" || /^'(nonce|sha\d+)-/.test(s))).toBe(true);
      }
    }
    // style-src is a separate decision (Leaflet's inline styles) and not touched by NUD-110
    expect(directive(buildCsp(prod), "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("development keeps inline scripts and eval for HMR and ignores a nonce (it would disable 'unsafe-inline')", () => {
    const dev = directive(
      buildCsp({ NODE_ENV: "development" }, { nonce, scriptHashes: [hash] }),
      "script-src",
    );
    expect(dev).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
  });

  it("rejects values that could break out of the header", () => {
    for (const bad of [
      "",
      "abc",
      "a b c d e f g h i j k l",
      "x';script-src *;'",
      "abc\r\nSet-Cookie: x=1",
      "short",
    ]) {
      expect(() => scriptSources({ dev: false, nonce: bad }), bad).toThrow();
    }
    for (const bad of [
      "md5-abc",
      "sha256-",
      "sha256-a'b",
      "sha256-ab cd",
      "'sha256-abc='",
      "sha256-abc;",
    ]) {
      expect(() => scriptSources({ dev: false, scriptHashes: [bad] }), bad).toThrow();
    }
  });

  it("the report-only switch applies to the page policy as well", () => {
    expect(cspHeader({ ...prod, CSP_REPORT_ONLY: "true" }, { nonce }).key).toBe(
      "Content-Security-Policy-Report-Only",
    );
    expect(cspHeader(prod, { nonce }).key).toBe("Content-Security-Policy");
  });

  it("securityHeaders = static CSP + the common headers", () => {
    const all = securityHeaders(prod);
    expect(all[0]).toEqual(cspHeader(prod));
    expect(all.slice(1)).toEqual(commonSecurityHeaders());
    expect(commonSecurityHeaders().some((h) => h.key.startsWith("Content-Security-Policy"))).toBe(
      false,
    );
  });
});
