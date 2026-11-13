# Google Maps for Geocoding and Routes (NUD-203) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With one Google Maps Platform key the app geocodes addresses and computes road routes through Google, so the self-hosted openrouteservice and Photon services on Railway can be removed.

**Architecture:** Two new provider classes behind the existing interfaces: `GoogleGeocoder` (`Geocoder`) and `GoogleRoutingProvider` (`route()` only). `GOOGLE_MAPS_SERVER_KEY` selects both, ahead of the ORS / Photon variables. The visiting order stays with the local heuristic (`HeuristicOrderRoutingProvider`), Google delivers legs and the route line; `FallbackRoutingProvider` still degrades to the estimate. The map stays Leaflet. All calls are made by the server; the key never reaches the browser.

**Tech Stack:** Geocoding API (`GET https://maps.googleapis.com/maps/api/geocode/json`), Routes API (`POST https://routes.googleapis.com/directions/v2:computeRoutes`), zod, `fetch`.

**Spec:** the owner's decision of 2026-11-13 (project thread; decision log rows of NUD-203) and Google's terms as read that day: price list (2026-11-12), Service Specific Terms (2026-10-28), EEA adjustments for the [Geocoding API](https://developers.google.com/maps/comms/eea/geocoding) and the [Routes API](https://developers.google.com/maps/comms/eea/routes).

## Global Constraints

- The owner's Google billing address is in the EEA, so the EEA terms apply: latitude, longitude and place id of a geocoding hit and the route line may be shown on the existing (non-Google) map. **Not** next to a map: Google's address text, and a route's description or steps. So the geocoder never hands Google's `formatted_address` to the UI, and the routes request never asks for steps.
- Billing tier "Essentials" only: at most 10 intermediate waypoints per `computeRoutes` request, `routingPreference: TRAFFIC_UNAWARE`, no `optimizeWaypointOrder`. Longer tours are requested in chunks.
- Route results are not stored in a cache table (Google allows no such cache). Standing tours stay what they are: templates in the app; using one asks Google again.
- The key is a secret: never in a URL that is logged, never in an error message, never in the health report.
- Without `GOOGLE_MAPS_SERVER_KEY` everything behaves as today (ORS / Photon / heuristic / Fake); CI and the e2e suite have no key.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` stay green.

## Review Focus

1. A tour with more than 10 stops: chunks must join without a gap or a doubled point, and the legs must still be `stops + 1`. Test in Task 2.
2. Google answers HTTP 200 with `status: "OVER_QUERY_LIMIT"` or `"REQUEST_DENIED"` (key not allowed for the API): that is a failure, not "no result". Test in Task 1.
3. A leg of length 0 (two orders at the same door): the Routes API omits `distanceMeters` for zero. Test in Task 2.
4. The key in a log line or error text after a failed request. Test in Tasks 1 and 2.
5. Both `GOOGLE_MAPS_SERVER_KEY` and the old `ORS_BASE_URL` / `PHOTON_URL` set (the state on Railway during the switch): Google must win, and `/api/health` must say `google`. Test in Task 3.

---

### Task 1: `GoogleGeocoder`

**Files:** Create `src/server/geocoder/google.ts`, `src/server/geocoder/google.test.ts`.

**Interfaces:**

- Produces: `class GoogleGeocoder implements Geocoder` with `new GoogleGeocoder({ apiKey, language?, region?, timeoutMs?, retries?, maxResults?, fetch? })`; `mapGoogleGeocodeResponse(body: unknown, query: string): GeocodeCandidate[]`.
- `label` is the query the user typed (numbered ` (2)`, ` (3)` from the second hit on), never `formatted_address`. `confidence`: `ROOFTOP` 1, `RANGE_INTERPOLATED` 0.8, `GEOMETRIC_CENTER` 0.6, `APPROXIMATE` 0.4; a `partial_match` is capped at 0.4.
- `reverse()` returns `null` without a request (the app does not use it, and the answer would be address text).

- [x] Tests first: mapping (two hits, labels, confidences, partial match), `ZERO_RESULTS` -> `[]`, `OVER_QUERY_LIMIT` / `REQUEST_DENIED` / `INVALID_REQUEST` -> `GeocoderError("HTTP")` without the key in the message, HTTP 500 retried once, timeout -> `TIMEOUT`, request carries `address`, `language=de`, `region=at`, the key only as query parameter, blank address -> `[]` without a request, too long -> `INVALID_INPUT`.
- [x] Implement, run `pnpm vitest run src/server/geocoder`, commit.

### Task 2: `GoogleRoutingProvider`

**Files:** Create `src/server/routing/google.ts`, `src/server/routing/google.test.ts`.

**Interfaces:**

- Produces: `class GoogleRoutingProvider implements Pick<RoutingProvider, "route">` with `new GoogleRoutingProvider({ apiKey, timeoutMs?, fetch? })` (no language or region: without steps and with coordinates as waypoints neither changes the answer); `MAX_GOOGLE_INTERMEDIATES = 10`; `mapComputeRoutesResponse(body: unknown, points: number): { legs: RouteLeg[]; coordinates: [number, number][] }`.
- Request per chunk: `origin`, `destination`, `intermediates` as `{ location: { latLng: { latitude, longitude } } }`, `travelMode: "DRIVE"`, `routingPreference: "TRAFFIC_UNAWARE"`, `polylineEncoding: "GEO_JSON_LINESTRING"`, `polylineQuality: "OVERVIEW"`; headers `X-Goog-Api-Key`, `X-Goog-FieldMask: routes.legs.distanceMeters,routes.legs.duration,routes.polyline.geoJsonLinestring`.

- [x] Tests first: 2 stops -> one request, 3 legs, totals, `approximate: false`; 25 stops -> three requests (12 + 12 + 5 points), 26 legs, geometry joined without a doubled point; leg without `distanceMeters` -> 0; `duration: "123.4s"` -> 123; no route -> `NO_ROUTE`; HTTP 403 -> `HTTP` without the key; timeout -> `TIMEOUT`; no stops -> empty route without a request; no `steps` in the field mask.
- [x] Implement, run `pnpm vitest run src/server/routing`, commit.

### Task 3: Provider selection, health, deploy check

**Files:** Modify `src/server/routing/index.ts`, `src/server/geocoder/index.ts`, `src/server/health.ts`, `scripts/lib/deploy-env.ts` (+ their tests).

- [x] `getRoutingProvider`: key set -> `Fallback(HeuristicOrder(google, heuristic), heuristic)`; `getGeocoder`: key set -> `CachingGeocoder(GoogleGeocoder)`. Google before ORS / Photon. `GOOGLE_MAPS_LANGUAGE` (default `de`), `GOOGLE_MAPS_REGION` (default `at`).
- [x] `ProviderMode` gains `"google"`; `/api/health` reports it for routing and geocoding.
- [x] Tests: precedence with the old variables still set, health, both singletons.

### Task 4: Attribution, documentation, Railway

**Files:** Modify `src/lib/map-config.ts` (+ test), `docs/env.md`, `.env.example`, `docs/deploy-railway.md`, `AGENTS.md`, `backlog.md`.

- [x] With the key set the map attribution ends with "Routing & Geocoding: Google Maps" (Google asks that its content is recognisable as such).
- [x] Docs: variables, the terms summary above, costs, how to create and restrict the key, known limits (stored tours and customer pins).
- [x] The owner entered the key on Railway (2026-11-13); `/api/health` shows `google`.
- [x] `pnpm maps:check` (`scripts/check-google-maps.ts`, `scripts/lib/maps-check.ts`): one fixed address, one fixed route, `ok` / `FAIL` lines without the key; last pre-deploy step of `app` with `--warn-only`.
- [x] The deploy log shows both checks as `ok` (2026-11-13 17:06 UTC); `deploy/railway/ors` and `deploy/railway/photon` are deleted with their documentation.
- [x] Owner, in the Railway dashboard: remove `ors`, `photon`, their volumes and `ORS_BASE_URL` / `PHOTON_URL` / `PHOTON_LANG` (done 2026-11-13).
