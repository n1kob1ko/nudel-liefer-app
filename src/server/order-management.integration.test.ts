// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
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

const { cancelOrderAction, createOrderAction, duplicateOrderAction, updateOrderAction } =
  await import("./order-actions");
const { orderDetailQuery, orderOverviewQuery } = await import("./order-queries");
const { cancelOrder, createOrder, listConfirmedOrdersForDate, todayIn, updateOrder } =
  await import("./orders");
const { setStorageForTests } = await import("./storage");
const { FakeStorage } = await import("./storage/fake");

const D1 = "2099-06-15";
const D2 = "2099-06-16";
const D3 = "2099-06-17";
const date = (d: string) => new Date(`${d}T00:00:00Z`);

describe.skipIf(!process.env.DATABASE_URL)("order overview & editing", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let customerId: string;
  let otherCustomerId: string;
  let archivedId: string;
  let p1: string;
  let p2: string;
  let p3: string;
  let inactiveProduct: string;

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    const mk = (data: Parameters<typeof t.prisma.user.create>[0]["data"]) =>
      t.prisma.user.create({ data }).then((u) => u.id);
    adminId = await mk({
      role: "ADMIN",
      email: "a@example.com",
      passwordHash: hash,
      displayName: "A",
    });
    driverId = await mk({ role: "DRIVER", username: "drv", passwordHash: hash, displayName: "D" });
    const customer = (n: string, extra: Record<string, unknown> = {}) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: n,
            name: `Kunde ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            pinConfirmed: true,
            ...extra,
          },
        })
        .then((c) => c.id);
    customerId = await customer("C1");
    otherCustomerId = await customer("C2");
    archivedId = await customer("C3");
    const product = (sku: string, sortOrder: number, extra: Record<string, unknown> = {}) =>
      t.prisma.product
        .create({
          data: {
            sku,
            unit: "PACK",
            weightKgPerUnit: 1,
            sortOrder,
            name: { de: sku, meta: { source: "de", machine: {} } },
            ...extra,
          },
        })
        .then((p) => p.id);
    p1 = await product("P1", 1);
    p2 = await product("P2", 2);
    p3 = await product("P3", 3);
    inactiveProduct = await product("P4", 4);
  }, 60_000);

  afterAll(async () => {
    await t?.teardown();
  });

  beforeEach(async () => {
    state.session = { user: { id: adminId } };
    setStorageForTests(new FakeStorage());
    await t.prisma.product.update({ where: { id: inactiveProduct }, data: { active: true } });
    await t.prisma.customer.update({ where: { id: archivedId }, data: { active: true } });
    await t.prisma.stopOrder.deleteMany();
    await t.prisma.stop.deleteMany();
    await t.prisma.tour.deleteMany();
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.screenshot.deleteMany();
  });

  const create = async (extra: Record<string, unknown> = {}) => {
    const result = await createOrderAction({
      customerId,
      deliveryDate: D1,
      lines: [{ productId: p1, quantity: "3" }],
      ...extra,
    });
    if (!result.ok) throw new Error(`create failed: ${result.error}`);
    return result.id;
  };
  const edit = (id: string, extra: Record<string, unknown> = {}) =>
    updateOrderAction(id, {
      deliveryDate: D1,
      status: "CONFIRMED",
      lines: [{ productId: p1, quantity: "3" }],
      ...extra,
    });
  const load = (id: string) =>
    t.prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const quantities = async (id: string) =>
    (await load(id)).items
      .map((i) => `${i.productId === p1 ? "p1" : i.productId === p2 ? "p2" : "?"}=${i.quantity}`)
      .sort();
  const tour = (d: string, status: "DRAFT" | "RELEASED" = "DRAFT") =>
    t.prisma.tour.create({ data: { date: date(d), status, depotSnapshot: {} } }).then((x) => x.id);
  const outdated = async (id: string) =>
    (await t.prisma.tour.findUniqueOrThrow({ where: { id } })).isOutdated;

  it("rejects anonymous callers, drivers and deactivated admins on every mutation without side effects", async () => {
    const id = await create();
    const inactiveAdmin = await t.prisma.user.create({
      data: {
        role: "ADMIN",
        email: "i@example.com",
        passwordHash: "x",
        displayName: "I",
        active: false,
      },
    });
    const sessions: Array<[typeof state.session, string]> = [
      [null, "UNAUTHENTICATED"],
      [{ user: { id: driverId } }, "FORBIDDEN"],
      [{ user: { id: inactiveAdmin.id } }, "UNAUTHENTICATED"],
    ];
    const calls: Array<() => Promise<unknown>> = [
      () => updateOrderAction(id, { deliveryDate: D2, lines: [{ productId: p1, quantity: 99 }] }),
      () => cancelOrderAction(id),
      () => duplicateOrderAction(id, D2),
    ];
    for (const [session, code] of sessions) {
      for (const call of calls) {
        state.session = session;
        await expect(call()).rejects.toMatchObject({ code });
      }
    }
    const order = await load(id);
    expect(order.status).toBe("CONFIRMED");
    expect(order.deliveryDate).toEqual(date(D1));
    expect(await quantities(id)).toEqual(["p1=3"]);
    expect(await t.prisma.order.count()).toBe(1);
  });

  describe("editing", () => {
    it("changes a quantity, adds and removes lines, date, status and note", async () => {
      const id = await create({ internalNote: "alt" });
      const result = await edit(id, {
        deliveryDate: D2,
        status: "DRAFT",
        internalNote: "neu",
        lines: [
          { productId: p1, quantity: "4" },
          { productId: p2, quantity: 10 },
        ],
      });
      expect(result).toMatchObject({ ok: true, id, status: "DRAFT" });
      const order = await load(id);
      expect(order).toMatchObject({ status: "DRAFT", internalNote: "neu", customerId });
      expect(order.deliveryDate).toEqual(date(D2));
      expect(await quantities(id)).toEqual(["p1=4", "p2=10"]);
      // Replacing the lines leaves no orphans.
      expect(await t.prisma.orderItem.count()).toBe(2);
    });

    it("validates quantities exactly like order entry and changes nothing on failure", async () => {
      const id = await create();
      const bad: Array<Record<string, unknown>> = [
        { lines: [{ productId: p1, quantity: 0 }] },
        { lines: [{ productId: p1, quantity: "-1" }] },
        { lines: [{ productId: p1, quantity: "1.000" }] },
        { lines: [{ productId: p1, quantity: "2,5" }] },
        { lines: [{ productId: p1, quantity: 2.5 }] },
        { lines: [{ productId: p1, quantity: "abc" }] },
        { lines: [{ productId: p1, quantity: "" }] },
        { lines: [] },
        { deliveryDate: "2099-02-30" },
        { status: "CANCELLED" },
        { status: "WHATEVER" },
        { internalNote: "x".repeat(1001) },
      ];
      for (const override of bad) {
        expect(await edit(id, override), JSON.stringify(override)).toEqual({
          ok: false,
          error: "invalid",
        });
      }
      expect(await updateOrderAction(id, "nonsense")).toEqual({ ok: false, error: "invalid" });
      expect(await updateOrderAction(id, null)).toEqual({ ok: false, error: "invalid" });
      expect(await quantities(id)).toEqual(["p1=3"]);
      expect((await load(id)).deliveryDate).toEqual(date(D1));
    });

    it("merges a product entered twice (digit strings add up)", async () => {
      const id = await create();
      await edit(id, {
        lines: [
          { productId: p1, quantity: "2" },
          { productId: p1, quantity: "3" },
        ],
      });
      expect(await quantities(id)).toEqual(["p1=5"]);
    });

    it("never changes the customer or the screenshot, whatever the client sends", async () => {
      const id = await create();
      const result = await edit(id, {
        customerId: otherCustomerId,
        screenshotKey: "screenshots/00000001-0000-4000-8000-000000000000.jpg",
        source: "SCREENSHOT",
      });
      expect(result.ok).toBe(true);
      expect(await load(id)).toMatchObject({ customerId, source: "MANUAL", screenshotId: null });
    });

    it("rejects past dates, unknown orders, cancelled orders and orders of past days", async () => {
      const id = await create();
      expect(await edit(id, { deliveryDate: "2020-01-01" })).toEqual({
        ok: false,
        error: "date_in_past",
      });
      expect(await edit("does-not-exist")).toEqual({ ok: false, error: "not_found" });
      expect(await edit("")).toEqual({ ok: false, error: "not_found" });

      const old = await t.prisma.order.create({
        data: {
          customerId,
          deliveryDate: date("2020-01-01"),
          windowFrom: date("2020-01-01"),
          windowTo: date("2020-01-01"),
          status: "CONFIRMED",
          createdById: adminId,
        },
      });
      expect(await edit(old.id)).toEqual({ ok: false, error: "not_editable" });

      expect(await cancelOrderAction(id)).toEqual({ ok: true, id });
      expect(await edit(id)).toEqual({ ok: false, error: "not_editable" });
      expect((await load(id)).status).toBe("CANCELLED");
    });

    it("a deactivated product may stay in the order but cannot be added", async () => {
      const id = await create({ lines: [{ productId: inactiveProduct, quantity: 2 }] });
      await t.prisma.product.update({ where: { id: inactiveProduct }, data: { active: false } });
      expect(
        await edit(id, {
          lines: [
            { productId: inactiveProduct, quantity: 5 },
            { productId: p1, quantity: 1 },
          ],
        }),
      ).toMatchObject({ ok: true });
      const other = await create({ customerId: otherCustomerId });
      expect(await edit(other, { lines: [{ productId: inactiveProduct, quantity: 1 }] })).toEqual({
        ok: false,
        error: "product_inactive",
      });
      expect(await edit(other, { lines: [{ productId: "nope", quantity: 1 }] })).toEqual({
        ok: false,
        error: "product_not_found",
      });
    });
  });

  describe("cancelling", () => {
    it("sets CANCELLED and deletes nothing", async () => {
      const key = "screenshots/00000002-0000-4000-8000-000000000000.jpg";
      const storage = new FakeStorage();
      storage.put(key, new Uint8Array(100), "image/jpeg");
      setStorageForTests(storage);
      const id = await create({ screenshotKey: key });
      expect(await cancelOrderAction(id)).toEqual({ ok: true, id });
      const order = await t.prisma.order.findUniqueOrThrow({
        where: { id },
        include: { items: true, screenshot: true },
      });
      expect(order.status).toBe("CANCELLED");
      expect(order.items).toHaveLength(1);
      expect(order.screenshot?.storageKey).toBe(key);
      // The overview still lists it, flagged as cancelled and no longer editable.
      const { rows } = await orderOverviewQuery({ from: D1, to: D1 });
      expect(rows.map((r) => r.status)).toEqual(["CANCELLED"]);
      expect((await orderDetailQuery(id))?.editable).toBe(false);
    });

    it("rejects a second cancel, unknown ids and orders of past days", async () => {
      const id = await create();
      await cancelOrderAction(id);
      expect(await cancelOrderAction(id)).toEqual({ ok: false, error: "not_editable" });
      expect(await cancelOrderAction("nope")).toEqual({ ok: false, error: "not_found" });
      expect(await cancelOrderAction(" ")).toEqual({ ok: false, error: "invalid" });
      const old = await t.prisma.order.create({
        data: {
          customerId,
          deliveryDate: date("2020-01-01"),
          windowFrom: date("2020-01-01"),
          windowTo: date("2020-01-01"),
          status: "CONFIRMED",
          createdById: adminId,
        },
      });
      expect(await cancelOrderAction(old.id)).toEqual({ ok: false, error: "not_editable" });
      expect((await load(old.id)).status).toBe("CONFIRMED");
    });

    it("cancelled and draft orders leave the totals and are never offered to a tour", async () => {
      const keep = await create({ lines: [{ productId: p1, quantity: 2 }] });
      const gone = await create({ lines: [{ productId: p1, quantity: 50 }] });
      await create({ status: "DRAFT", lines: [{ productId: p1, quantity: 70 }] });
      await cancelOrderAction(gone);
      const { totals } = await orderOverviewQuery({ from: D1, to: D1 });
      expect(totals).toHaveLength(1);
      expect(totals[0]).toMatchObject({ date: D1, orderCount: 1 });
      expect(totals[0]?.products.map((p) => [p.sku, p.quantity])).toEqual([["P1", 2]]);
      const forTour = await listConfirmedOrdersForDate(t.prisma, date(D1));
      expect(forTour.map((o) => o.id)).toEqual([keep]);
    });
  });

  describe("duplicating", () => {
    it("copies lines and note to another day as a draft without the screenshot", async () => {
      const key = "screenshots/00000003-0000-4000-8000-000000000000.jpg";
      const storage = new FakeStorage();
      storage.put(key, new Uint8Array(100), "image/jpeg");
      setStorageForTests(storage);
      const id = await create({
        screenshotKey: key,
        internalNote: "Hinterhof",
        lines: [
          { productId: p1, quantity: "3" },
          { productId: p2, quantity: 7 },
        ],
      });
      const result = await duplicateOrderAction(id, D3);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.id).not.toBe(id);
      const copy = await load(result.id);
      expect(copy).toMatchObject({
        customerId,
        status: "DRAFT",
        source: "MANUAL",
        screenshotId: null,
        internalNote: "Hinterhof",
        createdById: adminId,
      });
      expect(copy.deliveryDate).toEqual(date(D3));
      expect(await quantities(result.id)).toEqual(["p1=3", "p2=7"]);
      // The original is untouched.
      expect(await quantities(id)).toEqual(["p1=3", "p2=7"]);
      expect((await load(id)).status).toBe("CONFIRMED");
    });

    it("can copy a cancelled order, onto the same day too", async () => {
      const id = await create();
      await cancelOrderAction(id);
      expect(await duplicateOrderAction(id, D1)).toMatchObject({ ok: true });
    });

    it("rejects bad dates, past dates, unknown orders, archived customers and inactive products", async () => {
      const id = await create();
      expect(await duplicateOrderAction(id, "garbage")).toEqual({ ok: false, error: "invalid" });
      expect(await duplicateOrderAction(id, null)).toEqual({ ok: false, error: "invalid" });
      expect(await duplicateOrderAction(id, "2020-01-01")).toEqual({
        ok: false,
        error: "date_in_past",
      });
      expect(await duplicateOrderAction("nope", D2)).toEqual({ ok: false, error: "not_found" });

      const ofArchived = await create({ customerId: archivedId });
      await t.prisma.customer.update({ where: { id: archivedId }, data: { active: false } });
      expect(await duplicateOrderAction(ofArchived, D2)).toEqual({
        ok: false,
        error: "customer_inactive",
      });

      const withProduct = await create({ lines: [{ productId: inactiveProduct, quantity: 1 }] });
      await t.prisma.product.update({ where: { id: inactiveProduct }, data: { active: false } });
      expect(await duplicateOrderAction(withProduct, D2)).toEqual({
        ok: false,
        error: "product_inactive",
      });
      expect(await t.prisma.order.count()).toBe(2 + 0 + 1);
    });
  });

  describe("tour hook (refined by NUD-043)", () => {
    it("create, update, cancel and duplicate flag the tours of the affected day only", async () => {
      const t1 = await tour(D1);
      const t2 = await tour(D2);
      const t3 = await tour(D3, "RELEASED");
      const reset = () => t.prisma.tour.updateMany({ data: { isOutdated: false } });

      const id = await create(); // D1
      expect([await outdated(t1), await outdated(t2), await outdated(t3)]).toEqual([
        true,
        false,
        false,
      ]);

      await reset();
      await edit(id, { deliveryDate: D2 }); // moves D1 -> D2: both days
      expect([await outdated(t1), await outdated(t2), await outdated(t3)]).toEqual([
        true,
        true,
        false,
      ]);

      await reset();
      await edit(id, { deliveryDate: D2, lines: [{ productId: p1, quantity: 9 }] });
      expect([await outdated(t1), await outdated(t2), await outdated(t3)]).toEqual([
        false,
        true,
        false,
      ]);

      await reset();
      await cancelOrderAction(id);
      expect([await outdated(t1), await outdated(t2), await outdated(t3)]).toEqual([
        false,
        true,
        false,
      ]);

      await reset();
      const source = await create({ deliveryDate: D2 });
      await reset();
      // A copy is a draft: it is not on any tour until confirmed, so nothing is flagged.
      const copy = await duplicateOrderAction(source, D3);
      expect([await outdated(t1), await outdated(t2), await outdated(t3)]).toEqual([
        false,
        false,
        false,
      ]);
      if (!copy.ok) throw new Error("duplicate failed");
      await edit(copy.id, { deliveryDate: D3, status: "CONFIRMED" });
      expect(await outdated(t3)).toBe(true);
    });

    it("draft orders and saves that change nothing a tour contains flag nothing", async () => {
      const t1 = await tour(D1);
      const draft = await create({ status: "DRAFT" });
      expect(await outdated(t1)).toBe(false);
      await edit(draft, { status: "DRAFT", lines: [{ productId: p1, quantity: 7 }] });
      await cancelOrderAction(draft);
      expect(await outdated(t1)).toBe(false);

      const id = await create(); // confirmed -> flags
      expect(await outdated(t1)).toBe(true);
      await t.prisma.tour.updateMany({ data: { isOutdated: false } });
      await edit(id, { internalNote: "only a note" }); // same customer, day and quantities
      await edit(id, { lines: [{ productId: p1, quantity: "3" }] }); // same quantity as a string
      expect(await outdated(t1)).toBe(false);
      await edit(id, { lines: [{ productId: p1, quantity: 4 }] }); // quantity changed
      expect(await outdated(t1)).toBe(true);
    });

    it("confirming and un-confirming a draft flags the day", async () => {
      const t1 = await tour(D1);
      const id = await create({ status: "DRAFT" });
      await edit(id, { status: "CONFIRMED" });
      expect(await outdated(t1)).toBe(true);
      await t.prisma.tour.updateMany({ data: { isOutdated: false } });
      await edit(id, { status: "DRAFT" });
      expect(await outdated(t1)).toBe(true);
    });

    it("the flag is atomic with the order write: a failing hook rolls the change back", async () => {
      const id = await create();
      const boom = { markOutdatedForDate: async () => Promise.reject(new Error("hook failed")) };
      const today = todayIn("Europe/Vienna", new Date("2099-01-01T00:00:00Z"));
      const orders = await t.prisma.order.count();

      await expect(
        createOrder(
          t.prisma,
          adminId,
          { customerId, deliveryDate: D1, lines: [{ productId: p1, quantity: 1 }] },
          today,
          new FakeStorage(),
          boom,
        ),
      ).rejects.toThrow("hook failed");
      expect(await t.prisma.order.count()).toBe(orders);

      await expect(
        updateOrder(
          t.prisma,
          adminId,
          id,
          {
            deliveryDate: D1,
            status: "CONFIRMED",
            lines: [{ productId: p1, quantity: 9 }],
          },
          today,
          boom,
        ),
      ).rejects.toThrow("hook failed");
      expect(await quantities(id)).toEqual(["p1=3"]);

      await expect(cancelOrder(t.prisma, adminId, id, today, boom)).rejects.toThrow("hook failed");
      expect((await load(id)).status).toBe("CONFIRMED");
    });

    it("a rejected change does not flag anything", async () => {
      const id = await create();
      const t1 = await tour(D1);
      await edit(id, { lines: [{ productId: p1, quantity: 0 }] });
      await duplicateOrderAction(id, "2020-01-01");
      await cancelOrderAction("nope");
      expect(await outdated(t1)).toBe(false);
    });
  });

  describe("overview", () => {
    it("filters by date range, customer, status and source", async () => {
      const key = "screenshots/00000004-0000-4000-8000-000000000000.jpg";
      const storage = new FakeStorage();
      storage.put(key, new Uint8Array(100), "image/jpeg");
      setStorageForTests(storage);
      const a = await create(); // C1 D1 confirmed manual
      const b = await create({ customerId: otherCustomerId, deliveryDate: D2, status: "DRAFT" });
      const c = await create({ deliveryDate: D3, screenshotKey: key });
      const d = await create({ customerId: otherCustomerId, deliveryDate: D3 });
      await cancelOrderAction(d);

      const ids = async (params: Record<string, string>) =>
        (await orderOverviewQuery(params)).rows.map((r) => r.id).sort();
      expect(await ids({ from: D1, to: D3 })).toEqual([a, b, c, d].sort());
      expect(await ids({ from: D1, to: D2 })).toEqual([a, b].sort());
      expect(await ids({ from: D2 })).toEqual([b]);
      expect(await ids({ from: D1, to: D3, customer: otherCustomerId })).toEqual([b, d].sort());
      expect(await ids({ from: D1, to: D3, status: "CANCELLED" })).toEqual([d]);
      expect(await ids({ from: D1, to: D3, status: "DRAFT" })).toEqual([b]);
      expect(await ids({ from: D1, to: D3, source: "SCREENSHOT" })).toEqual([c]);
      expect(await ids({ from: D1, to: D3, source: "MANUAL", status: "CONFIRMED" })).toEqual([a]);
      expect(await ids({ from: D1, to: D1, customer: otherCustomerId })).toEqual([]);
    });

    // NUD-179 (QA 2026-10-29 F12): the overview opens on TODAY; the order form keeps the next
    // delivery day as its default.
    it("defaults to today and tolerates garbage params", async () => {
      const { filters } = await orderOverviewQuery({});
      expect(filters.from).toBe(filters.to);
      expect(filters).toMatchObject({ customerId: null, status: null, source: null });
      // "Today" is the factory's day (Europe/Vienna), which is the next UTC day after 23:00 UTC:
      // no time zone is more than 14 hours ahead of UTC.
      const latestToday = new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10);
      expect(filters.from <= latestToday).toBe(true);
      const garbage = await orderOverviewQuery({ from: "x", to: "y", status: "ZZ", source: "ZZ" });
      expect(garbage.filters).toEqual(filters);
    });

    // NUD-178 (QA 2026-10-29 F6 + F11): one rule for "which tour is this order in", in all four
    // states that used to disagree between the order page and the tours page.
    it("describes the tour link in all four states with the same rule", async () => {
      const id = await create();
      const otherDay = "2099-06-16";
      const otherTour = await tour(otherDay);
      const otherStop = await t.prisma.stop.create({
        data: { tourId: otherTour, customerId, sequence: 1, orders: { create: { orderId: id } } },
      });
      // (a) the order of D1 sits on a tour of D2: the link names THAT day ...
      const crossDay = await orderDetailQuery(id);
      expect(crossDay?.tour).toMatchObject({
        tourId: otherTour,
        date: otherDay,
        stopStatus: "PENDING",
      });
      // ... and it is not offered to a new tour of D1 any more. Before, it was "planned" and
      // "waiting for a tour" at the same time.
      const stillOffered = await listConfirmedOrdersForDate(t.prisma, date(D1), { tourId: null });
      expect(stillOffered.map((o) => o.id)).not.toContain(id);
      // (b) cancelling keeps the link as history - the UI says "war Teil einer Tour" ...
      expect(await cancelOrderAction(id)).toEqual({ ok: true, id });
      const cancelled = await orderDetailQuery(id);
      expect(cancelled?.status).toBe("CANCELLED");
      expect(cancelled?.tour).toMatchObject({ tourId: otherTour, stopId: otherStop.id });
      // (c) a cancelled order is never offered to a tour ...
      expect(
        (await listConfirmedOrdersForDate(t.prisma, date(otherDay))).map((o) => o.id),
      ).not.toContain(id);
      // (d) an order on no stop has no link at all.
      const loose = await create();
      expect((await orderDetailQuery(loose))?.tour).toBeNull();
    });

    it("shows rows with line counts, quantities and the tour link", async () => {
      const id = await create({
        lines: [
          { productId: p1, quantity: "3" },
          { productId: p2, quantity: 1 },
        ],
      });
      const other = await create({ customerId: otherCustomerId });
      const tourId = await tour(D1);
      const stop = await t.prisma.stop.create({
        data: { tourId, customerId, sequence: 1, orders: { create: { orderId: id } } },
      });
      const { rows } = await orderOverviewQuery({ from: D1, to: D1 });
      const row = rows.find((r) => r.id === id);
      expect(row?.items.map((i) => i.quantity)).toEqual([3, 1]);
      // NUD-178: the link carries the tour day and the stop state too
      expect(row?.tour).toMatchObject({ tourId, stopId: stop.id, stopStatus: "PENDING" });
      expect(rows.find((r) => r.id === other)?.tour).toBeNull();
      expect((await orderDetailQuery(id))?.tour).toMatchObject({ tourId, stopId: stop.id });
    });

    it("totals per date match the sum of the confirmed orders and ignore the other filters", async () => {
      await create({
        lines: [
          { productId: p2, quantity: "1" },
          { productId: p1, quantity: 2 },
        ],
      });
      await create({
        customerId: otherCustomerId,
        lines: [
          { productId: p1, quantity: "1" },
          { productId: p3, quantity: 10 },
        ],
      });
      await create({ deliveryDate: D2, lines: [{ productId: p1, quantity: 4 }] });
      await create({ status: "DRAFT", lines: [{ productId: p1, quantity: 100 }] });

      const { totals } = await orderOverviewQuery({ from: D1, to: D2, customer: customerId });
      expect(totals.map((d) => [d.date, d.orderCount])).toEqual([
        [D1, 2],
        [D2, 1],
      ]);
      // Sorted by the product sort order; exact sums.
      expect(totals[0]?.products.map((p) => [p.sku, p.quantity])).toEqual([
        ["P1", 3],
        ["P2", 1],
        ["P3", 10],
      ]);
      expect(totals[1]?.products.map((p) => [p.sku, p.quantity])).toEqual([["P1", 4]]);
    });

    it("reports truncation instead of hiding rows silently", async () => {
      const { truncated } = await orderOverviewQuery({ from: D1, to: D1 });
      expect(truncated).toBe(false);
    });
  });

  it("order detail says whether the order can still be edited", async () => {
    const id = await create();
    expect((await orderDetailQuery(id))?.editable).toBe(true);
    const old = await t.prisma.order.create({
      data: {
        customerId,
        deliveryDate: date("2020-01-01"),
        windowFrom: date("2020-01-01"),
        windowTo: date("2020-01-01"),
        status: "CONFIRMED",
        createdById: adminId,
      },
    });
    expect((await orderDetailQuery(old.id))?.editable).toBe(false);
    expect(await orderDetailQuery("nope")).toBeNull();
  });
});
