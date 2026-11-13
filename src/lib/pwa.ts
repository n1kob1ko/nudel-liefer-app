/** Shared constants and the manifest builder for the driver PWA (NUD-080). */

import { withBasePath } from "./base-path";

/**
 * Browser UI / splash colours (redesign RD2): the yolk `--primary` of `globals.css`, the ink that
 * goes on top of it (white on yolk is unreadable) and the light page background.
 */
export const PWA_THEME_COLOR = "#ffc72c";
export const PWA_THEME_FOREGROUND = "#15171a";
export const PWA_BACKGROUND_COLOR = "#f1f2f4";

// Every value below becomes a URL the BROWSER fetches: Next applies `basePath` to `next/link` and
// `redirect()` only, not to `register()`, `navigator` URLs or the web app manifest, so each one has
// to carry the prefix explicitly (empty by default -> unchanged).
export const SW_URL = withBasePath("/sw.js");
export const OFFLINE_URL = withBasePath("/offline.html");

export const PWA_ICONS = {
  any192: withBasePath("/icons/icon-192.png"),
  any512: withBasePath("/icons/icon-512.png"),
  maskable192: withBasePath("/icons/icon-maskable-192.png"),
  maskable512: withBasePath("/icons/icon-maskable-512.png"),
  apple: withBasePath("/icons/apple-touch-icon.png"),
} as const;

/** Metadata URLs are not base-path aware either: the manifest link must carry the prefix. */
export function manifestPath(locale: string): string {
  return withBasePath(`/${locale}/manifest.webmanifest`);
}

/**
 * The locale-neutral address the installed app starts on (NUD-106). `proxy.ts` redirects it to the
 * driver's CURRENT language (session locale -> `NEXT_LOCALE` cookie -> Accept-Language -> `de`), so a
 * language switch after the installation is respected. `source=pwa` marks launches from the home
 * screen (also keeps the path distinct from a plain `/driver` visit in logs).
 */
export const DRIVER_LAUNCH_PATH = withBasePath("/driver?source=pwa");

export function driverHomePath(locale: string): string {
  return withBasePath(`/${locale}/driver`);
}

export type WebAppManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  dir: "ltr";
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "portrait";
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: "any" | "maskable" }[];
};

/**
 * Manifest of one locale (only the localized texts and `lang` differ). `start_url` is the same
 * locale-neutral launch path for all locales (NUD-106), `id` is the same too so the browser treats
 * them as one app. `scope` is the app root so that the redirect to `/<locale>/driver` and a later
 * language switch do not leave the installed app's scope. Under a sub-path that root is the base
 * path (`/delivery-app/`), never `/`: a scope of `/` would make the installed app claim the whole
 * origin, including an unrelated app served at `/quiz`.
 */
export function buildManifest(input: {
  locale: string;
  name: string;
  shortName: string;
  description: string;
}): WebAppManifest {
  const png = (src: string, size: number, purpose: "any" | "maskable") => ({
    src,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  });
  return {
    id: withBasePath("/driver"),
    name: input.name,
    short_name: input.shortName,
    description: input.description,
    lang: input.locale,
    dir: "ltr",
    start_url: DRIVER_LAUNCH_PATH,
    scope: withBasePath("/"),
    display: "standalone",
    orientation: "portrait",
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_BACKGROUND_COLOR,
    icons: [
      png(PWA_ICONS.any192, 192, "any"),
      png(PWA_ICONS.any512, 512, "any"),
      png(PWA_ICONS.maskable192, 192, "maskable"),
      png(PWA_ICONS.maskable512, 512, "maskable"),
    ],
  };
}
