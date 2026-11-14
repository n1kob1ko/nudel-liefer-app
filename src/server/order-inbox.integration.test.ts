// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ExtractionAnswer } from "@/domain/order-extraction";

import { hashSecret } from "./auth/password";
import {
  type OrderExtractionInput,
  type OrderExtractor,
  OrderExtractorError,
} from "./order-extractor";
import {
  addInboxPhotos,
  claimInboxPhotos,
  countInbox,
  discardInboxPhoto,
  drainInbox,
  getInboxPrefill,
  INBOX_DISCARD_GRACE_MS,
  INBOX_STALE_READ_MS,
  listInbox,
  nextInboxPhoto,
  purgeDiscardedInboxPhotos,
  restoreInboxPhoto,
  retryInboxPhoto,
  suggestCustomer,
} from "./order-inbox";
import { createOrder } from "./orders";
import { FakeStorage } from "./storage/fake";
import { createTestDb, type TestDb } from "./test-db";

const key = (n: number) => `screenshots/00000000-0000-4000-8000-${String(n).padStart(12, "0")}.jpg`;
const TODAY = "2099-06-14";
const tours = { markOutdatedForDate: async () => 0 } as unknown as Parameters<
  typeof createOrder
>[5];
const DAY = "2099-06-15";

/** A scripted model: the answer depends on the first byte of the photo. */
class ScriptedExtractor implements OrderExtractor {
  readonly kind = "fake" as const;
  readonly seen: number[] = [];
  running = 0;
  peak = 0;
  constructor(private readonly answers: Record<number, Partial<ExtractionAnswer> | "fail">) {}

