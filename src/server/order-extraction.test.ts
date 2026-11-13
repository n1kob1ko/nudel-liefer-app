import { describe, expect, it, vi } from "vitest";

import { createLocalizedText } from "@/lib/localized-text";

import { extractOrderDraft } from "./order-extraction";
import {
  FakeOrderExtractor,
  type OrderExtractionContext,
  type OrderExtractionInput,
  type OrderExtractor,
  OrderExtractorError,
} from "./order-extractor";

/** The catalog rows `getActiveProducts` reads; only these fields are used here. */
const rows = [
  {
    id: "crate",
    sku: "NUDELN-KARTON",
    unit: "CRATE",
    weightKgPerUnit: { toString: () => "10" },
    active: true,
    sortOrder: 1,
    name: createLocalizedText({ de: "Nudeln", "zh-Hans": "面条" }, "de"),
  },
  {
    id: "pack",
    sku: "NUDELN-BEUTEL",
    unit: "PACK",
    weightKgPerUnit: { toString: () => "3" },
    active: true,
    sortOrder: 2,
    name: createLocalizedText({ de: "Nudeln", "zh-Hans": "面条" }, "de"),
  },
];

const db = { product: { findMany: async () => rows } } as never;

const deps = (overrides: Partial<Parameters<typeof extractOrderDraft>[2]> = {}) => ({
  storage: { head: async () => ({ bytes: 1024, contentType: "image/jpeg" }), getReadUrl: async () => "https://storage.test/shot.jpg" },
  extractor: new FakeOrderExtractor() as OrderExtractor,
  today: "2026-10-28",
  timezone: "Europe/Vienna",
  fetch: (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch,
  ...overrides,
});

describe("extractOrderDraft (NUD-150)", () => {
  it("returns a draft from a pasted message without touching the database", async () => {
    const result = await extractOrderDraft(db, { text: "2 Karton Nudeln, morgen" }, deps());
    if (!result.ok) throw new Error(result.error);
    expect(result.draft.lines).toEqual([
      { productId: "crate", quantity: "2", confidence: 0.9, label: "Nudeln Kiste" },
    ]);
    expect(result.extraction.lines).toHaveLength(1);
    expect(result.model).toBe("fake");
  });

  it("passes the screenshot bytes to the extractor", async () => {
    const extract = vi.fn(
      async (input: OrderExtractionInput, context: OrderExtractionContext) => {
        void input;
        return new FakeOrderExtractor().extract({ text: "1 Kiste" }, context);
      },
    );
    const result = await extractOrderDraft(
      db,
      { text: "1 Kiste", screenshotKey: "screenshots/abc.jpg" },
      deps({ extractor: { kind: "fake", extract } as unknown as OrderExtractor }),
    );
    expect(result.ok).toBe(true);
    const input = extract.mock.calls[0]![0];
    expect(input.text).toBe("1 Kiste");
    expect(input.image?.bytes.byteLength).toBeGreaterThan(0);
    expect(input.image?.contentType).toBe("image/jpeg");
  });

  it("refuses an unusable screenshot instead of calling the model", async () => {
    const extract = vi.fn();
    const result = await extractOrderDraft(
      db,
      { screenshotKey: "screenshots/gone.jpg" },
      deps({
        storage: { head: async () => null, getReadUrl: async () => "https://storage.test/x" },
        extractor: { kind: "fake", extract } as unknown as OrderExtractor,
      }),
    );
    expect(result).toEqual({ ok: false, error: "screenshot_unavailable" });
    expect(extract).not.toHaveBeenCalled();
  });

  it("refuses an empty request and never reaches the model", async () => {
    const extract = vi.fn();
    const result = await extractOrderDraft(
      db,
      { text: "   " },
      deps({ extractor: { kind: "fake", extract } as unknown as OrderExtractor }),
    );
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(extract).not.toHaveBeenCalled();
  });

  it("reports a missing key as not_configured", async () => {
    const extractor = {
      kind: "fake",
      extract: async () => {
        throw new OrderExtractorError("no key", "NOT_CONFIGURED");
      },
    } as unknown as OrderExtractor;
    const result = await extractOrderDraft(db, { text: "2 Kiste" }, deps({ extractor }));
    expect(result).toEqual({ ok: false, error: "not_configured" });
  });

  it("reports any other provider failure as extraction_failed", async () => {
    const extractor = {
      kind: "claude",
      extract: async () => {
        throw new OrderExtractorError("boom", "HTTP");
      },
    } as unknown as OrderExtractor;
    const result = await extractOrderDraft(db, { text: "2 Kiste" }, deps({ extractor }));
    expect(result).toEqual({ ok: false, error: "extraction_failed" });
  });
});
