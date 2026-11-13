// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_ROUTES_FIELD_MASK,
  GOOGLE_ROUTES_URL,
  GoogleRoutingProvider,
  mapComputeRoutesResponse,
  MAX_GOOGLE_INTERMEDIATES,
} from "./google";
import { LocalHeuristicProvider } from "./heuristic";
import { getRoutingProvider, setRoutingProviderForTests } from "./index";
import { type LatLng, type OptimizeInput, RoutingError } from "./types";

const KEY = "AIza-test-key-0123456789";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const depot: LatLng = { lat: 48.2082, lng: 16.3738 };
/** Stops on a line east of the depot, all different. */
const stops = (count: number): LatLng[] =>
  Array.from({ length: count }, (_, i) => ({ lat: 48.21 + i / 1000, lng: 16.38 + i / 1000 }));

type Waypoint = { location: { latLng: { latitude: number; longitude: number } } };
type RoutesRequest = {
  origin: Waypoint;
  destination: Waypoint;
  intermediates?: Waypoint[];
  [key: string]: unknown;
};

const requestBody = (init: RequestInit | undefined) =>
  JSON.parse(String(init?.body)) as RoutesRequest;

const requestPoints = (body: RoutesRequest): [number, number][] =>
  [body.origin, ...(body.intermediates ?? []), body.destination].map((w) => [
    w.location.latLng.longitude,
    w.location.latLng.latitude,
  ]);

/**
 * HAND-WRITTEN from the documented `computeRoutes` response shape, not recorded live: every leg is
 * 1000 m and 120 s, the line runs straight through the points of the request.
 */
function routesFetch() {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const points = requestPoints(requestBody(init));
    return json({
      routes: [
        {
          legs: points.slice(1).map(() => ({ distanceMeters: 1000, duration: "120s" })),
          polyline: { geoJsonLinestring: { type: "LineString", coordinates: points } },
        },
      ],
    });
  });
}

const provider = (fetchMock: typeof fetch, extra = {}) =>
  new GoogleRoutingProvider({ apiKey: KEY, fetch: fetchMock, ...extra });

describe("mapComputeRoutesResponse", () => {
  const line = {
    geoJsonLinestring: {
      type: "LineString",
      coordinates: [
        [16.37, 48.2],
        [16.38, 48.21],
        [16.37, 48.2],
      ],
    },
  };

  it("maps legs (metres, whole seconds) and the line", () => {
    const body = {
      routes: [
        {
          legs: [
            { distanceMeters: 1234, duration: "123.4s" },
            { distanceMeters: 800, duration: "95s" },
          ],
          polyline: line,
        },
      ],
    };
    expect(mapComputeRoutesResponse(body, 3)).toEqual({
      legs: [
        { distanceM: 1234, durationS: 123 },
        { distanceM: 800, durationS: 95 },
      ],
      coordinates: line.geoJsonLinestring.coordinates,
    });
  });

  it("a leg between two orders at the same door has no distanceMeters: that is 0, not an error", () => {
    const body = { routes: [{ legs: [{ duration: "0s" }, {}], polyline: line }] };
    expect(mapComputeRoutesResponse(body, 3).legs).toEqual([
      { distanceM: 0, durationS: 0 },
      { distanceM: 0, durationS: 0 },
    ]);
  });

  it("an answer without a line has no coordinates (the caller draws through the points)", () => {
    const body = { routes: [{ legs: [{}] }] };
    expect(mapComputeRoutesResponse(body, 2).coordinates).toEqual([]);
  });

  it.each([[{}], [{ routes: [] }]])("no route found (%j) is NO_ROUTE", (body) => {
    expect(() => mapComputeRoutesResponse(body, 2)).toThrow(
      expect.objectContaining({ code: "NO_ROUTE" }),
    );
  });

  it("rejects another number of legs than hops, and another shape", () => {
    const oneLeg = { routes: [{ legs: [{ distanceMeters: 1, duration: "1s" }], polyline: line }] };
    expect(() => mapComputeRoutesResponse(oneLeg, 3)).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
    for (const body of [
      "nope",
      { routes: "nope" },
      { routes: [{ legs: [{ distanceMeters: "far" }] }] },
      { routes: [{ legs: [{ duration: "soon" }] }] },
      { routes: [{ legs: [{ distanceMeters: -5 }] }] },
    ]) {
      expect(() => mapComputeRoutesResponse(body, 2)).toThrow(
        expect.objectContaining({ code: "BAD_RESPONSE" }),
      );
    }
  });
});

