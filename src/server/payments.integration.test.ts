// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

/**
 * D33 / NUD-196: payments. Cash at the stop (rolled up per stop from the ON_DELIVERY orders) and
 * the accumulated monthly bill per customer (the office marks a month as paid). The amounts come
 * from the office (`Order.amountCents`), there are no catalog prices.
 */
const {
  markMonthlyPaid,
  monthlyBillQuery,
  monthlyOverviewQuery,
  openCashQuery,
  unmarkMonthlyPaid,
} = await import("./payments");
const { applyDriverPayment, applyOfficeCashReceipt } = await import("./stop-payment");
const { applySyncBatch } = await import("./driver-sync");

const TODAY = new Date("2099-06-10T00:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe.skipIf(!process.env.DATABASE_URL)("payments", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let otherDriverId: string;
  let c1: string;
  let c2: string;
  let productId: string;

  const db = () => t.prisma;

  beforeAll(async () => {
    t = await createTestDb();
    const hash = await hashSecret("123456");
    const user = (data: Parameters<typeof t.prisma.user.create>[0]["data"]) =>
      t.prisma.user.create({ data }).then((u) => u.id);
    adminId = await user({
      role: "ADMIN",
      email: "pay@example.com",
      passwordHash: hash,
      displayName: "Office",
    });
    driverId = await user({
      role: "DRIVER",
      username: "pay-drv",
      passwordHash: hash,
      displayName: "Anna",
    });
    otherDriverId = await user({
      role: "DRIVER",
      username: "pay-drv2",
      passwordHash: hash,
      displayName: "Bernd",
    });
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
    c1 = await customer("P1");
    c2 = await customer("P2");
    productId = await t.prisma.product
      .create({
        data: {
          sku: "PAY-1",
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
    await db().stopMutation.deleteMany();
    await db().stop.deleteMany();
    await db().tour.deleteMany();
    await db().orderItem.deleteMany();
    await db().order.deleteMany();
    await db().monthlyPayment.deleteMany();
  });

  const order = (input: {
    customerId: string;
    date: string;
    term: "MONTHLY" | "ON_DELIVERY";
    amountCents: number | null;
    status?: "CONFIRMED" | "CANCELLED";
  }) =>
    db().order.create({
      data: {
        customerId: input.customerId,
        deliveryDate: day(input.date),
        windowFrom: day(input.date),
        windowTo: day(input.date),
        status: input.status ?? "CONFIRMED",
        source: "MANUAL",
        paymentTerm: input.term,
        amountCents: input.amountCents,
        createdById: adminId,
        items: { create: [{ productId, quantity: 1 }] },
      },
    });

  const tourWithStop = async (input: {
    date: string;
    driverId?: string;
    status?: "RELEASED" | "IN_PROGRESS" | "COMPLETED";
    stopStatus?: "PENDING" | "DELIVERED" | "PROBLEM";
    customerId: string;
    orders: string[];
    collectedCents?: number | null;
  }) => {
    const tour = await db().tour.create({
      data: {
        date: day(input.date),
        driverId: input.driverId ?? driverId,
        status: input.status ?? "RELEASED",
        depotSnapshot: {},
      },
    });
    const stop = await db().stop.create({
      data: {
        tourId: tour.id,
        customerId: input.customerId,
        sequence: 1,
        status: input.stopStatus ?? "DELIVERED",
        collectedCents: input.collectedCents ?? null,
        collectedAt: input.collectedCents !== undefined ? day(input.date) : null,
        orders: { create: input.orders.map((orderId) => ({ orderId })) },
      },
    });
    return { tour, stop };
  };

  describe("cash at the stop", () => {
    it("lists a delivered stop whose cash was not collected, with what is due", async () => {
      const cash = await order({
        customerId: c1,
        date: "2099-05-20",
        term: "ON_DELIVERY",
        amountCents: 4250,
      });
      const monthly = await order({
        customerId: c1,
        date: "2099-05-20",
        term: "MONTHLY",
        amountCents: 9999,
      });
      await tourWithStop({
        date: "2099-05-20",
        customerId: c1,
        orders: [cash.id, monthly.id],
      });

      const rows = await openCashQuery(db(), TODAY);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        customerId: c1,
        dueCents: 4250,
        collectedCents: null,
        state: "open",
        driverName: "Anna",
      });
    });

    it("lists a partly collected stop as short and drops a fully collected one", async () => {
      const cash = await order({
        customerId: c2,
        date: "2099-05-21",
        term: "ON_DELIVERY",
        amountCents: 5000,
      });
      const { stop } = await tourWithStop({
        date: "2099-05-21",
        customerId: c2,
        orders: [cash.id],
        collectedCents: 2000,
      });
      const shortRows = await openCashQuery(db(), TODAY);
      expect(shortRows.map((row) => [row.stopId, row.state])).toEqual([[stop.id, "short"]]);

      await db().stop.update({ where: { id: stop.id }, data: { collectedCents: 5000 } });
      expect(await openCashQuery(db(), TODAY)).toEqual([]);
    });

    it("ignores stops that are not delivered, tours that are not released and future days", async () => {
      const cash = await order({
        customerId: c1,
        date: "2099-05-22",
        term: "ON_DELIVERY",
        amountCents: 1000,
      });
      await tourWithStop({
        date: "2099-05-22",
        customerId: c1,
        orders: [cash.id],
        stopStatus: "PENDING",
      });
      const future = await order({
        customerId: c1,
        date: "2099-06-20",
        term: "ON_DELIVERY",
        amountCents: 1000,
      });
      await tourWithStop({ date: "2099-06-20", customerId: c1, orders: [future.id] });

      expect(await openCashQuery(db(), TODAY)).toEqual([]);
    });

    it("records the collected amount, audits it and replays safely", async () => {
      const cash = await order({
        customerId: c1,
        date: "2099-05-23",
        term: "ON_DELIVERY",
        amountCents: 3000,
      });
      const { stop } = await tourWithStop({
        date: "2099-05-23",
        customerId: c1,
        orders: [cash.id],
      });

      const first = await applyDriverPayment(
        db(),
        { id: driverId, role: "DRIVER" },
        {
          clientMutationId: "11111111-1111-4111-8111-111111111111",
          stopId: stop.id,
          collectedCents: 3000,
        },
        day("2099-05-23"),
      );
      expect(first).toMatchObject({ ok: true, replayed: false, collectedCents: 3000 });

      const stored = await db().stop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(stored.collectedCents).toBe(3000);
      expect(stored.collectedById).toBe(driverId);

      const audit = await db().auditLog.findFirstOrThrow({
        where: { action: "stop.payment", entityId: stop.id },
      });
      expect(audit.diff).toMatchObject({ from: null, to: 3000, dueCents: 3000 });

      const replay = await applyDriverPayment(
        db(),
        { id: driverId, role: "DRIVER" },
        {
          clientMutationId: "11111111-1111-4111-8111-111111111111",
          stopId: stop.id,
          collectedCents: 3000,
        },
        day("2099-05-23"),
      );
      expect(replay).toMatchObject({ ok: true, replayed: true });
      expect(await db().stopMutation.count()).toBe(1);
    });

    it("refuses a payment on a stop that is not delivered, and a foreign driver", async () => {
      const cash = await order({
        customerId: c2,
        date: "2099-05-24",
        term: "ON_DELIVERY",
        amountCents: 2000,
      });
      const { stop } = await tourWithStop({
        date: "2099-05-24",
        customerId: c2,
        orders: [cash.id],
        stopStatus: "PENDING",
      });
      const pending = await applyDriverPayment(
        db(),
        { id: driverId, role: "DRIVER" },
        {
          clientMutationId: "22222222-2222-4222-8222-222222222222",
          stopId: stop.id,
          collectedCents: 2000,
        },
      );
      expect(pending).toEqual({ ok: false, error: "not_completed" });

      await db().stop.update({ where: { id: stop.id }, data: { status: "DELIVERED" } });
      const foreign = await applyDriverPayment(
        db(),
        { id: otherDriverId, role: "DRIVER" },
        {
          clientMutationId: "33333333-3333-4333-8333-333333333333",
          stopId: stop.id,
          collectedCents: 2000,
        },
      );
      expect(foreign).toEqual({ ok: false, error: "not_found" });
    });

    it("lets the office settle open cash, audited, and the row leaves the open list (NUD-209)", async () => {
      const cash = await order({
        customerId: c2,
        date: "2099-05-26",
        term: "ON_DELIVERY",
        amountCents: 4200,
      });
      const { stop } = await tourWithStop({
        date: "2099-05-26",
        customerId: c2,
        orders: [cash.id],
        status: "COMPLETED",
      });
      expect((await openCashQuery(db(), TODAY)).map((row) => row.stopId)).toContain(stop.id);

      const byDriver = await applyOfficeCashReceipt(
        db(),
        { id: driverId, role: "DRIVER" },
        { stopId: stop.id, collectedCents: 4200 },
      );
      expect(byDriver).toEqual({ ok: false, error: "forbidden" });
      expect(
        await applyOfficeCashReceipt(db(), { id: adminId, role: "ADMIN" }, { stopId: stop.id }),
      ).toEqual({ ok: false, error: "invalid" });

      const result = await applyOfficeCashReceipt(
        db(),
        { id: adminId, role: "ADMIN" },
        { stopId: stop.id, collectedCents: 4200 },
        day("2099-05-27"),
      );
      expect(result).toEqual({ ok: true, stopId: stop.id, collectedCents: 4200 });
      const stored = await db().stop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(stored).toMatchObject({ collectedCents: 4200, collectedById: adminId });
      const audit = await db().auditLog.findFirstOrThrow({
        where: { action: "stop.payment", entityId: stop.id },
        orderBy: { createdAt: "desc" },
      });
      expect(audit.diff).toMatchObject({ from: null, to: 4200, dueCents: 4200, via: "office" });
      expect((await openCashQuery(db(), TODAY)).map((row) => row.stopId)).not.toContain(stop.id);

      // A stop the driver has not delivered takes no money, from the office either.
      await db().stop.update({ where: { id: stop.id }, data: { status: "PENDING" } });
      expect(
        await applyOfficeCashReceipt(
          db(),
          { id: adminId, role: "ADMIN" },
          { stopId: stop.id, collectedCents: 4200 },
        ),
      ).toEqual({ ok: false, error: "not_completed" });
    });

    it("accepts the cash of the last stop, which completes the tour", async () => {
      const cash = await order({
        customerId: c1,
        date: "2099-05-25",
        term: "ON_DELIVERY",
        amountCents: 1500,
      });
      const { stop, tour } = await tourWithStop({
        date: "2099-05-25",
        customerId: c1,
        orders: [cash.id],
      });
      // Delivering the only stop of the tour finishes it; the driver collects the cash right after.
      await db().tour.update({
        where: { id: tour.id },
        data: { status: "COMPLETED", completedAt: day("2099-05-25") },
      });

      const result = await applyDriverPayment(
        db(),
        { id: driverId, role: "DRIVER" },
        {
          clientMutationId: "44444444-4444-4444-8444-444444444444",
          stopId: stop.id,
          collectedCents: 1500,
        },
        day("2099-05-25"),
      );
      expect(result).toMatchObject({ ok: true, collectedCents: 1500 });
    });

    it("accepts a payment entry through the offline sync batch (the real driver path)", async () => {
      const cash = await order({
        customerId: c2,
        date: "2099-05-26",
        term: "ON_DELIVERY",
        amountCents: 2750,
      });
      const { stop } = await tourWithStop({
        date: "2099-05-26",
        customerId: c2,
        orders: [cash.id],
      });

      const response = await applySyncBatch(
        db(),
        { id: driverId, role: "DRIVER", locale: "de" },
        [
          {
            clientMutationId: "55555555-5555-4555-8555-555555555555",
            type: "payment",
            stopId: stop.id,
            collectedCents: 2750,
            createdAt: day("2099-05-26").toISOString(),
          },
        ],
        day("2099-05-26"),
      );
      expect(response.results[0]).toMatchObject({ outcome: "applied" });
      const stored = await db().stop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(stored.collectedCents).toBe(2750);
    });
  });

  describe("monthly bill", () => {
    it("summarises a finished month per customer and counts orders without an amount", async () => {
      await order({ customerId: c1, date: "2099-05-05", term: "MONTHLY", amountCents: 1000 });
      await order({ customerId: c1, date: "2099-05-19", term: "MONTHLY", amountCents: 2500 });
      await order({ customerId: c1, date: "2099-05-20", term: "MONTHLY", amountCents: null });
      // Cash orders and cancellations are not on the bill.
      await order({ customerId: c1, date: "2099-05-21", term: "ON_DELIVERY", amountCents: 800 });
      await order({
        customerId: c1,
        date: "2099-05-22",
        term: "MONTHLY",
        amountCents: 500,
        status: "CANCELLED",
      });
      // The current month is not "open" yet.
      await order({ customerId: c1, date: "2099-06-02", term: "MONTHLY", amountCents: 700 });

      const rows = await monthlyOverviewQuery(db(), TODAY);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        customerId: c1,
        monthKey: "2099-05",
        amountCents: 3500,
        orderCount: 3,
        noAmountCount: 1,
        state: "open",
      });
    });

    it("leaves an order out that a problem stop carried and nothing delivered (NUD-209)", async () => {
      const delivered = await order({
        customerId: c1,
        date: "2099-05-04",
        term: "MONTHLY",
        amountCents: 1000,
      });
      await tourWithStop({
        date: "2099-05-04",
        status: "COMPLETED",
        customerId: c1,
        orders: [delivered.id],
      });
      const closed = await order({
        customerId: c1,
        date: "2099-05-05",
        term: "MONTHLY",
        amountCents: 3960,
      });
      await tourWithStop({
        date: "2099-05-05",
        status: "COMPLETED",
        stopStatus: "PROBLEM",
        customerId: c1,
        orders: [closed.id],
      });
      // Problem first, delivered later on a second stop of the same order: billed once.
      const retried = await order({
        customerId: c1,
        date: "2099-05-06",
        term: "MONTHLY",
        amountCents: 500,
      });
      await tourWithStop({
        date: "2099-05-06",
        status: "COMPLETED",
        stopStatus: "PROBLEM",
        customerId: c1,
        orders: [retried.id],
      });
      await tourWithStop({
        date: "2099-05-06",
        status: "COMPLETED",
        customerId: c1,
        orders: [retried.id],
      });
      // Never on a tour (no stop): still billed, as before.
      await order({ customerId: c1, date: "2099-05-07", term: "MONTHLY", amountCents: 200 });

      const [row] = await monthlyOverviewQuery(db(), TODAY);
      expect(row).toMatchObject({ amountCents: 1700, orderCount: 3 });
      const bill = await monthlyBillQuery(db(), c1, "2099-05", TODAY);
      expect(bill?.totalCents).toBe(1700);
      expect(bill?.orders.map((entry) => entry.id)).not.toContain(closed.id);
      // The "paid" snapshot uses the same filter (BILLED_MONTHLY_ORDER); it is not marked here
      // because the audit log is append-only and the next test reads the first "monthly.pay".
    });

    it("marks a month as paid (with a snapshot and an audit entry) and takes it back", async () => {
      await order({ customerId: c1, date: "2099-05-05", term: "MONTHLY", amountCents: 1000 });
      const marked = await markMonthlyPaid(
        db(),
        adminId,
        { customerId: c1, month: "2099-05", note: "bar beglichen" },
        TODAY,
      );
      expect(marked).toMatchObject({ ok: true, amountCents: 1000, orderCount: 1 });

      const paidRows = await monthlyOverviewQuery(db(), TODAY);
      expect(paidRows.map((row) => row.state)).toEqual(["paid"]);

      const bill = await monthlyBillQuery(db(), c1, "2099-05", TODAY);
      expect(bill).toMatchObject({
        monthKey: "2099-05",
        totalCents: 1000,
        state: "paid",
        closed: true,
      });
      expect(bill?.payment).toMatchObject({
        amountCents: 1000,
        orderCount: 1,
        paidByName: "Office",
      });
      expect(bill?.payment?.note).toBe("bar beglichen");

      const audit = await db().auditLog.findFirstOrThrow({ where: { action: "monthly.pay" } });
      expect(audit.entity).toBe("Customer");
      expect(audit.diff).toMatchObject({ periodStart: "2099-05-01", amountCents: 1000 });

      const unmarked = await unmarkMonthlyPaid(db(), adminId, { customerId: c1, month: "2099-05" });
      expect(unmarked).toMatchObject({ ok: true });
      const openAgain = await monthlyOverviewQuery(db(), TODAY);
      expect(openAgain.map((row) => row.state)).toEqual(["open"]);
      expect(await db().auditLog.count({ where: { action: "monthly.unpay" } })).toBe(1);
    });

    it("refuses the current month, a month without orders and unknown customers", async () => {
      await order({ customerId: c1, date: "2099-06-02", term: "MONTHLY", amountCents: 700 });
      expect(
        await markMonthlyPaid(db(), adminId, { customerId: c1, month: "2099-06" }, TODAY),
      ).toEqual({ ok: false, error: "nothing_to_pay" });
      expect(
        await markMonthlyPaid(db(), adminId, { customerId: c1, month: "2099-04" }, TODAY),
      ).toEqual({ ok: false, error: "nothing_to_pay" });
      expect(
        await markMonthlyPaid(db(), adminId, { customerId: "nope", month: "2099-05" }, TODAY),
      ).toEqual({ ok: false, error: "not_found" });
      expect(await markMonthlyPaid(db(), adminId, { month: "2099-13" }, TODAY)).toEqual({
        ok: false,
        error: "invalid",
      });
    });

    it("shows the orders of the month with their amounts and the missing ones", async () => {
      const first = await order({
        customerId: c2,
        date: "2099-05-02",
        term: "MONTHLY",
        amountCents: 1200,
      });
      await order({ customerId: c2, date: "2099-05-09", term: "MONTHLY", amountCents: null });
      await order({ customerId: c2, date: "2099-05-11", term: "ON_DELIVERY", amountCents: 300 });

      const bill = await monthlyBillQuery(db(), c2, "2099-05", TODAY);
      expect(bill?.orders.map((entry) => entry.id)).toEqual([first.id, expect.any(String)]);
      expect(bill?.orders).toHaveLength(2);
      expect(bill?.totalCents).toBe(1200);
      expect(bill?.noAmountCount).toBe(1);
      expect(bill?.state).toBe("open");
      expect(await monthlyBillQuery(db(), c2, "2099-04", TODAY)).toMatchObject({
        orders: [],
        totalCents: 0,
      });
    });
  });
});
