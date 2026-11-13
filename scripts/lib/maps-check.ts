/**
 * The checks behind `pnpm maps:check` (NUD-203): one address search and one route, the two things
 * the app asks Google for. Pure: `scripts/check-google-maps.ts` builds the Google providers and
 * prints the lines.
 *
 * The test data is public and fixed (St. Stephen's Cathedral and Schönbrunn Palace in Vienna), so
 * a run sends Google nothing about a customer. A line never carries the key or a text Google or
 * `fetch` produced: a `GeocoderError` / `RoutingError` has a fixed text (see the providers), any
 * other error is reduced to its class name.
 */
import type { Geocoder } from "../../src/server/geocoder/types";
import { GeocoderError } from "../../src/server/geocoder/types";
import type { LatLng, RoutingProvider } from "../../src/server/routing/types";
import { RoutingError } from "../../src/server/routing/types";

export const CHECK_ADDRESS = "Stephansplatz 3, 1010 Wien";
/** Where `CHECK_ADDRESS` is; also the start and end of the test route. */
export const CHECK_DEPOT: LatLng = { lat: 48.2082, lng: 16.3731 };
/** Schönbrunn Palace, about 5 km away as the crow flies. */
export const CHECK_STOP: LatLng = { lat: 48.1845, lng: 16.3122 };
/** A hit further away than this is a different place. */
const MAX_OFFSET_KM = 2;

export type MapsCheckDeps = {
  geocoder: Pick<Geocoder, "search">;
  routing: Pick<RoutingProvider, "route">;
  log: (line: string) => void;
};

function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function describeError(error: unknown): string {
  if (error instanceof GeocoderError || error instanceof RoutingError) {
    return `${error.code} - ${error.message}`;
  }
  return `unexpected error (${error instanceof Error ? error.constructor.name : typeof error})`;
}

/** Runs both checks (the second also when the first failed) and returns whether both passed. */
export async function runMapsCheck({ geocoder, routing, log }: MapsCheckDeps): Promise<boolean> {
  let ok = true;
  const step = (label: string, passed: boolean, detail: string) => {
    log(`[maps-check] ${passed ? "ok  " : "FAIL"} ${label}: ${detail}`);
    if (!passed) ok = false;
  };

  try {
    const candidates = await geocoder.search(CHECK_ADDRESS);
    const first = candidates[0];
    if (!first) {
      step("geocode", false, "no candidate for the test address");
    } else {
      const offset = distanceKm(CHECK_DEPOT, first);
      step(
        "geocode",
        offset <= MAX_OFFSET_KM,
        offset <= MAX_OFFSET_KM
          ? `${candidates.length} candidate(s), the first one within ${MAX_OFFSET_KM} km of the expected place`
          : `the first candidate is ${Math.round(offset)} km away from the expected place`,
      );
    }
  } catch (error) {
    step("geocode", false, describeError(error));
  }

  try {
    const route = await routing.route({ depot: CHECK_DEPOT, orderedStops: [CHECK_STOP] });
    const points = route.geometry.coordinates.length;
    const detail = `${route.legs.length} legs, ${(route.totalDistanceM / 1000).toFixed(1)} km, ${Math.round(route.totalDurationS / 60)} min, a line of ${points} points`;
    // A road line has more points than the three the request named; an estimate is no answer.
    const real =
      !route.approximate &&
      route.legs.length === 2 &&
      route.totalDistanceM > 0 &&
      route.totalDurationS > 0 &&
      points > 3;
    step("route", real, real ? detail : `not a road route (${detail})`);
  } catch (error) {
    step("route", false, describeError(error));
  }

  return ok;
}
