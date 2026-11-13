import { describe, expect, it } from "vitest";

import { corsRules, parseOrigin } from "./bucket-cors";

describe("parseOrigin", () => {
  it("accepts a bare https origin and drops a trailing slash", () => {
    expect(parseOrigin("https://routenplanner.example")).toBe("https://routenplanner.example");
    expect(parseOrigin(" https://App.Example:8443/ ")).toBe("https://app.example:8443");
  });
  it("accepts http only for localhost (a local check against MinIO)", () => {
    expect(parseOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(parseOrigin("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(() => parseOrigin("http://routenplanner.example")).toThrow(/https/);
  });
  it("refuses a wildcard, a path, a query and anything that is not a URL", () => {
    for (const value of [
      "*",
      "https://*.example",
      "https://app.example/admin",
      "https://app.example/?x=1",
      "app.example",
      "",
    ]) {
      expect(() => parseOrigin(value)).toThrow();
    }
  });
});

describe("corsRules", () => {
  it("allows the browser upload (PUT with a content type) and reading, for the given origins only", () => {
    expect(corsRules(["https://a.example", "https://b.example"])).toEqual([
      {
        ID: "nudel-browser-uploads",
        AllowedOrigins: ["https://a.example", "https://b.example"],
        AllowedMethods: ["GET", "HEAD", "PUT"],
        AllowedHeaders: ["content-type"],
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3600,
      },
    ]);
  });
  it("needs at least one origin and drops duplicates", () => {
    expect(() => corsRules([])).toThrow(/origin/);
    expect(corsRules(["https://a.example", "https://a.example/"])[0]!.AllowedOrigins).toEqual([
      "https://a.example",
    ]);
  });
});
