// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildDepartureChecklist } from "@/domain/departure-checklist";
import type { SyncEntry } from "@/domain/driver-sync";
import { toDriverToday } from "@/lib/driver-tour-model";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const state: { db: TestDb["prisma"] | null } = { db: null };
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("./auth/auth", () => ({ auth: async () => null }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { applySyncBatch } = await import("./driver-sync");
const { applyDriverDeparture } = await import("./tour-departure");
const { getDriverTourResponse } = await import("./driver-tour-payload");

const text = (de: string, hans: string) => ({
  de,
  "zh-Hans": hans,
  meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
});
const NOW = new Date("2099-07-02T06:00:00Z");
const OPTIONS = { now: NOW, timezone: "Europe/Vienna", serviceMinutesPerStop: 10 };
const SERVER_NOW = new Date("2099-07-02T06:30:00.000Z");
const T_LOAD = new Date("2099-07-02T05:40:00.000Z");
const T_GO = new Date("2099-07-02T05:55:00.000Z");

describe.skipIf(!process.env.DATABASE_URL)(
  "departure checklist (NUD-151)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let driverId: string;
    let otherDriverId: string;
    let tourId: string;
    let stopIds: string[];
    let foreignStopId: string;
    let since = new Date();

    const driver = (id = driverId) => ({ id, role: "DRIVER" as const, locale: "de" });
    const entry = (type: "loading" | "depart", at: Date, stopId = stopIds[0]!): SyncEntry => ({
      clientMutationId: randomUUID(),
      type,
      stopId,
      createdAt: at.toISOString(),
    });
    const sync = (entries: SyncEntry[], who = driver()) =>
      applySyncBatch(t.prisma, who, entries, SERVER_NOW, { afterApply: () => undefined });
    const tour = () => t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });
    const audits = () =>
      t.prisma.auditLog.findMany({
        where: { entity: "Tour", entityId: tourId, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
      });
    const reset = () =>
      t.prisma.tour.update({
        where: { id: tourId },
        data: { loadingStartedAt: null, departedAt: null },
      });

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      const hash = await hashSecret("123456");
      const user = (data: Record<string, unknown>) =>
        t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
      driverId = await user({ role: "DRIVER", username: "drv", displayName: "Fahrer Marko" });
      otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "Other" });

      const mkProduct = (sku: string, unit: "PACK" | "CRATE" | "PIECE", de: string, sort: number) =>
        t.prisma.product.create({
          data: { sku, unit, weightKgPerUnit: 3, sortOrder: sort, name: text(de, de) },
        });
      const beutel = await mkProduct("N-B", "PACK", "Nudeln", 1);
      const karton = await mkProduct("N-K", "CRATE", "Nudeln", 2);
      const teig = await mkProduct("W-T", "PIECE", "Wantan-Teig", 3);

      const mkCustomer = (n: number, key?: { hasKey: boolean; keyNumber?: string }) =>
        t.prisma.customer
          .create({
            data: {
              customerNumber: `K${n}`,
              name: `Trattoria ${n}`,
              street: "Hauptstraße 1",
              postalCode: "1010",
              city: "Wien",
              lat: 48.2,
              lng: 16.3,
              ...(key ? { hasKey: key.hasKey, keyNumber: key.keyNumber ?? null } : {}),
            },
          })
          .then((c) => c.id);
      const c1 = await mkCustomer(1, { hasKey: true, keyNumber: "12" });
      const c2 = await mkCustomer(2, { hasKey: false });
      const c3 = await mkCustomer(3);
      const c4 = await mkCustomer(4, { hasKey: true, keyNumber: "31" });

      const depot = { name: "Depot", address: "x", lat: 48.2, lng: 16.3 };
      const mkTour = (who: string) =>
        t.prisma.tour.create({
          data: {
            date: new Date("2099-07-02T00:00:00Z"),
            driverId: who,
            status: "RELEASED",
            releaseRevision: 1,
            depotSnapshot: depot,
          },
        });
      tourId = (await mkTour(driverId)).id;
      const items = (rows: Array<[string, number]>) =>
        rows.map(([productId, quantity]) => ({ productId, quantity }));
      const mkStop = (
        id: string,
        seq: number,
        trip: number,
        customerId: string,
        rows: Array<[string, number]>,
      ) =>
        t.prisma.stop
          .create({ data: { tourId: id, customerId, sequence: seq, trip, items: items(rows) } })
          .then((s) => s.id);
      stopIds = [
        await mkStop(tourId, 1, 1, c1, [
          [karton.id, 4],
          [beutel.id, 5],
        ]),
        await mkStop(tourId, 2, 1, c2, [
          [karton.id, 10],
          [teig.id, 3],
        ]),
        await mkStop(tourId, 3, 1, c3, [[beutel.id, 17]]),
        // Second trip (reload at the depot)
        await mkStop(tourId, 4, 2, c4, [
          [karton.id, 2],
          [teig.id, 1],
        ]),
      ];
      const foreign = await mkTour(otherDriverId);
      foreignStopId = await mkStop(foreign.id, 1, 1, c1, [[beutel.id, 1]]);
    });

    afterAll(async () => {
      await t?.teardown();
    });

    it("opening the checklist writes loadingStartedAt, leaving writes departedAt, with the time of the tap", async () => {
      since = new Date();
      const result = await sync([entry("loading", T_LOAD), entry("depart", T_GO)]);
      expect(result.results.map((r) => r.outcome)).toEqual(["applied", "applied"]);
      const row = await tour();
      expect(row.loadingStartedAt?.toISOString()).toBe(T_LOAD.toISOString());
      expect(row.departedAt?.toISOString()).toBe(T_GO.toISOString());
      // The answer carries the authoritative times for the offline copy.
      expect(result.tours[0]).toMatchObject({
        tourId,
        loadingStartedAt: T_LOAD.toISOString(),
        departedAt: T_GO.toISOString(),
      });
      const rows = await audits();
      expect(rows.map((r) => r.action)).toEqual(["tour.loading_started", "tour.departed"]);
      expect(rows.every((r) => r.actorId === driverId)).toBe(true);
      expect(rows[1]!.diff).toMatchObject({ skipped: false, via: "sync" });
    });

    it("skipping the checklist records departedAt only", async () => {
      await reset();
      since = new Date();
      await sync([entry("depart", T_GO)]);
      const row = await tour();
      expect(row.loadingStartedAt).toBeNull();
      expect(row.departedAt?.toISOString()).toBe(T_GO.toISOString());
      expect((await audits())[0]!.diff).toMatchObject({ skipped: true });
    });

    it("the first write wins, and a replayed id changes nothing", async () => {
      await reset();
      since = new Date();
      const first = entry("depart", T_GO);
      await sync([first]);
      const later = new Date(T_GO.getTime() + 600_000);
      const again = await sync([first, entry("depart", later)]);
      expect(again.results.map((r) => r.outcome)).toEqual(["replayed", "applied"]);
      expect((await tour()).departedAt?.toISOString()).toBe(T_GO.toISOString());
      expect(await audits()).toHaveLength(1); // the second, no-op departure is not logged
    });

    it("a driver cannot touch another driver's tour (and learns nothing about it)", async () => {
      await reset();
      since = new Date();
      const bad = await sync([entry("depart", T_GO, foreignStopId)]);
      expect(bad.results[0]).toMatchObject({ outcome: "rejected", error: "not_found" });
      const unknown = await sync([entry("loading", T_GO, "does-not-exist")]);
      expect(unknown.results[0]).toMatchObject({ outcome: "rejected", error: "not_found" });
      expect((await tour()).departedAt).toBeNull();
      expect(await audits()).toHaveLength(0);
    });

    it("only a driver may call it, and unknown fields are refused", async () => {
      const admin = { id: driverId, role: "ADMIN" as const };
      const body = { type: "depart", clientMutationId: randomUUID(), stopId: stopIds[0] };
      expect(await applyDriverDeparture(t.prisma, admin, body)).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await applyDriverDeparture(t.prisma, driver(), { ...body, extra: 1 })).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await applyDriverDeparture(t.prisma, driver(), { ...body, type: "key" })).toEqual({
        ok: false,
        error: "invalid",
      });
    });

    it("an id reused for another kind of entry is a conflict", async () => {
      await reset();
      const id = randomUUID();
      const a = { type: "loading", clientMutationId: id, stopId: stopIds[0] };
      expect(await applyDriverDeparture(t.prisma, driver(), a, T_LOAD)).toEqual({
        ok: true,
        replayed: false,
      });
      expect(
        await applyDriverDeparture(t.prisma, driver(), { ...a, type: "depart" }, T_GO),
      ).toEqual({ ok: false, error: "mutation_conflict" });
    });

    it("the payload carries the times and the office's fixed items, picked per locale", async () => {
      await reset();
      await t.prisma.settings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          depotName: "D",
          depotAddress: "x",
          depotLat: 48.2,
          depotLng: 16.3,
          departureChecklist: [{ id: "c1", text: text("Lieferscheine", "送货单") }],
        },
        update: { departureChecklist: [{ id: "c1", text: text("Lieferscheine", "送货单") }] },
      });
      await sync([entry("loading", T_LOAD)]);
      const response = await getDriverTourResponse(t.prisma, driver(), OPTIONS);
      expect(response.tour?.loadingStartedAt).toBe(T_LOAD.toISOString());
      expect(response.tour?.departedAt).toBeNull();
      expect(toDriverToday(response, "de")?.checklist).toEqual([
        { id: "c1", text: "Lieferscheine" },
      ]);
      expect(toDriverToday(response, "zh-Hans")?.checklist).toEqual([{ id: "c1", text: "送货单" }]);
    });

    it("the checklist lists the keys per trip and no product totals", async () => {
      const response = await getDriverTourResponse(t.prisma, driver(), OPTIONS);
      const today = toDriverToday(response, "de")!;
      const asStops = today.stops.map((stop) => ({
        trip: stop.trip,
        customerId: stop.customerId,
        customerName: stop.customerName,
        hasKey: stop.hasKey,
        keyNumber: stop.keyNumber,
      }));
      const trip1 = buildDepartureChecklist(asStops, 1);
      expect(Object.keys(trip1)).toEqual(["keys"]);
      // Keys: only customers whose key exists, in delivery order, per trip.
      expect(trip1.keys.map((k) => [k.keyNumber, k.customerName])).toEqual([["12", "Trattoria 1"]]);
      expect(buildDepartureChecklist(asStops, 2).keys.map((k) => k.keyNumber)).toEqual(["31"]);
    });
  },
);
