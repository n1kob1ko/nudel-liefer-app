import { FallbackRoutingProvider } from "./fallback";
import { GoogleRoutingProvider } from "./google";
import { LocalHeuristicProvider } from "./heuristic";
import { HeuristicOrderRoutingProvider } from "./heuristic-order";
import { DEFAULT_PROFILE, ORS_PROFILES, type OrsProfile, OrsRoutingProvider } from "./ors";
import type { RoutingProvider } from "./types";

export { FallbackRoutingProvider } from "./fallback";
export { GoogleRoutingProvider, mapComputeRoutesResponse } from "./google";
export { LocalHeuristicProvider } from "./heuristic";
export { HeuristicOrderRoutingProvider } from "./heuristic-order";
export {
  mapDirectionsResponse,
  mapFleetResponse,
  mapOptimizationResponse,
  OrsRoutingProvider,
} from "./ors";
export * from "./types";

let instance: RoutingProvider | undefined;
let warned = false;

/** `ORS_ROUTING_PROFILE`: `driving-car` (default) or `driving-hgv`; anything else falls back to the default. */
export function parseProfile(value: string | undefined): OrsProfile {
  const profile = value?.trim();
  if (!profile) return DEFAULT_PROFILE;
  if ((ORS_PROFILES as readonly string[]).includes(profile)) return profile as OrsProfile;
  console.warn(`[routing] unknown ORS_ROUTING_PROFILE "${profile}" - using ${DEFAULT_PROFILE}`);
  return DEFAULT_PROFILE;
}

/** Same trimming rule as the geocoder's `parseBaseUrl` (which reads its own variable, NUD-156). */
export function parseBaseUrl(value: string | undefined): string | undefined {
  const baseUrl = value?.trim().replace(/\/+$/, "");
  return baseUrl ? baseUrl : undefined;
}

/**
 * Routing provider selected from the environment.
 *
 * `GOOGLE_MAPS_SERVER_KEY` (NUD-203) comes first and wins over every ORS variable: the visiting
 * order from the local heuristic, the legs and the road line from Google's Routes API
 * (`GoogleRoutingProvider`), composed like a self-hosted ORS below. `distribute()` stays the
 * heuristic's. When Google fails, `FallbackRoutingProvider` answers with the estimate.
 *
 * Without that key: ORS with automatic fallback to the local
 * heuristic when either `ORS_API_KEY` (hosted API) or `ORS_BASE_URL` (self-hosted instance,
 * NUD-156 — it needs no key) is set, otherwise the heuristic alone and a single warning.
 * `ORS_BASE_URL` points the routing/optimization calls at a self-hosted openrouteservice; unset
 * keeps the public API.
 *
 * With a **self-hosted** instance (`ORS_BASE_URL`) the tour is planned by
 * `HeuristicOrderRoutingProvider`: the visiting order from the local heuristic, the legs and the
 * road geometry from ORS `/v2/directions` — so `approximate: false` and a real route on the map,
 * which the self-hosted instance can deliver although it has no `/optimization` (VROOM). The
 * **hosted** API (a key, no base URL) keeps its VROOM ordering and gets the plain provider. When
 * ORS fails, `FallbackRoutingProvider` answers with the pure heuristic result (`approximate: true`,
 * straight lines); without a remote provider the heuristic alone answers, also `approximate: true`.
 * Geocoding has its own variable (`PHOTON_URL` / `ORS_GEOCODE_BASE_URL`), because the self-hosted
 * image does not serve `/geocode/*` at all.
 */
export function getRoutingProvider(
  env: Record<string, string | undefined> = process.env,
): RoutingProvider {
  if (instance) return instance;
  const googleKey = env.GOOGLE_MAPS_SERVER_KEY?.trim();
  const apiKey = env.ORS_API_KEY?.trim() ?? "";
  const baseUrl = parseBaseUrl(env.ORS_BASE_URL);
  const heuristic = new LocalHeuristicProvider();
  if (googleKey) {
    instance = new FallbackRoutingProvider(
      new HeuristicOrderRoutingProvider(
        new GoogleRoutingProvider({ apiKey: googleKey }),
        heuristic,
      ),
      heuristic,
    );
  } else if (apiKey || baseUrl) {
    const ors = new OrsRoutingProvider({
      apiKey,
      baseUrl,
      profile: parseProfile(env.ORS_ROUTING_PROFILE),
    });
    // The hosted API still has `/optimization` (VROOM), so only a self-hosted instance — which
    // serves directions/matrix but no optimization — is composed with the heuristic order.
    instance = new FallbackRoutingProvider(
      baseUrl ? new HeuristicOrderRoutingProvider(ors, heuristic) : ors,
      heuristic,
    );
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[routing] none of GOOGLE_MAPS_SERVER_KEY, ORS_API_KEY, ORS_BASE_URL is set - using the local heuristic (distances and times are estimates, approximate)",
      );
    }
    instance = heuristic;
  }
  return instance;
}

/** Test helper. */
export function setRoutingProviderForTests(provider: RoutingProvider | undefined) {
  instance = provider;
  if (!provider) warned = false;
}
