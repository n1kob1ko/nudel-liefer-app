import { describe, expect, it } from "vitest";

import {
  type BillPdfModel,
  layoutBillPdf,
  PDF_PAGE,
  type PdfOp,
  splitFontRuns,
} from "./bill-pdf-layout";

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

const texts = (page: PdfOp[]) => page.flatMap((op) => (op.type === "text" ? [op] : []));
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

  /** No text leaves the printable area or runs into the page footer; nothing overlaps the edge. */
  const expectInsidePage = (pages: PdfOp[][]) => {
    const footerY = PDF_PAGE.margin - 16;
    for (const [index, page] of pages.entries()) {
      for (const op of texts(page)) {
        const where = `page ${index + 1}: "${op.text.slice(0, 40)}"`;
        expect(op.x, where).toBeGreaterThanOrEqual(PDF_PAGE.margin - 0.01);
        expect(op.x + measure(op.text, op.size), where).toBeLessThanOrEqual(right + 0.01);
        expect(op.y, where).toBeGreaterThanOrEqual(footerY);
        expect(op.y, where).toBeLessThanOrEqual(PDF_PAGE.height - PDF_PAGE.margin);
        // Only the footer itself may stand on the footer line.
        if (op.y < PDF_PAGE.margin + 28) expect(op.y, where).toBe(footerY);
      }
    }
  };

  it("wraps a long sender name and address in the space left of the title", () => {
    const pages = layoutBillPdf(
      model({
        sender: {
          name: "Erste Wiener Nudel- und Teigwarenmanufaktur Produktions- und Vertriebsgesellschaft",
          addressLines: [
            "Gewerbepark Süd, Halle 14, Zufahrt über die Laxenburger Straße, Tor 3, 2. Stock, 1100 Wien, Österreich",
          ],
        },
      }),
      measure,
    );
    expectInsidePage(pages);
    const page = pages[0]!;
    const title = find(page, "Monatsrechnung")!;
    const senderOps = texts(page).filter((op) => op.y > title.y - 40 && op.x < title.x);
    expect(senderOps.length).toBeGreaterThan(2);
    for (const op of senderOps) {
      expect(op.x + measure(op.text, op.size), op.text).toBeLessThan(title.x);
    }
    // The recipient starts below the last sender line, not on top of it.
    const lowestSender = Math.min(...senderOps.map((op) => op.y));
    expect(find(page, "Gelso Nero GmbH")!.y).toBeLessThan(lowestSender);
  });

  it("wraps a recipient or meta line that is wider than the page", () => {
    const company =
      "Gastronomiebetriebe Zum Goldenen Schlüssel und Zur Alten Mühle Betriebsführungs- und Beteiligungsgesellschaft m.b.H. & Co KG";
    const pages = layoutBillPdf(
      model({
        recipient: [company, "Hauptstraße 1", "1010 Wien"],
        meta: [`Kundennummer ${"X".repeat(140)}`],
      }),
      measure,
    );
    expectInsidePage(pages);
    const page = pages[0]!;
    const first = texts(page).find((op) => op.text.startsWith("Gastronomiebetriebe"))!;
    // Every line of the wrapped first recipient line stays bold.
    expect(first.bold).toBe(true);
    expect(texts(page).filter((op) => op.bold && op.size === 11).length).toBeGreaterThan(1);
    expect(find(page, "Hauptstraße 1")!.y).toBeLessThan(first.y - 15);
  });

  it("shortens a footer text that would run into the page number", () => {
    const pages = layoutBillPdf(
      model({
        footerLeft: `${"Sehr langer Firmenname ".repeat(12)}· Monatsrechnung Oktober 2026 · D-001`,
      }),
      measure,
    );
    expectInsidePage(pages);
    const page = pages[0]!;
    const label = find(page, "Seite 1 von 1")!;
    const footer = texts(page).find((op) => op.text.startsWith("Sehr langer"))!;
    expect(footer.text.endsWith("…")).toBe(true);
    expect(footer.x + measure(footer.text, footer.size)).toBeLessThan(label.x);
  });

  it("carries a foot with more corrections than fit one page onto the next, total included", () => {
    const corrections = Array.from({ length: 60 }, (_, index) => ({
      label: `Korrektur ${index + 1}`,
      amount: "-1,00 €",
      style: "plain" as const,
    }));
    const pages = layoutBillPdf(
      model({
        foot: [
          { label: "Zwischensumme Bestellungen", amount: "119,45 €", style: "muted" },
          ...corrections,
          { label: "Summe", amount: "59,45 €", style: "total" },
        ],
      }),
      measure,
    );
    expectInsidePage(pages);
    expect(pages.length).toBeGreaterThan(1);
    const all = pages.flatMap((page) => texts(page).map((op) => op.text));
    for (const { label } of corrections) expect(all, label).toContain(label);
    expect(texts(pages.at(-1)!).map((op) => op.text)).toContain("Summe");
  });

  it("carries one order with more product lines than a page holds onto the next page", () => {
    const items = Array.from({ length: 400 }, (_, index) => `${index + 1} Kiste Nudelsorte`).join(
      ", ",
    );
    const pages = layoutBillPdf(
      model({ orders: [{ date: "06.10.2026", items, amount: "55,15 €" }] }),
      measure,
    );
    expectInsidePage(pages);
    expect(pages.length).toBeGreaterThan(1);
    const all = pages.flatMap((page) => texts(page).map((op) => op.text)).join(" ");
    expect(all).toContain("400 Kiste Nudelsorte");
    expect(all).toContain("Summe");
  });

  it("keeps every text inside the page for an ordinary and for a long bill", () => {
    expectInsidePage(layoutBillPdf(model(), measure));
    expectInsidePage(
      layoutBillPdf(
        model({
          orders: Array.from({ length: 120 }, (_, index) => ({
            date: "06.10.2026",
            items: `${index + 1} Sackerl Nudeln, 2 Kiste Nudeln, 3 kg Teigblätter für Lasagne und Cannelloni`,
            amount: "55,15 €",
          })),
          notes: Array.from({ length: 30 }, () => "Notiz: ".padEnd(300, "lang ")),
        }),
        measure,
      ),
    );
  });
});

describe("splitFontRuns", () => {
  /** A "main font" that only knows Latin-1, as a stand-in for a font without Chinese letters. */
  const latin = (codePoint: number) => codePoint < 0x100;

  it("keeps a text the main font can write in one run", () => {
    expect(splitFontRuns("2 Kiste Nudeln", latin)).toEqual([
      { text: "2 Kiste Nudeln", fallback: false },
    ]);
  });

  it("cuts out the stretches the main font cannot write, in reading order", () => {
    expect(splitFontRuns("2 箱 面条 (Nudeln)", latin)).toEqual([
      { text: "2 ", fallback: false },
      { text: "箱", fallback: true },
      { text: " ", fallback: false },
      { text: "面条", fallback: true },
      { text: " (Nudeln)", fallback: false },
    ]);
  });

  it("never cuts a character that needs two code units in half", () => {
    expect(splitFontRuns("a\u{20000}b", latin)).toEqual([
      { text: "a", fallback: false },
      { text: "\u{20000}", fallback: true },
      { text: "b", fallback: false },
    ]);
  });

  it("returns no runs for an empty text", () => {
    expect(splitFontRuns("", latin)).toEqual([]);
  });
});
