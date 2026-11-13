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

const { createProductAction, moveProductAction, setProductActiveAction, updateProductAction } =
  await import("./product-actions");
const { activeProductsQuery, getProductQuery, listProductsQuery } =
  await import("./product-queries");

const valid = {
  sku: "tst-1",
  unit: "PACK",
  weightKgPerUnit: "2,5",
  name: { de: "Schraubennudeln", hans: "螺旋意面", en: "", sr: "", cs: "" },
  enAuto: true,
  srAuto: true,
  csAuto: true,
};

describe.skipIf(!process.env.DATABASE_URL)("product catalog", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let inactiveAdminId: string;

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
    inactiveAdminId = await mk({
      role: "ADMIN",
      email: "i@example.com",
      passwordHash: hash,
      displayName: "I",
      active: false,
    });
  }, 60_000);

  afterAll(async () => {
    await t?.teardown();
  });

  beforeEach(async () => {
    state.session = null;
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.recurringOrder.deleteMany();
    await t.prisma.product.deleteMany();
  });

  const asAdmin = () => {
    state.session = { user: { id: adminId } };
  };

  async function create(overrides: Record<string, unknown> = {}) {
    asAdmin();
    const result = await createProductAction({ ...valid, ...overrides });
    if (!result.ok) throw new Error(`create failed: ${result.error}`);
    return result.id;
  }

  const skus = async () => (await listProductsQuery()).map((p) => p.sku);

  it("rejects anonymous callers, drivers and deactivated admins on every action and read", async () => {
    const id = await create({ sku: "AUTH-1" });
    const calls: Array<() => Promise<unknown>> = [
      () => createProductAction({ ...valid, sku: "AUTH-2" }),
      () => updateProductAction(id, { ...valid, sku: "AUTH-1", name: { ...valid.name, de: "X" } }),
      () => setProductActiveAction(id, false),
      () => moveProductAction(id, "down"),
      () => listProductsQuery(),
      () => activeProductsQuery(),
      () => getProductQuery(id),
    ];
    const sessions: Array<[typeof state.session, string]> = [
      [null, "UNAUTHENTICATED"],
      [{ user: { id: driverId } }, "FORBIDDEN"],
      [{ user: { id: inactiveAdminId } }, "UNAUTHENTICATED"],
    ];
    for (const [session, code] of sessions) {
      for (const call of calls) {
        state.session = session;
        await expect(call()).rejects.toMatchObject({ code });
      }
    }
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.active).toBe(true);
    expect(await t.prisma.product.count()).toBe(1);
  });

  it("rejects a product without a Simplified Chinese name (or German name, or SKU)", async () => {
    asAdmin();
    for (const name of [
      { ...valid.name, hans: "" },
      { ...valid.name, hans: "   " },
      { ...valid.name, de: "" },
    ]) {
      expect(await createProductAction({ ...valid, name })).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    const withoutHans = { de: valid.name.de, en: "", sr: "", cs: "" };
    expect(await createProductAction({ ...valid, name: withoutHans })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await createProductAction({ ...valid, sku: "" })).toMatchObject({ ok: false });
    expect(await createProductAction({ ...valid, sku: "bad sku!" })).toMatchObject({ ok: false });
    expect(await createProductAction({ ...valid, unit: "BOX" })).toMatchObject({ ok: false });
    expect(await createProductAction("nonsense")).toMatchObject({ ok: false });
    expect(await t.prisma.product.count()).toBe(0);
  });

  it("machine-translates the en / sr-Latn / cs names from German and marks them as machine", async () => {
    const id = await create();
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.sku).toBe("TST-1");
    expect(row.name).toMatchObject({
      de: "Schraubennudeln",
      "zh-Hans": "螺旋意面",
      en: "[en] Schraubennudeln",
      "sr-Latn": "[sr-Latn] Schraubennudeln",
      cs: "[cs] Schraubennudeln",
      meta: { source: "de", machine: { en: true, "sr-Latn": true, cs: true } },
    });
    expect((row.name as { meta: { pendingTranslation?: boolean } }).meta.pendingTranslation).toBe(
      undefined,
    );
  });

  it("recomputes an auto name on the server and keeps a hand-edited one", async () => {
    const id = await create({
      name: { de: "Fusilli", hans: "螺旋意面", en: "FALSCH", sr: "Rucno", cs: "Ručně" },
      enAuto: true,
      srAuto: false,
      csAuto: false,
    });
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.name).toMatchObject({
      en: "[en] Fusilli",
      "sr-Latn": "Rucno",
      cs: "Ručně",
      meta: { machine: { en: true } },
    });
    const machine = (row.name as { meta: { machine: Record<string, boolean> } }).meta.machine;
    expect(machine).not.toHaveProperty("sr-Latn");
    expect(machine).not.toHaveProperty("cs");
    // Editing the German name refreshes the auto English name and keeps the hand-edited ones.
    asAdmin();
    const result = await updateProductAction(id, {
      sku: "TST-1",
      unit: "PACK",
      weightKgPerUnit: "3",
      name: { de: "Penne", hans: "笔管面", en: "x", sr: "Rucno", cs: "Ručně" },
      enAuto: true,
      srAuto: false,
      csAuto: false,
    });
    expect(result.ok).toBe(true);
    const updated = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect(updated.name).toMatchObject({
      de: "Penne",
      "zh-Hans": "笔管面",
      en: "[en] Penne",
      "sr-Latn": "Rucno",
      cs: "Ručně",
    });
    const form = await getProductQuery(id);
    expect(form).toMatchObject({ enAuto: true, srAuto: false, csAuto: false, unitLocked: false });
  });

  it("translates an empty, non-auto field instead of storing an empty name", async () => {
    const id = await create({ enAuto: false, srAuto: false, csAuto: false });
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    expect((row.name as Record<string, string>).cs).toBe("[cs] Schraubennudeln");
  });

  it("saves the product when the translator fails and flags the name pending", async () => {
    const { buildProductName, productInputSchema } = await import("./products");
    const down = {
      kind: "deepl" as const,
      translate: async () => {
        throw Object.assign(new Error("down"), { code: "HTTP" });
      },
    };
    const name = await buildProductName(productInputSchema.parse(valid), { translator: down });
    expect(name).toMatchObject({ de: "Schraubennudeln", "zh-Hans": "螺旋意面" });
    expect(name.en).toBeUndefined();
    expect(name.meta.pendingTranslation).toBe(true);
    // A language without a provider (UNSUPPORTED) stays empty without clogging the retry job.
    const noSerbian = {
      kind: "deepl" as const,
      translate: async (text: string, _from: string, to: string) => {
        if (to === "sr-Latn") throw Object.assign(new Error("n/a"), { code: "UNSUPPORTED" });
        return `[${to}] ${text}`;
      },
    };
    const partial = await buildProductName(productInputSchema.parse(valid), {
      translator: noSerbian as never,
    });
    expect(partial["sr-Latn"]).toBeUndefined();
    expect(partial.en).toBe("[en] Schraubennudeln");
    expect(partial.meta.pendingTranslation).toBeUndefined();
  });

  it("rejects duplicate SKUs case-insensitively", async () => {
    const id = await create({ sku: "dup-1" });
    asAdmin();
    expect(await createProductAction({ ...valid, sku: "DUP-1" })).toEqual({
      ok: false,
      error: "sku_taken",
    });
    const other = await create({ sku: "dup-2" });
    expect(await updateProductAction(other, { ...valid, sku: "Dup-1", name: valid.name })).toEqual({
      ok: false,
      error: "sku_taken",
    });
    expect(await updateProductAction(id, { ...valid, sku: "dup-1" })).toEqual({ ok: true, id });
  });

  it("appends new products to the end and reorders with up/down", async () => {
    const a = await create({ sku: "A" });
    const b = await create({ sku: "B" });
    const c = await create({ sku: "C" });
    expect(await skus()).toEqual(["A", "B", "C"]);
    expect(await moveProductAction(c, "up")).toEqual({ ok: true });
    expect(await skus()).toEqual(["A", "C", "B"]);
    expect(await moveProductAction(a, "down")).toEqual({ ok: true });
    expect(await skus()).toEqual(["C", "A", "B"]);
    // Ends are no-ops.
    await moveProductAction(c, "up");
    await moveProductAction(b, "down");
    expect(await skus()).toEqual(["C", "A", "B"]);
    expect((await listProductsQuery()).map((p) => p.sortOrder)).toEqual([0, 1, 2]);
    expect(await moveProductAction("nope", "up")).toEqual({ ok: false, error: "not_found" });
    expect(await moveProductAction(a, "sideways")).toEqual({ ok: false, error: "invalid" });
  });

  it("repairs tied sort orders when moving", async () => {
    const ids = [
      await create({ sku: "T1" }),
      await create({ sku: "T2" }),
      await create({ sku: "T3" }),
    ];
    await t.prisma.product.updateMany({ data: { sortOrder: 5 } });
    await moveProductAction(ids[2]!, "up");
    expect((await listProductsQuery()).map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it("getActiveProducts (order picker) hides inactive products in sort order; old orders keep them", async () => {
    const a = await create({ sku: "A" });
    const b = await create({ sku: "B" });
    await create({ sku: "C" });
    const customer = await t.prisma.customer.create({
      data: {
        customerNumber: "K1",
        name: "K",
        street: "S 1",
        postalCode: "1010",
        city: "Wien",
      },
    });
    await t.prisma.order.create({
      data: {
        customerId: customer.id,
        deliveryDate: new Date("2026-11-02"),
        windowFrom: new Date("2026-11-02"),
        windowTo: new Date("2026-11-02"),
        status: "CONFIRMED",
        createdById: adminId,
        items: { create: [{ productId: b, quantity: 3 }] },
      },
    });
    expect((await activeProductsQuery()).map((p) => p.sku)).toEqual(["A", "B", "C"]);
    expect(await setProductActiveAction(b, false)).toEqual({ ok: true });
    expect((await activeProductsQuery()).map((p) => p.sku)).toEqual(["A", "C"]);
    expect(await skus()).toEqual(["A", "B", "C"]); // still listed for the admin
    // The product row and the old order item survive (soft delete only).
    const item = await t.prisma.orderItem.findFirstOrThrow({ include: { product: true } });
    expect(item.product).toMatchObject({ id: b, active: false });
    // Reordering moves through inactive products too; the picker keeps the relative order.
    await moveProductAction(a, "down");
    expect(await skus()).toEqual(["B", "A", "C"]);
    expect((await activeProductsQuery()).map((p) => p.sku)).toEqual(["A", "C"]);
    expect(await setProductActiveAction(b, true)).toEqual({ ok: true });
    expect((await activeProductsQuery()).map((p) => p.sku)).toContain("B");
    expect(await setProductActiveAction("nope", true)).toEqual({ ok: false, error: "not_found" });
    expect(await setProductActiveAction(a, "yes")).toEqual({ ok: false, error: "invalid" });
  });

  it("does not allow changing the unit of a product that is on an order", async () => {
    const id = await create({ sku: "U1" });
    expect(await updateProductAction(id, { ...valid, sku: "U1", unit: "KG" })).toEqual({
      ok: true,
      id,
    });
    const customer = await t.prisma.customer.create({
      data: { customerNumber: "K2", name: "K", street: "S 1", postalCode: "1010", city: "Wien" },
    });
    await t.prisma.order.create({
      data: {
        customerId: customer.id,
        deliveryDate: new Date("2026-11-02"),
        windowFrom: new Date("2026-11-02"),
        windowTo: new Date("2026-11-02"),
        createdById: adminId,
        items: { create: [{ productId: id, quantity: 1 }] },
      },
    });
    expect(await updateProductAction(id, { ...valid, sku: "U1", unit: "CRATE" })).toEqual({
      ok: false,
      error: "unit_locked",
    });
    expect((await t.prisma.product.findUniqueOrThrow({ where: { id } })).unit).toBe("KG");
    expect(await getProductQuery(id)).toMatchObject({ unitLocked: true });
    // Names stay editable.
    expect((await updateProductAction(id, { ...valid, sku: "U1", unit: "KG" })).ok).toBe(true);
  });

  it("keeps the unit locked for a product that is only on a standing order (NUD-201)", async () => {
    // Its orders may be deleted after they were paid; the standing order still means "3 of this unit".
    const id = await create({ sku: "U2" });
    const customer = await t.prisma.customer.create({
      data: { customerNumber: "K3", name: "K", street: "S 1", postalCode: "1010", city: "Wien" },
    });
    await t.prisma.recurringOrder.create({
      data: {
        customerId: customer.id,
        weekdays: [1],
        anchorDate: new Date("2026-11-02"),
        confirmedById: adminId,
        items: { create: [{ productId: id, quantity: 3 }] },
      },
    });
    const stored = await t.prisma.product.findUniqueOrThrow({ where: { id } });
    const other = stored.unit === "CRATE" ? "KG" : "CRATE";
    expect(await updateProductAction(id, { ...valid, sku: "U2", unit: other })).toEqual({
      ok: false,
      error: "unit_locked",
    });
    expect(await getProductQuery(id)).toMatchObject({ unitLocked: true });
  });

  it("stores the weight per unit, accepts a decimal comma and rejects 0, negatives and text", async () => {
    asAdmin();
    const id = await create({ sku: "W1", weightKgPerUnit: "12,5" });
    expect(
      Number((await t.prisma.product.findUniqueOrThrow({ where: { id } })).weightKgPerUnit),
    ).toBe(12.5);
    expect(await getProductQuery(id)).toMatchObject({ weightKgPerUnit: "12.5" });
    expect((await updateProductAction(id, { ...valid, sku: "W1", weightKgPerUnit: 4 })).ok).toBe(
      true,
    );
    expect(
      Number((await t.prisma.product.findUniqueOrThrow({ where: { id } })).weightKgPerUnit),
    ).toBe(4);
    for (const bad of ["0", "-3", "abc", "", "1,234", "10000", undefined]) {
      expect(await createProductAction({ ...valid, sku: "W2", weightKgPerUnit: bad })).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    // The database refuses a non-positive weight even when the service is bypassed.
    await expect(
      t.prisma.product.update({ where: { id }, data: { weightKgPerUnit: 0 } }),
    ).rejects.toThrow();
  });
});