describe("GoogleRoutingProvider.route", () => {
  it("asks computeRoutes once for a short tour: depot, the stops in order, depot", async () => {
    const fetchMock = routesFetch();
    const [a, b] = stops(2) as [LatLng, LatLng];

    const result = await provider(fetchMock).route({ depot, orderedStops: [a, b] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(GOOGLE_ROUTES_URL);
    expect(String(url)).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Goog-Api-Key")).toBe(KEY);
    expect(headers.get("X-Goog-FieldMask")).toBe(GOOGLE_ROUTES_FIELD_MASK);
    expect(requestBody(init)).toEqual({
      origin: { location: { latLng: { latitude: depot.lat, longitude: depot.lng } } },
      destination: { location: { latLng: { latitude: depot.lat, longitude: depot.lng } } },
      intermediates: [
        { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
        { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      ],
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      polylineEncoding: "GEO_JSON_LINESTRING",
      polylineQuality: "OVERVIEW",
    });

    expect(result.legs).toHaveLength(3);
    expect(result.totalDistanceM).toBe(3000);
    expect(result.totalDurationS).toBe(360);
    expect(result.approximate).toBe(false);
    expect(result.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [depot.lng, depot.lat],
        [a.lng, a.lat],
        [b.lng, b.lat],
        [depot.lng, depot.lat],
      ],
    });
  });

  it("stays in the cheapest price class: no steps, no traffic, no reordering by Google", async () => {
    const fetchMock = routesFetch();
    await provider(fetchMock).route({ depot, orderedStops: stops(3) });

    expect(GOOGLE_ROUTES_FIELD_MASK).toBe(
      "routes.legs.distanceMeters,routes.legs.duration,routes.polyline.geoJsonLinestring",
    );
    // Route steps are text that may not be shown next to a map (EEA terms).
    expect(GOOGLE_ROUTES_FIELD_MASK).not.toContain("steps");
    const body = requestBody(fetchMock.mock.calls[0]![1]);
    expect(body).not.toHaveProperty("optimizeWaypointOrder");
    expect(body.routingPreference).toBe("TRAFFIC_UNAWARE");
  });

  it("the key travels in a header only, never in the address or the body", async () => {
    const fetchMock = routesFetch();
    await provider(fetchMock).route({ depot, orderedStops: stops(1) });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain(KEY);
    expect(String(init?.body)).not.toContain(KEY);
  });

  it("a tour with exactly 10 stops is one request, with 11 it is two", async () => {
    expect(MAX_GOOGLE_INTERMEDIATES).toBe(10);
    const ten = routesFetch();
    const eleven = routesFetch();

    const a = await provider(ten).route({ depot, orderedStops: stops(10) });
    const b = await provider(eleven).route({ depot, orderedStops: stops(11) });

    expect(ten).toHaveBeenCalledTimes(1);
    expect(a.legs).toHaveLength(11);
    expect(eleven).toHaveBeenCalledTimes(2);
    expect(b.legs).toHaveLength(12);
  });

  it("a long tour is asked in pieces of at most 10 stops between two ends, joined without a gap", async () => {
    const fetchMock = routesFetch();
    const ordered = stops(25);

    const result = await provider(fetchMock).route({ depot, orderedStops: ordered });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const chunks = fetchMock.mock.calls.map(([, init]) => requestPoints(requestBody(init)));
    expect(chunks.map((c) => c.length)).toEqual([12, 12, 5]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(requestBody(init).intermediates!.length).toBeLessThanOrEqual(10);
    }
    // Each piece starts where the one before ended.
    expect(chunks[1]![0]).toEqual(chunks[0]!.at(-1));
    expect(chunks[2]![0]).toEqual(chunks[1]!.at(-1));

    const all: [number, number][] = [depot, ...ordered, depot].map((p) => [p.lng, p.lat]);
    expect(result.legs).toHaveLength(26);
    expect(result.totalDistanceM).toBe(26_000);
    expect(result.totalDurationS).toBe(26 * 120);
    // No doubled point where two pieces meet.
    expect(result.geometry.coordinates).toEqual(all);
  });

  it("keeps the legs in tour order even when a later piece answers first", async () => {
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const index = call++;
      const points = requestPoints(requestBody(init));
      // The first piece answers last.
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 0));
      return json({
        routes: [
          {
            legs: points.slice(1).map(() => ({ distanceMeters: index + 1, duration: "1s" })),
            polyline: { geoJsonLinestring: { type: "LineString", coordinates: points } },
          },
        ],
      });
    });

    const result = await provider(fetchMock).route({ depot, orderedStops: stops(12) });

    expect(result.legs.map((l) => l.distanceM)).toEqual([...Array(11).fill(1), 2, 2]);
  });

  it("draws through the points where Google sends no line (all orders at one door)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ routes: [{ legs: [{}, {}] }] }));
    const result = await provider(fetchMock).route({ depot, orderedStops: [depot] });

    expect(result.legs).toEqual([
      { distanceM: 0, durationS: 0 },
      { distanceM: 0, durationS: 0 },
    ]);
    expect(result.totalDistanceM).toBe(0);
    expect(result.geometry.coordinates).toEqual([
      [depot.lng, depot.lat],
      [depot.lng, depot.lat],
      [depot.lng, depot.lat],
    ]);
  });

  it("no stops is an empty route without a request", async () => {
    const fetchMock = routesFetch();
    const result = await provider(fetchMock).route({ depot, orderedStops: [] });
    expect(result.legs).toEqual([]);
    expect(result.approximate).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses coordinates that are not on the globe without a request", async () => {
    const fetchMock = routesFetch();
    await expect(
      provider(fetchMock).route({ depot, orderedStops: [{ lat: 120, lng: 16 }] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no route between the points is NO_ROUTE", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({}));
    await expect(
      provider(fetchMock).route({ depot, orderedStops: stops(1) }),
    ).rejects.toMatchObject({ code: "NO_ROUTE" });
  });

  it("a key that may not use the Routes API is an HTTP error, and Google's text stays out of it", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(
        {
          error: {
            code: 403,
            message: `Requests from this key ${KEY} are blocked.`,
            status: "PERMISSION_DENIED",
          },
        },
        403,
      ),
    );
    const error = await provider(fetchMock)
      .route({ depot, orderedStops: stops(1) })
      .catch((e: unknown) => e as RoutingError);

    expect(error).toBeInstanceOf(RoutingError);
    expect(error).toMatchObject({ code: "HTTP", status: 403 });
    expect(error.message).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout and an unreachable service, never with the key in the text", async () => {
    const timeout = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed (X-Goog-Api-Key: ${KEY})`);
    });

    const timedOut = await provider(timeout)
      .route({ depot, orderedStops: stops(1) })
      .catch((e: unknown) => e as RoutingError);
    const unreachable = await provider(offline)
      .route({ depot, orderedStops: stops(1) })
      .catch((e: unknown) => e as RoutingError);

    expect(timedOut).toMatchObject({ code: "TIMEOUT" });
    expect(unreachable).toMatchObject({ code: "NETWORK" });
    expect(`${timedOut.message}${unreachable.message}`).not.toContain(KEY);
  });

  it("gives up at the deadline for the whole tour", async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(
      provider(hanging, { timeoutMs: 20 }).route({ depot, orderedStops: stops(1) }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("an answer that is not JSON is a bad response", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 }));
    await expect(
      provider(fetchMock).route({ depot, orderedStops: stops(1) }),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("getRoutingProvider with GOOGLE_MAPS_SERVER_KEY", () => {
  afterEach(() => {
    setRoutingProviderForTests(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const input: OptimizeInput = {
    depot,
    stops: stops(4).map((location, i) => ({ id: `s${i}`, location, serviceSeconds: 60 })),
  };

  it("Google wins over the old ORS variables: order from the heuristic, roads from Google", async () => {
    const fetchMock = routesFetch();
    vi.stubGlobal("fetch", fetchMock);

    // The state on Railway during the switch: the key is new, the old variables are still there.
    const routing = getRoutingProvider({
      GOOGLE_MAPS_SERVER_KEY: ` ${KEY} `,
      ORS_BASE_URL: "http://ors.railway.internal:8082/ors",
      ORS_API_KEY: "old-key",
    });
    const result = await routing.optimize(input);

    expect(result.approximate).toBe(false);
    expect(result.orderedStopIds).toEqual(
      (await new LocalHeuristicProvider().optimize(input)).orderedStopIds,
    );
    expect(result.legs).toHaveLength(5);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([GOOGLE_ROUTES_URL]);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("X-Goog-Api-Key")).toBe(KEY);
  });

  it("falls back to the estimate when Google refuses, and logs no key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => json({ error: { message: `key ${KEY} blocked` } }, 403)),
    );

    const result = await getRoutingProvider({ GOOGLE_MAPS_SERVER_KEY: KEY }).optimize(input);

    expect(result.approximate).toBe(true);
    expect(result.legs).toHaveLength(5);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
  });

  it("a blank key is no key: the heuristic answers, and the warning names the variable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = routesFetch();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getRoutingProvider({ GOOGLE_MAPS_SERVER_KEY: "   " }).optimize(input);

    expect(result.approximate).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain("GOOGLE_MAPS_SERVER_KEY");
  });
});
