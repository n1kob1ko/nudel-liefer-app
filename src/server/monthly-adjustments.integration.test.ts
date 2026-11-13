// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

/**
 * NUD-197: correction lines on a monthly bill (discount, credit note, surcharge). They count into
 * the month's total wherever that total is shown or snapshotted, they are frozen while the month
 * is marked paid, and removing one keeps the row.
 */
const { addMonthlyAdjustment, removeMonthlyAdjustment } = await import("./monthly-adjustments");
const { markMonthlyPaid, monthlyBillQuery, monthlyOverviewQuery, unmarkMonthlyPaid } =
  await import("./payments");

const TODAY = new Date("2099-06-10T00:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe.skipIf(!process.env.DATABASE_URL)("monthly bill corrections", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let c1: string;
  let c2: string;
  let productId: string;

  const db = () => t.prisma;

  beforeAll(async () => {
    t = await createTestDb();
    adminId = await t.prisma.user
      .create({
        data: {
          role: "ADMIN",
          email: "adjust@example.com",
          passwordHash: await hashSecret("123456"),
          displayName: "Office",
        },
      })
      .then((u) => u.id);
    const customer = (number: string) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: number,
            name: `Kunde ${number}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
          },
        })
        .then((c) => c.id);
    c1 = await customer("A1");
    c2 = await customer("A2");
    productId = await t.prisma.product
      .create({
        data: {
          sku: "ADJ-1",
          unit: "PACK",
          weightKgPerUnit: 3,
          sortOrder: 1,
          name: { de: "Sackerl", meta: { source: "de", machine: {} } },
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

  const order = (customerId: string, date: string, amountCents: number | null) =>
    db().order.create({
      data: {
        customerId,
        deliveryDate: day(date),
        windowFrom: day(date),
        windowTo: day(date),
        status: "CONFIRMED",
        source: "MANUAL",
        paymentTerm: "MONTHLY",
        amountCents,
        createdById: adminId,
        items: { create: [{ productId, quantity: 1 }] },
      },
    });

  const add = (input: Record<string, unknown>) =>
    addMonthlyAdjustment(db(), adminId, {
      customerId: c1,
      month: "2099-05",
      kind: "deduction",
      label: "Rabatt Stammkunde",
      amount: "10,00",
      ...input,
    });

  const bill = (customerId = c1, month = "2099-05") =>
    monthlyBillQuery(db(), customerId, month, TODAY);

  it("a deduction lowers the month's total and is listed on the bill", async () => {
    await order(c1, "2099-05-04", 5000);
    await order(c1, "2099-05-18", 2500);

    const result = await add({});
    expect(result).toMatchObject({ ok: true, amountCents: -1000 });

    const found = await bill();
    expect(found?.ordersTotalCents).toBe(7500);
    expect(found?.totalCents).toBe(6500);
    expect(found?.adjustments).toEqual([
      expect.objectContaining({ label: "Rabatt Stammkunde", amountCents: -1000 }),
    ]);
  });

  it("a surcharge raises the total", async () => {
    await order(c1, "2099-05-04", 5000);
    await add({ kind: "surcharge", label: "Leergut", amount: "2.50" });
    expect((await bill())?.totalCents).toBe(5250);
  });

  it("counts only for its own customer and month", async () => {
    await order(c1, "2099-05-04", 5000);
    await order(c1, "2099-04-04", 3000);
    await order(c2, "2099-05-04", 4000);
    await add({});

    expect((await bill(c1, "2099-04"))?.totalCents).toBe(3000);
    expect((await bill(c2, "2099-05"))?.totalCents).toBe(4000);
    expect((await bill(c2, "2099-05"))?.adjustments).toEqual([]);
  });

  it("rejects an amount of zero, a missing text, a text over 120 characters and a bad month", async () => {
    for (const input of [
      { amount: "0" },
      { amount: "-5" },
      { amount: "1.000,00" },
      { amount: "" },
      { label: "   " },
      { label: "x".repeat(121) },
      { month: "2099-13" },
      { kind: "gift" },
    ]) {
      expect(await add(input), JSON.stringify(input)).toEqual({ ok: false, error: "invalid" });
    }
    expect(await db().monthlyAdjustment.count()).toBe(0);
  });

  it("answers not_found for a customer that does not exist", async () => {
    expect(await add({ customerId: "nope" })).toEqual({ ok: false, error: "not_found" });
  });

  it("the list of open months shows the total with corrections", async () => {
    await order(c1, "2099-05-04", 5000);
    await add({ amount: "12,50" });
    await add({ kind: "surcharge", label: "Leergut", amount: "1" });

    const rows = await monthlyOverviewQuery(db(), TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customerId: c1, monthKey: "2099-05", amountCents: 3850 });
  });

  it("marking the month paid snapshots the total with corrections", async () => {
    await order(c1, "2099-05-04", 5000);
    await add({});

    const marked = await markMonthlyPaid(
      db(),
      adminId,
      { customerId: c1, month: "2099-05" },
      TODAY,
    );
    expect(marked).toMatchObject({ ok: true, amountCents: 4000, orderCount: 1 });
    expect((await bill())?.payment?.amountCents).toBe(4000);
  });

  it("freezes the corrections while the month is marked paid and frees them after the take-back", async () => {
    await order(c1, "2099-05-04", 5000);
    const first = await add({});
    if (!first.ok) throw new Error("setup");
    await markMonthlyPaid(db(), adminId, { customerId: c1, month: "2099-05" }, TODAY);

    expect(await add({ label: "Nachlass" })).toEqual({ ok: false, error: "locked" });
    expect(await removeMonthlyAdjustment(db(), adminId, { adjustmentId: first.id })).toEqual({
      ok: false,
      error: "locked",
    });
    expect((await bill())?.adjustments).toHaveLength(1);

    await unmarkMonthlyPaid(db(), adminId, { customerId: c1, month: "2099-05" });
    expect(await add({ label: "Nachlass" })).toMatchObject({ ok: true });
    expect(await removeMonthlyAdjustment(db(), adminId, { adjustmentId: first.id })).toEqual({
      ok: true,
    });
  });

  it("removing a correction keeps the row and takes it off the bill", async () => {
    await order(c1, "2099-05-04", 5000);
    const added = await add({});
    if (!added.ok) throw new Error("setup");

    expect(await removeMonthlyAdjustment(db(), adminId, { adjustmentId: added.id })).toEqual({
      ok: true,
    });

    const found = await bill();
    expect(found?.totalCents).toBe(5000);
    expect(found?.adjustments).toEqual([]);
    const row = await db().monthlyAdjustment.findUniqueOrThrow({ where: { id: added.id } });
    expect(row.voidedAt).not.toBeNull();
    expect(row.voidedById).toBe(adminId);
  });

  it("answers not_found when the correction is unknown or already removed", async () => {
    await order(c1, "2099-05-04", 5000);
    const added = await add({});
    if (!added.ok) throw new Error("setup");
    await removeMonthlyAdjustment(db(), adminId, { adjustmentId: added.id });

    expect(await removeMonthlyAdjustment(db(), adminId, { adjustmentId: added.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await removeMonthlyAdjustment(db(), adminId, { adjustmentId: "nope" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await removeMonthlyAdjustment(db(), adminId, {})).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("audits adding and removing with the amount and without the typed text", async () => {
    await order(c1, "2099-05-04", 5000);
    const added = await add({ label: "Gutschrift Frau Huber" });
    if (!added.ok) throw new Error("setup");
    await removeMonthlyAdjustment(db(), adminId, { adjustmentId: added.id });

    // The audit log is append-only, so earlier tests left entries: look at this correction's own.
    const entries = (
      await db().auditLog.findMany({
        where: { entity: "Customer", entityId: c1 },
        orderBy: { createdAt: "asc" },
      })
    ).filter((entry) => (entry.diff as { adjustmentId?: string }).adjustmentId === added.id);
    expect(entries.map((entry) => entry.action)).toEqual([
      "monthly.adjust",
      "monthly.adjust_remove",
    ]);
    expect(entries[0]!.diff).toMatchObject({
      periodStart: "2099-05-01",
      adjustmentId: added.id,
      amountCents: -1000,
    });
    expect(JSON.stringify(entries.map((entry) => entry.diff))).not.toContain("Huber");
  });

  it("a correction can be added while the month is still running", async () => {
    await order(c1, "2099-06-02", 5000);
    expect(await add({ month: "2099-06" })).toMatchObject({ ok: true });
    expect((await bill(c1, "2099-06"))?.totalCents).toBe(4000);
  });

  it("refuses a correction in a month without orders on monthly bill", async () => {
    // Such a month has no bill: it is not listed as open and cannot be marked paid, so a
    // correction on it would be money nobody ever sees again.
    await order(c1, "2099-04-04", 3000);
    expect(await add({})).toEqual({ ok: false, error: "no_orders" });

    const cancelled = await order(c1, "2099-05-04", 5000);
    await db().order.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    const cash = await order(c1, "2099-05-05", 700);
    await db().order.update({ where: { id: cash.id }, data: { paymentTerm: "ON_DELIVERY" } });
    expect(await add({})).toEqual({ ok: false, error: "no_orders" });
    expect(await db().monthlyAdjustment.count()).toBe(0);
  });

  it("never snapshots a total that misses a correction added at the same moment", async () => {
    await order(c1, "2099-05-04", 5000);
    for (let round = 0; round < 8; round++) {
      await db().monthlyPayment.deleteMany();
      await db().monthlyAdjustment.deleteMany();
      const [, marked] = await Promise.all([
        add({ amount: "1,00" }),
        markMonthlyPaid(db(), adminId, { customerId: c1, month: "2099-05" }, TODAY),
      ]);
      if (!marked.ok) throw new Error("expected the month to be marked");
      const active = await db().monthlyAdjustment.aggregate({
        where: { customerId: c1, voidedAt: null },
        _sum: { amountCents: true },
      });
      // Whoever came first: the snapshot is the orders plus exactly the corrections that exist.
      expect(marked.amountCents, `round ${round}`).toBe(5000 + (active._sum.amountCents ?? 0));
    }
  });

  it("the database itself refuses a correction of zero", async () => {
    await expect(
      db().monthlyAdjustment.create({
        data: {
          customerId: c1,
          periodStart: new Date("2099-05-01T00:00:00Z"),
          label: "Null",
          amountCents: 0,
          createdById: adminId,
        },
      }),
    ).rejects.toThrow(/MonthlyAdjustment_amountCents_nonzero/);
  });
});
