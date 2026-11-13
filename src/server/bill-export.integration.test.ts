// @vitest-environment node
import { type AbstractIntlMessages, createTranslator } from "next-intl";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import de from "../../messages/de.json";
import en from "../../messages/en.json";
import zhHans from "../../messages/zh-Hans.json";
import { createLocalizedText } from "../lib/localized-text";
import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

/**
 * NUD-198: the monthly bill as a file. One customer's month as CSV or PDF, or all customers of a
 * month as one CSV for the accounting.
 */
const { createBillExport, exportTextsFrom } = await import("./bill-export");
const { addMonthlyAdjustment } = await import("./monthly-adjustments");
const { markMonthlyPaid } = await import("./payments");

const TODAY = new Date("2099-06-10T00:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const MESSAGES = { de, en, "zh-Hans": zhHans } as unknown as Record<string, AbstractIntlMessages>;

const texts = async (locale: "de" | "en" | "zh-Hans") =>
  exportTextsFrom(
    createTranslator({ locale, messages: MESSAGES[locale]!, namespace: "admin.payments" }),
    createTranslator({ locale, messages: MESSAGES[locale]!, namespace: "common" }),
  );

describe.skipIf(!process.env.DATABASE_URL)("monthly bill export", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let c1: string;
  let c2: string;
  let c3: string;
  let productId: string;

  const db = () => t.prisma;
  const ctx = {
    today: TODAY,
    timezone: "Europe/Vienna",
    depot: { name: "Nudelfabrik Wien", address: "Absberggasse 27, 1100 Wien" },
    texts,
  };
  const run = (query: Record<string, string>) =>
    createBillExport(db(), new URLSearchParams(query), ctx);
  const csvLines = (body: string | Uint8Array) =>
    String(body)
      .replace(/^\uFEFF/, "")
      .trimEnd()
      .split("\r\n");

  beforeAll(async () => {
    t = await createTestDb();
    adminId = await t.prisma.user
      .create({
        data: {
          role: "ADMIN",
          email: "export@example.com",
          passwordHash: await hashSecret("123456"),
          displayName: "Office",
        },
      })
      .then((u) => u.id);
    const customer = (number: string, name: string, extra: Record<string, string> = {}) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: number,
            name,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            ...extra,
          },
        })
        .then((c) => c.id);
    // Created out of order on purpose: the export sorts by customer number.
    c2 = await customer("E2", "Beisl Zum Baum");
    c1 = await customer("E1", "Trattoria Gelso", {
      companyName: "Gelso Nero GmbH",
      vatId: "ATU12345678",
      billingStreet: "Rechnungsweg 9",
      billingPostalCode: "1020",
      billingCity: "Wien",
    });
    c3 = await customer("E3", "Nur Bar");
    productId = await t.prisma.product
      .create({
        data: {
          sku: "EXP-1",
          unit: "CRATE",
          weightKgPerUnit: 3,
          sortOrder: 1,
          name: createLocalizedText({ de: "Nudeln", en: "Noodles" }, "de"),
        },
      })
      .then((p) => p.id);
  }, 60_000);

  afterAll(async () => {
    await t.teardown();
  });

  beforeEach(async () => {
    await db().orderItem.deleteMany();
    await db().order.deleteMany();
    await db().monthlyPayment.deleteMany();
    await db().monthlyAdjustment.deleteMany();
  });

  const order = (input: {
    customerId: string;
    date: string;
    amountCents: number | null;
    term?: "MONTHLY" | "ON_DELIVERY";
    status?: "CONFIRMED" | "CANCELLED";
    quantity?: number;
  }) =>
    db().order.create({
      data: {
        customerId: input.customerId,
        deliveryDate: day(input.date),
        windowFrom: day(input.date),
        windowTo: day(input.date),
        status: input.status ?? "CONFIRMED",
        source: "MANUAL",
        paymentTerm: input.term ?? "MONTHLY",
        amountCents: input.amountCents,
        createdById: adminId,
        items: { create: [{ productId, quantity: input.quantity ?? 2 }] },
      },
    });

  const seedMay = async () => {
    await order({ customerId: c1, date: "2099-05-18", amountCents: 2500 });
    await order({ customerId: c1, date: "2099-05-04", amountCents: 5000, quantity: 3 });
    await order({ customerId: c2, date: "2099-05-11", amountCents: null });
    await order({ customerId: c2, date: "2099-05-12", amountCents: 900, status: "CANCELLED" });
    await order({ customerId: c3, date: "2099-05-12", amountCents: 700, term: "ON_DELIVERY" });
    await order({ customerId: c1, date: "2099-04-30", amountCents: 111 });
    await addMonthlyAdjustment(db(), adminId, {
      customerId: c1,
      month: "2099-05",
      kind: "deduction",
      label: "Rabatt Stammkunde",
      amount: "10",
    });
  };

  it("exports one customer's month as CSV: orders by day, then the corrections", async () => {
    await seedMay();
    const result = await run({ month: "2099-05", customer: c1, format: "csv", locale: "de" });
    if (!result.ok) throw new Error("expected a file");

    expect(result.fileName).toBe("monatsrechnung-E1-2099-05.csv");
    expect(result.contentType).toBe("text/csv; charset=utf-8");
    expect(csvLines(result.body)).toEqual([
      "Monat;Kundennummer;Kunde;Liefertag;Art;Beschreibung;Betrag (EUR);Status;Bezahlt am",
      "2099-05;E1;Trattoria Gelso;04.05.2099;Bestellung;3 Kiste Nudeln;50,00;Offen;",
      "2099-05;E1;Trattoria Gelso;18.05.2099;Bestellung;2 Kiste Nudeln;25,00;Offen;",
      "2099-05;E1;Trattoria Gelso;;Korrektur;Rabatt Stammkunde;-10,00;Offen;",
    ]);
  });

  it("writes the paid state and the day it was marked, in the factory time zone", async () => {
    await seedMay();
    await markMonthlyPaid(db(), adminId, { customerId: c1, month: "2099-05" }, TODAY);
    // 23:30 UTC on the 9th is already the 10th in Vienna.
    await db().monthlyPayment.updateMany({ data: { paidAt: new Date("2099-06-09T23:30:00Z") } });

    const result = await run({ month: "2099-05", customer: c1, format: "csv", locale: "de" });
    if (!result.ok) throw new Error("expected a file");
    expect(csvLines(result.body)[1]).toMatch(/;Bezahlt;10\.06\.2099$/);
  });

  it("exports all customers of a month in one CSV, by customer number, monthly orders only", async () => {
    await seedMay();
    const result = await run({ month: "2099-05", format: "csv", locale: "en" });
    if (!result.ok) throw new Error("expected a file");

    expect(result.fileName).toBe("monatsrechnungen-2099-05.csv");
    const lines = csvLines(result.body);
    expect(lines[0]).toBe(
      "Month,Customer number,Customer,Delivery day,Kind,Description,Amount (EUR),Status,Paid on",
    );
    expect(lines.slice(1)).toEqual([
      "2099-05,E1,Trattoria Gelso,2099-05-04,Order,3 Carton Noodles,50.00,Open,",
      "2099-05,E1,Trattoria Gelso,2099-05-18,Order,2 Carton Noodles,25.00,Open,",
      "2099-05,E1,Trattoria Gelso,,Correction,Rabatt Stammkunde,-10.00,Open,",
      "2099-05,E2,Beisl Zum Baum,2099-05-11,Order,2 Carton Noodles,,Open,",
    ]);
  });

  it("answers with a header-only file for a month without monthly orders", async () => {
    const result = await run({ month: "2099-03", format: "csv", locale: "de" });
    if (!result.ok) throw new Error("expected a file");
    expect(csvLines(result.body)).toHaveLength(1);
  });

  it("exports one customer's month as a PDF", async () => {
    await seedMay();
    const result = await run({ month: "2099-05", customer: c1, format: "pdf", locale: "de" });
    if (!result.ok) throw new Error("expected a file");

    expect(result.fileName).toBe("monatsrechnung-E1-2099-05.pdf");
    expect(result.contentType).toBe("application/pdf");
    const pdf = await PDFDocument.load(result.body as Uint8Array);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Monatsrechnung E1 2099-05");
  });

  it("writes the PDF in German for a Chinese-speaking user, because the font has no Chinese letters", async () => {
    await seedMay();
    const result = await run({ month: "2099-05", customer: c1, format: "pdf", locale: "zh-Hans" });
    if (!result.ok) throw new Error("expected a file");
    expect((await PDFDocument.load(result.body as Uint8Array)).getTitle()).toBe(
      "Monatsrechnung E1 2099-05",
    );
  });

  it("refuses what it cannot answer", async () => {
    await seedMay();
    expect(await run({ month: "2099-5", customer: c1 })).toEqual({ ok: false, status: 400 });
    expect(await run({ customer: c1 })).toEqual({ ok: false, status: 400 });
    expect(await run({ month: "2099-05", customer: c1, format: "xlsx" })).toEqual({
      ok: false,
      status: 400,
    });
    expect(await run({ month: "2099-05", customer: c1, locale: "cs" })).toEqual({
      ok: false,
      status: 400,
    });
    // A PDF is one customer's document; there is no PDF of "everybody".
    expect(await run({ month: "2099-05", format: "pdf" })).toEqual({ ok: false, status: 400 });
    expect(await run({ month: "2099-05", customer: "nope", format: "csv" })).toEqual({
      ok: false,
      status: 404,
    });
  });
});

