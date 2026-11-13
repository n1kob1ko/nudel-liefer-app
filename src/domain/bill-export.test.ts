import { describe, expect, it } from "vitest";

import {
  billExportHref,
  type BillExportRow,
  buildBillCsv,
  csvStyleFor,
  exportFileName,
  type ExportLabels,
} from "./bill-export";

const labels: ExportLabels = {
  columns: {
    month: "Monat",
    customerNumber: "Kundennummer",
    customer: "Kunde",
    date: "Datum",
    kind: "Art",
    description: "Beschreibung",
    amount: "Betrag (EUR)",
    status: "Status",
    paidOn: "Bezahlt am",
  },
  order: "Bestellung",
  adjustment: "Korrektur",
  open: "Offen",
  paid: "Bezahlt",
  current: "Laufender Monat",
};

const row = (extra: Partial<BillExportRow> = {}): BillExportRow => ({
  monthKey: "2026-10",
  customerNumber: "D-001",
  customerName: "Trattoria Il Gelso Nero",
  date: "2026-10-06",
  kind: "order",
  description: "1 Sackerl Nudeln, 2 Kiste Nudeln",
  amountCents: 5515,
  state: "open",
  paidOn: null,
  ...extra,
});

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("csv style per language", () => {
  it("German gets what a German Excel opens: semicolon, decimal comma, day first", () => {
    expect(csvStyleFor("de")).toEqual({ delimiter: ";", decimal: ",", date: "dmy" });
  });

  it("English and Chinese get comma, decimal point and ISO dates", () => {
    expect(csvStyleFor("en")).toEqual({ delimiter: ",", decimal: ".", date: "iso" });
    expect(csvStyleFor("zh-Hans")).toEqual({ delimiter: ",", decimal: ".", date: "iso" });
  });
});

describe("buildBillCsv", () => {
  it("starts with a byte order mark and a header line, and ends every line with CRLF", () => {
    const csv = buildBillCsv([row()], labels, csvStyleFor("de"));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines(csv)[0]).toBe(
      "Monat;Kundennummer;Kunde;Datum;Art;Beschreibung;Betrag (EUR);Status;Bezahlt am",
    );
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("writes an order in the German style", () => {
    const csv = buildBillCsv([row()], labels, csvStyleFor("de"));
    expect(lines(csv)[1]).toBe(
      "2026-10;D-001;Trattoria Il Gelso Nero;06.10.2026;Bestellung;1 Sackerl Nudeln, 2 Kiste Nudeln;55,15;Offen;",
    );
  });

  it("writes the same order in the English style, quoting the text that holds a comma", () => {
    const csv = buildBillCsv([row()], labels, csvStyleFor("en"));
    expect(lines(csv)[1]).toBe(
      '2026-10,D-001,Trattoria Il Gelso Nero,2026-10-06,Bestellung,"1 Sackerl Nudeln, 2 Kiste Nudeln",55.15,Offen,',
    );
  });

  it("writes a correction without a date and with its sign, and the paid day of a paid month", () => {
    const csv = buildBillCsv(
      [
        row({
          kind: "adjustment",
          date: null,
          description: "Rabatt Stammkunde",
          amountCents: -1000,
          state: "paid",
          paidOn: "2026-11-03",
        }),
      ],
      labels,
      csvStyleFor("de"),
    );
    expect(lines(csv)[1]).toBe(
      "2026-10;D-001;Trattoria Il Gelso Nero;;Korrektur;Rabatt Stammkunde;-10,00;Bezahlt;03.11.2026",
    );
  });

  it("leaves the amount empty for an order without an amount instead of writing 0", () => {
    const csv = buildBillCsv([row({ amountCents: null })], labels, csvStyleFor("de"));
    expect(lines(csv)[1]!.split(";")[6]).toBe("");
  });

  it("never rounds: whole cents in, two decimals out, no thousands separator", () => {
    const amount = (cents: number) =>
      lines(buildBillCsv([row({ amountCents: cents })], labels, csvStyleFor("de")))[1]!.split(
        ";",
      )[6];
    expect(amount(5)).toBe("0,05");
    expect(amount(-5)).toBe("-0,05");
    expect(amount(123456789)).toBe("1234567,89");
    expect(amount(0)).toBe("0,00");
  });

  it("quotes cells that hold the delimiter, a quote or a line break", () => {
    const csv = buildBillCsv(
      [row({ customerName: 'Beisl "Zum Baum"; Wien', description: "Zeile 1\nZeile 2" })],
      labels,
      csvStyleFor("de"),
    );
    expect(csv).toContain('"Beisl ""Zum Baum""; Wien"');
    expect(csv).toContain('"Zeile 1\nZeile 2"');
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    for (const text of ["=1+1", "+49 1234", "-Rabatt", "@SUM(A1)", "\t=1"]) {
      const csv = buildBillCsv([row({ description: text })], labels, csvStyleFor("de"));
      expect(lines(csv)[1]!.split(";")[5], text).toBe(`'${text}`);
    }
  });

  it("writes only the header for a month without rows", () => {
    expect(lines(buildBillCsv([], labels, csvStyleFor("de")))).toHaveLength(2);
  });
});

describe("exportFileName", () => {
  it("names one customer's bill after the customer number and the month", () => {
    expect(exportFileName({ customerNumber: "D-001", monthKey: "2026-10", extension: "pdf" })).toBe(
      "monatsrechnung-D-001-2026-10.pdf",
    );
  });

  it("names the export of all customers after the month", () => {
    expect(exportFileName({ monthKey: "2026-10", extension: "csv" })).toBe(
      "monatsrechnungen-2026-10.csv",
    );
  });

  it("keeps only characters that are safe in a file name and a header", () => {
    expect(
      exportFileName({ customerNumber: 'K/12 "ä"\r\n', monthKey: "2026-10", extension: "csv" }),
    ).toBe("monatsrechnung-K-12-2026-10.csv");
  });
});

describe("billExportHref", () => {
  it("links one customer's month in the asked format and language", () => {
    expect(
      billExportHref({ month: "2026-10", customerId: "c 1&x", format: "pdf", locale: "de" }),
    ).toBe("/api/admin/payments/export?month=2026-10&format=pdf&locale=de&customer=c+1%26x");
  });

  it("links every customer of a month when no customer is named", () => {
    expect(billExportHref({ month: "2026-10", format: "csv", locale: "zh-Hans" })).toBe(
      "/api/admin/payments/export?month=2026-10&format=csv&locale=zh-Hans",
    );
  });
});
