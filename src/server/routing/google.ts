import { z } from "zod";

import {
  assertValidPoints,
  emptyRoute,
  type LatLng,
  type RouteInput,
  type RouteLeg,
  type RouteResult,
  ROUTING_TIMEOUT_MS,
  RoutingError,
  type RoutingProvider,
} from "./types";

/**
 * Google Maps Platform **Routes API** (NUD-203), selected by `GOOGLE_MAPS_SERVER_KEY`.
 *
 *   POST https://routes.googleapis.com/directions/v2:computeRoutes
 *
 * Only `route()`: the visiting order stays with the local heuristic
 * (`HeuristicOrderRoutingProvider`), Google delivers the legs and the line for exactly that order.
 * Three things are deliberate:
 *
 * - **Price class "Essentials"**: at most 10 stops between the two ends of a request, no traffic
 *   (`TRAFFIC_UNAWARE`), no reordering by Google. A longer tour is asked in pieces that share their
 *   boundary point; every piece is one billed request.
 * - **No steps** in the field mask: under Google's EEA terms (the owner's account is billed there)
 *   the route line may be drawn on the app's own map, the description and the steps may not be
 *   shown next to a map.
 * - The key travels in the `X-Goog-Api-Key` header, and no text Google or `fetch` produced is
 *   passed on in an error: both can quote the key.
 */
export const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const GOOGLE_ROUTES_FIELD_MASK =
  "routes.legs.distanceMeters,routes.legs.duration,routes.polyline.geoJsonLinestring";
/** Stops between origin and destination of one request that still bill as "Essentials". */
export const MAX_GOOGLE_INTERMEDIATES = 10;

/** Protobuf JSON duration: seconds with an `s`, e.g. `"123.4s"`. */
const DURATION = /^(\d+(?:\.\d+)?)s$/;

const computeRoutesResponse = z.object({
  routes: z
    .array(
      z.object({
        // Protobuf JSON leaves out a field that is 0, so a leg between two orders at the same door
        // comes without `distanceMeters`.
        legs: z
          .array(
            z.object({
              distanceMeters: z.number().min(0).default(0),
              duration: z.string().regex(DURATION).default("0s"),
            }),
          )
          .default([]),
        polyline: z
          .object({
            geoJsonLinestring: z
              .object({
                coordinates: z.array(z.tuple([z.number(), z.number()]).rest(z.number())),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

/**
 * Maps one `computeRoutes` answer for a request with `points` waypoints (origin, intermediates,
 * destination) to its `points - 1` legs and the line as `[lng, lat]` pairs. `coordinates` is empty
 * when Google sent no line. Throws `NO_ROUTE` for an answer without a route.
 */
export function mapComputeRoutesResponse(
  body: unknown,
  points: number,
): { legs: RouteLeg[]; coordinates: [number, number][] } {
  const parsed = computeRoutesResponse.safeParse(body);
  if (!parsed.success) {
    throw new RoutingError("Unexpected response from the routing service", "BAD_RESPONSE");
  }
  const route = parsed.data.routes[0];
  if (!route) throw new RoutingError("The routing service found no route", "NO_ROUTE");
  if (route.legs.length !== points - 1) {
    throw new RoutingError("Unexpected response from the routing service", "BAD_RESPONSE");
  }
  return {
    legs: route.legs.map((leg) => ({
      distanceM: Math.round(leg.distanceMeters),
      durationS: Math.round(Number(DURATION.exec(leg.duration)![1])),
    })),
    coordinates: (route.polyline?.geoJsonLinestring?.coordinates ?? []).map(
      (c): [number, number] => [c[0], c[1]],
    ),
  };
}

export type GoogleRoutingOptions = {
  apiKey: string;
  /** Deadline for one whole call (all pieces together). Default 8 s. No retries: the caller falls back. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export class GoogleRoutingProvider implements Pick<RoutingProvider, "route"> {
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: GoogleRoutingOptions) {
    this.timeoutMs = options.timeoutMs ?? ROUTING_TIMEOUT_MS;
    this.fetchFn = options.fetch ?? fetch;
  }

  async route(input: RouteInput): Promise<RouteResult> {
    assertValidPoints(input.depot, input.orderedStops);
    if (input.orderedStops.length === 0) return emptyRoute(input.depot, false);
    const signal = AbortSignal.timeout(this.timeoutMs);
    const points = [input.depot, ...input.orderedStops, input.depot];

    // Pieces share their boundary point, so legs and line join without a gap.
    const chunks: LatLng[][] = [];
    for (let start = 0; start < points.length - 1;) {
      const end = Math.min(start + MAX_GOOGLE_INTERMEDIATES + 1, points.length - 1);
      chunks.push(points.slice(start, end + 1));
      start = end;
    }
    const answers = await Promise.all(chunks.map((chunk) => this.computeRoute(chunk, signal)));

    const legs: RouteLeg[] = [];
    const coordinates: [number, number][] = [];
    answers.forEach((answer, index) => {
      legs.push(...answer.legs);
      coordinates.push(...(index === 0 ? answer.coordinates : answer.coordinates.slice(1)));
    });
    return {
      legs,
      geometry: { type: "LineString", coordinates },
      totalDistanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
      totalDurationS: legs.reduce((sum, leg) => sum + leg.durationS, 0),
      approximate: false,
    };
  }

  private async computeRoute(chunk: LatLng[], signal: AbortSignal) {
    const waypoints = chunk.map((p) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    }));
    const body = await this.post(
      {
        origin: waypoints[0],
        destination: waypoints.at(-1),
        intermediates: waypoints.slice(1, -1),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        polylineEncoding: "GEO_JSON_LINESTRING",
        polylineQuality: "OVERVIEW",
      },
      signal,
    );
    const mapped = mapComputeRoutesResponse(body, chunk.length);
    // Google sends no usable line for a piece of length 0 (every order at one door): draw through
    // the points, so the pieces still join.
    return mapped.coordinates.length >= 2
      ? mapped
      : { ...mapped, coordinates: chunk.map((p): [number, number] => [p.lng, p.lat]) };
  }

  private async post(payload: unknown, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(GOOGLE_ROUTES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.options.apiKey,
          "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      // Fixed texts: the original error can carry the request, and the request carries the key.
      throw isTimeout(error)
        ? new RoutingError("Routing service timed out", "TIMEOUT")
        : new RoutingError("Routing service is unreachable", "NETWORK");
    }
    if (!response.ok) {
      // Only the status: the `error.message` of the body may quote the key.
      throw new RoutingError(
        `Routing service answered HTTP ${response.status}`,
        "HTTP",
        response.status,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw isTimeout(error)
        ? new RoutingError("Routing service timed out", "TIMEOUT")
        : new RoutingError("Response was not JSON", "BAD_RESPONSE");
    }
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
