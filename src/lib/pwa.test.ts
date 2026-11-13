import { describe, expect, it } from "vitest";

import cs from "../../messages/cs.json";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import srLatn from "../../messages/sr-Latn.json";
import zhHans from "../../messages/zh-Hans.json";
import { LOCALES } from "./localized-text";
import { buildManifest, DRIVER_LAUNCH_PATH, manifestPath, PWA_ICONS } from "./pwa";

const messages = { de, "zh-Hans": zhHans, en, "sr-Latn": srLatn, cs };

describe("buildManifest", () => {
  for (const locale of LOCALES) {
    it(`is valid and starts on the driver home for ${locale}`, () => {
      const pwa = messages[locale as keyof typeof messages].pwa;
      const m = buildManifest({
        locale,
        name: pwa.name,
        shortName: pwa.shortName,
        description: pwa.description,
      });
      // Locale-neutral (NUD-106): the server picks the driver's current language at launch.
      expect(m.start_url).toBe("/driver?source=pwa");
      expect(m.start_url).toBe(DRIVER_LAUNCH_PATH);
      expect(m.start_url.startsWith(m.scope)).toBe(true);
      expect(m.display).toBe("standalone");
      expect(m.lang).toBe(locale);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.short_name.length).toBeGreaterThan(0);
      // Home-screen labels are cut after roughly a dozen characters. The product name "Routenplanner"
      // is 13 narrow ones and is used as the label on purpose (rename 2026-11-13), hence 13, not 12.
      expect(m.short_name.length).toBeLessThanOrEqual(13);
      expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }

  it("has icons 192 and 512 plus maskable ones", () => {
    const m = buildManifest({ locale: "de", name: "n", shortName: "s", description: "d" });
    const find = (sizes: string, purpose: string) =>
      m.icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    expect(find("192x192", "any")?.src).toBe(PWA_ICONS.any192);
    expect(find("512x512", "any")?.src).toBe(PWA_ICONS.any512);
    expect(find("512x512", "maskable")?.src).toBe(PWA_ICONS.maskable512);
    expect(m.icons.every((i) => i.type === "image/png")).toBe(true);
  });

  it("keeps the app id stable and the same start URL for all locales (NUD-106)", () => {
    const manifests = LOCALES.map((locale) =>
      buildManifest({ locale, name: "n", shortName: "s", description: "d" }),
    );
    expect(new Set(manifests.map((m) => m.start_url)).size).toBe(1);
    expect(manifests.every((m) => m.id === "/driver")).toBe(true);
    expect(manifests.every((m) => m.scope === "/")).toBe(true);
  });

  it("uses one app id for all locales (one installed app)", () => {
    const ids = LOCALES.map(
      (locale) => buildManifest({ locale, name: "n", shortName: "s", description: "d" }).id,
    );
    expect(new Set(ids).size).toBe(1);
  });

  it("links a per-locale manifest path", () => {
    expect(manifestPath("sr-Latn")).toBe("/sr-Latn/manifest.webmanifest");
  });
});
