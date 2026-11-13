import { describe, expect, it } from "vitest";

import { GeocoderError } from "../../src/server/geocoder/types";
import { type RouteResult, RoutingError } from "../../src/server/routing/types";
import { CHECK_ADDRESS, CHECK_DEPOT, CHECK_STOP, runMapsCheck } from "./maps-check";

const SECRET = "AIza-secret-key";

const goodRoute: RouteResult = {
  legs: [
    { distanceM: 6200, durationS: 900 },
    { distanceM: 6400, durationS: 950 },
  ],
  geometry: {
    type: "LineString",
    coordinates: [
      [16.3731, 48.2082],
      [16.34, 48.2],
      [16.3122, 48.1845],
      [16.3731, 48.2082],
    ],
  },
  totalDistanceM: 12600,
  totalDurationS: 1850,
  approximate: false,
};

function run(overrides: Partial<Parameters<typeof runMapsCheck>[0]> = {}) {
  const lines: string[] = [];
  return runMapsCheck({
    geocoder: {
      search: async () => [{ label: CHECK_ADDRESS, lat: 48.2084, lng: 16.3735, confidence: 1 }],
    },
    routing: { route: async () => goodRoute },
    log: (line) => lines.push(line),
    ...overrides,
  }).then((ok) => ({ ok, lines }));
}

describe("runMapsCheck", () => {
  it("passes when the address lands in Vienna and the route has two legs and a line", async () => {
    const { ok, lines } = await run();
    expect(ok).toBe(true);
    expect(lines).toEqual([
      "[maps-check] ok   geocode: 1 candidate(s), the first one within 2 km of the expected place",
      "[maps-check] ok   route: 2 legs, 12.6 km, 31 min, a line of 4 points",
    ]);
  });

  it("asks for the fixed address and the fixed round trip", async () => {
    const seen: unknown[] = [];
    await run({
      geocoder: {
        search: async (address) => {
          seen.push(address);
          return [{ label: address, lat: 48.2084, lng: 16.3735, confidence: 1 }];
        },
      },
      routing: {
        route: async (input) => {
          seen.push(input);
          return goodRoute;
        },
      },
    });
    expect(seen).toEqual([CHECK_ADDRESS, { depot: CHECK_DEPOT, orderedStops: [CHECK_STOP] }]);
  });

  it("fails when Google finds nothing", async () => {
    const { ok, lines } = await run({ geocoder: { search: async () => [] } });
    expect(ok).toBe(false);
    expect(lines[0]).toBe("[maps-check] FAIL geocode: no candidate for the test address");
  });

  it("fails when the first candidate is somewhere else", async () => {
    const { ok, lines } = await run({
      geocoder: { search: async () => [{ label: "x", lat: 47.07, lng: 15.44, confidence: 1 }] },
    });
    expect(ok).toBe(false);
    expect(lines[0]).toMatch(/^\[maps-check\] FAIL geocode: the first candidate is \d+ km away/);
  });

  it("reports a refusal with the provider's fixed text and still tries the route", async () => {
    const { ok, lines } = await run({
      geocoder: {
        search: async () => {
          throw new GeocoderError("Geocoding service refused the request (REQUEST_DENIED)", "HTTP");
        },
      },
    });
    expect(ok).toBe(false);
    expect(lines).toEqual([
      "[maps-check] FAIL geocode: HTTP - Geocoding service refused the request (REQUEST_DENIED)",
      "[maps-check] ok   route: 2 legs, 12.6 km, 31 min, a line of 4 points",
    ]);
  });

  it("fails on a route error, on an estimate and on a route without a real line", async () => {
    const refused = await run({
      routing: {
        route: async () => {
          throw new RoutingError("Routing service answered HTTP 403", "HTTP", 403);
        },
      },
    });
    expect(refused.ok).toBe(false);
    expect(refused.lines[1]).toBe(
      "[maps-check] FAIL route: HTTP - Routing service answered HTTP 403",
    );

    const estimate = await run({
      routing: { route: async () => ({ ...goodRoute, approximate: true }) },
    });
    expect(estimate.ok).toBe(false);

    const noLine = await run({
      routing: {
        route: async () => ({
          ...goodRoute,
          geometry: {
            type: "LineString" as const,
            coordinates: goodRoute.geometry.coordinates.slice(0, 2),
          },
        }),
      },
    });
    expect(noLine.ok).toBe(false);

    const noDistance = await run({
      routing: { route: async () => ({ ...goodRoute, totalDistanceM: 0 }) },
    });
    expect(noDistance.ok).toBe(false);
  });

  it("never prints the text of an unknown error: it could quote the key", async () => {
    const { ok, lines } = await run({
      geocoder: {
        search: async () => {
          throw new Error(`fetch failed for ...&key=${SECRET}`);
        },
      },
      routing: {
        route: async () => {
          throw new TypeError(`X-Goog-Api-Key: ${SECRET}`);
        },
      },
    });
    expect(ok).toBe(false);
    expect(lines).toEqual([
      "[maps-check] FAIL geocode: unexpected error (Error)",
      "[maps-check] FAIL route: unexpected error (TypeError)",
    ]);
    expect(lines.join("\n")).not.toContain(SECRET);
  });
});
