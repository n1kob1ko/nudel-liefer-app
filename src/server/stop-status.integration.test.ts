// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "./auth/actor";
import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { applyStopMutation } = await import("./stop-status");
const { stopStatusAction } = await import("./stop-status-actions");

const T0 = new Date("2099-07-02T08:00:00Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

describe.skipIf(!process.env.DATABASE_URL)("driver stop status", { timeout: 60_000 }, () => {
  let t: TestDb;
  let driverId: string;
  let otherDriverId: string;
  let adminId: string;
  let customerIds: string[];
  let tourId: string;
  let stopIds: string[];

  const actor = (id = driverId, role: "DRIVER" | "ADMIN" = "DRIVER", locale = "zh-Hans") => ({
    id,
    role,
    locale,
  });
  const mutate = (input: Record<string, unknown>, who = actor(), now = T0) =>
    applyStopMutation(t.prisma, who, { clientMutationId: randomUUID(), ...input }, now);
  const stopRow = (i: number) => t.prisma.stop.findUniqueOrThrow({ where: { id: stopIds[i] } });
  const tourRow = () => t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });

  /** Fresh stops (all PENDING) and tour (RELEASED) before every test. */
  async function reset(tourStatus = "RELEASED") {
    await t.prisma.stopMutation.deleteMany();
    await t.prisma.stop.updateMany({
      where: { tourId },
      data: {
        status: "PENDING",
        problemReason: null,
        problemNote: undefined,
        completedAt: null,
        clientMutationId: null,
      },
    });
    await t.prisma.tour.update({
      where: { id: tourId },
      data: { status: tourStatus as never, completedAt: null },
    });
  }

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    const user = (data: Record<string, unknown>) =>
      t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
    adminId = await user({ role: "ADMIN", email: "a@example.com", displayName: "A" });
    driverId = await user({
      role: "DRIVER",
      username: "drv",
      displayName: "Driver",
      locale: "zh_Hans",
      localeChosen: true,
    });
    otherDriverId = await user({ role: "DRIVER", username: "drv2", displayName: "Other" });
    customerIds = [];
    for (const n of [1, 2, 3]) {
      const c = await t.prisma.customer.create({
        data: {
          customerNumber: `K${n}`,
          name: `Trattoria ${n}`,
          street: "Hauptstraße 1",
          postalCode: "1010",
          city: "Wien",
          lat: 48.2,
          lng: 16.3,
          pinConfirmed: true,
        },
      });
      customerIds.push(c.id);
    }
    const tour = await t.prisma.tour.create({
      data: {
        date: new Date("2099-07-02T00:00:00Z"),
        driverId,
        status: "RELEASED",
        releaseRevision: 1,
        depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
      },
    });
    tourId = tour.id;
    stopIds = [];
    for (const [i, customerId] of customerIds.entries()) {
      const s = await t.prisma.stop.create({
        data: { tourId, customerId, sequence: i + 1, items: [] },
      });
      stopIds.push(s.id);
    }
  });

  beforeEach(async () => {
    state.session = null;
    await reset();
  });

  afterAll(async () => {
    await t?.teardown();
  });

  it("marks a stop delivered, starts the tour and names the next stop", async () => {
    const id = randomUUID();
    const res = await applyStopMutation(
      t.prisma,
      actor(),
      { type: "delivered", stopId: stopIds[0], clientMutationId: id },
      T0,
    );
    expect(res).toMatchObject({
      ok: true,
      replayed: false,
      kind: "COMPLETE",
      status: "DELIVERED",
      tourStatus: "IN_PROGRESS",
      done: 1,
      total: 3,
      nextStopId: stopIds[1],
      completedAt: T0.toISOString(),
      undoUntil: plus(5 * MIN).toISOString(),
    });
    const stop = await stopRow(0);
    expect(stop).toMatchObject({ status: "DELIVERED", problemReason: null, clientMutationId: id });
    expect(stop.completedAt?.toISOString()).toBe(T0.toISOString());
    expect((await tourRow()).status).toBe("IN_PROGRESS");
  });

  it("stores a problem with its reason and a free text in the driver's locale", async () => {
    const res = await mutate({
      type: "problem",
      stopId: stopIds[1],
      reason: "NO_PARKING",
      note: "  门口封路  ",
    });
    expect(res).toMatchObject({ ok: true, status: "PROBLEM", nextStopId: stopIds[2] });
    const stop = await stopRow(1);
    expect(stop.status).toBe("PROBLEM");
    expect(stop.problemReason).toBe("NO_PARKING");
    expect(stop.problemNote).toMatchObject({
      "zh-Hans": "门口封路",
      meta: { source: "zh-Hans", machine: {} },
    });
    expect(stop.problemNote).not.toHaveProperty("de");
    // Without a text nothing is stored.
    await mutate({ type: "problem", stopId: stopIds[2], reason: "CLOSED", note: "   " });
    expect((await stopRow(2)).problemNote).toBeNull();
  });

  it("sets the note source to the driver's locale (German driver)", async () => {
    await applyStopMutation(
      t.prisma,
      actor(driverId, "DRIVER", "de"),
      {
        type: "problem",
        stopId: stopIds[0],
        reason: "OTHER",
        note: "Tor war zu",
        clientMutationId: randomUUID(),
      },
      T0,
    );
    expect((await stopRow(0)).problemNote).toMatchObject({
      de: "Tor war zu",
      meta: { source: "de" },
    });
  });

  it("is idempotent: the same id twice (also in parallel) changes the state exactly once", async () => {
    const input = { type: "delivered", stopId: stopIds[0], clientMutationId: randomUUID() };
    const [a, b] = await Promise.all([
      applyStopMutation(t.prisma, actor(), input, T0),
      applyStopMutation(t.prisma, actor(), input, T0),
    ]);
    expect([a, b].filter((r) => r.ok && !r.replayed)).toHaveLength(1);
    expect([a, b].filter((r) => r.ok && r.replayed)).toHaveLength(1);
    // A later replay returns the same result and does not touch the stop again.
    const later = await applyStopMutation(t.prisma, actor(), input, plus(2 * MIN));
    expect(later).toMatchObject({ ok: true, replayed: true, completedAt: T0.toISOString() });
    expect((await stopRow(0)).completedAt?.toISOString()).toBe(T0.toISOString());
    expect(await t.prisma.stopMutation.count()).toBe(1);
    expect((await tourRow()).status).toBe("IN_PROGRESS");
  });

  it("rejects a second completion with another id and leaves the first untouched", async () => {
    await mutate({ type: "delivered", stopId: stopIds[0] });
    const second = await mutate(
      { type: "problem", stopId: stopIds[0], reason: "CLOSED" },
      actor(),
      plus(MIN),
    );
    expect(second).toEqual({ ok: false, error: "already_completed" });
    const stop = await stopRow(0);
    expect(stop.status).toBe("DELIVERED");
    expect(stop.problemReason).toBeNull();
    expect(stop.completedAt?.toISOString()).toBe(T0.toISOString());
    expect(await t.prisma.stopMutation.count()).toBe(1);
  });

  it("rejects an id that was used for something else", async () => {
    const id = randomUUID();
    await applyStopMutation(
      t.prisma,
      actor(),
      { type: "delivered", stopId: stopIds[0], clientMutationId: id },
      T0,
    );
    const other = await applyStopMutation(
      t.prisma,
      actor(),
      { type: "delivered", stopId: stopIds[1], clientMutationId: id },
      T0,
    );
    expect(other).toEqual({ ok: false, error: "mutation_conflict" });
    expect((await stopRow(1)).status).toBe("PENDING");
    // The same id as an undo is a different mutation as well.
    const asUndo = await applyStopMutation(
      t.prisma,
      actor(),
      { type: "undo", stopId: stopIds[0], clientMutationId: id },
      T0,
    );
    expect(asUndo).toEqual({ ok: false, error: "mutation_conflict" });
    expect((await stopRow(0)).status).toBe("DELIVERED");
  });

  it("undo within five minutes reopens the stop; the tour stays IN_PROGRESS", async () => {
    await mutate({ type: "problem", stopId: stopIds[0], reason: "CLOSED", note: "zu" });
    const id = randomUUID();
    const input = { type: "undo", stopId: stopIds[0], clientMutationId: id };
    const res = await applyStopMutation(t.prisma, actor(), input, plus(5 * MIN));
    expect(res).toMatchObject({
      ok: true,
      kind: "UNDO",
      status: "PENDING",
      done: 0,
      tourStatus: "IN_PROGRESS",
      undoUntil: null,
      completedAt: null,
    });
    expect(await stopRow(0)).toMatchObject({
      status: "PENDING",
      problemReason: null,
      problemNote: null,
      completedAt: null,
      clientMutationId: null,
    });
    // A replay of the undo returns the stored result and does not undo anything again.
    await mutate({ type: "delivered", stopId: stopIds[0] }, actor(), plus(6 * MIN));
    const replay = await applyStopMutation(t.prisma, actor(), input, plus(6 * MIN));
    expect(replay).toMatchObject({ ok: true, replayed: true, kind: "UNDO" });
    expect((await stopRow(0)).status).toBe("DELIVERED");
    // The stop can be completed again after an undo.
    expect((await tourRow()).status).toBe("IN_PROGRESS");
  });

  it("undo of a delivery takes the cash recorded with it back (owner 2026-11-14)", async () => {
    await mutate({ type: "delivered", stopId: stopIds[0] });
    await t.prisma.stop.update({
      where: { id: stopIds[0] },
      data: { collectedCents: 4200, collectedAt: T0, collectedById: driverId },
    });
    const res = await mutate({ type: "undo", stopId: stopIds[0] }, actor(), plus(MIN));
    expect(res).toMatchObject({ ok: true, kind: "UNDO", status: "PENDING" });
    expect(await stopRow(0)).toMatchObject({
      collectedCents: null,
      collectedAt: null,
      collectedById: null,
    });
    const audit = await t.prisma.auditLog.findFirstOrThrow({
      where: { entity: "Stop", entityId: stopIds[0], action: "stop.undo" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.diff).toMatchObject({ previousCollectedCents: 4200 });
  });

  it("rejects undo after five minutes (server clock) and when nothing was completed", async () => {
    await mutate({ type: "delivered", stopId: stopIds[0] });
    const late = await mutate({ type: "undo", stopId: stopIds[0] }, actor(), plus(5 * MIN + 1000));
    expect(late).toEqual({ ok: false, error: "undo_expired" });
    expect((await stopRow(0)).status).toBe("DELIVERED");
    const nothing = await mutate({ type: "undo", stopId: stopIds[1] });
    expect(nothing).toEqual({ ok: false, error: "not_completed" });
  });

  it("walks the tour status RELEASED -> IN_PROGRESS -> COMPLETED and then refuses undo", async () => {
    expect((await tourRow()).status).toBe("RELEASED");
    await mutate({ type: "delivered", stopId: stopIds[0] });
    expect((await tourRow()).status).toBe("IN_PROGRESS");
    await mutate({ type: "problem", stopId: stopIds[2], reason: "REFUSED" });
    expect((await tourRow()).status).toBe("IN_PROGRESS");
    const last = await mutate({ type: "delivered", stopId: stopIds[1] }, actor(), plus(MIN));
    expect(last).toMatchObject({
      ok: true,
      tourStatus: "COMPLETED",
      done: 3,
      total: 3,
      nextStopId: null,
      undoUntil: null,
    });
    const tour = await tourRow();
    expect(tour.status).toBe("COMPLETED");
    expect(tour.completedAt?.toISOString()).toBe(plus(MIN).toISOString());
    const undo = await mutate({ type: "undo", stopId: stopIds[1] }, actor(), plus(2 * MIN));
    expect(undo).toEqual({ ok: false, error: "tour_completed" });
    expect((await stopRow(1)).status).toBe("DELIVERED");
    expect((await tourRow()).status).toBe("COMPLETED");
    // A completed tour accepts nothing new.
    expect(await mutate({ type: "delivered", stopId: stopIds[1] })).toEqual({
      ok: false,
      error: "already_completed",
    });
  });

  it("advances to the next pending stop behind it, else to an earlier one", async () => {
    const a = await mutate({ type: "delivered", stopId: stopIds[1] });
    expect(a).toMatchObject({ ok: true, nextStopId: stopIds[2] });
    const b = await mutate({ type: "delivered", stopId: stopIds[2] });
    expect(b).toMatchObject({ ok: true, nextStopId: stopIds[0] });
  });

  it("only touches stops in the driver's own released tour", async () => {
    const input = { type: "delivered", stopId: stopIds[0] };
    expect(await mutate(input, actor(otherDriverId))).toEqual({ ok: false, error: "not_found" });
    expect(await mutate({ ...input, stopId: "nope" })).toEqual({ ok: false, error: "not_found" });
    expect(await mutate(input, actor(adminId, "ADMIN"))).toEqual({
      ok: false,
      error: "forbidden",
    });
    for (const status of ["DRAFT", "OPTIMIZED"]) {
      await reset(status);
      expect(await mutate(input)).toEqual({ ok: false, error: "tour_not_active" });
    }
    await reset();
    expect((await stopRow(0)).status).toBe("PENDING");
    expect(await t.prisma.stopMutation.count()).toBe(0);
    expect((await tourRow()).status).toBe("RELEASED");
  });

  it("works on a tour of another day (a queued mutation may sync later)", async () => {
    const res = await mutate(
      { type: "delivered", stopId: stopIds[0] },
      actor(),
      plus(40 * 24 * 60 * MIN),
    );
    expect(res.ok).toBe(true);
  });

  it("validates the input strictly", async () => {
    const stopId = stopIds[0];
    const bad: unknown[] = [
      null,
      { type: "delivered", stopId },
      { type: "delivered", stopId, clientMutationId: "not-a-uuid" },
      { type: "problem", stopId, clientMutationId: randomUUID(), reason: "BROKEN" },
      { type: "problem", stopId, clientMutationId: randomUUID() },
      {
        type: "problem",
        stopId,
        clientMutationId: randomUUID(),
        reason: "OTHER",
        note: "x".repeat(501),
      },
      { type: "delivered", stopId, clientMutationId: randomUUID(), status: "PROBLEM" },
      { type: "teleport", stopId, clientMutationId: randomUUID() },
    ];
    for (const input of bad) {
      expect(await applyStopMutation(t.prisma, actor(), input, T0)).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    expect((await stopRow(0)).status).toBe("PENDING");
  });

  it("waits for the per-date advisory lock that release / re-release hold", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = t.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tour:2099-07-02'))`;
      locked();
      await gate;
    });
    await lockTaken;
    let finished = false;
    const pending = mutate({ type: "delivered", stopId: stopIds[0] }).then((r) => {
      finished = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(finished).toBe(false);
    expect((await stopRow(0)).status).toBe("PENDING");
    release();
    await holder;
    expect(await pending).toMatchObject({ ok: true });
    expect((await stopRow(0)).status).toBe("DELIVERED");
  });

  describe("server action authorization", () => {
    const input = () => ({
      type: "delivered" as const,
      stopId: stopIds[0],
      clientMutationId: randomUUID(),
    });

    it("rejects anonymous users and admins; nothing changes", async () => {
      state.session = null;
      await expect(stopStatusAction(input())).rejects.toBeInstanceOf(AuthorizationError);
      state.session = { user: { id: adminId } };
      await expect(stopStatusAction(input())).rejects.toBeInstanceOf(AuthorizationError);
      expect((await stopRow(0)).status).toBe("PENDING");
      expect(await t.prisma.stopMutation.count()).toBe(0);
    });

    it("rejects a deactivated driver", async () => {
      await t.prisma.user.update({ where: { id: otherDriverId }, data: { active: false } });
      state.session = { user: { id: otherDriverId } };
      await expect(stopStatusAction(input())).rejects.toBeInstanceOf(AuthorizationError);
      await t.prisma.user.update({ where: { id: otherDriverId }, data: { active: true } });
    });

    it("lets the assigned driver in, another driver gets not_found", async () => {
      state.session = { user: { id: otherDriverId } };
      expect(await stopStatusAction(input())).toEqual({ ok: false, error: "not_found" });
      state.session = { user: { id: driverId } };
      expect(await stopStatusAction(input())).toMatchObject({ ok: true, status: "DELIVERED" });
    });
  });
});
