import { CachingGeocoder } from "./cache";
import { FakeGeocoder } from "./fake";
import { GoogleGeocoder } from "./google";
import { DEFAULT_COUNTRIES, OrsGeocoder } from "./ors";
import { PhotonGeocoder } from "./photon";
import type { Geocoder } from "./types";

export { CachingGeocoder, LruCache } from "./cache";
export { FakeGeocoder } from "./fake";
export { GoogleGeocoder, mapGoogleGeocodeResponse } from "./google";
export { mapOrsResponse, OrsGeocoder } from "./ors";
export { mapPhotonResponse, PHOTON_DEFAULT_BASE_URL, PhotonGeocoder } from "./photon";
export * from "./types";

let instance: Geocoder | undefined;
let warned = false;

/** `ORS_GEOCODE_COUNTRIES="AT,DE"` -> `["AT","DE"]`; invalid entries are ignored. */
export function parseCountries(value: string | undefined): string[] {
  const list = (value ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return list.length ? list : DEFAULT_COUNTRIES;
}

/**
 * `ORS_GEOCODE_BASE_URL="http://127.0.0.1:4000/"` -> `"http://127.0.0.1:4000"`. A blank value means
 * "unset", so an empty variable cannot silently point the app at nothing. `undefined` = the public API.
 *
 * Deliberately separate from the routing provider's `ORS_BASE_URL` (NUD-156): the self-hosted
 * openrouteservice image has **no** geocoding endpoint, so one shared variable would let a self-hosted
 * *routing* instance silently break geocoding. Geocoding is served by Pelias, a different service.
 */
export function parseBaseUrl(value: string | undefined): string | undefined {
  const baseUrl = value?.trim().replace(/\/+$/, "");
  return baseUrl ? baseUrl : undefined;
}

/**
 * Geocoder selected from the environment, in this order:
 * `GOOGLE_MAPS_SERVER_KEY` -> Google's Geocoding API (NUD-203; `GOOGLE_MAPS_LANGUAGE`, default `de`,
 * and `GOOGLE_MAPS_REGION`, default `at`); `PHOTON_URL` -> a self-hosted Komoot Photon (NUD-157, no key, the only way to geocode without the
 * hosted quota); `ORS_API_KEY` -> the hosted openrouteservice/Pelias API; neither -> the deterministic
 * Fake plus one warning. The admin confirms every pin (D9), so the Fake never silently becomes a
 * delivery position.
 */
export function getGeocoder(env: Record<string, string | undefined> = process.env): Geocoder {
  if (instance) return instance;
  const googleKey = env.GOOGLE_MAPS_SERVER_KEY?.trim();
  const photonUrl = parseBaseUrl(env.PHOTON_URL);
  const apiKey = env.ORS_API_KEY?.trim();
  if (googleKey) {
    instance = new CachingGeocoder(
      new GoogleGeocoder({
        apiKey: googleKey,
        language: env.GOOGLE_MAPS_LANGUAGE?.trim() || undefined,
        region: env.GOOGLE_MAPS_REGION?.trim() || undefined,
      }),
    );
  } else if (photonUrl) {
    instance = new CachingGeocoder(
      new PhotonGeocoder({ baseUrl: photonUrl, lang: env.PHOTON_LANG?.trim() || undefined }),
    );
  } else if (apiKey) {
    instance = new CachingGeocoder(
      new OrsGeocoder({
        apiKey,
        baseUrl: parseBaseUrl(env.ORS_GEOCODE_BASE_URL),
        countries: parseCountries(env.ORS_GEOCODE_COUNTRIES),
      }),
    );
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[geocoder] none of GOOGLE_MAPS_SERVER_KEY, PHOTON_URL, ORS_API_KEY is set - using the FakeGeocoder (coordinates are NOT real addresses)",
      );
    }
    instance = new CachingGeocoder(new FakeGeocoder());
  }
  return instance;
}

/** Test helper. */
export function setGeocoderForTests(geocoder: Geocoder | undefined) {
  instance = geocoder;
  if (!geocoder) warned = false;
}
