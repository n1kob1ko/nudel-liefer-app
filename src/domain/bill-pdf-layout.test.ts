import { describe, expect, it } from "vitest";

import { type BillPdfModel, layoutBillPdf, PDF_PAGE, type PdfOp } from "./bill-pdf-layout";

/** Every character is half its font size wide: enough to check wrapping and right alignment. */
const measure = (text: string, size: number) => text.length * size * 0.5;

const model = (extra: Partial<BillPdfModel> = {}): BillPdfModel => ({
  sender: { name: "Nudelfabrik Wien", addressLines: ["Absberggasse 27, 1100 Wien"] },
  recipient: ["Gelso Nero GmbH", "Trattoria Il Gelso Nero", "Hauptstraße 1", "1010 Wien"],
  meta: ["Kundennummer D-001", "UID ATU12345678"],
  title: "Monatsrechnung",
  monthLabel: "Oktober 2026",
  columns: { date: "Liefertag", items: "Produkte", amount: "Betrag" },
  orders: [
    { date: "06.10.2026", items: "1 Sackerl Nudeln, 2 Kiste Nudeln", amount: "55,15 €" },
    { date: "13.10.2026", items: "3 Kiste Nudeln", amount: "64,30 €" },
  ],
  emptyText: "Keine Bestellungen in diesem Monat.",
  foot: [
    { label: "Zwischensumme Bestellungen", amount: "119,45 €", style: "muted" },
    { label: "Rabatt Stammkunde", amount: "-10,00 €", style: "plain" },
    { label: "Summe", amount: "109,45 €", style: "total" },
  ],
  notes: ["Offen"],
  footerLeft: "Nudelfabrik Wien · Monatsrechnung Oktober 2026 · D-001",
  pageLabel: (page, pages) => `Seite ${page} von ${pages}`,
  ...extra,
});

const texts = (page: PdfOp[]) =>
  page.flatMap((op) => (op.type === "text" ? [op] : []));
const find = (page: PdfOp[], text: string) => texts(page).find((op) => op.text === text);
const right = PDF_PAGE.width - PDF_PAGE.margin;

describe("layoutBillPdf", () => {
  it("puts a short bill on one page with sender, recipient, month, every order and the total", () => {
    const pages = layoutBillPdf(model(), measure);
    expect(pages).toHaveLength(1);
    const all = texts(pages[0]!).map((op) => op.text);
    for (const expected of [
      "Nudelfabrik Wien",
      "Absberggasse 27, 1100 Wien",
      "Monatsrechnung",
      "Oktober 2026",
      "Gelso Nero GmbH",
      "1010 Wien",
      "Kundennummer D-001",
      "UID ATU12345678",
      "Liefertag",
      "06.10.2026",
      "1 Sackerl Nudeln, 2 Kiste Nudeln",
      "55,15 €",
      "Zwischensumme Bestellungen",
      "Rabatt Stammkunde",
      "-10,00 €",
      "Summe",
      "109,45 €",
      "Offen",
      "Seite 1 von 1",
    ]) {
      expect(all, expected).toContain(expected);
    }
  });

  it("right-aligns every amount on the same edge", () => {
    const page = layoutBillPdf(model(), measure)[0]!;
    for (const amount of ["55,15 €", "64,30 €", "119,45 €", "-10,00 €", "109,45 €"]) {
      const op = find(page, amount)!;
      expect(op.x + measure(op.text, op.size), amount).toBeCloseTo(right, 5);
    }
  });

  it("prints the total in bold and larger than the lines above it", () => {
    const page = layoutBillPdf(model(), measure)[0]!;
    const total = find(page, "109,45 €")!;
    const line = find(page, "-10,00 €")!;
    expect(total.bold).toBe(true);
    expect(total.size).toBeGreaterThan(line.size);
  });

  it("reads top to bottom: orders, then the foot, then the notes", () => {
    const page = layoutBillPdf(model(), measure)[0]!;
    const y = (text: string) => find(page, text)!.y;
    expect(y("06.10.2026")).toBeGreaterThan(y("13.10.2026"));
    expect(y("13.10.2026")).toBeGreaterThan(y("Zwischensumme Bestellungen"));
    expect(y("Zwischensumme Bestellungen")).toBeGreaterThan(y("Summe"));
    expect(y("Summe")).toBeGreaterThan(y("Offen"));
  });

  it("wraps a long product list inside its column instead of running into the amount", () => {
    const items = Array.from({ length: 14 }, (_, i) => `${i + 1} Kiste Nudeln Sorte ${i + 1}`).join(
      ", ",
    );
    const page = layoutBillPdf(
      model({ orders: [{ date: "06.10.2026", items, amount: "55,15 €" }] }),
      measure,
    )[0]!;
    const amount = find(page, "55,15 €")!;
    const itemLines = texts(page).filter((op) => op.text.includes("Kiste Nudeln Sorte"));
    expect(itemLines.length).toBeGreaterThan(1);
    for (const line of itemLines) {
      expect(line.x + measure(line.text, line.size)).toBeLessThan(amount.x);
    }
    // Nothing is lost by wrapping.
    expect(itemLines.map((line) => line.text).join(" ")).toBe(items);
  });

  it("breaks a word that is wider than the column", () => {
    const word = "X".repeat(400);
    const page = layoutBillPdf(
      model({ orders: [{ date: "06.10.2026", items: word, amount: "1,00 €" }] }),
      measure,
    )[0]!;
    const pieces = texts(page).filter((op) => /^X+$/.test(op.text));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((op) => op.text).join("")).toBe(word);
  });

  it("continues a long month on further pages, each with the column header and a page number", () => {
    const orders = Array.from({ length: 90 }, (_, i) => ({
      date: `${String((i % 28) + 1).padStart(2, "0")}.10.2026`,
      items: `Bestellung ${i + 1}`,
      amount: "10,00 €",
    }));
    const pages = layoutBillPdf(model({ orders }), measure);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, index) => {
      expect(find(page, "Liefertag"), `header on page ${index + 1}`).toBeDefined();
      expect(find(page, `Seite ${index + 1} von ${pages.length}`)).toBeDefined();
      for (const op of texts(page)) {
        expect(op.y).toBeGreaterThan(20);
        expect(op.y).toBeLessThan(PDF_PAGE.height - 20);
      }
    });
    const printed = pages.flatMap((page) => texts(page).map((op) => op.text));
    for (let i = 1; i <= 90; i++) expect(printed).toContain(`Bestellung ${i}`);
    // The letterhead is on the first page only.
    expect(find(pages[1]!, "Gelso Nero GmbH")).toBeUndefined();
  });

  it("keeps the foot together: the total never lands on a page without its subtotal", () => {
    for (let count = 20; count <= 60; count++) {
      const orders = Array.from({ length: count }, (_, i) => ({
        date: "06.10.2026",
        items: `Bestellung ${i + 1}`,
        amount: "10,00 €",
      }));
      const pages = layoutBillPdf(model({ orders }), measure);
      const totalPage = pages.findIndex((page) => find(page, "Summe"));
      const subtotalPage = pages.findIndex((page) => find(page, "Zwischensumme Bestellungen"));
      expect(totalPage, `with ${count} orders`).toBe(subtotalPage);
    }
  });

  it("says so when the month has no orders", () => {
    const page = layoutBillPdf(model({ orders: [] }), measure)[0]!;
    expect(find(page, "Keine Bestellungen in diesem Monat.")).toBeDefined();
  });
});
