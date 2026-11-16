// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deliveryOrder, loadSheetTotals } from "@/domain/load-sheet";
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

const { generateTourWith } = await import("./tour-builder");
const { tourPrintQuery } = await import("./tour-queries");
const { createTourService } = await import("./tour-service");

const DAY = new Date("2099-09-01T00:00:00Z");
const NOW = new Date("2099-08-20T10:00:00Z");
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

describe.skipIf(!process.env.DATABASE_URL)("tour print (load sheet)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let spag: string;
  let flour: string;

  const name = (de: string, zh: string) => ({
    de,
    "zh-Hans": zh,
    meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00.000Z" },
  });

  async function buildTour(count: number) {
    for (let i = 1; i <= count; i++) {
      const customer = await t.prisma.customer.create({
        data: {
          customerNumber: `C${String(i).padStart(3, "0")}`,
          name: `Kunde ${i}`,
          street: "Hauptstraße 1",
          postalCode: "1010",
          city: "Wien",
          lat: DEPOT.lat,
          lng: DEPOT.lng + i * 0.01,
          pinConfirmed: true,
        },
      });
      await t.prisma.order.create({
        data: {
          customerId: customer.id,
          deliveryDate: DAY,
          windowFrom: DAY,
          windowTo: DAY,
          status: "CONFIRMED",
          createdById: adminId,
          items: {
            create: [
              { productId: spag, quantity: (i % 4) + 1 },
              ...(i % 2 === 0 ? [{ productId: flour, quantity: 3 }] : []),
            ],
          },
        },
      });
    }
    const result = await generateTourWith(
      {
        db: t.prisma,
        actorId: adminId,
        provider: new LocalHeuristicProvider(),
        requireDepot: async () => requireDepot({ ...SETTINGS, depotPinConfirmed: true }),
        loadSettings: async () => SETTINGS,
        now: () => NOW,
      },
      DAY,
    );
    if (!result.ok) throw new Error(`generate failed: ${result.error}`);
    return result.tourId;
  }

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    adminId = (
      await t.prisma.user.create({
        data: { role: "ADMIN", email: "a@example.com", passwordHash: hash, displayName: "A" },
      })
    ).id;
    driverId = (
      await t.prisma.user.create({
        data: { role: "DRIVER", username: "drv", passwordHash: hash, displayName: "Fahrer Eins" },
      })
    ).id;
    spag = (
      await t.prisma.product.create({
        data: {
          sku: "SPAG-5",
          unit: "PACK",
          weightKgPerUnit: 1,
          name: name("Spaghetti 5 kg", "意大利面 5 公斤"),
        },
      })
    ).id;
    flour = (
      await t.prisma.product.create({
        data: { sku: "FLOUR", unit: "KG", weightKgPerUnit: 1, name: name("Mehl", "面粉") },
      })
    ).id;
  }, 60_000);
  afterAll(async () => {
    await t?.teardown();
  });
  beforeEach(async () => {
    state.session = { user: { id: adminId } };
    setRoutingProviderForTests(new LocalHeuristicProvider());
    await t.prisma.settings.deleteMany();
    await t.prisma.settings.create({ data: { id: 1, ...SETTINGS, depotPinConfirmed: true } });
    await t.prisma.tour.deleteMany();
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.customer.deleteMany();
  });

  it("reads stops in delivery order with the tour's own quantities, driver and depot", async () => {
    const tourId = await buildTour(6);
    await t.prisma.tour.update({ where: { id: tourId }, data: { driverId } });
    const print = await tourPrintQuery(tourId);
    expect(print).toMatchObject({
      id: tourId,
      date: "2099-09-01",
      isOutdated: false,
      driverName: "Fahrer Eins",
      depot: { name: "Nudelfabrik", address: "Graben 1, 1010 Wien" },
    });
    expect(print!.stops).toHaveLength(6);
    expect(print!.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(print!.products.map((p) => p.sku).sort()).toEqual(["FLOUR", "SPAG-5"]);
  });

  it("totals equal the sum of the stops and of the confirmed orders, per product and unit", async () => {
    const tourId = await buildTour(30);
    const print = (await tourPrintQuery(tourId))!;
    expect(print.stops).toHaveLength(30);
    const totals = loadSheetTotals(print.stops, print.products);
    const sum = async (productId: string) =>
      (await t.prisma.orderItem.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum
        .quantity ?? 0;
    expect(totals).toEqual([
      { productId: flour, unit: "KG", quantity: await sum(flour) },
      { productId: spag, unit: "PACK", quantity: await sum(spag) },
    ]);
    expect(totals[0]!.quantity).toBe(15 * 3);
    // delivery order: stop 1 first
    expect(deliveryOrder(print.stops).map((s) => s.sequence)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it("keeps the tour's quantities when an order changes afterwards and says so (isOutdated)", async () => {
    const tourId = await buildTour(3);
    const before = (await tourPrintQuery(tourId))!;
    const item = await t.prisma.orderItem.findFirstOrThrow({ where: { productId: spag } });
    await t.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({ where: { id: item.id }, data: { quantity: 99 } });
      await createTourService(t.prisma).markOutdatedForDate(DAY, tx);
    });
    const after = (await tourPrintQuery(tourId))!;
    expect(after.isOutdated).toBe(true);
    expect(after.stops.map((s) => s.items)).toEqual(before.stops.map((s) => s.items));
    expect(
      loadSheetTotals(after.stops, after.products).find((x) => x.productId === spag)!.quantity,
    ).toBe(
      loadSheetTotals(before.stops, before.products).find((x) => x.productId === spag)!.quantity,
    );
  });

  it("answers null for unknown and malformed ids", async () => {
    expect(await tourPrintQuery("does-not-exist")).toBeNull();
    expect(await tourPrintQuery("")).toBeNull();
    expect(await tourPrintQuery(undefined)).toBeNull();
    expect(await tourPrintQuery("x".repeat(200))).toBeNull();
  });

  it("rejects anonymous callers, drivers and deactivated admins", async () => {
    const tourId = await buildTour(2);
    for (const [session, code] of [
      [null, "UNAUTHENTICATED"],
      [{ user: { id: driverId } }, "FORBIDDEN"],
    ] as const) {
      state.session = session;
      await expect(tourPrintQuery(tourId)).rejects.toMatchObject({ code });
    }
    await t.prisma.user.update({ where: { id: adminId }, data: { active: false } });
    state.session = { user: { id: adminId } };
    await expect(tourPrintQuery(tourId)).rejects.toBeDefined();
    await t.prisma.user.update({ where: { id: adminId }, data: { active: true } });
    expect(await tourPrintQuery(tourId)).not.toBeNull();
  });
});
