// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleGeocoder, mapGoogleGeocodeResponse } from "./google";
import { getGeocoder, setGeocoderForTests } from "./index";
import { type Geocoder, GeocoderError } from "./types";

const KEY = "AIza-test-key-0123456789";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// HAND-WRITTEN from the documented Geocoding API response shape, not recorded live.
const hit = (
  lat: number,
  lng: number,
  locationType: string,
  extra: Record<string, unknown> = {},
) => ({
  formatted_address: "Stephansplatz 1, 1010 Wien, Österreich",
  geometry: { location: { lat, lng }, location_type: locationType },
  place_id: "ChIJ-test",
  types: ["street_address"],
  ...extra,
});

const ok = (...results: unknown[]) => ({ status: "OK", results });

const expectedFailure = (): GeocoderError => {
  throw new Error("expected the call to fail");
};

describe("mapGoogleGeocodeResponse", () => {
  it("maps hits to candidates, best first, with the typed address as the label", () => {
    const candidates = mapGoogleGeocodeResponse(
      ok(hit(48.2084, 16.3731, "ROOFTOP"), hit(48.21, 16.37, "GEOMETRIC_CENTER")),
      "Stephansplatz 1, Wien",
    );
    expect(candidates).toEqual([
      { label: "Stephansplatz 1, Wien", lat: 48.2084, lng: 16.3731, confidence: 1 },
      { label: "Stephansplatz 1, Wien (2)", lat: 48.21, lng: 16.37, confidence: 0.6 },
    ]);
  });

  it("never hands Google's address text to the caller (EEA terms: not next to a map)", () => {
    const [candidate] = mapGoogleGeocodeResponse(ok(hit(48.2, 16.3, "ROOFTOP")), "meine eingabe");
    expect(JSON.stringify(candidate)).not.toContain("Österreich");
    expect(candidate!.label).toBe("meine eingabe");
  });

  it("maps the precision of a hit to a confidence; a partial match is never more than a guess", () => {
    const confidence = (type: string, extra = {}) =>
      mapGoogleGeocodeResponse(ok(hit(48, 16, type, extra)), "q")[0]!.confidence;
    expect(confidence("ROOFTOP")).toBe(1);
    expect(confidence("RANGE_INTERPOLATED")).toBe(0.8);
    expect(confidence("GEOMETRIC_CENTER")).toBe(0.6);
    expect(confidence("APPROXIMATE")).toBe(0.4);
    expect(confidence("SOMETHING_NEW")).toBe(0.4);
    expect(confidence("ROOFTOP", { partial_match: true })).toBe(0.4);
  });

  it("nothing found is an empty list, not an error", () => {
    expect(mapGoogleGeocodeResponse({ status: "ZERO_RESULTS", results: [] }, "q")).toEqual([]);
  });

  it.each([
    "OVER_QUERY_LIMIT",
    "OVER_DAILY_LIMIT",
    "REQUEST_DENIED",
    "INVALID_REQUEST",
    "UNKNOWN_ERROR",
  ])("status %s is a failure although the HTTP status is 200", (status) => {
    const body = { status, results: [], error_message: `The provided API key ${KEY} is invalid.` };
    let thrown: unknown;
    try {
      mapGoogleGeocodeResponse(body, "q");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GeocoderError);
    expect((thrown as GeocoderError).code).toBe("HTTP");
    expect((thrown as GeocoderError).message).toContain(status);
    // Google's own error text can quote the key; it must not travel into logs.
    expect((thrown as GeocoderError).message).not.toContain(KEY);
  });

  it("rejects an answer of another shape", () => {
    expect(() => mapGoogleGeocodeResponse({ results: "nope" }, "q")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
    expect(() =>
      mapGoogleGeocodeResponse(ok({ geometry: { location: { lat: "x", lng: 1 } } }), "q"),
    ).toThrow(expect.objectContaining({ code: "BAD_RESPONSE" }));
  });

  it("leaves out a hit whose coordinates are not on the globe", () => {
    expect(
      mapGoogleGeocodeResponse(ok(hit(120, 16, "ROOFTOP"), hit(48, 16, "ROOFTOP")), "q"),
    ).toEqual([{ label: "q", lat: 48, lng: 16, confidence: 1 }]);
  });
});

describe("GoogleGeocoder.search", () => {
  it("asks the Geocoding API with the address, the language and the region", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(ok(hit(48.2, 16.37, "ROOFTOP"))),
    );
    const geocoder = new GoogleGeocoder({ apiKey: KEY, fetch: fetchMock });

    const result = await geocoder.search("  Stephansplatz 1,   1010 Wien ");

    expect(result).toEqual([
      { label: "Stephansplatz 1, 1010 Wien", lat: 48.2, lng: 16.37, confidence: 1 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://maps.googleapis.com/maps/api/geocode/json",
    );
    expect(url.searchParams.get("address")).toBe("Stephansplatz 1, 1010 Wien");
    expect(url.searchParams.get("language")).toBe("de");
    expect(url.searchParams.get("region")).toBe("at");
    expect(url.searchParams.get("key")).toBe(KEY);
  });

  it("uses the configured language and region", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(ok()));
    await new GoogleGeocoder({
      apiKey: KEY,
      language: "en",
      region: "de",
      fetch: fetchMock,
    }).search("x");
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.get("region")).toBe("de");
  });

  it("returns at most five candidates", async () => {
    const many = Array.from({ length: 8 }, (_, i) => hit(48 + i / 100, 16, "ROOFTOP"));
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(ok(...many)));
    expect(await new GoogleGeocoder({ apiKey: KEY, fetch: fetchMock }).search("x")).toHaveLength(5);
  });

  it("does not ask for a blank address and refuses one that is too long", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(ok()));
    const geocoder = new GoogleGeocoder({ apiKey: KEY, fetch: fetchMock });

    expect(await geocoder.search("   ")).toEqual([]);
    await expect(geocoder.search("x".repeat(301))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tries once more after a 500 and then answers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(ok(hit(48, 16, "ROOFTOP"))));
    const result = await new GoogleGeocoder({ apiKey: KEY, fetch: fetchMock }).search("x");
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a request the key is not allowed to make", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}, 403));
    await expect(
      new GoogleGeocoder({ apiKey: KEY, fetch: fetchMock }).search("x"),
    ).rejects.toMatchObject({ code: "HTTP", status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a refusal that comes with HTTP 200", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: "REQUEST_DENIED", results: [], error_message: "API not enabled" }),
    );
    await expect(
      new GoogleGeocoder({ apiKey: KEY, fetch: fetchMock }).search("x"),
    ).rejects.toMatchObject({ code: "HTTP" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout and an unreachable service, never with the key in the text", async () => {
    const timeout = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed: https://maps.googleapis.com/?key=${KEY}`);
    });

    const timedOut = await new GoogleGeocoder({ apiKey: KEY, fetch: timeout, retries: 0 })
      .search("x")
      .then(expectedFailure, (e: unknown) => e as GeocoderError);
    const unreachable = await new GoogleGeocoder({ apiKey: KEY, fetch: offline, retries: 0 })
      .search("x")
      .then(expectedFailure, (e: unknown) => e as GeocoderError);

    expect(timedOut).toMatchObject({ code: "TIMEOUT" });
    expect(unreachable).toMatchObject({ code: "NETWORK" });
    expect(`${timedOut.message}${unreachable.message}`).not.toContain(KEY);
  });

  it("an answer that is not JSON is a bad response", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 }));
    await expect(
      new GoogleGeocoder({ apiKey: KEY, fetch: fetchMock }).search("x"),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("GoogleGeocoder.reverse", () => {
  it("answers null without a request: the app shows no address for a pin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(ok()));
    const geocoder: Geocoder = new GoogleGeocoder({ apiKey: KEY, fetch: fetchMock });
    expect(await geocoder.reverse(48.2, 16.37)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getGeocoder with GOOGLE_MAPS_SERVER_KEY", () => {
  afterEach(() => {
    setGeocoderForTests(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Google wins over Photon and the ORS key, and an address is asked only once", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(ok(hit(48.2, 16.37, "ROOFTOP"))),
    );
    vi.stubGlobal("fetch", fetchMock);

    // The state on Railway during the switch: the key is new, the old variables are still there.
    const geocoder = getGeocoder({
      GOOGLE_MAPS_SERVER_KEY: ` ${KEY} `,
      PHOTON_URL: "http://photon.railway.internal:2322",
      PHOTON_LANG: "de",
      ORS_API_KEY: "old-key",
    });
    const first = await geocoder.search("Stephansplatz 1, Wien");
    const second = await geocoder.search("Stephansplatz 1, Wien");

    expect(first).toEqual([
      { label: "Stephansplatz 1, Wien", lat: 48.2, lng: 16.37, confidence: 1 },
    ]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.hostname).toBe("maps.googleapis.com");
    expect(url.searchParams.get("key")).toBe(KEY);
    expect(url.searchParams.get("language")).toBe("de");
    expect(url.searchParams.get("region")).toBe("at");
  });

  it("GOOGLE_MAPS_LANGUAGE and GOOGLE_MAPS_REGION replace the defaults; blanks do not", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(ok()));
    vi.stubGlobal("fetch", fetchMock);

    await getGeocoder({
      GOOGLE_MAPS_SERVER_KEY: KEY,
      GOOGLE_MAPS_LANGUAGE: " en ",
      GOOGLE_MAPS_REGION: "  ",
    }).search("x");

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.get("region")).toBe("at");
  });

  it("without any provider the warning names the Google variable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getGeocoder({ GOOGLE_MAPS_SERVER_KEY: "  " });
    expect(String(warn.mock.calls[0]![0])).toContain("GOOGLE_MAPS_SERVER_KEY");
  });
});
