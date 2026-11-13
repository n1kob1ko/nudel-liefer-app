import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assembleDraft,
  type CatalogProduct,
  type OrderDraft,
} from "@/domain/order-extraction";
import { createLocalizedText } from "@/lib/localized-text";
import { FakeOrderExtractor, getOrderExtractor } from "@/server/order-extractor";
import { CATALOG_PRODUCTS } from "@/server/product-catalog";

/**
 * Evaluation of the AI order draft (NUD-150 acceptance criterion): runs every anonymised sample
 * message of `tests/fixtures/order-extraction/samples.json` through the configured extractor and
 * reports the line accuracy (does the draft contain exactly the products and quantities the office
 * would have typed?).
 *
 *   pnpm eval:order-extraction                 # configured provider (Claude when ANTHROPIC_API_KEY is set)
 *   pnpm eval:order-extraction -- --fake       # offline stand-in, no key and no cost
 *   pnpm eval:order-extraction -- --min 0.8    # exit 1 when the accuracy is below 80 %
 *
 * `--today YYYY-MM-DD` freezes the reference day (relative days like "morgen" are resolved against
 * the factory time zone otherwise).
 */

const FIXTURE = path.join("tests", "fixtures", "order-extraction", "samples.json");

/** SKU -> the id the extractor's answer is mapped to (the catalog's real ids come from the DB). */
const PRODUCT_IDS: Record<string, string> = {
  "NUDELN-BEUTEL": "pack",
  "NUDELN-KARTON": "crate",
  "WANTAN-TEIG": "wantan",
};

export const EVAL_CATALOG: CatalogProduct[] = CATALOG_PRODUCTS.map((product) => ({
  id: PRODUCT_IDS[product.sku] ?? product.sku,
  name: createLocalizedText(
    { de: product.de, en: product.en, "sr-Latn": product.sr, cs: product.cs, "zh-Hans": product.hans },
    "de",
  ),
  unit: product.unit as CatalogProduct["unit"],
}));

export type EvalSample = {
  id: string;
  locale: "de" | "zh-Hans";
  text: string;
  lines: { productId: string; quantity: number }[];
  windowFromOffsetDays: number | null;
  windowFromTime?: string;
  windowToTime?: string;
};

export function loadSamples(file: string = FIXTURE): EvalSample[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { samples: EvalSample[] };
  return parsed.samples;
}

/** Today in the factory time zone as `YYYY-MM-DD` (the app's default zone, `Settings.timezone`). */
export function todayInVienna(now: Date = new Date(), timeZone = "Europe/Vienna"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .replaceAll("/", "-");
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** A draft line multiset as a comparable string, e.g. `crate x2, pack x5`. */
export function lineKey(lines: readonly { productId: string; quantity: string | number }[]): string {
  return [...lines]
    .map((line) => `${line.productId} x${line.quantity}`)
    .sort()
    .join(", ");
}

export type SampleResult = {
  id: string;
  locale: string;
  exact: boolean;
  expected: string;
  actual: string;
  windowOk: boolean | null;
  draft: OrderDraft;
};

/**
 * Runs the extractor over all samples. `windowOk` is `null` when the sample asks for no window,
 * otherwise it only checks the day (times are best-effort and reported separately).
 */
export async function evaluateSamples(
  samples: readonly EvalSample[],
  options: {
    extractor?: ReturnType<typeof getOrderExtractor>;
    today: string;
    timezone?: string;
  },
): Promise<SampleResult[]> {
  const extractor = options.extractor ?? getOrderExtractor();
  const results: SampleResult[] = [];
  for (const sample of samples) {
    const { answer } = await extractor.extract(
      { text: sample.text },
      { catalog: EVAL_CATALOG, today: options.today, timezone: options.timezone ?? "Europe/Vienna" },
    );
    const draft = assembleDraft(answer, EVAL_CATALOG);
    const expectedKey = lineKey(sample.lines);
    const actualKey = lineKey(draft.lines);
    const expectedWindow =
      sample.windowFromOffsetDays === null
        ? null
        : addDays(options.today, sample.windowFromOffsetDays);
    results.push({
      id: sample.id,
      locale: sample.locale,
      exact: expectedKey === actualKey,
      expected: expectedKey,
      actual: actualKey,
      windowOk: expectedWindow === null ? null : draft.window?.from === expectedWindow,
      draft,
    });
  }
  return results;
}

function parseArgs(argv: readonly string[]): { fake: boolean; min: number; today?: string } {
  const args = { fake: false, min: 0, today: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fake") args.fake = true;
    else if (arg === "--min") args.min = Number(argv[++i] ?? "0");
    else if (arg === "--today") args.today = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const samples = loadSamples();
  const today = args.today ?? todayInVienna();
  const extractor = args.fake ? new FakeOrderExtractor() : getOrderExtractor();
  const results = await evaluateSamples(samples, { extractor, today });

  const exact = results.filter((r) => r.exact).length;
  const windowCases = results.filter((r) => r.windowOk !== null);
  const windows = windowCases.filter((r) => r.windowOk).length;
  console.log(`provider: ${extractor.kind} · today ${today}`);
  for (const result of results) {
    const mark = result.exact ? "ok  " : "MISS";
    const window = result.windowOk === null ? "" : result.windowOk ? " · window ok" : " · window MISS";
    console.log(`${mark} ${result.id} (${result.locale})${window}`);
    if (!result.exact) {
      console.log(`      expected: ${result.expected}`);
      console.log(`      actual:   ${result.actual || "(nothing)"}`);
    }
  }
  const accuracy = results.length === 0 ? 0 : exact / results.length;
  console.log(
    `\nline accuracy: ${exact}/${results.length} = ${(accuracy * 100).toFixed(1)} %` +
      (windowCases.length > 0 ? ` · window day: ${windows}/${windowCases.length}` : ""),
  );
  if (accuracy < args.min) {
    console.error(`\nFAIL: ${(accuracy * 100).toFixed(1)} % is below the required ${(args.min * 100).toFixed(1)} %`);
    process.exitCode = 1;
  }
}

// Only run when executed directly (the eval test imports `evaluateSamples`). No top-level await:
// tsx compiles this file to CommonJS (package.json has no "type": "module").
if (process.argv[1]?.includes("order-extractor-eval")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
