// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

/**
 * NUD-199: the history of "paid" notes. Every valid note, newest first, with a filter by year and
 * customer, the number of hits and their sum.
 */
const { paidHistoryQuery, PAID_HISTORY_PAGE_SIZE } = await import("./payment-history");

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe.skipIf(!process.env.DATABASE_URL)("paid history", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let muellerId: string;
  let gelsoId: string;

  const db = () => t.prisma;
  const paid = (input: {
    customerId: string;
    month: string;
    amountCents: number;
    paidAt: string;
    note?: string;
    voided?: boolean;
    orderCount?: number;
  }) =>
    db().monthlyPayment.create({
      data: {
        customerId: input.customerId,
        periodStart: day(`${input.month}-01`),
        amountCents: input.amountCents,
        orderCount: input.orderCount ?? 3,
        note: input.note ?? null,
        paidAt: new Date(input.paidAt),
        paidById: adminId,
        voidedAt: input.voided ? new Date(input.paidAt) : null,
        voidedById: input.voided ? adminId : null,
      },
    });

  beforeAll(async () => {
    t = await createTestDb();
    adminId = await t.prisma.user
      .create({
        data: {
          role: "ADMIN",
          email: "history@example.com",
          passwordHash: await hashSecret("123456"),
          displayName: "Büro Anna",
        },
      })
      .then((u) => u.id);
    const customer = (number: string, name: string) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: number,
            name,
            street: "Gasse 1",
            postalCode: "1010",
            city: "Wien",
          },
        })
        .then((c) => c.id);
    muellerId = await customer("H-100", "Gasthaus Müller");
    gelsoId = await customer("H-200", "Trattoria Gelso");

    await paid({
      customerId: muellerId,
      month: "2098-12",
      amountCents: 10000,
      paidAt: "2099-01-05T09:00:00Z",
    });
    await paid({
      customerId: muellerId,
      month: "2099-01",
      amountCents: 20050,
      paidAt: "2099-02-03T09:00:00Z",
      note: "Überweisung",
      orderCount: 7,
    });
    await paid({
      customerId: gelsoId,
      month: "2099-01",
      amountCents: 30000,
      paidAt: "2099-02-10T09:00:00Z",
    });
    // Taken back by the office: not part of the history.
    await paid({
      customerId: gelsoId,
      month: "2099-02",
      amountCents: 99999,
      paidAt: "2099-03-01T09:00:00Z",
      voided: true,
    });
  }, 60_000);

  afterAll(async () => {
    await t.teardown();
  });

  it("lists every valid paid note, newest first, with who marked it and the note", async () => {
    const result = await paidHistoryQuery(db(), {});

    expect(result.rows.map((row) => [row.customerName, row.monthKey])).toEqual([
      ["Trattoria Gelso", "2099-01"],
      ["Gasthaus Müller", "2099-01"],
      ["Gasthaus Müller", "2098-12"],
    ]);
    expect(result.rows[1]).toEqual({
      id: expect.any(String),
      customerId: muellerId,
      customerNumber: "H-100",
      customerName: "Gasthaus Müller",
      periodStart: "2099-01-01",
      monthKey: "2099-01",
      orderCount: 7,
      amountCents: 20050,
      paidAt: "2099-02-03T09:00:00.000Z",
      paidByName: "Büro Anna",
      note: "Überweisung",
    });
    expect(result.total).toBe(3);
    expect(result.sumCents).toBe(60050);
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(1);
  });

  it("offers the years that have paid notes, newest first", async () => {
    const result = await paidHistoryQuery(db(), {});
    expect(result.years).toEqual([2099, 2098]);
  });

  it("filters by the year of the billed month", async () => {
    const result = await paidHistoryQuery(db(), { year: 2098 });
    expect(result.rows.map((row) => row.monthKey)).toEqual(["2098-12"]);
    expect(result.total).toBe(1);
    expect(result.sumCents).toBe(10000);
    // The year picker keeps all years, whatever is filtered.
    expect(result.years).toEqual([2099, 2098]);
  });

  it("finds a customer by name without accents and by customer number", async () => {
    const byName = await paidHistoryQuery(db(), { q: "muller" });
    expect(byName.rows.map((row) => row.customerName)).toEqual([
      "Gasthaus Müller",
      "Gasthaus Müller",
    ]);
    expect(byName.sumCents).toBe(30050);

    const byNumber = await paidHistoryQuery(db(), { q: "h-200" });
    expect(byNumber.rows.map((row) => row.customerName)).toEqual(["Trattoria Gelso"]);

    const both = await paidHistoryQuery(db(), { q: "müller", year: 2099 });
    expect(both.rows.map((row) => row.monthKey)).toEqual(["2099-01"]);
  });

  it("answers an empty list with a zero sum when nothing matches", async () => {
    const result = await paidHistoryQuery(db(), { q: "gibt es nicht" });
    expect(result).toMatchObject({ rows: [], total: 0, sumCents: 0, page: 1, pageCount: 1 });
  });

  it("pages the list and keeps count and sum of all hits", async () => {
    expect(PAID_HISTORY_PAGE_SIZE).toBe(50);
    const first = await paidHistoryQuery(db(), { pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.pageCount).toBe(2);

    const second = await paidHistoryQuery(db(), { pageSize: 2, page: 2 });
    expect(second.rows.map((row) => row.monthKey)).toEqual(["2098-12"]);
    expect(second.total).toBe(3);
    expect(second.sumCents).toBe(60050);

    // A page behind the end is the last page, not an empty screen.
    const beyond = await paidHistoryQuery(db(), { pageSize: 2, page: 9 });
    expect(beyond.page).toBe(2);
    expect(beyond.rows).toHaveLength(1);
  });

  it("ignores input it cannot read instead of failing", async () => {
    const result = await paidHistoryQuery(db(), { year: "abc", page: -3, q: 42 });
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
  });
});
