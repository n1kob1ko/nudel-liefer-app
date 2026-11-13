import { describe, expect, it } from "vitest";

import {
  buildOfflineHtml,
  buildOfflineScript,
  OFFLINE_LOCALES,
  OFFLINE_SCRIPT_PATH,
  type OfflineTexts,
} from "./offline-page";

const texts = Object.fromEntries(
  OFFLINE_LOCALES.map((l) => [l, { title: `T-${l}`, text: `X-${l} <b>`, retry: `R-${l}` }]),
) as Record<(typeof OFFLINE_LOCALES)[number], OfflineTexts>;

describe("buildOfflineHtml", () => {
  const html = buildOfflineHtml(texts, "#ffc72c");

  it("contains the texts of all four locales, escaped", () => {
    for (const l of OFFLINE_LOCALES) {
      expect(html).toContain(`lang="${l}"`);
      expect(html).toContain(`T-${l}`);
      expect(html).toContain(`R-${l}`);
    }
    expect(html).toContain("X-de &lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("forwards the locale-neutral start URL to the locale of the NEXT_LOCALE cookie (NUD-106)", () => {
    const script = buildOfflineScript();
    expect(script).toContain("NEXT_LOCALE");
    expect(script).toContain('=== "/driver"');
    expect(script).toContain("location.replace");
    // trailing slashes are removed with /\/+$/ (an over-escaped pattern would never match "/driver/")
    expect(script).toContain(String.raw`replace(/\/+$/, "")`);
  });

  it("has no inline script and no inline event handler: the CSP of static files forbids them (NUD-110)", () => {
    expect(html).toContain(`<script src="${OFFLINE_SCRIPT_PATH}"></script>`);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).toContain("data-reload");
    expect(buildOfflineScript()).toContain("location.reload()");
  });

  it("the script is valid JavaScript", () => {
    expect(() => new Function(buildOfflineScript())).not.toThrow();
  });

  it("is static and generic: no external resources, no session data", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<(link|img|iframe)\b/);
  });
});