describe("bill PDF model", () => {
  it("addresses the legal entity at its billing address and lists subtotal, corrections and total", async () => {
    const { billPdfModel } = await import("./bill-export");
    const noodles = createLocalizedText({ de: "Nudeln" }, "de");
    const model = billPdfModel(
      {
        customer: {
          id: "c",
          customerNumber: "E1",
          name: "Trattoria Gelso",
          city: "Wien",
          street: "Hauptstraße 1",
          postalCode: "1010",
          companyName: "Gelso Nero GmbH",
          vatId: "ATU12345678",
          billingStreet: "Rechnungsweg 9",
          billingPostalCode: "1020",
          billingCity: "Wien",
        },
        periodStart: "2099-05-01",
        monthKey: "2099-05",
        closed: true,
        orders: [
          {
            id: "o1",
            date: "2099-05-04",
            status: "CONFIRMED",
            amountCents: 5000,
            paymentTerm: "MONTHLY",
            itemCount: 1,
            items: [{ productName: noodles, sku: "N", unit: "CRATE", quantity: 3 }],
          },
          {
            id: "o2",
            date: "2099-05-11",
            status: "CONFIRMED",
            amountCents: null,
            paymentTerm: "MONTHLY",
            itemCount: 1,
            items: [{ productName: noodles, sku: "N", unit: "CRATE", quantity: 1 }],
          },
        ],
        adjustments: [{ id: "a1", label: "Rabatt Stammkunde", amountCents: -1000 }],
        ordersTotalCents: 5000,
        totalCents: 4000,
        noAmountCount: 1,
        state: "paid",
        payment: {
          amountCents: 4000,
          orderCount: 2,
          paidAt: "2099-06-03T10:00:00.000Z",
          paidByName: "Office",
          note: "Überweisung am 3.",
        },
      },
      {
        locale: "de",
        timezone: "Europe/Vienna",
        depot: { name: "Nudelfabrik Wien", address: "Absberggasse 27, 1100 Wien" },
        texts: await texts("de"),
      },
    );
    const plain = (value: string) => value.replace(/\u00a0/g, " ");

    expect(model.sender).toEqual({
      name: "Nudelfabrik Wien",
      addressLines: ["Absberggasse 27, 1100 Wien"],
    });
    expect(model.recipient).toEqual([
      "Gelso Nero GmbH",
      "Trattoria Gelso",
      "Rechnungsweg 9",
      "1020 Wien",
    ]);
    expect(model.meta).toEqual(["Kundennummer E1", "UID ATU12345678"]);
    expect(model.monthLabel).toBe("Mai 2099");
    expect(model.orders.map((order) => [order.date, order.items, plain(order.amount)])).toEqual([
      ["04.05.2099", "3 Kiste Nudeln", "50,00 €"],
      ["11.05.2099", "1 Kiste Nudeln", "ohne Betrag"],
    ]);
    expect(model.foot.map((row) => [row.label, plain(row.amount), row.style])).toEqual([
      ["Zwischensumme Bestellungen", "50,00 €", "muted"],
      ["Rabatt Stammkunde", "-10,00 €", "plain"],
      ["Summe", "40,00 €", "total"],
    ]);
    expect(model.notes).toEqual([
      "Bezahlt am 03.06.2099",
      "Notiz: Überweisung am 3.",
      "1 Bestellung ohne Betrag ist in der Summe nicht enthalten.",
    ]);
    expect(model.footerLeft).toBe("Nudelfabrik Wien · Monatsrechnung Mai 2099 · E1");
    expect(model.pageLabel(1, 2)).toBe("Seite 1 von 2");
  });
});
