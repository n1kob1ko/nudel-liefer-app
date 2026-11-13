import { describe, expect, it } from "vitest";

import { isKnownUrlStyle, usesPathStyle } from "./s3-url-style";

describe("usesPathStyle", () => {
  it("keeps today's rule when nothing is set: path style whenever there is an endpoint", () => {
    expect(usesPathStyle("https://abc.eu.r2.cloudflarestorage.com", undefined)).toBe(true);
    expect(usesPathStyle("http://localhost:9000", "")).toBe(true);
    expect(usesPathStyle(undefined, undefined)).toBe(false);
  });
  it("signs bucket sub-domain URLs for a virtual-hosted bucket", () => {
    expect(usesPathStyle("https://t3.storageapi.dev", "virtual")).toBe(false);
    expect(usesPathStyle("https://t3.storageapi.dev", " Virtual ")).toBe(false);
  });
  it("treats an explicit path like the default", () => {
    expect(usesPathStyle("https://t3.storageapi.dev", "path")).toBe(true);
    expect(usesPathStyle(undefined, "path")).toBe(false);
  });
});

describe("isKnownUrlStyle", () => {
  it("accepts unset, path and virtual", () => {
    for (const value of [undefined, "", "  ", "path", "virtual", "PATH", " virtual "]) {
      expect(isKnownUrlStyle(value)).toBe(true);
    }
  });
  it("refuses anything else", () => {
    for (const value of ["vhost", "virtual-hosted", "true", "0"]) {
      expect(isKnownUrlStyle(value)).toBe(false);
    }
  });
});
