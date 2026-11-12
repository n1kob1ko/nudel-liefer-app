// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isCustomerPhotoKey } from "@/lib/uploads";

import { seed } from "../../prisma/seed";
import { DEMO_CUSTOMERS, DEMO_ORDER_NOTE, DEMO_PRODUCT_SKUS, demoOrderLines } from "./demo-data";
import { assertDemoStorageConfigured, demoUuid, seedDemo, type UploadObject } from "./demo-seed";
import { FakeStorage } from "./storage/fake";
import { createTestDb, type TestDb } from "./test-db";

const fakeUpload: UploadObject = async (storage, key, body, contentType) => {
  (storage as FakeStorage).put(key, body, contentType);
};

describe("demo data (pure)", () => {
  it("has 20 unique Vienna customers with Wien postcodes", () => {
    expect(DEMO_CUSTOMERS).toHaveLength(20);
    expect(new Set(DEMO_CUSTOMERS.map((c) => c.number)).size).toBe(20);
    expect(new Set(DEMO_CUSTOMERS.map((c) => c.name)).size).toBe(20);
    for (const c of DEMO_CUSTOMERS) {
      expect(c.postalCode).toMatch(/^1[01]\d0$/);
      expect(c.lat).toBeGreaterThan(48.1);
      expect(c.lat).toBeLessThan(48.3);
      expect(c.lng).toBeGreaterThan(16.2);
      expect(c.lng).toBeLessThan(16.5);
    }
  });

  it("builds 1-3 distinct order lines with sensible quantities", () => {
    expect(DEMO_PRODUCT_SKUS).toHaveLength(3);
    for (let i = 0; i < DEMO_CUSTOMERS.length; i += 1) {
      const lines = demoOrderLines(i);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(3);
      expect(new Set(lines.map((l) => l.sku)).size).toBe(lines.length);
      for (const l of lines) expect(Number(l.quantity)).toBeGreaterThan(0);
    }
  });

  it("derives deterministic storage keys the upload rules accept", () => {
    const key = `customers/${demoUuid("D-001:STORE")}.png`;
    expect(isCustomerPhotoKey(key)).toBe(true);
    expect(demoUuid("D-001:STORE")).toBe(demoUuid("D-001:STORE"));
    expect(demoUuid("D-001:STORE")).not.toBe(demoUuid("D-001:PARKING"));
  });

  it("refuses to run the photo seed without S3 configuration", () => {
    expect(() => assertDemoStorageConfigured({})).toThrow(/S3-compatible/);
    expect(() =>
      assertDemoStorageConfigured({
        S3_BUCKET: "b",
        S3_ACCESS_KEY_ID: "a",
        S3_SECRET_ACCESS_KEY: "s",
      }),
    ).not.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("seedDemo", { timeout: 120_000 }, () => {
  let t: TestDb;
  const now = new Date("2026-10-14T10:00:00Z"); // Wednesday -> next delivery day Thursday 2026-10-15

  beforeAll(async () => {
    process.env.SEED_ADMIN_PASSWORD ||= "test-password-1";
    t = await createTestDb();
    await seed(t.prisma);
  });
  afterAll(async () => {
    await t.teardown();
  });

  it("creates customers, photos, products, orders and the confirmed depot; reruns add nothing", async () => {
    const storage = new FakeStorage();
    const first = await seedDemo(t.prisma, { storage, now, upload: fakeUpload });
    expect(first).toEqual({
      deliveryDate: "2026-10-15",
      depotUpdated: true,
      customersCreated: 20,
      photosCreated: 40,
      ordersCreated: 20,
      standingToursCreated: 2,
    });

    const settings = await t.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings.depotPinConfirmed).toBe(true);
    expect(settings.depotAddress).toContain("Wien");

    const products = await t.prisma.product.findMany({ where: { active: true } });
    expect(products).toHaveLength(3);
    for (const p of products) {
      const name = p.name as Record<string, string>;
      for (const l of ["de", "zh-Hans"]) expect(name[l]).toBeTruthy();
    }

    const customers = await t.prisma.customer.findMany({ include: { photos: true } });
    expect(customers).toHaveLength(20);
    for (const c of customers) {
      expect(c.lat).not.toBeNull();
      expect(c.photos.map((p) => p.kind).sort()).toEqual(["PARKING", "STORE"]);
      for (const p of c.photos) {
        expect(storage.has(p.storageKey)).toBe(true);
        expect(p.isCurrent).toBe(true);
      }
    }
    const orders = await t.prisma.order.findMany({ include: { items: true } });
    expect(orders).toHaveLength(20);
    for (const o of orders) {
      expect(o.status).toBe("CONFIRMED");
      expect(o.deliveryDate.toISOString().slice(0, 10)).toBe("2026-10-15");
      expect(o.internalNote).toBe(DEMO_ORDER_NOTE);
      expect(o.items.length).toBeGreaterThan(0);
    }

    const second = await seedDemo(t.prisma, { storage, now, upload: fakeUpload });
    expect(second).toMatchObject({
      depotUpdated: false,
      customersCreated: 0,
      photosCreated: 0,
      ordersCreated: 0,
      standingToursCreated: 0,
    });
    expect(await t.prisma.customer.count()).toBe(20);
    expect(await t.prisma.photo.count()).toBe(40);
    expect(await t.prisma.order.count()).toBe(20);
    expect(await t.prisma.product.count()).toBe(3);
    // NUD-194: two fixed groups of 8 and 6 customers; the rest stays off-route.
    const groups = await t.prisma.standingTour.findMany({
      include: { customers: true, driver: { select: { username: true } } },
      orderBy: { sortOrder: "asc" },
    });
    expect(groups.map((g) => [g.name, g.customers.length, g.driver?.username])).toEqual([
      ["Stammtour 1", 8, "fahrer-de"],
      ["Stammtour 2", 6, "driver-en"],
    ]);
    expect(await t.prisma.standingTourCustomer.count()).toBe(14);
  });

  it("can create the orders for today, and a rerun adds nothing while they are current", async () => {
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    const first = await seedDemo(t.prisma, { photos: false, now, ordersForToday: true });
    expect(first).toMatchObject({ deliveryDate: "2026-10-14", ordersCreated: 20 });
    // Same day without the flag: the existing current set counts, nothing is added.
    expect(await seedDemo(t.prisma, { photos: false, now })).toMatchObject({ ordersCreated: 0 });
    // The next day the orders are in the past: a fresh set for the next delivery day is created.
    const later = new Date("2026-10-15T10:00:00Z");
    expect(await seedDemo(t.prisma, { photos: false, now: later })).toMatchObject({
      deliveryDate: "2026-10-16",
      ordersCreated: 20,
    });
  });

  it("does not overwrite a depot the admin has confirmed, and works without photos", async () => {
    await t.prisma.settings.update({
      where: { id: 1 },
      data: { depotName: "Echte Fabrik", depotPinConfirmed: true },
    });
    const result = await seedDemo(t.prisma, { photos: false, now });
    expect(result.depotUpdated).toBe(false);
    expect((await t.prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).depotName).toBe(
      "Echte Fabrik",
    );
  });

  it("repairs a slot whose demo photo became history instead of failing with key_in_use", async () => {
    // NUD-160: the demo key is still referenced by a history row (a driver replaced the demo photo
    // and that replacement row is gone again) while the customer has no current STORE photo. The key
    // guard in attachCustomerPhoto refuses every key a row uses, so the seed must pick a new one.
    const customer = await t.prisma.customer.findUniqueOrThrow({
      where: { customerNumber: "D-005" },
    });
    const demoKey = `customers/${demoUuid("D-005:STORE")}.png`;
    const historyRow = await t.prisma.photo.findFirstOrThrow({
      where: { customerId: customer.id, kind: "STORE" },
    });
    expect(historyRow.storageKey).toBe(demoKey);
    await t.prisma.photo.update({ where: { id: historyRow.id }, data: { isCurrent: false } });

    const storage = new FakeStorage();
    const repaired = await seedDemo(t.prisma, { storage, now, upload: fakeUpload });
    expect(repaired.photosCreated).toBe(1);

    const current = await t.prisma.photo.findMany({
      where: { customerId: customer.id, kind: "STORE", isCurrent: true },
    });
    expect(current).toHaveLength(1);
    expect(current[0]!.storageKey).not.toBe(demoKey);
    expect(storage.has(current[0]!.storageKey)).toBe(true);
    // The history row keeps its object, and a further run adds nothing.
    expect(await t.prisma.photo.findUniqueOrThrow({ where: { id: historyRow.id } })).toMatchObject({
      storageKey: demoKey,
      isCurrent: false,
    });
    expect(await seedDemo(t.prisma, { storage, now, upload: fakeUpload })).toMatchObject({
      photosCreated: 0,
    });
  });
});
