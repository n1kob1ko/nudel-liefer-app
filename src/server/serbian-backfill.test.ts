import { describe, expect, it } from "vitest";

import { createLocalizedText, type LocalizedText } from "@/lib/localized-text";

import { type BackfillDb,backfillSerbian, needsSerbian } from "./serbian-backfill";
import type { Translator } from "./translator/types";

/** A text with a German source and no Serbian value (what the years before NUD-150 produced). */
const withoutSerbian = (de: string): LocalizedText => createLocalizedText({ de }, "de");

/** A text that already has Serbian. */
const withSerbian = (de: string, sr: string): LocalizedText =>
  createLocalizedText({ de, "sr-Latn": sr }, "de");

/** Stub database: one table per source, `updateMany` only writes when the row is still there. */
function fakeDb(rows: Record<"customer" | "stop" | "product", LocalizedText[]>) {
  const updates: string[] = [];
  const table = (name: keyof typeof rows, column: string) => ({
    findMany: async (args: { cursor?: { id: string }; skip?: number; take: number }) => {
      const all = rows[name];
      const start = args.cursor ? all.findIndex((_, index) => `id-${index}` === args.cursor!.id) + 1 : 0;
      return all.length === 0
        ? []
        : all
            .map((value, index) => ({ id: `id-${index}`, [column]: value }))
            .slice(start, start + args.take);
    },
    updateMany: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const index = Number(args.where.id.replace("id-", ""));
      rows[name][index] = args.data[column] as LocalizedText;
      updates.push(`${name}:${column}:${index}`);
      return { count: 1 };
    },
  });
  const db = {
    customer: table("customer", "notes"),
    stop: table("stop", "problemNote"),
    product: table("product", "name"),
  } as unknown as BackfillDb;
  return { db, updates, rows };
}

/** Translator that answers "[sr-Latn] <text>" for the Serbian target only. */
const translator: Translator = {
  kind: "claude",
  translate: async (text, from, to) => (to === "sr-Latn" ? `SR:${text}` : text),
};

describe("needsSerbian", () => {
  it("is true for a text without Serbian and false for a complete one", () => {
    expect(needsSerbian(withoutSerbian("Nudeln"))).toBe(true);
    expect(needsSerbian(withSerbian("Nudeln", "Nudle"))).toBe(false);
  });

  it("is false for an empty text and for a corrupt value", () => {
    expect(needsSerbian(createLocalizedText({}, "de"))).toBe(false);
    expect(needsSerbian({ nonsense: true })).toBe(false);
    expect(needsSerbian(null)).toBe(false);
  });
});

describe("backfillSerbian", () => {
  it("counts in a dry run and writes nothing", async () => {
    const { db, updates } = fakeDb({
      customer: [withoutSerbian("Bitte hinten anliefern"), withSerbian("Nudeln", "Nudle")],
      stop: [withoutSerbian("Niemand da")],
      product: [withSerbian("Nudeln", "Nudle")],
    });
    const report = await backfillSerbian({ db, translator }, { apply: false });
    expect(report.examined).toBe(4);
    expect(report.filled).toBe(2);
    expect(report.skipped).toBe(2);
    expect(updates).toEqual([]);
    expect(report.bySource["customer.notes"]).toEqual({ examined: 2, filled: 1, failed: 0 });
  });

  it("fills exactly the missing Serbian texts on --apply", async () => {
    const { db, updates, rows } = fakeDb({
      customer: [withoutSerbian("Bitte hinten anliefern")],
      stop: [withoutSerbian("Niemand da"), withSerbian("Offen", "Otvoreno")],
      product: [],
    });
    const report = await backfillSerbian({ db, translator }, { apply: true });
    expect(report.filled).toBe(2);
    expect(updates).toEqual(["customer:notes:0", "stop:problemNote:0"]);
    expect(rows.customer[0]!["sr-Latn"]).toBe("SR:Bitte hinten anliefern");
    expect(rows.stop[1]!["sr-Latn"]).toBe("Otvoreno");
  });

  it("counts a text the provider cannot translate as failed and keeps going", async () => {
    const failing: Translator = {
      kind: "claude",
      translate: async () => {
        throw new Error("boom");
      },
    };
    const { db, updates } = fakeDb({
      customer: [withoutSerbian("Text")],
      stop: [withoutSerbian("Auch ein Text")],
      product: [],
    });
    const report = await backfillSerbian({ db, translator: failing }, { apply: true });
    expect(report.failed).toBe(2);
    expect(report.filled).toBe(0);
    expect(updates).toEqual([]);
  });

  it("is idempotent: a second run finds nothing to do", async () => {
    const { db } = fakeDb({ customer: [withoutSerbian("Text")], stop: [], product: [] });
    await backfillSerbian({ db, translator }, { apply: true });
    const second = await backfillSerbian({ db, translator }, { apply: true });
    expect(second.filled).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("pages through more rows than one page holds", async () => {
    const many = Array.from({ length: 5 }, (_, index) => withoutSerbian(`Text ${index}`));
    const { db, updates } = fakeDb({ customer: many, stop: [], product: [] });
    const report = await backfillSerbian({ db, translator, pageSize: 2 }, { apply: true });
    expect(report.filled).toBe(5);
    expect(updates).toHaveLength(5);
  });

  it("refuses nothing itself: the CLI is what stops a fake provider", async () => {
    const fake: Translator = { kind: "fake", translate: async (text) => `[sr-Latn] ${text}` };
    const { db, updates } = fakeDb({ customer: [withoutSerbian("Text")], stop: [], product: [] });
    await backfillSerbian({ db, translator: fake }, { apply: true });
    // The service writes what the provider returns; `scripts/backfill-serbian.ts` exits before this
    // when the configured translator is the FakeTranslator, so no "[sr-Latn] ..." placeholder lands.
    expect(updates).toEqual(["customer:notes:0"]);
  });
});
