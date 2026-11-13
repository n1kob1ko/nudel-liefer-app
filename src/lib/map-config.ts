export type MapTileConfig = {
  url: string;
  attribution: string;
  /**
   * `MAP_TILE_CACHE=1` (NUD-108): the service worker keeps the tiles the user viewed. The tile
   * layer then requests them with CORS (`crossOrigin`), so the worker never stores opaque
   * responses, which count with a large padded size against the storage quota.
   */
  cache?: boolean;
};

/** OpenStreetMap standard tiles: fine for development only (OSM tile usage policy). */
export const DEV_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEV_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * NUD-203: with `GOOGLE_MAPS_SERVER_KEY` the pins come from Google's Geocoding API and the route
 * line from its Routes API, drawn on this (non-Google) map. Google asks that its content is
 * recognisable as such, so every map names it after the map provider's own attribution.
 */
export const GOOGLE_ATTRIBUTION = "Routing &amp; Geocoding: Google Maps";

/**
 * Tile layer from `MAP_TILE_URL` / `MAP_TILE_ATTRIBUTION`; dev-only OSM defaults when unset. Only
 * ever called on the server: the Google key decides about one more attribution and stays there.
 */
export function getMapTileConfig(
  env: Record<string, string | undefined> = process.env,
): MapTileConfig {
  const url = env.MAP_TILE_URL?.trim();
  const withGoogle = (attribution: string) =>
    env.GOOGLE_MAPS_SERVER_KEY?.trim()
      ? [attribution, GOOGLE_ATTRIBUTION].filter(Boolean).join(" | ")
      : attribution;
  if (!url) return { url: DEV_TILE_URL, attribution: withGoogle(DEV_TILE_ATTRIBUTION) };
  return {
    url,
    attribution: withGoogle(env.MAP_TILE_ATTRIBUTION?.trim() ?? ""),
    ...(isTileCacheEnabled(env) ? { cache: true } : {}),
  };
}

/**
 * Opt-in (default OFF, NUD-108): the worker caches tiles the user has looked at (never a bulk
 * download). Only with an explicit `MAP_TILE_URL`: the dev-only OSM default is never cached. Check
 * the provider's terms first (docs/env.md).
 */
export function isTileCacheEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MAP_TILE_CACHE?.trim() === "1" && !!env.MAP_TILE_URL?.trim();
}
