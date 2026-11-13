import { describe, expect, it } from "vitest";

import {
  DEV_TILE_ATTRIBUTION,
  DEV_TILE_URL,
  getMapTileConfig,
  GOOGLE_ATTRIBUTION,
  isTileCacheEnabled,
} from "./map-config";

describe("getMapTileConfig", () => {
  it("defaults to OSM for development", () => {
    expect(getMapTileConfig({})).toEqual({ url: DEV_TILE_URL, attribution: DEV_TILE_ATTRIBUTION });
    expect(getMapTileConfig({ MAP_TILE_URL: "  " }).url).toBe(DEV_TILE_URL);
  });

  it("uses the configured provider and its attribution", () => {
    expect(
      getMapTileConfig({
        MAP_TILE_URL: " https://t.example/{z}/{x}/{y}.png ",
        MAP_TILE_ATTRIBUTION: "© Example",
      }),
    ).toEqual({ url: "https://t.example/{z}/{x}/{y}.png", attribution: "© Example" });
  });

  it("does not attribute OSM to a custom provider", () => {
    expect(
      getMapTileConfig({ MAP_TILE_URL: "https://t.example/{z}/{x}/{y}.png" }).attribution,
    ).toBe("");
  });
});

describe("Google attribution (NUD-203)", () => {
  const URL = "https://t.example/{z}/{x}/{y}.png";

  it("names Google next to the map provider while the Google key is set", () => {
    expect(GOOGLE_ATTRIBUTION).toContain("Google Maps");
    expect(
      getMapTileConfig({
        MAP_TILE_URL: URL,
        MAP_TILE_ATTRIBUTION: "© Example",
        GOOGLE_MAPS_SERVER_KEY: "AIza-secret-key",
      }).attribution,
    ).toBe(`© Example | ${GOOGLE_ATTRIBUTION}`);
    expect(getMapTileConfig({ GOOGLE_MAPS_SERVER_KEY: "AIza-secret-key" }).attribution).toBe(
      `${DEV_TILE_ATTRIBUTION} | ${GOOGLE_ATTRIBUTION}`,
    );
    // No stray separator when the map provider has no attribution of its own.
    expect(
      getMapTileConfig({ MAP_TILE_URL: URL, GOOGLE_MAPS_SERVER_KEY: "AIza-secret-key" })
        .attribution,
    ).toBe(GOOGLE_ATTRIBUTION);
  });

  it("the key itself never reaches the browser with the tile settings", () => {
    const config = getMapTileConfig({
      MAP_TILE_URL: URL,
      GOOGLE_MAPS_SERVER_KEY: "AIza-secret-key",
    });
    expect(JSON.stringify(config)).not.toContain("AIza");
  });

  it("says nothing about Google without the key", () => {
    expect(getMapTileConfig({ GOOGLE_MAPS_SERVER_KEY: "  " }).attribution).toBe(
      DEV_TILE_ATTRIBUTION,
    );
  });
});

describe("tile cache flag (NUD-108)", () => {
  const URL = "https://t.example/{z}/{x}/{y}.png";

  it("is off by default", () => {
    expect(isTileCacheEnabled({})).toBe(false);
    expect(getMapTileConfig({ MAP_TILE_URL: URL }).cache).toBeUndefined();
  });

  it("needs MAP_TILE_CACHE=1 and an explicit tile URL", () => {
    expect(isTileCacheEnabled({ MAP_TILE_CACHE: "1", MAP_TILE_URL: URL })).toBe(true);
    expect(getMapTileConfig({ MAP_TILE_CACHE: "1", MAP_TILE_URL: URL }).cache).toBe(true);
    expect(isTileCacheEnabled({ MAP_TILE_CACHE: "true", MAP_TILE_URL: URL })).toBe(false);
    // the dev-only OSM default is never cached
    expect(isTileCacheEnabled({ MAP_TILE_CACHE: "1" })).toBe(false);
    expect(getMapTileConfig({ MAP_TILE_CACHE: "1" }).cache).toBeUndefined();
  });
});
