// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { BillPdfModel } from "@/domain/bill-pdf-layout";

import { renderBillPdf } from "./bill-pdf";

const model = (extra: Partial<BillPdfModel> = {}): BillPdfModel => ({
  sender: { name: "Nudelfabrik Wien", addressLines: ["Absberggasse 27, 1100 Wien"] },
  recipient: ["Ćevabdžinica Šargija", "Hauptstraße 1", "1010 Wien"],
  meta: ["Kundennummer D-001"],
  title: "Monatsrechnung",
  monthLabel: "Oktober 2026",
  columns: { date: "Liefertag", items: "Produkte", amount: "Betrag" },
  orders: [{ date: "06.10.2026", items: "2 Kiste Nudeln", amount: "55,15 €" }],
  emptyText: "Keine Bestellungen in diesem Monat.",
  foot: [{ label: "Summe", amount: "55,15 €", style: "total" }],
  notes: ["Offen"],
  footerLeft: "Nudelfabrik Wien · Monatsrechnung Oktober 2026 · D-001",
  pageLabel: (page, pages) => `Seite ${page} von ${pages}`,
  ...extra,
});

/** Names of the fonts a PDF embeds (subsets carry a random prefix, e.g. `ABCDEF+DejaVuSans`). */
const fontNames = (pdf: PDFDocument): string[] =>
  pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFDict && object.get(PDFName.of("Type")) === PDFName.of("Font")
        ? [String(object.get(PDFName.of("BaseFont")))]
        : [],
    );

describe("renderBillPdf", () => {
  it("produces an A4 PDF that a PDF reader can open, titled after customer and month", async () => {
    const bytes = await renderBillPdf(model(), { title: "Monatsrechnung D-001 2026-10" });
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(pdf.getTitle()).toBe("Monatsrechnung D-001 2026-10");
  });

  it("writes as many pages as the layout needs", async () => {
    const orders = Array.from({ length: 120 }, (_, i) => ({
      date: "06.10.2026",
      items: `Bestellung ${i + 1}`,
      amount: "10,00 €",
    }));
    const pdf = await PDFDocument.load(await renderBillPdf(model({ orders }), { title: "x" }));
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });

  it("stays small, because only the used letters of the font are embedded", async () => {
    const bytes = await renderBillPdf(model(), { title: "x" });
    expect(bytes.length).toBeLessThan(120_000);
  });

  it("writes Chinese text with the Chinese font instead of empty boxes", async () => {
    const bytes = await renderBillPdf(
      model({
        recipient: ["金龙饭店", "Hauptstraße 1", "1010 Wien"],
        orders: [{ date: "06.10.2026", items: "2 箱 面条", amount: "1,00 €" }],
      }),
      { title: "x" },
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(fontNames(pdf).some((name) => name.includes("NotoSansSC"))).toBe(true);
    // Still only the used letters: a handful of Chinese glyphs, not the whole 2 MB font.
    expect(bytes.length).toBeLessThan(160_000);
  });

  it("embeds the Chinese font only when a bill needs it", async () => {
    const pdf = await PDFDocument.load(await renderBillPdf(model(), { title: "x" }));
    expect(fontNames(pdf).some((name) => name.includes("NotoSansSC"))).toBe(false);
    expect(fontNames(pdf).some((name) => name.includes("DejaVuSans"))).toBe(true);
  });

  it("does not fail on text no font has letters for", async () => {
    const bytes = await renderBillPdf(
      model({
        orders: [
          { date: "06.10.2026", items: "2 x \u{1F35C} \u0E01\u0E4B\u0E27\u0E22", amount: "1,00 €" },
        ],
      }),
      { title: "x" },
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("ships font files whose letters all start at an even position", () => {
    // The PDF library writes the subset with a short glyph index; a letter that starts at an odd
    // position is silently dropped from the PDF (seen with a font saved without padding).
    for (const name of ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "NotoSansSC-Subset.ttf"]) {
      const font = fontkit.create(
        readFileSync(join(process.cwd(), "assets", "fonts", name)),
      ) as unknown as { loca: { offsets: number[] } };
      expect(
        font.loca.offsets.filter((offset) => offset % 2 !== 0),
        name,
      ).toEqual([]);
    }
  });
});
