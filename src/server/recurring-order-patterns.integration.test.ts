// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import {
  createRecurringOrder,
  generateRecurringOrders,
  listRecurringOrders,
  updateRecurringOrder,
} from "./recurring-orders";
import { createTestDb, type TestDb } from "./test-db";
import { createTourService } from "./tour-service";

vi.mock("next/cache", () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

/**
 * NUD-171: the patterns beyond "these weekdays, every N weeks" - per-weekday product lists, monthly
 * building blocks, a delivery window time and the two end conditions - against a real database
 * (the migration is replayed by `createTestDb`). The old behaviour without the new fields is
 * asserted both here and in `recurring-orders.integration.test.ts`.
 *
 * Monday 2099-06-15 is "today"; with the default lead time of 14 days the job generates up to
 * 2099-06-29. Tests that need a longer horizon pass `leadDays` explicitly.
 */

const TODAY = new Date("2099-06-15T00:00:00Z");
const iso = (d: Date | null) => d?.toISOString().slice(0, 10);

describe.skipIf(!process.env.DATABASE_URL)(
  "recurring order patterns (NUD-171)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let pack: string;
    let crate: string;
    let n = 0;
    const ctx = () => ({ today: TODAY, tours: createTourService(t.prisma) });

    async function customer() {
      n += 1;
      return t.prisma.customer
        .create({
          data: {
            customerNumber: `P${n}`,
            name: `Kunde ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
          },
        })
        .then((c) => c.id);
    }

    const rule = (customerId: string, over: Record<string, unknown> = {}) => ({
      customerId,
      weekdays: [1],
      anchorDate: "2099-06-15",
      lines: [{ productId: pack, quantity: 2 }],
      ...over,
    });

    const ordersOf = (customerId: string) =>
      t.prisma.order.findMany({
        where: { customerId },
        orderBy: { deliveryDate: "asc" },
        include: { items: { orderBy: { productId: "asc" } } },
      });

    const daysOf = async (customerId: string) =>
      (await ordersOf(customerId)).map((o) => iso(o.deliveryDate));

    /** `[productId, quantity]` pairs of an order, ordered by product id like the expectations. */
    function byProduct(list: readonly (readonly [string, number])[]): [string, number][] {
      return list
        .map(([productId, quantity]) => [productId, quantity] as [string, number])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }

    const pairs = (order: { items: { productId: string; quantity: number }[] }) =>
      byProduct(order.items.map((i) => [i.productId, i.quantity] as const));

    beforeAll(async () => {
      t = await createTestDb();
      adminId = await t.prisma.user
        .create({
          data: {
            role: "ADMIN",
            email: "patterns@example.com",
            passwordHash: await hashSecret("123456"),
            displayName: "A",
          },
        })
        .then((u) => u.id);
      const product = (sku: string, unit: "PACK" | "CRATE", sortOrder: number) =>
        t.prisma.product
          .create({
            data: {
              sku,
              unit,
              weightKgPerUnit: 3,
              sortOrder,
              name: { de: sku, meta: { source: "de", machine: {} } },
            },
          })
          .then((p) => p.id);
      pack = await product("BEUTEL", "PACK", 1);
      crate = await product("KARTON", "CRATE", 2);
    });

    afterAll(async () => {
      await t.teardown();
    });

    it("an old-style rule generates exactly as before, without window times", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { weekdays: [1, 4] }),
        ctx(),
      );
      expect(created).toMatchObject({ ok: true, generated: 5 });
      expect(await daysOf(c)).toEqual([
        "2099-06-15",
        "2099-06-18",
        "2099-06-22",
        "2099-06-25",
        "2099-06-29",
      ]);
      for (const order of await ordersOf(c)) {
        expect(pairs(order)).toEqual([[pack, 2]]);
        expect([order.windowFromTime, order.windowToTime]).toEqual([null, null]);
      }
      const stored = await t.prisma.recurringOrder.findFirstOrThrow({ where: { customerId: c } });
      expect(stored).toMatchObject({
        monthlyRules: [],
        skipFrom: null,
        skipTo: null,
        endsOn: null,
        maxDeliveries: null,
        windowFromTime: null,
        windowToTime: null,
      });
      expect(
        await t.prisma.recurringOrderDayItem.count({ where: { recurringOrderId: stored.id } }),
      ).toBe(0);
    });

    it("gives every generated order the product list of its own weekday", async () => {
      const c = await customer();
      await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, {
          weekdays: [1, 4],
          dayItems: [
            { weekday: 4, productId: crate, quantity: 3 },
            { weekday: 4, productId: pack, quantity: 1 },
          ],
        }),
        ctx(),
      );
      const orders = await ordersOf(c);
      expect(orders.map((o) => iso(o.deliveryDate))).toEqual([
        "2099-06-15",
        "2099-06-18",
        "2099-06-22",
        "2099-06-25",
        "2099-06-29",
      ]);
      // Mondays keep the base list, Thursdays get their own rows.
      const lines = orders.map((o) => [iso(o.deliveryDate), pairs(o)]);
      expect(lines).toEqual([
        ["2099-06-15", byProduct([[pack, 2]])],
        [
          "2099-06-18",
          byProduct([
            [crate, 3],
            [pack, 1],
          ]),
        ],
        ["2099-06-22", byProduct([[pack, 2]])],
        [
          "2099-06-25",
          byProduct([
            [crate, 3],
            [pack, 1],
          ]),
        ],
        ["2099-06-29", byProduct([[pack, 2]])],
      ]);
    });

    it("generates the union of the weekly and the monthly patterns", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, {
          weekdays: [3],
          monthlyRules: [
            { kind: "dayOfMonth", day: 1 },
            { kind: "nthWeekday", nth: 1, weekday: 1 },
          ],
        }),
        ctx(),
      );
      expect(created).toMatchObject({ ok: true, generated: 2 }); // the Wednesdays 17th and 24th
      // A longer horizon adds the monthly days: 2099-07-01 (the 1st), 2099-07-06 (first Monday of
      // July) beside the Wednesdays; June 1 and June 7 lie before the anchor date.
      await generateRecurringOrders(t.prisma, { ...ctx(), leadDays: 30 });
      expect(await daysOf(c)).toEqual([
        "2099-06-17",
        "2099-06-24",
        "2099-07-01",
        "2099-07-06",
        "2099-07-08",
        "2099-07-15",
      ]);
      const stored = await t.prisma.recurringOrder.findFirstOrThrow({ where: { customerId: c } });
      expect(stored.monthlyRules).toEqual([
        { kind: "dayOfMonth", day: 1 },
        { kind: "nthWeekday", nth: 1, weekday: 1 },
      ]);
    });

    it("accepts a monthly-only rule and delivers on its monthly days", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, {
          weekdays: [],
          monthlyRules: [
            { kind: "dayOfMonth", day: 1 },
            { kind: "nthWeekday", nth: 1, weekday: 1 },
          ],
        }),
        ctx(),
      );
      expect(created).toMatchObject({ ok: true, generated: 0 }); // nothing in the next 14 days
      // 2099-07-01 is the 1st of July, 2099-07-06 the first Monday; June 1 and June 7 lie before
      // the anchor date of 2099-06-15.
      await generateRecurringOrders(t.prisma, { ...ctx(), leadDays: 30 });
      expect(await daysOf(c)).toEqual(["2099-07-01", "2099-07-06"]);
      const stored = await t.prisma.recurringOrder.findFirstOrThrow({ where: { customerId: c } });
      expect(stored.weekdays).toEqual([]);
      expect(stored.monthlyRules).toEqual([
        { kind: "dayOfMonth", day: 1 },
        { kind: "nthWeekday", nth: 1, weekday: 1 },
      ]);
      const [view] = await listRecurringOrders(t.prisma, c, TODAY);
      expect(view).toMatchObject({
        weekdays: [],
        monthlyRules: [
          { kind: "dayOfMonth", day: 1 },
          { kind: "nthWeekday", nth: 1, weekday: 1 },
        ],
      });
      expect(view!.nextDates).toEqual(["2099-07-01", "2099-07-06", "2099-08-01"]);
    });

    it("copies the rule's delivery window time onto every generated order", async () => {
      const c = await customer();
      await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { windowFromTime: "08:00", windowToTime: "12:30" }),
        ctx(),
      );
      const orders = await ordersOf(c);
      expect(orders).toHaveLength(3);
      for (const order of orders) {
        expect([order.windowFromTime, order.windowToTime]).toEqual(["08:00", "12:30"]);
      }
      expect(
        await createRecurringOrder(
          t.prisma,
          adminId,
          rule(await customer(), { windowFromTime: "08:00" }),
          ctx(),
        ),
      ).toEqual({ ok: false, error: "invalid" });
    });

    it("stops at endsOn, the last day included", async () => {
      const c = await customer();
      await createRecurringOrder(t.prisma, adminId, rule(c, { endsOn: "2099-06-22" }), ctx());
      expect(await daysOf(c)).toEqual(["2099-06-15", "2099-06-22"]);
      // The cron run afterwards adds nothing.
      expect((await generateRecurringOrders(t.prisma, ctx())).created).toBe(0);
      expect(await daysOf(c)).toEqual(["2099-06-15", "2099-06-22"]);
    });

    it("stops after maxDeliveries, counting orders that were cancelled", async () => {
      const c = await customer();
      await createRecurringOrder(t.prisma, adminId, rule(c, { maxDeliveries: 2 }), ctx());
      expect(await daysOf(c)).toEqual(["2099-06-15", "2099-06-22"]);
      await t.prisma.order.updateMany({
        where: { customerId: c, deliveryDate: new Date("2099-06-15T00:00:00Z") },
        data: { status: "CANCELLED" },
      });
      // The cancelled delivery still counts: the rule is used up.
      expect((await generateRecurringOrders(t.prisma, ctx())).created).toBe(0);
      expect(await ordersOf(c)).toHaveLength(2);
    });

    it("stops after maxDeliveries also when earlier orders were deleted since (NUD-201)", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { maxDeliveries: 2 }),
        ctx(),
      );
      if (!created.ok) throw new Error("setup");
      expect(await daysOf(c)).toEqual(["2099-06-15", "2099-06-22"]);
      // What the order retention job does once the deliveries are paid.
      await t.prisma.order.deleteMany({ where: { customerId: c } });

      const later = await generateRecurringOrders(t.prisma, {
        ...ctx(),
        leadDays: 40,
        ruleIds: [created.id],
      });

      // The two deliveries happened: the rule is used up, whatever is left of its orders.
      expect(later.created).toBe(0);
      expect(await ordersOf(c)).toHaveLength(0);
    });

    it("counts the budget across several runs", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { maxDeliveries: 4 }),
        ctx(),
      );
      expect(created).toMatchObject({ ok: true, generated: 3 }); // 15th, 22nd, 29th
      if (!created.ok) throw new Error("setup");
      const later = await generateRecurringOrders(t.prisma, {
        ...ctx(),
        leadDays: 40,
        ruleIds: [created.id],
      });
      expect(later.created).toBe(1); // the 4th delivery, the 6th of July
      expect(await daysOf(c)).toEqual(["2099-06-15", "2099-06-22", "2099-06-29", "2099-07-06"]);
      expect(
        (
          await generateRecurringOrders(t.prisma, {
            ...ctx(),
            leadDays: 40,
            ruleIds: [created.id],
          })
        ).created,
      ).toBe(0);
    });

    it("skips the connected skipped range on both ends", async () => {
      const c = await customer();
      await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { weekdays: [1, 4], skipFrom: "2099-06-17", skipTo: "2099-06-22" }),
        ctx(),
      );
      expect(await daysOf(c)).toEqual(["2099-06-15", "2099-06-25", "2099-06-29"]);
    });

    it("replaces the per-weekday lists on update and keeps the history in the audit snapshot", async () => {
      const c = await customer();
      const created = await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, { weekdays: [1, 4], dayItems: [{ weekday: 4, productId: crate, quantity: 3 }] }),
        ctx(),
      );
      if (!created.ok) throw new Error("setup");
      const result = await updateRecurringOrder(
        t.prisma,
        adminId,
        created.id,
        rule(c, { weekdays: [1, 4], dayItems: [{ weekday: 1, productId: pack, quantity: 9 }] }),
        ctx(),
      );
      expect(result).toMatchObject({ ok: true, generated: 0 });
      expect(
        await t.prisma.recurringOrderDayItem.findMany({
          where: { recurringOrderId: created.id },
          select: { weekday: true, productId: true, quantity: true },
        }),
      ).toEqual([{ weekday: 1, productId: pack, quantity: 9 }]);
      // The already generated Thursday orders keep their old items.
      const orders = await ordersOf(c);
      expect(orders[1]!.items.map((i) => [i.productId, i.quantity])).toEqual([[crate, 3]]);
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: created.id, action: "recurring.update" },
      });
      expect(audit.diff).toMatchObject({
        // Quantities in the audit log are scaled by 100 (`toAuditQuantity`).
        before: { dayItems: [{ weekday: 4, productId: crate, quantity: 300 }], monthlyRules: [] },
        after: { dayItems: [{ weekday: 1, productId: pack, quantity: 900 }], monthlyRules: [] },
      });
    });

    it("exposes the new fields in the rule view of the customer page", async () => {
      const c = await customer();
      await createRecurringOrder(
        t.prisma,
        adminId,
        rule(c, {
          weekdays: [1],
          monthlyRules: [{ kind: "nthWeekday", nth: -1, weekday: 5 }],
          windowFromTime: "09:00",
          windowToTime: "11:00",
          skipFrom: "2099-08-01",
          skipTo: "2099-08-14",
          endsOn: "2099-09-30",
          maxDeliveries: 12,
          dayItems: [{ weekday: 1, productId: crate, quantity: 4 }],
        }),
        ctx(),
      );
      const [view] = await listRecurringOrders(t.prisma, c, TODAY);
      expect(view).toMatchObject({
        weekdays: [1],
        monthlyRules: [{ kind: "nthWeekday", nth: -1, weekday: 5 }],
        windowFromTime: "09:00",
        windowToTime: "11:00",
        skipFrom: "2099-08-01",
        skipTo: "2099-08-14",
        endsOn: "2099-09-30",
        maxDeliveries: 12,
        state: "active",
      });
      expect(view!.dayItems).toEqual([
        {
          weekday: 1,
          productId: crate,
          productName: expect.anything(),
          unit: "CRATE",
          quantity: 4,
        },
      ]);
      expect(view!.nextDates).toEqual(["2099-06-15", "2099-06-22", "2099-06-26"]);
    });
  },
);
