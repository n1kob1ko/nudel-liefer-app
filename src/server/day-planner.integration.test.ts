// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireDepot } from "@/domain/settings";

import { hashSecret } from "./auth/password";
import { LocalHeuristicProvider, setRoutingProviderForTests } from "./routing";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("next/cache", () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { planDayWith } = await import("./day-planner");
const { editTourWith } = await import("./tour-edit");
const { getTourPlan, releaseTourWith, reorderStopsWith } = await import("./tour-planning");
const { getDriverTour } = await import("./tour-driver");
const { getTourPrint } = await import("./tour-print");

const DAY = new Date("2099-07-01T00:00:00Z");
const DAY_TEXT = "2099-07-01";
const NOW = new Date("2099-06-20T10:00:00Z");
const DEPOT = { lat: 48.2, lng: 16.3 };
const SETTINGS = {
  depotName: "Nudelfabrik",
  depotAddress: "Graben 1, 1010 Wien",
  depotLat: DEPOT.lat,
  depotLng: DEPOT.lng,
  timezone: "Europe/Vienna",
  departureTime: "07:00",
  serviceMinutesPerStop: 10,
  deliveryWeekdays: [1, 2, 3, 4, 5],
};
/** Eight customers on a ring around the depot. */
const RING: Array<[number, number]> = [
  [0.05, 0],
  [0.04, 0.04],
  [0, 0.05],
  [-0.04, 0.04],
  [-0.05, 0],
  [-0.04, -0.04],
  [0, -0.05],
  [0.04, -0.04],
];

describe.skipIf(!process.env.DATABASE_URL)(
  "plan the day (several tours, reload trips)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    const drivers: string[] = [];
    let productId: string;
    const provider = new LocalHeuristicProvider();
    const deps = () => ({
      db: t.prisma,
      actorId: adminId,
      provider,
      requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
      loadSettings: async () => SETTINGS,
      now: () => NOW,
    });
    const vehicle = (name: string, capacityKg: number) =>
      t.prisma.vehicle.create({ data: { name, capacityKg } }).then((v) => v.id);

    /** `count` customers on the ring, each ordering `crates` Kiste of 10 kg. */
    async function customers(count: number, crates = 10) {
      const ids: string[] = [];
      for (const [i, [dLat, dLng]] of RING.slice(0, count).entries()) {
        const c = await t.prisma.customer.create({
          data: {
            customerNumber: `C${i + 1}`,
            name: `Kunde ${i + 1}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: DEPOT.lat + dLat,
            lng: DEPOT.lng + dLng,
          },
        });
        ids.push(c.id);
        await t.prisma.order.create({
          data: {
            customerId: c.id,
            deliveryDate: DAY,
            windowFrom: DAY,
            windowTo: DAY,
            status: "CONFIRMED",
            createdById: adminId,
            items: { create: [{ productId, quantity: crates }] },
          },
        });
      }
      return ids;
    }
    const tours = () =>
      t.prisma.tour.findMany({
        where: { date: DAY },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { stops: { orderBy: { sequence: "asc" } } },
      });
    const kg = (items: unknown) =>
      (items as Array<{ quantity: number }>).reduce((sum, i) => sum + i.quantity * 10, 0);
    const tripLoads = (stops: Array<{ trip: number; items: unknown }>) => {
      const loads = new Map<number, number>();
      for (const s of stops) loads.set(s.trip, (loads.get(s.trip) ?? 0) + kg(s.items));
      return [...loads.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    };

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      const hash = await hashSecret("123456");
      adminId = (
        await t.prisma.user.create({
          data: { role: "ADMIN", email: "a@example.com", passwordHash: hash, displayName: "A" },
        })
      ).id;
      for (const name of ["Anna", "Bruno", "Cem"]) {
        drivers.push(
          (
            await t.prisma.user.create({
              data: {
                role: "DRIVER",
                username: name.toLowerCase(),
                passwordHash: hash,
                displayName: name,
              },
            })
          ).id,
        );
      }
      productId = (
        await t.prisma.product.create({
          data: {
            sku: "P1",
            unit: "CRATE",
            weightKgPerUnit: 10,
            name: { de: "P1", meta: { source: "de", machine: {} } },
          },
        })
      ).id;
    }, 60_000);
    afterAll(async () => {
      await t?.teardown();
    });
    beforeEach(async () => {
      state.session = { user: { id: adminId } };
      setRoutingProviderForTests(provider);
      await t.prisma.settings.deleteMany();
      await t.prisma.settings.create({ data: { id: 1, ...SETTINGS, depotPinConfirmed: true } });
      await t.prisma.tour.deleteMany();
      await t.prisma.orderItem.deleteMany();
      await t.prisma.order.deleteMany();
      await t.prisma.parkingSpot.deleteMany();
      await t.prisma.standingTour.deleteMany();
      await t.prisma.customer.deleteMany();
      await t.prisma.vehicle.deleteMany();
    });

    it("2 vehicles x 500 kg, 800 kg of stops -> two tours, neither over capacity", async () => {
      const v1 = await vehicle("Van 1", 500);
      const v2 = await vehicle("Van 2", 500);
      await customers(8);
      const result = await planDayWith(deps(), { date: DAY_TEXT });

      expect(result).toMatchObject({ ok: true, reloadTrips: 0, approximate: true });
      const day = await tours();
      expect(day).toHaveLength(2);
      expect(day.map((x) => x.vehicleId).sort()).toEqual([v1, v2].sort());
      for (const tour of day) {
        expect(tour.status).toBe("OPTIMIZED");
        expect(tour.stops.every((s) => s.trip === 1)).toBe(true);
        expect(Math.max(...tripLoads(tour.stops))).toBeLessThanOrEqual(500);
        expect(tour.geometry).not.toBeNull();
        expect(tour.stops.map((s) => s.sequence)).toEqual(tour.stops.map((_, i) => i + 1));
      }
      expect(day.flatMap((x) => x.stops).length).toBe(8);
      // Every order is on exactly one stop of exactly one tour.
      const links = await t.prisma.stopOrder.findMany();
      expect(new Set(links.map((l) => l.orderId)).size).toBe(8);
      expect(links).toHaveLength(8);
    });

    it("1 vehicle x 500 kg, 800 kg of stops -> one tour with a reload trip, each trip <= 500 kg", async () => {
      const v1 = await vehicle("Van 1", 500);
      await customers(8);
      const result = await planDayWith(deps(), { date: DAY_TEXT });

      expect(result).toMatchObject({ ok: true, reloadTrips: 1 });
      const day = await tours();
      expect(day).toHaveLength(1);
      const [tour] = day;
      expect(tour!.vehicleId).toBe(v1);
      expect(new Set(tour!.stops.map((s) => s.trip))).toEqual(new Set([1, 2]));
      expect(tripLoads(tour!.stops).every((load) => load <= 500)).toBe(true);
      expect(tripLoads(tour!.stops).reduce((a, b) => a + b, 0)).toBe(800);
      // trips are contiguous in tour order and the ETAs keep increasing across the reload
      expect(tour!.stops.map((s) => s.trip)).toEqual([...tour!.stops.map((s) => s.trip)].sort());
      const etas = tour!.stops.map((s) => s.etaAt!.getTime());
      expect(etas).toEqual([...etas].sort((a, b) => a - b));
      // The reload (way back + 20 min at the depot) is part of the tour duration.
      const firstOfTrip2 = tour!.stops.find((s) => s.trip === 2)!;
      const lastOfTrip1 = [...tour!.stops].reverse().find((s) => s.trip === 1)!;
      expect(firstOfTrip2.etaAt!.getTime() - lastOfTrip1.etaAt!.getTime()).toBeGreaterThan(
        (10 * 60 + 20 * 60) * 1000,
      );

      // The load indicator reads per trip: 800 kg in total is fine with a 500 kg vehicle.
      await t.prisma.tour.update({ where: { id: tour!.id }, data: { driverId: drivers[0] } });
      const released = await releaseTourWith(
        t.prisma,
        adminId,
        {
          tourId: tour!.id,
          version: (
            await t.prisma.tour.findUniqueOrThrow({ where: { id: tour!.id } })
          ).updatedAt.toISOString(),
        },
        NOW,
      );
      expect(released).toMatchObject({ ok: true });
    });

    it("a stop heavier than the vehicle is reported and still needs the overload override", async () => {
      await vehicle("Small", 500);
      const [customerId] = await customers(1, 80); // 800 kg in one stop
      const result = await planDayWith(deps(), { date: DAY_TEXT });
      expect(result).toMatchObject({ ok: true, oversizedCustomerIds: [customerId] });
      const [tour] = await tours();
      await t.prisma.tour.update({ where: { id: tour!.id }, data: { driverId: drivers[0] } });
      const version = (
        await t.prisma.tour.findUniqueOrThrow({ where: { id: tour!.id } })
      ).updatedAt.toISOString();
      expect(await releaseTourWith(t.prisma, adminId, { tourId: tour!.id, version }, NOW)).toEqual({
        ok: false,
        error: "overloaded",
      });
    });

    it("uses only the vehicles that are needed, none for a small day", async () => {
      await vehicle("Van 1", 500);
      await vehicle("Van 2", 500);
      await customers(3); // 300 kg
      await planDayWith(deps(), { date: DAY_TEXT });
      expect(await tours()).toHaveLength(1);
    });

    it("honours the selected vehicles and pairs the selected drivers in order", async () => {
      const v1 = await vehicle("Van 1", 500);
      const v2 = await vehicle("Van 2", 500);
      await vehicle("Van 3", 500);
      await customers(8);
      const result = await planDayWith(deps(), {
        date: DAY_TEXT,
        vehicleIds: [v1, v2],
        driverIds: [drivers[2]!, drivers[0]!],
      });
      expect(result).toMatchObject({ ok: true });
      const day = await tours();
      expect(day.map((x) => x.vehicleId).sort()).toEqual([v1, v2].sort());
      expect(day.map((x) => x.driverId)).toEqual([drivers[2], drivers[0]]);
    });

    it("standing tours: each default driver gets his customers, the rest the free driver (NUD-209)", async () => {
      // Without standing tours one 2000 kg van would take the whole small day.
      await vehicle("Big", 2000);
      await vehicle("Van 2", 500);
      await vehicle("Van 3", 500);
      const ids = await customers(8, 5); // 50 kg each
      const standing = (name: string, driverId: string, customerIds: string[]) =>
        t.prisma.standingTour.create({
          data: {
            name,
            driverId,
            customers: {
              create: customerIds.map((customerId, i) => ({ customerId, sortOrder: i })),
            },
          },
        });
      await standing("Nord", drivers[0]!, ids.slice(0, 3));
      await standing("Süd", drivers[1]!, ids.slice(4, 7));

      const result = await planDayWith(deps(), { date: DAY_TEXT, driverIds: drivers });
      expect(result).toMatchObject({ ok: true });
      const day = await tours();
      const customersOf = (driverId: string) =>
        day
          .find((tour) => tour.driverId === driverId)!
          .stops.map((s) => s.customerId)
          .sort();
      expect(day).toHaveLength(3);
      expect(customersOf(drivers[0]!)).toEqual(ids.slice(0, 3).sort());
      expect(customersOf(drivers[1]!)).toEqual(ids.slice(4, 7).sort());
      expect(customersOf(drivers[2]!)).toEqual([ids[3]!, ids[7]!].sort());
      expect(new Set(day.map((tour) => tour.vehicleId)).size).toBe(3);
    });

    it("standing tours without a free driver: the others join the nearest standing tour (NUD-209)", async () => {
      await vehicle("Van 1", 500);
      await vehicle("Van 2", 500);
      const ids = await customers(8, 5);
      await t.prisma.standingTour.create({
        data: {
          name: "Nord",
          driverId: drivers[0]!,
          customers: { create: [{ customerId: ids[0]!, sortOrder: 0 }] },
        },
      });
      await t.prisma.standingTour.create({
        data: {
          name: "Süd",
          driverId: drivers[1]!,
          customers: { create: [{ customerId: ids[4]!, sortOrder: 0 }] },
        },
      });
      const result = await planDayWith(deps(), {
        date: DAY_TEXT,
        driverIds: [drivers[0]!, drivers[1]!],
      });
      expect(result).toMatchObject({ ok: true });
      const day = await tours();
      expect(day.map((tour) => tour.driverId)).toEqual([drivers[0], drivers[1]]);
      // Every customer is planned once, and each standing customer stays with his driver.
      expect(day.flatMap((tour) => tour.stops).length).toBe(8);
      expect(day[0]!.stops.map((s) => s.customerId)).toContain(ids[0]);
      expect(day[1]!.stops.map((s) => s.customerId)).toContain(ids[4]);
      // RING[2] (north-east of the ring) is nearer to customer 1 than to customer 5.
      expect(day[0]!.stops.map((s) => s.customerId)).toContain(ids[1]);
    });

    it("rejects an unknown or inactive vehicle / driver and an empty fleet", async () => {
      await customers(2);
      expect(await planDayWith(deps(), { date: DAY_TEXT })).toMatchObject({
        ok: false,
        error: "no_vehicles",
      });
      const v = await vehicle("Van", 500);
      await t.prisma.vehicle.update({ where: { id: v }, data: { active: false } });
      expect(await planDayWith(deps(), { date: DAY_TEXT, vehicleIds: [v] })).toMatchObject({
        ok: false,
        error: "vehicle_invalid",
      });
      const active = await vehicle("Van 2", 500);
      expect(
        await planDayWith(deps(), { date: DAY_TEXT, vehicleIds: [active], driverIds: ["nope"] }),
      ).toMatchObject({ ok: false, error: "driver_invalid" });
      expect(await planDayWith(deps(), { date: "x", vehicleIds: [active] })).toMatchObject({
        ok: false,
        error: "invalid_date",
      });
      expect(await planDayWith(deps(), { date: DAY_TEXT, extra: 1 })).toMatchObject({
        ok: false,
        error: "invalid",
      });
      expect(await tours()).toHaveLength(0);
    });

    it("planning again rebuilds the unreleased tours: no duplicate stops, surplus tours emptied", async () => {
      await vehicle("Van 1", 500);
      await vehicle("Van 2", 500);
      await customers(8);
      await planDayWith(deps(), { date: DAY_TEXT });
      const first = await tours();
      expect(first).toHaveLength(2);

      await planDayWith(deps(), { date: DAY_TEXT });
      const second = await tours();
      expect(second.map((x) => x.id)).toEqual(first.map((x) => x.id));
      expect(second.flatMap((x) => x.stops)).toHaveLength(8);
      expect(await t.prisma.stopOrder.count()).toBe(8);

      // Only the first vehicle is selected now: the second tour stays as an empty tour.
      const only = (await t.prisma.vehicle.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
      await planDayWith(deps(), { date: DAY_TEXT, vehicleIds: [only] });
      const third = await tours();
      expect(third).toHaveLength(2);
      expect(third[0]!.stops.length).toBe(8);
      expect(third[1]!.stops).toHaveLength(0);
      expect(third[1]!.vehicleId).toBeNull();
      const audits = await t.prisma.auditLog.findMany({ where: { action: "tour.plan_day" } });
      expect(audits.length).toBeGreaterThanOrEqual(6);
      expect(audits.every((a) => a.actorId === adminId && a.entity === "Tour")).toBe(true);
    });

    it("refuses a day with a released tour or a locked tour", async () => {
      await vehicle("Van 1", 500);
      await customers(2);
      await planDayWith(deps(), { date: DAY_TEXT });
      const [tour] = await tours();
      await t.prisma.tour.update({ where: { id: tour!.id }, data: { locked: true } });
      expect(await planDayWith(deps(), { date: DAY_TEXT })).toMatchObject({
        ok: false,
        error: "tour_locked",
      });
      await t.prisma.tour.update({
        where: { id: tour!.id },
        data: { locked: false, status: "RELEASED" },
      });
      expect(await planDayWith(deps(), { date: DAY_TEXT })).toMatchObject({
        ok: false,
        error: "tour_not_editable",
      });
    });

    it("2 drivers, 5 loaded vehicles, 3 loads -> 2 tours, one driver switches vehicle (NUD-158)", async () => {
      const fleet = [];
      for (let i = 1; i <= 5; i++) fleet.push(await vehicle(`Van ${i}`, 300));
      await customers(8); // 8 x 100 kg = 800 kg -> 3 loads of at most 300 kg
      const result = await planDayWith(deps(), {
        date: DAY_TEXT,
        vehicleIds: fleet,
        driverIds: [drivers[0]!, drivers[1]!],
      });
      if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
      expect(result.tours).toHaveLength(2);
      expect(result.vehicleSwitches).toBe(1);
      expect(result.reloadTrips).toBe(0);
      expect(result.tours.map((x) => x.driverId)).toEqual([drivers[0], drivers[1]]);

      const day = await tours();
      expect(day.flatMap((x) => x.stops)).toHaveLength(8);
      const switching = day.find((x) => x.stops.some((s) => s.trip === 2))!;
      const trip2 = switching.stops.filter((s) => s.trip === 2);
      // The second trip runs on another vehicle, not the tour's own one.
      expect(trip2.every((s) => s.vehicleId && s.vehicleId !== switching.vehicleId)).toBe(true);
      expect(switching.stops.filter((s) => s.trip === 1).every((s) => s.vehicleId === null)).toBe(
        true,
      );
      // Three different vehicles are used, none by two drivers, each trip within 300 kg.
      const used = new Set([
        ...day.map((x) => x.vehicleId),
        ...day.flatMap((x) => x.stops.map((s) => s.vehicleId).filter(Boolean)),
      ]);
      expect(used.size).toBe(3);
      for (const tour of day) expect(Math.max(...tripLoads(tour.stops))).toBeLessThanOrEqual(300);

      // The driver sees the vehicle to switch into; the planning page knows each trip's vehicle.
      expect(await getDriverTour(t.prisma, switching.driverId!, DAY_TEXT)).toBeNull();
      const version = (
        await t.prisma.tour.findUniqueOrThrow({ where: { id: switching.id } })
      ).updatedAt.toISOString();
      expect(
        await releaseTourWith(t.prisma, adminId, { tourId: switching.id, version }, NOW),
      ).toMatchObject({ ok: true });
      const seen = await getDriverTour(t.prisma, switching.driverId!, DAY_TEXT);
      const secondVan = await t.prisma.vehicle.findUniqueOrThrow({
        where: { id: trip2[0]!.vehicleId! },
      });
      expect(seen!.stops.filter((s) => s.trip === 2).map((s) => s.vehicleName)).toEqual(
        trip2.map(() => secondVan.name),
      );
      expect(seen!.stops.filter((s) => s.trip === 1).every((s) => s.vehicleName === null)).toBe(
        true,
      );
      const plan = await getTourPlan(t.prisma, DAY_TEXT, "Europe/Vienna", switching.id);
      expect(plan!.tour!.tripVehicleIds).toEqual([null, trip2[0]!.vehicleId]);
    });

    it("drivers >= vehicles: unchanged, one tour per used vehicle and no switch", async () => {
      await vehicle("Van 1", 500);
      await vehicle("Van 2", 500);
      await customers(8);
      const result = await planDayWith(deps(), { date: DAY_TEXT });
      if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
      expect(result.vehicleSwitches).toBe(0);
      expect(result.tours).toHaveLength(2);
    });

    it("1 driver, 2 vehicles: the driver switches instead of reloading", async () => {
      await vehicle("Van 1", 500);
      await vehicle("Van 2", 500);
      await customers(8); // 800 kg: both vans needed
      const result = await planDayWith(deps(), { date: DAY_TEXT, driverIds: [drivers[0]!] });
      if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
      expect(result.tours).toHaveLength(1);
      expect(result.tours[0]!.trips).toBe(2);
      expect(result.vehicleSwitches).toBe(1);
      expect(result.reloadTrips).toBe(0);
      expect(new Set(result.tours[0]!.tripVehicleIds).size).toBe(2);

      // A manual reorder keeps the trip boundaries and each trip's vehicle at their positions.
      const [tour] = await tours();
      const ids = tour!.stops.map((s) => s.id);
      expect(
        await reorderStopsWith(
          { db: t.prisma, actorId: adminId, provider, loadSettings: async () => SETTINGS },
          { tourId: tour!.id, orderedStopIds: [...ids].reverse() },
        ),
      ).toMatchObject({ ok: true, changed: true });
      const [after] = await tours();
      expect(after!.stops.map((s) => s.vehicleId)).toEqual(tour!.stops.map((s) => s.vehicleId));
      expect(after!.stops.map((s) => s.id)).toEqual([...ids].reverse());
    });

    it("has no stop limit: plans all 52 stops and leaves none as not planned", async () => {
      await vehicle("Van 1", 5000);
      await vehicle("Van 2", 5000);
      // 52 customers on a line away from the depot, 1 Kiste each.
      for (let i = 0; i < 52; i++) {
        const c = await t.prisma.customer.create({
          data: {
            customerNumber: `L${i}`,
            name: `Linie ${i}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: DEPOT.lat + 0.001 * (i + 1),
            lng: DEPOT.lng,
          },
        });
        await t.prisma.order.create({
          data: {
            customerId: c.id,
            deliveryDate: DAY,
            windowFrom: DAY,
            windowTo: DAY,
            status: "CONFIRMED",
            createdById: adminId,
            items: { create: [{ productId, quantity: 1 }] },
          },
        });
      }
      const result = await planDayWith(deps(), { date: DAY_TEXT });
      if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
      expect(result.deferred).toEqual([]);
      const day = await tours();
      expect(day.flatMap((x) => x.stops)).toHaveLength(52);
      expect(await t.prisma.stopOrder.count()).toBe(52);

      const plan = await getTourPlan(t.prisma, DAY_TEXT, "Europe/Vienna");
      expect(plan!.unplanned).toEqual([]);
    });

    it("refuses the past, a missing depot and a day without orders", async () => {
      await vehicle("Van 1", 500);
      expect(await planDayWith(deps(), { date: DAY_TEXT })).toMatchObject({
        ok: false,
        error: "no_stops",
      });
      expect(
        await planDayWith(
          { ...deps(), now: () => new Date("2099-08-01T00:00:00Z") },
          { date: DAY_TEXT },
        ),
      ).toMatchObject({
        ok: false,
        error: "date_in_past",
      });
      expect(
        await planDayWith(
          {
            ...deps(),
            requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: false }),
          },
          { date: DAY_TEXT },
        ),
      ).toMatchObject({ ok: false, error: "depot_not_set" });
    });

    it("each driver sees only his own tour, with its trips", async () => {
      await vehicle("Van 1", 500);
      await vehicle("Van 2", 500);
      await customers(8);
      await planDayWith(deps(), { date: DAY_TEXT, driverIds: [drivers[0]!, drivers[1]!] });
      for (const tour of await tours()) {
        const version = tour.updatedAt.toISOString();
        expect(
          await releaseTourWith(t.prisma, adminId, { tourId: tour.id, version }, NOW),
        ).toMatchObject({
          ok: true,
        });
      }
      const day = await tours();
      for (const tour of day) {
        const seen = await getDriverTour(t.prisma, tour.driverId!, DAY_TEXT);
        expect(seen?.id).toBe(tour.id);
        expect(seen?.stops.map((s) => s.id)).toEqual(tour.stops.map((s) => s.id));
        expect(seen?.stops.every((s) => s.trip === 1)).toBe(true);
      }
      // A driver without a tour of his own sees nothing, and never the other drivers' stops.
      expect(await getDriverTour(t.prisma, drivers[2]!, DAY_TEXT)).toBeNull();
    });

    it("the driver tour carries the trip of every stop after a reload split", async () => {
      await vehicle("Van 1", 500);
      await customers(8);
      await planDayWith(deps(), { date: DAY_TEXT, driverIds: [drivers[0]!] });
      const [tour] = await tours();
      await releaseTourWith(
        t.prisma,
        adminId,
        { tourId: tour!.id, version: tour!.updatedAt.toISOString() },
        NOW,
      );
      const seen = await getDriverTour(t.prisma, drivers[0]!, DAY_TEXT);
      expect(new Set(seen?.stops.map((s) => s.trip))).toEqual(new Set([1, 2]));
    });

    it("the load sheet groups the stops by trip", async () => {
      await vehicle("Van 1", 500);
      await customers(8);
      await planDayWith(deps(), { date: DAY_TEXT });
      const [tour] = await tours();
      const print = await getTourPrint(t.prisma, tour!.id);
      expect(new Set(print?.stops.map((s) => s.trip))).toEqual(new Set([1, 2]));
    });

    it("a manual reorder keeps the trip boundaries at their positions", async () => {
      await vehicle("Van 1", 500);
      await customers(8);
      await planDayWith(deps(), { date: DAY_TEXT });
      const [tour] = await tours();
      const ids = tour!.stops.map((s) => s.id);
      const result = await reorderStopsWith(
        { db: t.prisma, actorId: adminId, provider, loadSettings: async () => SETTINGS },
        { tourId: tour!.id, orderedStopIds: [...ids].reverse() },
      );
      expect(result).toMatchObject({ ok: true, changed: true });
      const [after] = await tours();
      expect(after!.stops.map((s) => s.trip)).toEqual(tour!.stops.map((s) => s.trip));
      expect(after!.stops.map((s) => s.id)).toEqual([...ids].reverse());
    });

    it("Bearbeiten: a stop moved to another tour joins its last trip", async () => {
      await vehicle("Van 1", 500);
      await vehicle("Van 2", 500);
      await customers(8);
      await planDayWith(deps(), { date: DAY_TEXT });
      const [a, b] = await tours();
      const moved = a!.stops[0]!;
      const result = await editTourWith(
        { db: t.prisma, actorId: adminId, provider, loadSettings: async () => SETTINGS },
        {
          tourId: a!.id,
          version: a!.updatedAt.toISOString(),
          driverId: null,
          orderedStopIds: a!.stops.slice(1).map((s) => s.id),
          moves: [{ stopId: moved.id, targetTourId: b!.id }],
        },
      );
      expect(result).toMatchObject({ ok: true, moved: 1 });
      const [, after] = await tours();
      expect(after!.stops.at(-1)!.id).toBe(moved.id);
      expect(after!.stops.at(-1)!.trip).toBe(1);
    });
  },
);
