import { z } from "zod";

import {
  type GeocodeCandidate,
  type Geocoder,
  GeocoderError,
  MAX_ADDRESS_LENGTH,
  normalizeAddress,
} from "./types";

/**
 * Google Maps Platform **Geocoding API** (NUD-203), selected by `GOOGLE_MAPS_SERVER_KEY`.
 *
 *   GET https://maps.googleapis.com/maps/api/geocode/json?address=..&language=de&region=at&key=..
 *
 * Two things differ from the other geocoders and are deliberate:
 *
 * - The label of a candidate is the address **the user typed**, not Google's `formatted_address`.
 *   The owner's Google account is billed in the EEA, and under Google's EEA terms only latitude,
 *   longitude and place id of a geocoding hit may be shown on or next to a map; the candidates are
 *   listed right beside the pin map. Several hits are numbered, and the pin shows which is which.
 * - `reverse()` asks nothing: its only answer would be address text, and the app does not use it.
 *
 * Google answers HTTP 200 also for a refused request (`status: "REQUEST_DENIED"`, quota used up),
 * so the status inside the body decides. Its `error_message` can quote the key and is never
 * passed on; the key itself is a query parameter, so no URL of this class may reach a log.
 */
export const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
export const GOOGLE_DEFAULT_LANGUAGE = "de";
/** Region bias (ccTLD): "Hauptstraße 1" means the one in Austria first. */
export const GOOGLE_DEFAULT_REGION = "at";

const geocodeResponse = z.object({
  status: z.string(),
  results: z
    .array(
      z.object({
        geometry: z.object({
          location: z.object({ lat: z.number(), lng: z.number() }),
          location_type: z.string().optional(),
        }),
        partial_match: z.boolean().optional(),
      }),
    )
    .default([]),
});

/** How exact Google says the hit is -> confidence (the office warns below 0.5). */
function confidenceFor(locationType: string | undefined, partialMatch: boolean): number {
  const byType =
    locationType === "ROOFTOP"
      ? 1
      : locationType === "RANGE_INTERPOLATED"
        ? 0.8
        : locationType === "GEOMETRIC_CENTER"
          ? 0.6
          : 0.4;
  // Google could not match the whole address (a typo, a house number that does not exist).
  return partialMatch ? Math.min(byType, 0.4) : byType;
}

/** Maps a Geocoding API answer; `query` is what the user typed and becomes the label. */
export function mapGoogleGeocodeResponse(body: unknown, query: string): GeocodeCandidate[] {
  const parsed = geocodeResponse.safeParse(body);
  if (!parsed.success) {
    throw new GeocoderError("Unexpected response from the geocoding service", "BAD_RESPONSE");
  }
  const { status, results } = parsed.data;
  if (status === "ZERO_RESULTS") return [];
  if (status !== "OK") {
    // Only the status code: `error_message` may contain the key.
    throw new GeocoderError(`Geocoding service refused the request (${status})`, "HTTP");
  }
  return results
    .filter(
      ({ geometry: { location } }) => Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180,
    )
    .map((result, index) => ({
      label: index === 0 ? query : `${query} (${index + 1})`,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      confidence: confidenceFor(result.geometry.location_type, result.partial_match === true),
    }));
}

export type GoogleGeocoderOptions = {
  apiKey: string;
  /** Language of Google's matching, `de` by default. */
  language?: string;
  /** Region bias as a ccTLD, `at` by default. */
  region?: string;
  timeoutMs?: number;
  /** Extra attempts after a timeout, network error or 5xx/429. Default 1. */
  retries?: number;
  maxResults?: number;
  fetch?: typeof fetch;
};

export class GoogleGeocoder implements Geocoder {
  private readonly language: string;
  private readonly region: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly maxResults: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: GoogleGeocoderOptions) {
    this.language = options.language ?? GOOGLE_DEFAULT_LANGUAGE;
    this.region = options.region ?? GOOGLE_DEFAULT_REGION;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.retries = options.retries ?? 1;
    this.maxResults = options.maxResults ?? 5;
    this.fetchFn = options.fetch ?? fetch;
  }

  async search(address: string): Promise<GeocodeCandidate[]> {
    const text = address.trim().replace(/\s+/g, " ");
    if (!normalizeAddress(text)) return [];
    if (text.length > MAX_ADDRESS_LENGTH) {
      throw new GeocoderError("Address is too long", "INVALID_INPUT");
    }
    const params = new URLSearchParams({
      address: text,
      language: this.language,
      region: this.region,
      key: this.options.apiKey,
    });
    const body = await this.get(`${GOOGLE_GEOCODE_URL}?${params}`);
    return mapGoogleGeocodeResponse(body, text).slice(0, this.maxResults);
  }

  /** No request: see the class comment. */
  async reverse(): Promise<GeocodeCandidate | null> {
    return null;
  }

  private async get(url: string): Promise<unknown> {
    let lastError: GeocoderError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        // Fixed texts: the original error can carry the URL, and the URL carries the key.
        lastError = timedOut
          ? new GeocoderError("Geocoding service timed out", "TIMEOUT")
          : new GeocoderError("Geocoding service is unreachable", "NETWORK");
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new GeocoderError("Response was not JSON", "BAD_RESPONSE");
        }
      }
      lastError = new GeocoderError(
        `Geocoding service answered HTTP ${response.status}`,
        "HTTP",
        response.status,
      );
      // 4xx (key not allowed, bad request) will not get better by retrying; 429/5xx might.
      if (response.status < 500 && response.status !== 429) throw lastError;
    }
    throw lastError ?? new GeocoderError("Geocoding failed", "NETWORK");
  }
}
