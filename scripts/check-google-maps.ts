/**
 * Proves that Google answers with the key the app has (NUD-203): `pnpm maps:check [--warn-only]`.
 *
 * One address search (Geocoding API) and one route (Routes API) with fixed public test data, with
 * the same provider classes the app uses but without the caches and the fallback around them, so a
 * refusal shows instead of being covered by the estimate. Two billed requests per run. The key is
 * read from `GOOGLE_MAPS_SERVER_KEY` and never printed; neither is a text Google sent.
 *
 * Without the key there is nothing to check (the app then uses ORS/Photon or the heuristic).
 *
 * Exit codes: 0 = both answered (or no key), 2 = a check failed (the line says which).
 * `--warn-only` prints the same lines and always exits 0: the pre-deploy step uses it, because the
 * app keeps working on its estimate when Google is down and a deploy should not wait for Google.
 */
import { GoogleGeocoder } from "../src/server/geocoder/google";
import { GoogleRoutingProvider } from "../src/server/routing/google";
import { runMapsCheck } from "./lib/maps-check";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.find((arg) => arg !== "--warn-only");
  if (unknown) {
    console.error(
      `usage: tsx scripts/check-google-maps.ts [--warn-only]\nunknown argument: ${unknown}`,
    );
    return 1;
  }
  const warnOnly = args.includes("--warn-only");
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY?.trim();
  if (!apiKey) {
    console.info("[maps-check] skipped: GOOGLE_MAPS_SERVER_KEY is not set");
    return 0;
  }
  const ok = await runMapsCheck({
    geocoder: new GoogleGeocoder({
      apiKey,
      language: process.env.GOOGLE_MAPS_LANGUAGE?.trim() || undefined,
      region: process.env.GOOGLE_MAPS_REGION?.trim() || undefined,
    }),
    routing: new GoogleRoutingProvider({ apiKey }),
    log: (line) => console.info(line),
  });
  if (!ok && warnOnly) {
    console.info(
      "[maps-check] continuing (--warn-only): the app answers with its estimate meanwhile",
    );
  }
  return ok || warnOnly ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  () => {
    // No text: an unexpected error can carry the request, and the request carries the key.
    console.error("[maps-check] failed unexpectedly");
    process.exit(process.argv.includes("--warn-only") ? 0 : 1);
  },
);
