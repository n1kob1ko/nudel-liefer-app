// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { requireDepot } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider } from "./routing";
import { createTestDb, type TestDb } from "./test-db";

/**
 * NUD-212: the route of a delivery day is its standing tour in fixed order plus the extras of that
 * day; "An Fahrer senden" releases one tour per route and sends changes again later.
 */
const { loadDayRoutes, sendDayWith } = await import("./day-routes");

const NOW = new Date("2099-06-20T10:00:00Z");
const DEPOT = { lat: 48.2555, lng: 16.4682 };
const SETTINGS = {
  depotName: "Nudelfabrik",
  depotAddress: "Schillingstraße 17",
  depotLat: DEPOT.lat,
  depotLng: DEPOT.lng,
  timezone: "Europe/Vienna",
  departureTime: "07:00",
  serviceMinutesPerStop: 10,
  deliveryWeekdays: [1, 2, 3, 4, 5],
};

describe.skipIf(!process.env.DATABASE_URL)("day routes (NUD-212)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let anna: string;
  let bernd: string;
  let van1: string;
  let van2: string;
  let product: string;
  let north: string;
  let south: string;
  const c: Record<string, string> = {};
  let dayCounter = 0;
  let day: Date;
  let dayText: string;

  const deps = () => ({
    db: t.prisma,
    actorId: adminId,
    provider: new LocalHeuristicProvider(),
    requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
    loadSettings: async () => SETTINGS,
    now: () => NOW,
  });
  const send = (extra: Record<string, unknown> = {}) =>
    sendDayWith(deps(), { date: dayText, ...extra });
  const order = (customer: string, quantity = 2) =>
    t.prisma.order
      .create({
        data: {
          customerId: c[customer]!,
          deliveryDate: day,
          windowFrom: day,
          windowTo: day,
          status: "CONFIRMED",
          createdById: adminId,
          items: { create: [{ productId: product, quantity }] },
        },
      })
      .then((o) => o.id);
  const tourOf = (standingTourId: string) =>
    t.prisma.tour.findFirstOrThrow({
      where: { date: day, standingTourId },
      include: {
        stops: { orderBy: { sequence: "asc" }, include: { customer: true } },
      },
    });
  const names = async (standingTourId: string) =>
    (await tourOf(standingTourId)).stops.map((s) => s.customer.customerNumber);

  beforeAll(async () => {
    t = await createTestDb();
    const hash = await hashSecret("123456");
    adminId = (
      await t.prisma.user.create({
        data: { role: "ADMIN", email: "a@example.com", passwordHash: hash, displayName: "A" },
      })
    ).id;
    const driver = (username: string, displayName: string) =>
      t.prisma.user
        .create({ data: { role: "DRIVER", username, passwordHash: hash, displayName } })
        .then((u) => u.id);
    anna = await driver("anna", "Anna");
    bernd = await driver("bernd", "Bernd");
    van1 = (await t.prisma.vehicle.create({ data: { name: "Van 1", capacityKg: 1000 } })).id;
    van2 = (await t.prisma.vehicle.create({ data: { name: "Van 2", capacityKg: 1000 } })).id;
    product = (
      await t.prisma.product.create({
        data: {
          sku: "N",
          unit: "CRATE",
          weightKgPerUnit: 10,
          name: { de: "Nudeln", meta: { source: "de", machine: {} } },
        },
      })
    ).id;
    await t.prisma.settings.create({ data: { id: 1, ...SETTINGS, depotPinConfirmed: true } });
    const customer = (n: string, lat: number | null, lng: number | null) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: n,
            name: n,
            street: "x",
            postalCode: "1000",
            city: "Wien",
            lat,
            lng,
          },
        })
        .then((row) => (c[n] = row.id));
    // North (1210) and south-west (1020 / 1030 / 1100) of the depot in 1220.
    await customer("N1", 48.257, 16.399);
    await customer("N2", 48.28, 16.41);
    await customer("S1", 48.2241, 16.4026);
    await customer("S2", 48.1949, 16.3866);
    await customer("S3", 48.175, 16.378);
    await customer("X-Loewengasse", 48.2099, 16.3914);
    await customer("Y-Stammersdorf", 48.304, 16.415);
    await customer("Z-ohne-Ort", null, null);
    north = (
      await t.prisma.standingTour.create({
        data: {
          name: "Nord",
          sortOrder: 0,
          driverId: anna,
          vehicleId: van1,
          customers: {
            create: ["N1", "N2"].map((n, i) => ({ customerId: c[n]!, sortOrder: i })),
          },
        },
      })
    ).id;
    south = (
      await t.prisma.standingTour.create({
        data: {
          name: "Süd",
          sortOrder: 1,
          driverId: bernd,
          vehicleId: van2,
          customers: {
            create: ["S1", "S2", "S3"].map((n, i) => ({ customerId: c[n]!, sortOrder: i })),
          },
        },
      })
    ).id;
  }, 60_000);
  afterAll(async () => {
    await t?.teardown();
  });
  beforeEach(async () => {
    dayCounter += 1;
    day = new Date(Date.UTC(2099, 6, dayCounter));
    dayText = day.toISOString().slice(0, 10);
    await t.prisma.standingTour.update({
      where: { id: north },
      data: { driverId: anna, vehicleId: van1, active: true },
    });
    await t.prisma.standingTour.update({
      where: { id: south },
      data: { driverId: bernd, vehicleId: van2, active: true },
    });
  });

  it("places an extra where the detour is smallest", async () => {
    await order("X-Loewengasse");
    const plan = await loadDayRoutes(t.prisma, day, DEPOT);
    expect(plan.places.get(c["X-Loewengasse"]!)).toEqual({ routeId: south, slot: 1, moved: false });
    expect(plan.routes.find((r) => r.id === south)?.order).toEqual(
      ["S1", "X-Loewengasse", "S2", "S3"].map((n) => c[n]),
    );
  });

  it("sends one released tour per route, in standing order, with driver and vehicle", async () => {
    for (const n of ["S3", "N2", "S1", "X-Loewengasse", "N1"]) await order(n);
    const result = await send();
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.routes.map((r) => [r.standingTourId, r.outcome, r.stopCount])).toEqual([
      [north, "sent", 2],
      [south, "sent", 3],
    ]);
    expect(await names(north)).toEqual(["N1", "N2"]);
    expect(await names(south)).toEqual(["S1", "X-Loewengasse", "S3"]);
    const tour = await tourOf(south);
    expect(tour).toMatchObject({
      status: "RELEASED",
      driverId: bernd,
      vehicleId: van2,
      releaseRevision: 1,
    });
    expect(tour.stops.every((s) => s.etaAt !== null && s.trip === 1)).toBe(true);
  });

  it("does nothing on a second send without changes", async () => {
    await order("N1");
    await send();
    const again = await send();
    expect(again.ok && again.routes.map((r) => r.outcome)).toEqual(["unchanged", "empty"]);
    expect((await tourOf(north)).releaseRevision).toBe(1);
  });

  it("sends a changed quantity and a new customer again, in route order", async () => {
    const first = await order("S1");
    await order("S3");
    await send();
    await t.prisma.orderItem.updateMany({ where: { orderId: first }, data: { quantity: 5 } });
    await order("S2");
    const result = await send();
    expect(result.ok && result.routes.find((r) => r.standingTourId === south)?.outcome).toBe(
      "updated",
    );
    const tour = await tourOf(south);
    expect(tour.stops.map((s) => s.customer.customerNumber)).toEqual(["S1", "S2", "S3"]);
    expect(tour.releaseRevision).toBe(2);
    expect(tour.stops[0]!.items).toEqual([{ productId: product, quantity: 5 }]);
    expect(tour.stops[1]!.changeKind).toBe("ADDED");
  });

  it("moves an extra to the other route after both were sent", async () => {
    await order("N1");
    const extra = await order("X-Loewengasse");
    await order("S1");
    await send();
    expect(await names(south)).toEqual(["S1", "X-Loewengasse"]);
    await t.prisma.order.update({
      where: { id: extra },
      data: { routeStandingTourId: north, routeSlot: 2 },
    });
    const result = await send();
    expect(result.ok && result.routes.map((r) => r.outcome)).toEqual(["updated", "updated"]);
    expect(await names(south)).toEqual(["S1"]);
    expect(await names(north)).toEqual(["N1", "X-Loewengasse"]);
  });

  it("keeps completed stops and sends the open ones in route order", async () => {
    await order("S1");
    const s3 = await order("S3");
    await send();
    const done = (await tourOf(south)).stops[0]!;
    await t.prisma.stop.update({
      where: { id: done.id },
      data: { status: "DELIVERED", completedAt: NOW },
    });
    await t.prisma.orderItem.updateMany({ where: { orderId: s3 }, data: { quantity: 7 } });
    await order("S2");
    await send();
    const tour = await tourOf(south);
    expect(tour.stops.map((s) => [s.customer.customerNumber, s.status])).toEqual([
      ["S1", "DELIVERED"],
      ["S2", "PENDING"],
      ["S3", "PENDING"],
    ]);
    expect(tour.stops[0]!.items).toEqual(done.items);
  });

  it("refuses an overloaded route for every route and sends it with the confirmation", async () => {
    await order("N1");
    await order("S1", 120);
    const refused = await send();
    expect(refused).toEqual({ ok: false, error: "overloaded", standingTourId: south, overKg: 200 });
    expect(await t.prisma.tour.count({ where: { date: day } })).toBe(0);
    const sent = await send({ overrideOverload: true });
    expect(sent.ok && sent.routes.map((r) => r.outcome)).toEqual(["sent", "sent"]);
  });

  it("names the route that has no driver or no vehicle", async () => {
    await order("N1");
    await t.prisma.standingTour.update({ where: { id: north }, data: { driverId: null } });
    expect(await send()).toEqual({ ok: false, error: "driver_required", standingTourId: north });
    await t.prisma.standingTour.update({
      where: { id: north },
      data: { driverId: anna, vehicleId: null },
    });
    expect(await send()).toEqual({ ok: false, error: "vehicle_required", standingTourId: north });
  });

  it("takes a new standing driver over on a sent route", async () => {
    await order("N1");
    await send();
    await t.prisma.standingTour.update({ where: { id: north }, data: { driverId: bernd } });
    const result = await send();
    expect(result.ok && result.routes[0]!.outcome).toBe("updated");
    expect((await tourOf(north)).driverId).toBe(bernd);
  });

  it("reports a customer without any location and sends the rest", async () => {
    await order("Z-ohne-Ort");
    await order("N1");
    const result = await send();
    expect(result.ok && result.warnings.map((w) => w.customerId)).toEqual([c["Z-ohne-Ort"]]);
    expect(await names(north)).toEqual(["N1"]);
  });

  it("refuses without an active standing tour or without any stop", async () => {
    expect(await send()).toEqual({ ok: false, error: "no_stops" });
    await t.prisma.standingTour.updateMany({ data: { active: false } });
    await order("X-Loewengasse");
    expect(await send()).toEqual({ ok: false, error: "no_routes" });
  });

  it("empties an unreleased tour of the old flow so its orders go on the routes", async () => {
    const o = await order("N1");
    const old = await t.prisma.tour.create({
      data: {
        date: day,
        status: "OPTIMIZED",
        depotSnapshot: { name: "x", address: "x", lat: DEPOT.lat, lng: DEPOT.lng },
        stops: {
          create: [
            { customerId: c.N1!, sequence: 1, items: [], orders: { create: [{ orderId: o }] } },
          ],
        },
      },
    });
    const result = await send();
    expect(result.ok && result.routes[0]!.outcome).toBe("sent");
    expect(await t.prisma.stop.count({ where: { tourId: old.id } })).toBe(0);
    expect(await names(north)).toEqual(["N1"]);
  });
});
