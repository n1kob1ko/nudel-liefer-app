// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { purgeSettledOrders } from "./order-retention";
import { FakeStorage } from "./storage/fake";
import { createTestDb, type TestDb } from "./test-db";

/**
 * NUD-201: orders, their stops and tours and the monthly "paid" notes are deleted for good 30 days
 * after they were paid. What is not paid stays, whatever its age. Customers, products, settings
 * and the standing tours are never touched.
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-18T03:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** A delivery day in August: its month is over, and it is far more than 30 days ago. */
const AUGUST = "2026-08-10";
const AUGUST_MONTH = day("2026-08-01");

describe.skipIf(!process.env.DATABASE_URL)(
  "deleting settled orders (database)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    let c1: string;
    let c2: string;
    let productId: string;

    const db = () => t.prisma;
    const run = (options: Partial<Parameters<typeof purgeSettledOrders>[0]> = {}) =>
      purgeSettledOrders({
        db: db(),
        storage: new FakeStorage(),
        now: NOW,
        timezone: "Europe/Vienna",
        mode: "delete",
        retentionDays: 30,
        ...options,
      });

    beforeAll(async () => {
      t = await createTestDb();
      adminId = (
        await t.prisma.user.create({
          data: { role: "ADMIN", email: "del@example.com", passwordHash: "x", displayName: "Büro" },
        })
      ).id;
      driverId = (
        await t.prisma.user.create({
          data: { role: "DRIVER", username: "del-drv", passwordHash: "x", displayName: "Fahrer" },
        })
      ).id;
      const customer = async (number: string) =>
        (
          await t.prisma.customer.create({
            data: {
              customerNumber: number,
              name: `Kunde ${number}`,
              street: "Gasse 1",
              postalCode: "1010",
              city: "Wien",
            },
          })
        ).id;
      c1 = await customer("D-1");
      c2 = await customer("D-2");
      productId = (
        await t.prisma.product.create({
          data: {
            sku: "D-P",
            unit: "KG",
            weightKgPerUnit: 1,
            sortOrder: 1,
            name: { de: "Nudeln", meta: { source: "de", machine: {} } },
          },
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      await t?.teardown();
    });

    beforeEach(async () => {
      await db().stop.deleteMany();
      await db().tour.deleteMany();
      await db().order.deleteMany();
      await db().screenshot.deleteMany();
      await db().monthlyPayment.deleteMany();
      await db().monthlyAdjustment.deleteMany();
    });

    type OrderOptions = {
      term?: "MONTHLY" | "ON_DELIVERY";
      status?: "DRAFT" | "CONFIRMED" | "CANCELLED";
      amountCents?: number | null;
      screenshotId?: string;
    };
    const order = async (customerId: string, date: string, options: OrderOptions = {}) =>
      (
        await db().order.create({
          data: {
            customerId,
            deliveryDate: day(date),
            windowFrom: day(date),
            windowTo: day(date),
            status: options.status ?? "CONFIRMED",
            source: "MANUAL",
            paymentTerm: options.term ?? "MONTHLY",
            amountCents: options.amountCents === undefined ? 1000 : options.amountCents,
            screenshotId: options.screenshotId,
            createdById: adminId,
            items: { create: [{ productId, quantity: 2 }] },
          },
        })
      ).id;

    const tour = async (date: string) =>
      (
        await db().tour.create({
          data: {
            date: day(date),
            status: "COMPLETED",
            driverId,
            depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
          },
        })
      ).id;

    type StopOptions = {
      status?: "PENDING" | "DELIVERED" | "PROBLEM";
      completedAt?: Date;
      collectedCents?: number | null;
      collectedAt?: Date;
    };
    let sequence = 0;
    const stop = async (
      tourId: string,
      customerId: string,
      orderIds: string[],
      options: StopOptions = {},
    ) =>
      (
        await db().stop.create({
          data: {
            tourId,
            customerId,
            sequence: ++sequence,
            status: options.status ?? "DELIVERED",
            completedAt: options.completedAt ?? ago(60),
            collectedCents: options.collectedCents,
            collectedAt: options.collectedAt,
            collectedById: options.collectedCents == null ? undefined : driverId,
            orders: { create: orderIds.map((orderId) => ({ orderId })) },
          },
        })
      ).id;

    const paidNote = (
      customerId: string,
      paidAt: Date,
      options: { periodStart?: Date; voided?: boolean } = {},
    ) =>
      db().monthlyPayment.create({
        data: {
          customerId,
          periodStart: options.periodStart ?? AUGUST_MONTH,
          amountCents: 1000,
          orderCount: 1,
          paidById: adminId,
          paidAt,
          voidedAt: options.voided ? paidAt : null,
          voidedById: options.voided ? adminId : null,
        },
      });

    const correction = (customerId: string, periodStart = AUGUST_MONTH) =>
      db().monthlyAdjustment.create({
        data: {
          customerId,
          periodStart,
          label: "Rabatt",
          amountCents: -100,
          createdById: adminId,
        },
      });

    const left = async () => ({
      orders: await db().order.count(),
      items: await db().orderItem.count(),
      stops: await db().stop.count(),
      tours: await db().tour.count(),
      payments: await db().monthlyPayment.count(),
      adjustments: await db().monthlyAdjustment.count(),
    });
    const NOTHING = { orders: 0, items: 0, stops: 0, tours: 0, payments: 0, adjustments: 0 };

    describe("orders on the monthly bill", () => {
      it("deletes the month with its orders, stops, tour, paid note and corrections 30 days after it was paid", async () => {
        const o = await order(c1, AUGUST);
        await stop(await tour(AUGUST), c1, [o]);
        await paidNote(c1, ago(31));
        await correction(c1);

        const report = await run();

        expect(await left()).toEqual(NOTHING);
        expect(report).toMatchObject({
          mode: "delete",
          retentionDays: 30,
          cutoffDay: "2026-09-18",
          orders: 1,
          stops: 1,
          tours: 1,
          payments: 1,
          adjustments: 1,
          more: false,
        });
      });

      it("keeps a month that was paid less than 30 days ago", async () => {
        const o = await order(c1, AUGUST);
        await stop(await tour(AUGUST), c1, [o]);
        await paidNote(c1, ago(29));
        await correction(c1);

        const report = await run();

        expect(await left()).toEqual({
          orders: 1,
          items: 1,
          stops: 1,
          tours: 1,
          payments: 1,
          adjustments: 1,
        });
        expect(report).toMatchObject({ orders: 0, stops: 0, tours: 0, payments: 0 });
      });

      it("never deletes a month that is not paid, however old it is", async () => {
        const o = await order(c1, "2024-03-05");
        await stop(await tour("2024-03-05"), c1, [o], { completedAt: ago(900) });
        await correction(c1, day("2024-03-01"));

        await run();

        expect(await left()).toMatchObject({ orders: 1, stops: 1, tours: 1, adjustments: 1 });
      });

      it("keeps a month whose paid note was taken back", async () => {
        const o = await order(c1, AUGUST);
        await stop(await tour(AUGUST), c1, [o]);
        await paidNote(c1, ago(45), { voided: true });

        await run();

        expect(await left()).toMatchObject({ orders: 1, stops: 1, tours: 1, payments: 1 });
      });

      it("deletes only the paid customer of a month", async () => {
        const paid = await order(c1, AUGUST);
        const owed = await order(c2, AUGUST);
        await paidNote(c1, ago(40));

        await run();

        expect((await db().order.findMany({ select: { id: true } })).map((o) => o.id)).toEqual([
          owed,
        ]);
        expect(paid).not.toBe(owed);
      });

      it("deletes only the paid month of a customer", async () => {
        await order(c1, AUGUST);
        const july = await order(c1, "2026-07-14");
        await paidNote(c1, ago(40));

        await run();

        expect((await db().order.findMany({ select: { id: true } })).map((o) => o.id)).toEqual([
          july,
        ]);
      });
    });

    describe("paid notes without orders", () => {
      it("deletes the note of a month that has no order on the bill, 30 days after it was paid", async () => {
        await paidNote(c1, ago(31));
        await correction(c1);

        const report = await run();

        expect(await left()).toEqual(NOTHING);
        expect(report).toMatchObject({ orders: 0, payments: 1, adjustments: 1 });
      });

      it("keeps the note of a month that is not over for 30 days: orders may still come", async () => {
        // September ended on 30 September, less than 30 days before the run.
        await paidNote(c1, ago(40), { periodStart: day("2026-09-01") });

        await run();

        expect((await left()).payments).toBe(1);
      });
    });

    describe("cash orders", () => {
      const cash = { term: "ON_DELIVERY" as const, amountCents: 2500 };

      it("deletes a delivery 30 days after the driver collected the full amount", async () => {
        const o = await order(c1, AUGUST, cash);
        await stop(await tour(AUGUST), c1, [o], { collectedCents: 2500, collectedAt: ago(31) });

        await run();

        expect(await left()).toEqual(NOTHING);
      });

      it("keeps a delivery whose cash was collected less than 30 days ago", async () => {
        // Delivered in August, the money came late.
        const o = await order(c1, AUGUST, cash);
        await stop(await tour(AUGUST), c1, [o], { collectedCents: 2500, collectedAt: ago(10) });

        await run();

        expect(await left()).toMatchObject({ orders: 1, stops: 1, tours: 1 });
      });

      it("never deletes a delivery whose cash is still open or was paid in part", async () => {
        const open = await order(c1, "2024-03-05", cash);
        const short = await order(c2, "2024-03-05", cash);
        const old = await tour("2024-03-05");
        await stop(old, c1, [open], { completedAt: ago(900) });
        await stop(old, c2, [short], {
          completedAt: ago(900),
          collectedCents: 2000,
          collectedAt: ago(900),
        });

        await run();

        expect(await left()).toMatchObject({ orders: 2, stops: 2, tours: 1 });
      });

      it("deletes a delivered cash order without an amount: nothing is owed", async () => {
        const o = await order(c1, AUGUST, { term: "ON_DELIVERY", amountCents: null });
        await stop(await tour(AUGUST), c1, [o]);

        await run();

        expect(await left()).toEqual(NOTHING);
      });

      it("deletes a cash order that was never delivered 30 days after its delivery day", async () => {
        const never = await order(c1, AUGUST, cash);
        const problem = await order(c2, AUGUST, cash);
        await stop(await tour(AUGUST), c2, [problem], { status: "PROBLEM" });
        const recent = await order(c1, "2026-10-01", cash);

        await run();

        expect((await db().order.findMany({ select: { id: true } })).map((o) => o.id)).toEqual([
          recent,
        ]);
        expect(never).not.toBe(problem);
      });
    });

    describe("orders that were never to be paid", () => {
      it("deletes cancelled orders and drafts 30 days after their delivery day", async () => {
        await order(c1, "2026-09-17", { status: "CANCELLED" });
        await order(c1, "2026-09-17", { status: "DRAFT" });
        const cancelledRecent = await order(c1, "2026-09-18", { status: "CANCELLED" });
        const draftRecent = await order(c1, "2026-09-18", { status: "DRAFT" });

        await run();

        expect(
          (await db().order.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })).map(
            (o) => o.id,
          ),
        ).toEqual([cancelledRecent, draftRecent]);
      });
    });

    describe("tours", () => {
      it("takes only the paid stop off a tour that also delivered to somebody who has not paid", async () => {
        const paid = await order(c1, AUGUST);
        const owed = await order(c2, AUGUST);
        const shared = await tour(AUGUST);
        await stop(shared, c1, [paid]);
        const owedStop = await stop(shared, c2, [owed]);
        await paidNote(c1, ago(40));

        await run();

        expect((await db().stop.findMany({ select: { id: true } })).map((s) => s.id)).toEqual([
          owedStop,
        ]);
        expect(await db().tour.count()).toBe(1);

        // The second customer pays; 30 days later the rest of the tour goes too.
        await paidNote(c2, ago(31));
        await run();
        expect(await left()).toEqual(NOTHING);
      });

      it("keeps a stop, and both of its orders, while one of them is not paid", async () => {
        const monthly = await order(c1, AUGUST);
        const cashOpen = await order(c1, AUGUST, { term: "ON_DELIVERY", amountCents: 500 });
        await stop(await tour(AUGUST), c1, [monthly, cashOpen]);
        await paidNote(c1, ago(40));

        await run();

        // The paid note stays as well: without it the month would look unpaid again.
        expect(await left()).toMatchObject({ orders: 2, stops: 1, tours: 1, payments: 1 });
      });

      it("deletes an old tour that has no stops, and keeps a recent one", async () => {
        await tour(AUGUST);
        const recent = await tour("2026-10-10");

        const report = await run();

        expect((await db().tour.findMany({ select: { id: true } })).map((x) => x.id)).toEqual([
          recent,
        ]);
        expect(report.tours).toBe(1);
      });

      it("deletes an old stop that carries no order, and its tour with it", async () => {
        await stop(await tour(AUGUST), c1, []);
        const recentTour = await tour("2026-10-10");
        const recentStop = await stop(recentTour, c1, [], { completedAt: ago(8) });

        const report = await run();

        expect((await db().stop.findMany({ select: { id: true } })).map((s) => s.id)).toEqual([
          recentStop,
        ]);
        expect((await db().tour.findMany({ select: { id: true } })).map((x) => x.id)).toEqual([
          recentTour,
        ]);
        expect(report).toMatchObject({ orders: 0, stops: 1, tours: 1 });
      });

      it("deletes two settled orders that share a stop even when they fall into different batches", async () => {
        const first = await order(c1, "2026-08-10", { status: "CANCELLED" });
        const second = await order(c1, "2026-08-12", { status: "CANCELLED" });
        await stop(await tour("2026-08-12"), c1, [first, second]);

        const report = await run({ batchSize: 1, maxBatches: 10 });

        expect(await left()).toEqual(NOTHING);
        expect(report).toMatchObject({ orders: 2, stops: 1, tours: 1, more: false });
      });

      it("keeps a stop on a tour that drove less than 30 days ago", async () => {
        // Cancelled long ago, but still linked to a stop of a recent tour.
        const o = await order(c1, AUGUST, { status: "CANCELLED" });
        await stop(await tour("2026-10-10"), c1, [o], { completedAt: ago(8) });

        await run();

        expect(await left()).toMatchObject({ orders: 1, stops: 1, tours: 1 });
      });
    });

    describe("what always stays", () => {
      it("leaves customers, products, users and the change log alone", async () => {
        const o = await order(c1, AUGUST);
        await stop(await tour(AUGUST), c1, [o]);
        await paidNote(c1, ago(31));
        await db().auditLog.create({
          data: {
            actorId: adminId,
            entity: "Order",
            entityId: o,
            action: "order.create",
            diff: {},
          },
        });
        const before = {
          customers: await db().customer.count(),
          products: await db().product.count(),
          users: await db().user.count(),
          audit: await db().auditLog.count(),
        };

        await run();

        expect(await left()).toEqual(NOTHING);
        expect({
          customers: await db().customer.count(),
          products: await db().product.count(),
          users: await db().user.count(),
          audit: await db().auditLog.count(),
        }).toEqual(before);
      });
    });

    describe("screenshots of deleted orders", () => {
      const shot = async (storage: FakeStorage, key: string) => {
        storage.put(key, new Uint8Array([1, 2]), "image/jpeg");
        return (await db().screenshot.create({ data: { storageKey: key, uploadedById: adminId } }))
          .id;
      };

      it("deletes the file and the row with the order", async () => {
        const storage = new FakeStorage();
        const gone = await shot(storage, "screenshots/gone.jpg");
        // One screenshot can belong to several orders: it stays while one of them does.
        const shared = await shot(storage, "screenshots/shared.jpg");
        await order(c1, "2026-08-10", { status: "CANCELLED", screenshotId: gone });
        await order(c1, "2026-08-10", { status: "CANCELLED", screenshotId: shared });
        await order(c1, "2026-10-10", { status: "CANCELLED", screenshotId: shared });

        const report = await run({ storage });

        expect(storage.has("screenshots/gone.jpg")).toBe(false);
        expect(storage.has("screenshots/shared.jpg")).toBe(true);
        expect((await db().screenshot.findMany({ select: { id: true } })).map((s) => s.id)).toEqual(
          [shared],
        );
        expect(report).toMatchObject({ orders: 2, screenshots: 1, screenshotsFailed: 0 });
      });

      it("still deletes the order when the storage is down, and leaves the row for the screenshot job", async () => {
        const storage = new FakeStorage();
        const id = await shot(storage, "screenshots/down.jpg");
        await order(c1, "2026-08-10", { status: "CANCELLED", screenshotId: id });
        storage.delete = async () => {
          throw new Error("storage down");
        };

        const report = await run({ storage });

        expect(await db().order.count()).toBe(0);
        expect(await db().screenshot.count()).toBe(1);
        expect(report).toMatchObject({ orders: 1, screenshots: 0, screenshotsFailed: 1 });
      });
    });

    describe("modes and batches", () => {
      const settled = async () => {
        const o = await order(c1, AUGUST);
        await stop(await tour(AUGUST), c1, [o]);
        await paidNote(c1, ago(31));
      };

      it("only counts in dry-run and changes nothing", async () => {
        await settled();
        const before = await left();

        const report = await run({ mode: "dry-run" });

        expect(await left()).toEqual(before);
        expect(report).toMatchObject({ mode: "dry-run", orders: 1, stops: 1, tours: 0 });
      });

      it("does nothing at all when switched off", async () => {
        await settled();
        const before = await left();

        expect(await run({ mode: "off" })).toMatchObject({ mode: "off", orders: 0, stops: 0 });
        expect(await left()).toEqual(before);
      });

      it("refuses a period below seven days", async () => {
        await settled();
        await expect(run({ retentionDays: 6 })).rejects.toThrow(/below 7 days refused/);
        expect((await left()).orders).toBe(1);
      });

      it("finds nothing on the second run", async () => {
        await settled();
        await run();
        expect(await run()).toMatchObject({ orders: 0, stops: 0, tours: 0, payments: 0 });
      });

      it("steps back when the office takes the paid note back while the run is on its way", async () => {
        await settled();
        // The office's transaction has voided the note but is not committed yet.
        let voided!: () => void;
        const isVoided = new Promise<void>((resolve) => (voided = resolve));
        let commit!: () => void;
        const mayCommit = new Promise<void>((resolve) => (commit = resolve));
        const office = db().$transaction(
          async (tx) => {
            await tx.monthlyPayment.updateMany({ data: { voidedAt: NOW, voidedById: adminId } });
            voided();
            await mayCommit;
          },
          { timeout: 20_000 },
        );
        await isVoided;

        const running = run();
        await new Promise((resolve) => setTimeout(resolve, 400));
        commit();
        await office;
        const report = await running;

        expect(report).toMatchObject({ orders: 0, stops: 0, payments: 0 });
        expect(await left()).toMatchObject({ orders: 1, stops: 1, tours: 1, payments: 1 });
      });

      it("works in batches and says when more is left", async () => {
        for (let i = 0; i < 5; i++) await order(c1, "2026-08-10", { status: "CANCELLED" });

        const first = await run({ batchSize: 2, maxBatches: 2 });
        expect(first).toMatchObject({ orders: 4, batches: 2, more: true });
        expect(await db().order.count()).toBe(1);

        const second = await run({ batchSize: 2, maxBatches: 2 });
        expect(second).toMatchObject({ orders: 1, more: false });
        expect(await db().order.count()).toBe(0);
      });

      it("is not held up by settled orders that have to wait for their stop", async () => {
        // The two oldest candidates share a stop with an unpaid cash order and cannot go yet.
        const wait1 = await order(c1, "2026-07-01", { status: "CANCELLED" });
        const owed = await order(c1, "2026-07-01", { term: "ON_DELIVERY", amountCents: 500 });
        await stop(await tour("2026-07-01"), c1, [wait1, owed]);
        await order(c2, "2026-08-10", { status: "CANCELLED" });
        await order(c2, "2026-08-11", { status: "CANCELLED" });

        const report = await run({ batchSize: 1, maxBatches: 10 });

        expect(report).toMatchObject({ orders: 2, more: false });
        expect(
          (await db().order.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })).map(
            (o) => o.id,
          ),
        ).toEqual([wait1, owed]);
      });
    });
  },
);