  async extract(input: OrderExtractionInput) {
    const marker = input.image?.bytes[0] ?? -1;
    this.seen.push(marker);
    this.running += 1;
    this.peak = Math.max(this.peak, this.running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.running -= 1;
    const answer = this.answers[marker];
    if (!answer || answer === "fail") throw new OrderExtractorError("no", "BAD_RESPONSE");
    return {
      answer: { lines: [], confidence: 0.9, ...answer } as ExtractionAnswer,
      raw: {},
      model: "scripted",
    };
  }
}

describe.skipIf(!process.env.DATABASE_URL)("order inbox (NUD-210)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let wok: string;
  let lotus: string;
  let archived: string;
  let pack: string;
  let crate: string;
  let storage: FakeStorage;

  /** Serves the bytes of the fake storage for its `fake://read/<key>` URLs. */
  const fetchFromStorage = (async (url: string | URL | Request) => {
    const match = /^fake:\/\/read\/(.+)\?/.exec(String(url));
    const object = match ? storage.objects.get(match[1]!) : undefined;
    return object ? new Response(object.body as BodyInit) : new Response(null, { status: 404 });
  }) as typeof fetch;

  const deps = (extractor: OrderExtractor, now?: () => Date) => ({
    storage,
    extractor,
    today: TODAY,
    timezone: "Europe/Vienna",
    fetch: fetchFromStorage,
    now,
  });

  const upload = (n: number, marker = n) =>
    storage.put(key(n), new Uint8Array([marker, 1, 2]), "image/jpeg");

  beforeAll(async () => {
    t = await createTestDb();
    adminId = (
      await t.prisma.user.create({
        data: {
          role: "ADMIN",
          email: "inbox@example.com",
          passwordHash: await hashSecret("123456"),
          displayName: "A",
        },
      })
    ).id;
    const customer = (n: string, name: string, extra: Record<string, unknown> = {}) =>
      t.prisma.customer
        .create({
          data: {
            customerNumber: n,
            name,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            ...extra,
          },
        })
        .then((c) => c.id);
    wok = await customer("K1", "Wok Palace");
    lotus = await customer("K2", "Lotus Garten");
    archived = await customer("K3", "Alter Imbiss", { active: false });
    // The migrations bring the catalog (NUD-138): "Nudeln" as Sackerl and as Kiste.
    const product = (sku: string) =>
      t.prisma.product.findUniqueOrThrow({ where: { sku } }).then((p) => p.id);
    pack = await product("NUDELN-BEUTEL");
    crate = await product("NUDELN-KARTON");
  });

  afterAll(async () => {
    await t?.teardown();
  });

  beforeEach(async () => {
    await t.prisma.orderItem.deleteMany();
    await t.prisma.order.deleteMany();
    await t.prisma.screenshot.deleteMany();
    storage = new FakeStorage();
  });

  const statusOf = async (storageKey: string) =>
    (await t.prisma.screenshot.findFirst({ where: { storageKey } }))?.inboxStatus ?? null;

  it("takes uploaded photos, skips unknown, missing and repeated keys", async () => {
    upload(1);
    upload(2);
    const first = await addInboxPhotos(t.prisma, adminId, [key(1), key(2), key(3)], storage);
    expect(first).toEqual({ ok: true, added: 2, skipped: 1 });
    expect(await addInboxPhotos(t.prisma, adminId, [key(1)], storage)).toEqual({
      ok: true,
      added: 0,
      skipped: 1,
    });
    expect(await countInbox(t.prisma)).toBe(2);
    for (const bad of [
      [],
      ["customers/x.jpg"],
      "nope",
      Array.from({ length: 21 }, (_, i) => key(i)),
    ]) {
      expect(await addInboxPhotos(t.prisma, adminId, bad, storage)).toEqual({
        ok: false,
        error: "invalid",
      });
    }
  });

  it("reads every waiting photo, a few at a time, and proposes the customer by name", async () => {
    for (let n = 1; n <= 6; n++) upload(n);
    await addInboxPhotos(t.prisma, adminId, [1, 2, 3, 4, 5, 6].map(key), storage);
    const extractor = new ScriptedExtractor({
      1: {
        customer: "Wok Palace",
        lines: [
          { label: "Nudeln Kiste", quantity: 3, confidence: 0.9 },
          { label: "Nudeln Sackerl", quantity: 10, confidence: 0.9 },
          { label: "Tofu", quantity: 2, confidence: 0.9 },
        ],
      },
      2: {
        customer: "Pizzeria Roma",
        lines: [{ label: "Nudeln Kiste", quantity: 1, confidence: 0.9 }],
      },
      3: { customer: null, lines: [] },
      4: "fail",
      5: { customer: "Alter Imbiss" },
      6: { customer: "LOTUS GARTEN" },
    });
    const report = await drainInbox(t.prisma, deps(extractor), { concurrency: 2 });
    expect(report).toEqual({ read: 5, failed: 1 });
    expect(extractor.peak).toBe(2);
    expect([...extractor.seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);

    const view = await listInbox(t.prisma, storage);
    expect(view.waiting).toBe(0);
    expect(view.ready).toBe(5);
    expect(view.items.map((item) => item.status)).toEqual([
      "READY",
      "READY",
      "READY",
      "FAILED",
      "READY",
      "READY",
    ]);
    const [one, two, three, four, five, six] = view.items;
    expect(one!.customer).toEqual({ id: wok, name: "Wok Palace", city: "Wien" });
    expect(one!.lines).toEqual([
      { productId: crate, quantity: "3" },
      { productId: pack, quantity: "10" },
    ]);
    expect(one!.unmatched).toBe(1);
    expect(one!.url).toContain(key(1));
    expect(two!.customer).toBeNull();
    expect(two!.customerHint).toBe("Pizzeria Roma");
    expect(three!.customerHint).toBeNull();
    expect(four!.error).toBe("extraction_failed");
    // An archived customer is never proposed.
    expect(five!.customer).toBeNull();
    expect(six!.customer?.id).toBe(lotus);

    // Nothing left to read: a second run does not call the model again.
    expect(await drainInbox(t.prisma, deps(extractor))).toEqual({ read: 0, failed: 0 });
    expect(extractor.seen).toHaveLength(6);
  });

  it("claims a photo once and takes over a reader that vanished", async () => {
    upload(1);
    await addInboxPhotos(t.prisma, adminId, [key(1)], storage);
    const start = new Date("2099-06-14T08:00:00Z");
    expect(await claimInboxPhotos(t.prisma, 4, start)).toHaveLength(1);
    expect(await claimInboxPhotos(t.prisma, 4, start)).toHaveLength(0);
    const soon = new Date(start.getTime() + INBOX_STALE_READ_MS - 1000);
    expect(await claimInboxPhotos(t.prisma, 4, soon)).toHaveLength(0);
    const late = new Date(start.getTime() + INBOX_STALE_READ_MS + 1000);
    expect(await claimInboxPhotos(t.prisma, 4, late)).toHaveLength(1);
  });

  it("does not overwrite a photo that was discarded while it was being read", async () => {
    upload(1);
    await addInboxPhotos(t.prisma, adminId, [key(1)], storage);
    const row = await t.prisma.screenshot.findFirstOrThrow();
    const extractor: OrderExtractor = {
      kind: "fake",
      extract: async () => {
        await discardInboxPhoto(t.prisma, row.id);
        return { answer: { lines: [], confidence: 1 } as ExtractionAnswer, raw: {}, model: "x" };
      },
    };
    expect(await drainInbox(t.prisma, deps(extractor))).toEqual({ read: 0, failed: 0 });
    expect(await statusOf(key(1))).toBe("DISCARDED");
  });

  it("learns the customer of a chat name from the order the office saved", async () => {
    upload(1);
    upload(2);
    await addInboxPhotos(t.prisma, adminId, [key(1)], storage);
    const extractor = new ScriptedExtractor({
      1: { customer: "Chen 🍜", lines: [{ label: "Nudeln Kiste", quantity: 2, confidence: 0.9 }] },
      2: { customer: "chen 🍜", lines: [{ label: "Nudeln Kiste", quantity: 4, confidence: 0.9 }] },
    });
    await drainInbox(t.prisma, deps(extractor));
    expect((await listInbox(t.prisma, storage)).items[0]!.customer).toBeNull();

    const saved = await createOrder(
      t.prisma,
      adminId,
      {
        customerId: lotus,
        deliveryDate: DAY,
        windowFrom: DAY,
        windowTo: DAY,
        status: "CONFIRMED",
        screenshotKey: key(1),
        lines: [{ productId: crate, quantity: "2" }],
      },
      new Date(`${TODAY}T00:00:00Z`),
      storage,
      tours,
    );
    expect(saved.ok).toBe(true);
    expect(await statusOf(key(1))).toBe("DONE");
    expect(await countInbox(t.prisma)).toBe(0);
    const order = await t.prisma.order.findFirstOrThrow({ include: { screenshot: true } });
    expect(order.source).toBe("SCREENSHOT");
    expect(order.screenshot?.storageKey).toBe(key(1));
    expect(await t.prisma.screenshot.count()).toBe(1);

    await addInboxPhotos(t.prisma, adminId, [key(2)], storage);
    await drainInbox(t.prisma, deps(extractor));
    const next = (await listInbox(t.prisma, storage)).items[0]!;
    expect(next.customer?.id).toBe(lotus);
    expect(await suggestCustomer(t.prisma, "Chen 🍜")).toBe(lotus);
    expect(await suggestCustomer(t.prisma, "  ")).toBeNull();
  });

  it("saves one order per photo: a second save of the same photo is refused", async () => {
    upload(1);
    await addInboxPhotos(t.prisma, adminId, [key(1)], storage);
    const input = {
      customerId: wok,
      deliveryDate: DAY,
      windowFrom: DAY,
      windowTo: DAY,
      status: "DRAFT",
      screenshotKey: key(1),
      lines: [{ productId: pack, quantity: "1" }],
    };
    const save = () =>
      createOrder(t.prisma, adminId, input, new Date(`${TODAY}T00:00:00Z`), storage, tours);
    const results = await Promise.all([save(), save()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "screenshot_in_use" });
    expect(await t.prisma.order.count()).toBe(1);
  });

  it("refuses a discarded photo and a photo that already has an order", async () => {
    upload(1);
    await addInboxPhotos(t.prisma, adminId, [key(1)], storage);
    const row = await t.prisma.screenshot.findFirstOrThrow();
    await discardInboxPhoto(t.prisma, row.id);
    const saved = await createOrder(
      t.prisma,
      adminId,
      {
        customerId: wok,
        deliveryDate: DAY,
        windowFrom: DAY,
        windowTo: DAY,
        status: "DRAFT",
        screenshotKey: key(1),
        lines: [{ productId: pack, quantity: "1" }],
      },
      new Date(`${TODAY}T00:00:00Z`),
      storage,
      tours,
    );
    expect(saved).toMatchObject({ ok: false, error: "screenshot_in_use" });
  });

  it("opens one photo for the form and names the next one that is ready", async () => {
    for (let n = 1; n <= 3; n++) upload(n);
    await addInboxPhotos(t.prisma, adminId, [1, 2, 3].map(key), storage);
    const extractor = new ScriptedExtractor({
      1: {
        customer: "Wok Palace",
        lines: [{ label: "Nudeln Kiste", quantity: 3, confidence: 0.4 }],
      },
      2: "fail",
      3: { customer: null, lines: [{ label: "Nudeln Sackerl", quantity: 5, confidence: 0.9 }] },
    });
    await drainInbox(t.prisma, deps(extractor));
    const rows = await t.prisma.screenshot.findMany({ orderBy: { storageKey: "asc" } });

    const first = await getInboxPrefill(t.prisma, rows[0]!.id, storage);
    expect(first).toMatchObject({
      id: rows[0]!.id,
      customerId: wok,
      customerHint: "Wok Palace",
      nextId: rows[2]!.id,
      remaining: 2,
    });
    expect(first!.screenshot.storageKey).toBe(key(1));
    expect(first!.draft?.lines).toEqual([
      { productId: crate, quantity: "3", confidence: 0.4, label: "Nudeln Kiste" },
    ]);
    expect(first!.extraction?.customer).toBe("Wok Palace");

    // A photo that could not be read still opens: the office types the order next to it.
    const failed = await getInboxPrefill(t.prisma, rows[1]!.id, storage);
    expect(failed).toMatchObject({ draft: null, extraction: null, customerId: null });
    expect(failed!.nextId).toBe(rows[0]!.id);

    const last = await getInboxPrefill(t.prisma, rows[2]!.id, storage);
    expect(last!.nextId).toBe(rows[0]!.id);
    await discardInboxPhoto(t.prisma, rows[0]!.id);
    // Nothing else is ready: the photo that could not be read comes next, then nothing.
    expect((await getInboxPrefill(t.prisma, rows[2]!.id, storage))!.nextId).toBe(rows[1]!.id);
    expect((await getInboxPrefill(t.prisma, rows[1]!.id, storage))!.nextId).toBe(rows[2]!.id);
    await discardInboxPhoto(t.prisma, rows[1]!.id);
    expect((await getInboxPrefill(t.prisma, rows[2]!.id, storage))!.nextId).toBeNull();
    expect(await getInboxPrefill(t.prisma, rows[0]!.id, storage)).toBeNull();
    expect(await getInboxPrefill(t.prisma, "missing", storage)).toBeNull();
    expect(await getInboxPrefill(t.prisma, { id: 1 }, storage)).toBeNull();
  });

  it("offers unread photos as next only when there is no model to read them", async () => {
    upload(1);
    upload(2);
    await addInboxPhotos(t.prisma, adminId, [key(1), key(2)], storage);
    const [a, b] = await t.prisma.screenshot.findMany({ orderBy: { storageKey: "asc" } });
    expect((await getInboxPrefill(t.prisma, a!.id, storage))!.nextId).toBeNull();
    const byHand = await getInboxPrefill(t.prisma, a!.id, storage, { includeUnread: true });
    expect(byHand).toMatchObject({ nextId: b!.id, remaining: 1, draft: null });
    expect(await nextInboxPhoto(t.prisma, null, true)).toBe(a!.id);
    expect(await nextInboxPhoto(t.prisma, null, false)).toBeNull();
  });

  it("discards with a way back, then deletes the photo for good", async () => {
    upload(1);
    upload(2);
    await addInboxPhotos(t.prisma, adminId, [key(1), key(2)], storage);
    await drainInbox(
      t.prisma,
      deps(new ScriptedExtractor({ 1: { customer: "Wok Palace" }, 2: "fail" })),
    );
    const [a, b] = await t.prisma.screenshot.findMany({ orderBy: { storageKey: "asc" } });
    const at = new Date("2099-06-14T08:00:00Z");

    expect(await discardInboxPhoto(t.prisma, a!.id, at)).toEqual({ ok: true });
    expect(await discardInboxPhoto(t.prisma, a!.id, at)).toEqual({ ok: false, error: "not_found" });
    expect(await discardInboxPhoto(t.prisma, b!.id, at)).toEqual({ ok: true });
    expect(await countInbox(t.prisma)).toBe(0);

    expect(await restoreInboxPhoto(t.prisma, a!.id)).toEqual({ ok: true });
    expect(await restoreInboxPhoto(t.prisma, a!.id)).toEqual({ ok: false, error: "not_found" });
    expect(await statusOf(key(1))).toBe("READY");
    expect(await restoreInboxPhoto(t.prisma, b!.id)).toEqual({ ok: true });
    expect(await statusOf(key(2))).toBe("FAILED");

    await discardInboxPhoto(t.prisma, b!.id, at);
    const early = new Date(at.getTime() + INBOX_DISCARD_GRACE_MS - 1000);
    expect(await purgeDiscardedInboxPhotos(t.prisma, storage, early)).toEqual({
      deleted: 0,
      failed: 0,
    });
    const late = new Date(at.getTime() + INBOX_DISCARD_GRACE_MS + 1000);
    expect(await purgeDiscardedInboxPhotos(t.prisma, storage, late)).toEqual({
      deleted: 1,
      failed: 0,
    });
    expect(storage.has(key(2))).toBe(false);
    expect(storage.has(key(1))).toBe(true);
    expect(await t.prisma.screenshot.count()).toBe(1);
  });

  it("reads a failed photo again on request", async () => {
    upload(1);
    await addInboxPhotos(t.prisma, adminId, [key(1)], storage);
    await drainInbox(t.prisma, deps(new ScriptedExtractor({ 1: "fail" })));
    const row = await t.prisma.screenshot.findFirstOrThrow();
    expect(row.inboxStatus).toBe("FAILED");
    expect(await retryInboxPhoto(t.prisma, row.id)).toEqual({ ok: true });
    expect(await retryInboxPhoto(t.prisma, row.id)).toEqual({ ok: false, error: "not_found" });
    await drainInbox(t.prisma, deps(new ScriptedExtractor({ 1: { customer: "Wok Palace" } })));
    expect(await statusOf(key(1))).toBe("READY");
  });

  it("marks a photo whose file is gone as failed instead of waiting forever", async () => {
    upload(1);
    await addInboxPhotos(t.prisma, adminId, [key(1)], storage);
    storage.objects.delete(key(1));
    expect(await drainInbox(t.prisma, deps(new ScriptedExtractor({})))).toEqual({
      read: 0,
      failed: 1,
    });
    expect((await listInbox(t.prisma, storage)).items[0]!.error).toBe("screenshot_unavailable");
  });

  it("keeps the photo of the order form working as before", async () => {
    upload(9);
    const saved = await createOrder(
      t.prisma,
      adminId,
      {
        customerId: wok,
        deliveryDate: DAY,
        windowFrom: DAY,
        windowTo: DAY,
        status: "DRAFT",
        screenshotKey: key(9),
        lines: [{ productId: pack, quantity: "1" }],
      },
      new Date(`${TODAY}T00:00:00Z`),
      storage,
      tours,
    );
    expect(saved.ok).toBe(true);
    expect(await statusOf(key(9))).toBeNull();
    expect(await countInbox(t.prisma)).toBe(0);
    expect(archived).toBeTruthy();
  });
});
