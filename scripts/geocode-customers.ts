/**
 * Adresspunkte for active customers that have none (NUD-157): `tsx scripts/geocode-customers.ts
 * [--apply] [--limit N] [--batch N]`.
 *
 * ONE self-contained file on purpose (like `scripts/import-day-orders.ts`): copy it to the server
 * with a single `scp` and run it there without a rebuild — it imports only modules that are
 * already deployed. It reads the environment (`set -a && . /etc/delivery-app.env && set +a`) and
 * needs no `.env`. **Dry run by default.**
 *
 * The geocoder is whatever the environment selects (`PHOTON_URL` for the self-hosted Photon,
 * `ORS_API_KEY` for the hosted API, otherwise the Fake — which invents coordinates, so the script
 * refuses to run against it in `--apply` mode).
 *
 * Exit codes: 0 = done (or nothing to do), 1 = usage / setup problem, 2 = refused (Fake geocoder),
 * 3 = the run stopped early (rate limit / provider unavailable).
 */
import { addressQuery } from "../src/domain/customer";
import { GEOCODE_BATCH_SIZE } from "../src/domain/customer-import";
import { geocodeCustomers, listCustomerIdsWithoutPin } from "../src/server/customer-pins";
import { createPrismaClient } from "../src/server/db";
import { getGeocoder, MAX_ADDRESS_LENGTH } from "../src/server/geocoder";
import { type Geocoder, GeocoderError } from "../src/server/geocoder/types";
import { createThrottle } from "../src/server/throttle";

const LOW_CONFIDENCE = 0.5;

type Options = { apply: boolean; limit: number; batch: number };

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    apply: false,
    limit: Number.MAX_SAFE_INTEGER,
    batch: GEOCODE_BATCH_SIZE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else if (arg === "--batch") options.batch = Number(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1)
    throw new Error("--limit must be a positive number");
  if (!Number.isInteger(options.batch) || options.batch < 1 || options.batch > GEOCODE_BATCH_SIZE) {
    throw new Error(`--batch must be between 1 and ${GEOCODE_BATCH_SIZE}`);
  }
  return options;
}

/** Which geocoder the environment selects; the Fake must never write coordinates. */
function providerLabel(
  env: Record<string, string | undefined>,
): "google" | "self-hosted" | "hosted" | "fake" {
  if (env.GOOGLE_MAPS_SERVER_KEY?.trim()) return "google";
  if (env.PHOTON_URL?.trim()) return "self-hosted";
  if (env.ORS_API_KEY?.trim()) return "hosted";
  return "fake";
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `usage: tsx scripts/geocode-customers.ts [--apply] [--limit N] [--batch N]\n${(error as Error).message}`,
    );
    return 1;
  }

  const provider = providerLabel(process.env);
  if (options.apply && provider === "fake") {
    console.error(
      "[geocode] refusing to write: neither PHOTON_URL nor ORS_API_KEY is set, the FakeGeocoder invents coordinates",
    );
    return 2;
  }

  const db = createPrismaClient();
  try {
    const ids = (await listCustomerIdsWithoutPin(db)).slice(0, options.limit);
    console.info(
      `[geocode] provider ${provider}, ${ids.length} active customer(s) without an Adresspunkt, ` +
        `batch ${options.batch}, ${options.apply ? "APPLY" : "dry run"}`,
    );
    if (ids.length === 0) {
      console.info("[geocode] nothing to do");
      return 0;
    }
    if (!options.apply) return await dryRun(db, getGeocoder(), ids, options.batch);

    const wait = createThrottle(provider === "hosted" ? 700 : 0);
    let stopped: "rate_limited" | "unavailable" | null = null;
    const totals = { found: 0, not_found: 0, failed: 0, skipped: 0, lowConfidence: 0 };
    for (let offset = 0; offset < ids.length; offset += options.batch) {
      const batch = ids.slice(offset, offset + options.batch);
      const result = await geocodeCustomers(db, getGeocoder(), batch, { wait });
      if (!result.ok) return 1;
      for (const outcome of result.outcomes) {
        totals[outcome.status] += 1;
        if (outcome.status === "found" && outcome.lowConfidence) totals.lowConfidence += 1;
      }
      console.info(
        `[geocode] ${Math.min(offset + options.batch, ids.length)}/${ids.length} ` +
          `(found ${totals.found}, not found ${totals.not_found}, failed ${totals.failed}, low confidence ${totals.lowConfidence})`,
      );
      stopped = result.stopped;
      if (stopped) break;
    }
    console.info(
      `[geocode] done: found ${totals.found}, not found ${totals.not_found}, failed ${totals.failed}, ` +
        `skipped ${totals.skipped}, low confidence ${totals.lowConfidence}${stopped ? `, stopped (${stopped})` : ""}`,
    );
    return stopped ? 3 : 0;
  } finally {
    await db.$disconnect();
  }
}

/** Reads the address and asks the geocoder without writing anything. */
async function dryRun(
  db: ReturnType<typeof createPrismaClient>,
  geocoder: Geocoder,
  ids: readonly string[],
  batch: number,
): Promise<number> {
  const rows = await db.customer.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { customerNumber: "asc" },
    select: {
      id: true,
      customerNumber: true,
      name: true,
      street: true,
      postalCode: true,
      city: true,
      country: true,
    },
  });
  let found = 0;
  let missed = 0;
  let failed = 0;
  let low = 0;
  let i = 0;
  for (const customer of rows) {
    i += 1;
    try {
      const hits = await geocoder.search(addressQuery(customer, MAX_ADDRESS_LENGTH));
      const best = hits[0];
      if (!best) {
        missed += 1;
        console.info(
          `[geocode] ${customer.customerNumber} ${customer.name}: NO HIT (${customer.street}, ${customer.postalCode} ${customer.city})`,
        );
      } else {
        found += 1;
        const unsure = best.confidence < LOW_CONFIDENCE;
        if (unsure) low += 1;
        console.info(
          `[geocode] ${customer.customerNumber} ${customer.name}: ${best.lat.toFixed(5)},${best.lng.toFixed(5)} ` +
            `conf ${best.confidence.toFixed(2)}${unsure ? " (LOW)" : ""} <- ${best.label}`,
        );
      }
    } catch (error) {
      if (!(error instanceof GeocoderError)) throw error;
      failed += 1;
      console.info(
        `[geocode] ${customer.customerNumber} ${customer.name}: FAILED ${error.code} ${error.status ?? ""}`,
      );
    }
    if (i % batch === 0) console.info(`[geocode] ${i}/${rows.length} checked`);
  }
  console.info(
    `[geocode] dry run: ${found} hit(s), ${missed} without a hit, ${failed} failed, ${low} low confidence (nothing written)`,
  );
  return failed > 0 ? 3 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("[geocode] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
