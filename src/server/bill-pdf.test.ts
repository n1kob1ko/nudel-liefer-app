// @vitest-environment node
import { PDFDocument } from "pdf-lib";
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

  it("does not fail on text the font has no letters for (Chinese product names)", async () => {
    const bytes = await renderBillPdf(
      model({ orders: [{ date: "06.10.2026", items: "2 箱 面条", amount: "1,00 €" }] }),
      { title: "x" },
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
