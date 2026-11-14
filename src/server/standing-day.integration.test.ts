// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isoWeekday } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";
import { createTourService } from "./tour-service";

/**
 * NUD-186: the day plan ("Tagesplanung"). A standing tour is a fixed group of customers with a
 * default driver; `/admin/planning` shows its customers every delivery day with editable quantities.
 * A save writes normal CONFIRMED orders (0 = nothing ordered, the order stays), so tour planning, the
 * driver app and the packing list need no change.
 */
const {
  moveExtra,
  saveStandingDay,
  saveStandingTour,
  setStandingTourActive,
  setStandingTourDriver,
  setStandingTourVehicle,
  standingDayQuery,
} = await import("./standing-tours");

const DAY = "2099-06-15";
const OTHER_DAY = "2099-06-16";
const date = (d: string) => new Date(`${d}T00:00:00Z`);
const today = date("2099-06-14");

describe.skipIf(!process.env.DATABASE_URL)("day plan (standing tours)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let tours: ReturnType<typeof createTourService>;
  let adminId: string;
  let driverA: string;
  let driverB: string;
  let c1: string;
  let c2: string;
  let c3: string;
  let c4: string;
  let p1: string;
  let p2: string;
  let gone: string;

  const db = () => t.prisma;

  beforeAll(async () => {
    t = await createTestDb();
    tours = createTourService(t.prisma);
    const hash = await hashSecret("123456");
    const user = (data: Parameters<typeof t.prisma.user.create>[0]["data"]) =>
      t.prisma.user.create({ data }).then((u) => u.id);
    adminId = await user({
      role: "ADMIN",
      email: "plan@example.com",
      passwordHash: hash,
      displayName: "Office",
    });
    driverA = await user({
      role: "DRIVER",
      username: "drv-a",
      passwordHash: hash,
      displayName: "Anna",
    });
    driverB = await user({
      role: "DRIVER",
      username: "drv-b",
      passwordHash: hash,
      displayName: "Bernd",
    });
    const customer = (number: string, extra: Record<string, unknown> = {}) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: number,
            name: `Kunde ${number}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            ...extra,
          },
        })
        .then((c) => c.id);
    c1 = await customer("C1");
    c2 = await customer("C2");
    c3 = await customer("C3");
    c4 = await customer("C4");
    const product = (sku: string, sortOrder: number, extra: Record<string, unknown> = {}) =>
      t.prisma.product
        .create({
          data: {
            sku,
            unit: "PACK",
            weightKgPerUnit: 3,
            sortOrder,
            name: { de: sku, meta: { source: "de", machine: {} } },
            ...extra,
          },
        })
        .then((p) => p.id);
    p1 = await product("SACK", 1);
    p2 = await product("KISTE", 2, { unit: "CRATE", weightKgPerUnit: 10 });
    gone = await product("ALT", 3, { active: false });
  }, 60_000);

  afterAll(async () => {
    await t.teardown();
  });

  async function clearDay(day: string) {
    await db().order.deleteMany({ where: { deliveryDate: date(day) } });
    await db().tour.deleteMany({ where: { date: date(day) } });
  }

  async function reset() {
    await clearDay(DAY);
    await clearDay(OTHER_DAY);
    await db().standingTourCustomer.deleteMany({});
    await db().standingTour.deleteMany({});
    await db().recurringOrder.deleteMany({});
    // The audit log is append-only (NUD-092): assertions look at the entries of one entity instead.
  }

  const createRoute = async (name: string, customerIds: string[], driverId?: string) => {
    const result = await saveStandingTour(db(), adminId, {
      name,
      driverId: driverId ?? null,
      customerIds,
    });
    if (!result.ok) throw new Error(result.error);
    return result.id;
  };

  const orderOf = (customerId: string, day = DAY) =>
    db().order.findFirstOrThrow({
      where: { customerId, deliveryDate: date(day) },
      include: { items: { orderBy: { productId: "asc" } } },
    });

  describe("standingDayQuery", () => {
    it("lists the customers of every standing tour, sorted, with the driver and the off-route ones", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1, c2], driverA);
      await createRoute("Stammtour 2", [c3]);

      const plan = await standingDayQuery(db(), DAY, today);
      expect(plan.date).toBe(DAY);
      // The catalog of the migrations already holds the owner's three products; only the active ones
      // are columns, in catalog order.
      const skus = plan.products.map((p) => p.sku);
      expect(skus).toContain("SACK");
      expect(skus).toContain("KISTE");
      expect(skus).not.toContain("ALT");
      expect(plan.routes.map((r) => r.name)).toEqual(["Stammtour 1", "Stammtour 2"]);
      expect(plan.routes[0]).toMatchObject({ driverId: driverA, driverName: "Anna" });
      expect(plan.routes[0]!.rows.map((r) => r.customerNumber)).toEqual(["C1", "C2"]);
      expect(plan.routes[1]).toMatchObject({ driverId: null, driverName: null });
      expect(plan.offRoute.map((r) => r.customerNumber)).toContain("C4");
      expect(plan.editable).toBe(true);
      expect(plan.readOnly).toBeNull();
    });

    it("shows the quantities of the day's confirmed order", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      await db().order.create({
        data: {
          customerId: c1,
          deliveryDate: date(DAY),
          windowFrom: date(DAY),
          windowTo: date(DAY),
          status: "CONFIRMED",
          source: "MANUAL",
          createdById: adminId,
          items: { create: [{ productId: p1, quantity: 2 }] },
        },
      });

      const plan = await standingDayQuery(db(), DAY, today);
      const row = plan.routes[0]!.rows[0]!;
      expect(row.source).toBe("order");
      expect(row.orderCount).toBe(1);
      expect(row.quantities[p1]).toBe(2);
      expect(row.quantities[p2]).toBe(0);
      expect(row.nothing).toBe(false);
      expect(row.weightKg).toBe(6);
    });

    it("suggests the quantities of the recurring rule when no order exists yet", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      await db().recurringOrder.create({
        data: {
          customerId: c1,
          weekdays: [isoWeekday(date(DAY))],
          anchorDate: date("2099-01-01"),
          confirmedById: adminId,
          items: { create: [{ productId: p1, quantity: 4 }] },
        },
      });

      const plan = await standingDayQuery(db(), DAY, today);
      const row = plan.routes[0]!.rows[0]!;
      expect(row.source).toBe("rule");
      expect(row.orderId).toBeNull();
      expect(row.quantities[p1]).toBe(4);
      // Nothing is stored by looking at the plan.
      expect(await db().order.count()).toBe(0);
    });

    it("does not suggest anything for a cancelled order and ignores inactive products", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      await db().recurringOrder.create({
        data: {
          customerId: c1,
          weekdays: [isoWeekday(date(DAY))],
          anchorDate: date("2099-01-01"),
          confirmedById: adminId,
          items: { create: [{ productId: p1, quantity: 4 }] },
        },
      });
      await db().order.create({
        data: {
          customerId: c1,
          deliveryDate: date(DAY),
          windowFrom: date(DAY),
          windowTo: date(DAY),
          status: "CANCELLED",
          source: "MANUAL",
          createdById: adminId,
          items: { create: [{ productId: gone, quantity: 1 }] },
        },
      });

      const plan = await standingDayQuery(db(), DAY, today);
      const row = plan.routes[0]!.rows[0]!;
      expect(row.cancelled).toBe(true);
      expect(row.source).toBe("none");
      expect(row.quantities[p1]).toBe(0);
    });

    it("stays editable once a route of the day is sent, and is read-only for past days (NUD-212)", async () => {
      await reset();
      const route = await createRoute("Stammtour 1", [c1]);
      const spot = await db().vehicle.create({
        data: { name: "Auto", capacityKg: 500 },
      });
      await db().tour.create({
        data: {
          date: date(DAY),
          status: "RELEASED",
          vehicleId: spot.id,
          standingTourId: route,
          depotSnapshot: {},
        },
      });

      const sent = await standingDayQuery(db(), DAY, today);
      expect(sent.editable).toBe(true);
      expect(sent.readOnly).toBeNull();
      expect(sent.routes[0]!.state).toBe("sent");

      const past = await standingDayQuery(db(), "2099-06-13", today);
      expect(past.readOnly).toBe("past");
    });
  });

  describe("saveStandingDay", () => {
    it("creates a confirmed order for the day and audits it", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);

      const result = await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [
            {
              customerId: c1,
              lines: [
                { productId: p1, quantity: 3 },
                { productId: p2, quantity: 1 },
              ],
            },
          ],
        },
        today,
        tours,
      );
      expect(result).toMatchObject({ ok: true, written: 1, created: 1, updated: 0 });

      const order = await orderOf(c1);
      expect(order.status).toBe("CONFIRMED");
      expect(order.source).toBe("MANUAL");
      expect(order.items.map((i) => [i.productId, i.quantity])).toEqual([
        [p1, 3],
        [p2, 1],
      ]);
      // The office wanted exactly this day, the whole day.
      expect(order.windowFrom.toISOString().slice(0, 10)).toBe(DAY);
      expect(order.windowTo.toISOString().slice(0, 10)).toBe(DAY);

      const audit = await db().auditLog.findMany({
        where: { entity: "Order", entityId: order.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("order.create");
    });

    it("writes nothing when the quantities did not change", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      const input = {
        date: DAY,
        rows: [
          {
            customerId: c1,
            lines: [
              { productId: p1, quantity: 2 },
              { productId: p2, quantity: 0 },
            ],
          },
        ],
      };
      await saveStandingDay(db(), adminId, input, today, tours);
      const auditBefore = await db().auditLog.count();
      const ordersBefore = await db().order.count();

      const again = await saveStandingDay(db(), adminId, input, today, tours);
      expect(again).toMatchObject({ ok: true, written: 0 });
      expect(await db().auditLog.count()).toBe(auditBefore);
      expect(await db().order.count()).toBe(ordersBefore);
    });

    it("keeps the order without lines when the customer wants nothing", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [{ customerId: c1, lines: [{ productId: p1, quantity: 2 }] }],
        },
        today,
        tours,
      );

      const result = await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [
            {
              customerId: c1,
              lines: [
                { productId: p1, quantity: 0 },
                { productId: p2, quantity: 0 },
              ],
            },
          ],
        },
        today,
        tours,
      );
      expect(result).toMatchObject({ ok: true, written: 1, updated: 1 });

      const order = await orderOf(c1);
      expect(order.status).toBe("CONFIRMED");
      expect(order.items).toEqual([]);

      const plan = await standingDayQuery(db(), DAY, today);
      expect(plan.routes[0]!.rows[0]!.nothing).toBe(true);
    });

    it("does not create an order for an empty row of a customer who never ordered", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      const result = await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [
            {
              customerId: c1,
              lines: [
                { productId: p1, quantity: 0 },
                { productId: p2, quantity: 0 },
              ],
            },
          ],
        },
        today,
        tours,
      );
      expect(result).toMatchObject({ ok: true, written: 0 });
      expect(await db().order.count()).toBe(0);
    });

    it("merges several confirmed orders of one customer into the first and cancels the rest", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      const make = (quantity: number) =>
        db().order.create({
          data: {
            customerId: c1,
            deliveryDate: date(DAY),
            windowFrom: date(DAY),
            windowTo: date(DAY),
            status: "CONFIRMED",
            source: "MANUAL",
            createdById: adminId,
            items: { create: [{ productId: p1, quantity }] },
          },
        });
      const first = await make(1);
      const second = await make(2);

      const result = await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [{ customerId: c1, lines: [{ productId: p1, quantity: 7 }] }],
        },
        today,
        tours,
      );
      expect(result).toMatchObject({ ok: true, written: 1, updated: 1, merged: 1 });

      const kept = await db().order.findUniqueOrThrow({
        where: { id: first.id },
        include: { items: true },
      });
      expect(kept.status).toBe("CONFIRMED");
      expect(kept.items.map((i) => i.quantity)).toEqual([7]);
      const cancelled = await db().order.findUniqueOrThrow({ where: { id: second.id } });
      expect(cancelled.status).toBe("CANCELLED");
    });

    it("adds an off-route customer for that day only", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      const result = await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [{ customerId: c4, lines: [{ productId: p1, quantity: 2 }] }],
        },
        today,
        tours,
      );
      expect(result).toMatchObject({ ok: true, written: 1, created: 1 });
      expect((await orderOf(c4)).status).toBe("CONFIRMED");
      // The membership did not change: C4 rides along as an extra of the day (NUD-212).
      const plan = await standingDayQuery(db(), DAY, today);
      expect(plan.offRoute.map((row) => row.customerId)).not.toContain(c4);
      const extra = plan.routes[0]!.rows.find((row) => row.customerId === c4);
      expect(extra?.extra).toMatchObject({ moved: false });
      const members = await db().standingTourCustomer.findMany({ select: { customerId: true } });
      expect(members.map((m) => m.customerId)).toEqual([c1]);
    });

    it("flags the open tour of the day as outdated", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      const tour = await db().tour.create({
        data: { date: date(DAY), status: "OPTIMIZED", depotSnapshot: {} },
      });
      await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [{ customerId: c1, lines: [{ productId: p1, quantity: 2 }] }],
        },
        today,
        tours,
      );
      const after = await db().tour.findUniqueOrThrow({ where: { id: tour.id } });
      expect(after.isOutdated).toBe(true);
    });

    it("saves a day whose route is sent and refuses a day in the past (NUD-212)", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      await db().tour.create({
        data: { date: date(DAY), status: "RELEASED", depotSnapshot: {} },
      });
      const released = await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [{ customerId: c1, lines: [{ productId: p1, quantity: 2 }] }],
        },
        today,
        tours,
      );
      expect(released).toMatchObject({ ok: true, written: 1 });

      const past = await saveStandingDay(
        db(),
        adminId,
        {
          date: "2099-06-01",
          rows: [{ customerId: c1, lines: [{ productId: p1, quantity: 2 }] }],
        },
        today,
        tours,
      );
      expect(past).toEqual({ ok: false, error: "date_in_past" });
    });

    it("rejects an inactive product, an unknown customer and broken input", async () => {
      await reset();
      const inactive = await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [{ customerId: c1, lines: [{ productId: gone, quantity: 1 }] }],
        },
        today,
        tours,
      );
      expect(inactive).toEqual({ ok: false, error: "product_inactive" });

      const unknown = await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [{ customerId: "does-not-exist", lines: [{ productId: p1, quantity: 1 }] }],
        },
        today,
        tours,
      );
      expect(unknown).toEqual({ ok: false, error: "customer_not_found" });

      expect(await saveStandingDay(db(), adminId, { date: DAY, rows: [] }, today, tours)).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(
        await saveStandingDay(
          db(),
          adminId,
          {
            date: DAY,
            rows: [{ customerId: c1, lines: [{ productId: p1, quantity: -1 }] }],
          },
          today,
          tours,
        ),
      ).toEqual({ ok: false, error: "invalid" });
    });
  });

  describe("standing tours", () => {
    it("creates, renames and reassigns the customers of a group", async () => {
      await reset();
      const id = await createRoute("Stammtour 1", [c1, c2], driverA);
      const audit = await db().auditLog.findMany({
        where: { entity: "StandingTour", entityId: id },
      });
      expect(audit.map((a) => a.action)).toEqual(["standing_tour.create"]);

      const renamed = await saveStandingTour(db(), adminId, {
        id,
        name: "Stammtour Nord",
        driverId: driverB,
        customerIds: [c2, c3],
      });
      expect(renamed).toMatchObject({ ok: true, created: false });

      const plan = await standingDayQuery(db(), DAY, today);
      expect(plan.routes[0]).toMatchObject({
        name: "Stammtour Nord",
        driverId: driverB,
        driverName: "Bernd",
      });
      expect(plan.routes[0]!.rows.map((row) => row.customerId)).toEqual([c2, c3]);
      expect(plan.offRoute.map((row) => row.customerId)).toContain(c1);
    });

    it("rejects a duplicate name and a customer of another group", async () => {
      await reset();
      await createRoute("Stammtour 1", [c1]);
      expect(
        await saveStandingTour(db(), adminId, {
          name: "stammtour 1",
          customerIds: [c3],
        }),
      ).toEqual({ ok: false, error: "name_taken" });

      expect(
        await saveStandingTour(db(), adminId, {
          name: "Stammtour 2",
          customerIds: [c1],
        }),
      ).toEqual({ ok: false, error: "customer_in_other" });
    });

    it("changes the driver and archives a group without touching its orders", async () => {
      await reset();
      const id = await createRoute("Stammtour 1", [c1, c2], driverA);
      await saveStandingDay(
        db(),
        adminId,
        {
          date: DAY,
          rows: [{ customerId: c1, lines: [{ productId: p1, quantity: 2 }] }],
        },
        today,
        tours,
      );

      expect(await setStandingTourDriver(db(), adminId, id, driverB)).toMatchObject({
        ok: true,
        active: true,
      });
      const driverChange = await db().auditLog.findFirstOrThrow({
        where: { action: "standing_tour.driver", entityId: id },
      });
      expect(driverChange.diff).toMatchObject({ from: driverA, to: driverB });

      expect(await setStandingTourActive(db(), adminId, id, false)).toMatchObject({ ok: true });
      const plan = await standingDayQuery(db(), DAY, today);
      expect(plan.routes).toEqual([]);
      // The customers are off-route now; the order of the day stays untouched.
      const offRoute = plan.offRoute.map((row) => row.customerId);
      expect(offRoute).toContain(c1);
      expect(offRoute).toContain(c2);
      expect((await orderOf(c1)).status).toBe("CONFIRMED");

      expect(await setStandingTourDriver(db(), adminId, id, "nope")).toEqual({
        ok: false,
        error: "invalid",
      });
    });

    it("sets the vehicle of a standing tour and audits it (NUD-212)", async () => {
      await reset();
      const id = await createRoute("Stammtour 1", [c1]);
      const van = await db().vehicle.create({ data: { name: "Van", capacityKg: 800 } });
      expect(await setStandingTourVehicle(db(), adminId, id, van.id)).toMatchObject({ ok: true });
      expect((await db().standingTour.findUniqueOrThrow({ where: { id } })).vehicleId).toBe(van.id);
      const change = await db().auditLog.findFirstOrThrow({
        where: { action: "standing_tour.vehicle", entityId: id },
      });
      expect(change.diff).toMatchObject({ from: null, to: van.id });
      const plan = await standingDayQuery(db(), DAY, today);
      expect(plan.routes[0]).toMatchObject({ vehicleId: van.id, capacityKg: 800 });
      expect(await setStandingTourVehicle(db(), adminId, id, "nope")).toEqual({
        ok: false,
        error: "invalid",
      });
    });
  });

  describe("moveExtra (NUD-212)", () => {
    it("puts an extra on the chosen route and slot, and back to the suggestion", async () => {
      await reset();
      const first = await createRoute("Stammtour 1", [c1]);
      const second = await createRoute("Stammtour 2", [c2, c3]);
      await saveStandingDay(
        db(),
        adminId,
        { date: DAY, rows: [{ customerId: c4, lines: [{ productId: p1, quantity: 2 }] }] },
        today,
        tours,
      );
      const move = (standingTourId: string | null, slot: number | null) =>
        moveExtra(db(), adminId, { date: DAY, customerId: c4, standingTourId, slot }, today, tours);

      expect(await move(second, 1)).toEqual({ ok: true });
      let plan = await standingDayQuery(db(), DAY, today);
      const route2 = plan.routes.find((r) => r.id === second)!;
      expect(route2.rows.map((r) => r.customerId)).toEqual([c2, c4, c3]);
      expect(route2.rows[1]!.extra).toEqual({ moved: true, slot: 1 });
      expect(plan.routes.find((r) => r.id === first)!.rows.map((r) => r.customerId)).toEqual([c1]);

      expect(await move(null, null)).toEqual({ ok: true });
      plan = await standingDayQuery(db(), DAY, today);
      const back = plan.routes.flatMap((r) => r.rows).find((r) => r.customerId === c4);
      expect(back?.extra).toMatchObject({ moved: false });
    });

    it("refuses a standing customer, an unknown route, a past day and a customer without order", async () => {
      await reset();
      const route = await createRoute("Stammtour 1", [c1]);
      const move = (input: Record<string, unknown>, day = today) =>
        moveExtra(db(), adminId, { date: DAY, slot: 0, ...input }, day, tours);
      expect(await move({ customerId: c1, standingTourId: route })).toEqual({
        ok: false,
        error: "standing_customer",
      });
      expect(await move({ customerId: c4, standingTourId: "nope" })).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await move({ customerId: c4, standingTourId: route, slot: -1 })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await move({ customerId: c4, standingTourId: route })).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await move({ customerId: c4, standingTourId: route }, date("2099-06-20"))).toEqual({
        ok: false,
        error: "date_in_past",
      });
    });
  });
});
