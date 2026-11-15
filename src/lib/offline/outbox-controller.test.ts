import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEntry, SyncResponse } from "@/domain/driver-sync";

import { createOutboxController } from "./outbox-controller";
import { createMemoryOutboxStore } from "./outbox-store";

type Handler = (entries: SyncEntry[]) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A server that applies everything: returns the stop states the entries would produce. */
const applyAll: Handler = (entries) =>
  json({
    results: entries.map((e) => ({ clientMutationId: e.clientMutationId, outcome: "applied" })),
    tours: [
      {
        tourId: "t1",
        status: "IN_PROGRESS",
        stops: entries
          .filter((e) => e.type !== "undo")
          .map((e) => ({
            id: e.stopId,
            status: e.type === "delivered" ? "DELIVERED" : "PROBLEM",
            problemReason: e.reason ?? null,
            completedAt: e.createdAt,
          })),
      },
    ],
    serverTime: "2099-07-02T10:00:00.000Z",
  } satisfies SyncResponse);

function setup(handler: Handler = applyAll) {
  const store = createMemoryOutboxStore();
  const requests: SyncEntry[][] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let clock = Date.parse("2099-07-02T08:00:00.000Z");
  let ids = 0;
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const entries = (JSON.parse(String(init?.body)) as { entries: SyncEntry[] }).entries;
    requests.push(entries);
    return handler(entries);
  }) as unknown as typeof fetch;
  const controller = createOutboxController({
    store,
    fetchImpl,
    now: () => new Date(clock),
    newId: () => `id-${++ids}`,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => undefined,
  });
  return {
    store,
    requests,
    timers,
    fetchImpl,
    controller,
    tick: (ms: number) => void (clock += ms),
  };
}

const tap = (stopId: string, type: "delivered" | "undo" = "delivered") => ({
  type,
  stopId,
  customerName: `Customer ${stopId}`,
});

beforeEach(() => vi.clearAllMocks());

describe("enqueue and undo", () => {
  it("stores a tap with its own id and the time of the tap, in order", async () => {
    const { controller, store, tick } = setup();
    await controller.start("u1");
    const a = await controller.enqueue(tap("s1"));
    tick(1000);
    const b = await controller.enqueue({
      type: "problem",
      stopId: "s2",
      reason: "CLOSED",
      customerName: "x",
    });
    expect([a.clientMutationId, b.clientMutationId]).toEqual(["id-1", "id-2"]);
    expect(a.createdAt).toBe("2099-07-02T08:00:00.000Z");
    expect(b.createdAt).toBe("2099-07-02T08:00:01.000Z");
    expect(controller.getState().entries.map((e) => e.stopId)).toEqual(["s1", "s2"]);
    expect(store.entryRows.size).toBe(2);
  });

  it("keeps one entry for a double tap", async () => {
    const { controller, store } = setup();
    await controller.start("u1");
    const [a, b] = await Promise.all([
      controller.enqueue(tap("s1")),
      controller.enqueue(tap("s1")),
    ]);
    expect(b.clientMutationId).toBe(a.clientMutationId);
    expect(store.entryRows.size).toBe(1);
  });

  it("removes a queued completion on undo: nothing is sent, no pair", async () => {
    const { controller, store, fetchImpl } = setup();
    await controller.start("u1");
    await controller.enqueue(tap("s1"));
    expect(await controller.undo("s1", "Customer s1")).toBe("cancelled");
    expect(store.entryRows.size).toBe(0);
    expect(controller.getState().entries).toEqual([]);
    expect(await controller.flush()).toEqual({ kind: "empty" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("takes the cash queued with a cancelled delivery away too (owner 2026-11-14)", async () => {
    const { controller, store, fetchImpl } = setup();
    await controller.start("u1");
    await controller.enqueue(tap("s1"));
    await controller.enqueue({
      type: "payment",
      stopId: "s1",
      collectedCents: 4200,
      customerName: "Customer s1",
    });
    await controller.enqueue(tap("s2"));
    expect(await controller.undo("s1", "Customer s1")).toBe("cancelled");
    expect(controller.getState().entries.map((e) => [e.stopId, e.type])).toEqual([
      ["s2", "delivered"],
    ]);
    expect(store.entryRows.size).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queues a real undo for a completion the server already holds", async () => {
    const { controller, store } = setup();
    await controller.start("u1");
    expect(await controller.undo("s1", "Customer s1")).toBe("queued");
    expect([...store.entryRows.values()].map((e) => e.type)).toEqual(["undo"]);
    expect(await controller.undo("s1", "Customer s1")).toBe("none");
  });

  it("queues the undo behind a completion that is being sent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { controller, requests } = setup(async (entries) => {
      await gate;
      return applyAll(entries);
    });
    await controller.start("u1");
    await controller.enqueue(tap("s1"));
    const first = controller.flush();
    await vi.waitFor(() => expect(controller.getState().inFlight.size).toBe(1));
    expect(await controller.undo("s1", "Customer s1")).toBe("queued");
    const second = controller.flush(); // arrives while the first request runs: runs once more
    release();
    await Promise.all([first, second]);
    expect(requests.map((r) => r.map((e) => e.type))).toEqual([["delivered"], ["undo"]]);
    expect(controller.getState().entries).toEqual([]);
  });
});

describe("flush", () => {
  it("sends the queue in tap order and removes what the server settled", async () => {
    const { controller, requests, store } = setup();
    await controller.start("u1");
    const flushed = vi.fn();
    controller.onFlushed(flushed);
    for (const id of ["s1", "s2", "s3"]) await controller.enqueue(tap(id));
    const outcome = await controller.flush();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.map((e) => e.stopId)).toEqual(["s1", "s2", "s3"]);
    expect(requests[0]![0]).toMatchObject({ type: "delivered", clientMutationId: "id-1" });
    expect(outcome).toMatchObject({ kind: "ran", applied: 3, rejected: 0, failure: null });
    expect(store.entryRows.size).toBe(0);
    expect(flushed).toHaveBeenCalledTimes(1);
    // The authoritative states bridge the gap until the page data is refreshed.
    expect(Object.keys(controller.getState().confirmed).sort()).toEqual(["s1", "s2", "s3"]);
    expect(controller.getState().inFlight.size).toBe(0);
  });

  it("patches the stored tour copy with the authoritative states", async () => {
    const { controller, store } = setup();
    store.tourRows.set("u1", {
      userId: "u1",
      data: {
        tour: {
          id: "t1",
          status: "RELEASED",
          stops: [{ id: "s1", status: "PENDING", problemReason: null, completedAt: null }],
        },
      },
    });
    await controller.start("u1");
    await controller.enqueue(tap("s1"));
    await controller.flush();
    const data = store.tourRows.get("u1")!.data as {
      tour: { status: string; stops: Array<{ status: string }> };
    };
    expect(data.tour.status).toBe("IN_PROGRESS");
    expect(data.tour.stops[0]!.status).toBe("DELIVERED");
  });

  it("sends at most 50 entries per request", async () => {
    const { controller, requests } = setup();
    await controller.start("u1");
    for (let i = 0; i < 120; i++) await controller.enqueue(tap(`s${i}`));
    await controller.flush();
    expect(requests.map((r) => r.length)).toEqual([50, 50, 20]);
    expect(requests.flat().map((e) => e.stopId)).toEqual(
      Array.from({ length: 120 }, (_, i) => `s${i}`),
    );
  });

  it("keeps everything on a network failure and backs off exponentially", async () => {
    let up = false;
    const { controller, requests, timers, tick } = setup((entries) => {
      if (!up) throw new TypeError("Failed to fetch");
      return applyAll(entries);
    });
    await controller.start("u1");
    await controller.enqueue(tap("s1"));
    expect(await controller.flush()).toMatchObject({ kind: "ran", failure: "network" });
    expect(controller.getState().entries).toHaveLength(1);
    expect(controller.getState().failure).toBe("network");
    expect(timers.at(-1)!.ms).toBe(2000);

    // A regular trigger inside the backoff does not hit the network ...
    tick(1000);
    expect(await controller.flush()).toEqual({ kind: "empty" });
    expect(requests).toHaveLength(1);
    // ... the browser's online event does, and fails again with a longer wait.
    expect(await controller.flush({ force: true })).toMatchObject({ failure: "network" });
    expect(requests).toHaveLength(2);
    expect(timers.at(-1)!.ms).toBe(4000);

    up = true;
    tick(10_000);
    expect(await controller.flush()).toMatchObject({ kind: "ran", applied: 1, failure: null });
    expect(controller.getState().failure).toBeNull();
    expect(controller.getState().entries).toEqual([]);
    // The backoff is reset: the next failure starts at 2 s again.
    up = false;
    await controller.enqueue(tap("s2"));
    await controller.flush();
    expect(timers.at(-1)!.ms).toBe(2000);
  });

  it("keeps the queue when the server answers 5xx, garbage or unauthorized", async () => {
    for (const response of [
      () => json({ error: "x" }, 500),
      () => new Response("<html>", { status: 200 }),
      () => json({ error: "unauthenticated" }, 401),
    ]) {
      const { controller } = setup(response);
      await controller.start("u1");
      await controller.enqueue(tap("s1"));
      const out = await controller.flush();
      expect(out).toMatchObject({ kind: "ran" });
      expect(controller.getState().entries).toHaveLength(1);
    }
  });

  it("turns a rejection into a notice that survives until it is dismissed", async () => {
    const { controller, store } = setup((entries) =>
      json({
        results: entries.map((e) => ({
          clientMutationId: e.clientMutationId,
          outcome: "rejected",
          error: "changed_by_office",
        })),
        tours: [
          {
            tourId: "t1",
            status: "RELEASED",
            stops: [{ id: "s1", status: "PENDING", problemReason: null, completedAt: null }],
          },
        ],
        serverTime: "2099-07-02T10:00:00.000Z",
      }),
    );
    await controller.start("u1");
    await controller.enqueue(tap("s1"));
    expect(await controller.flush()).toMatchObject({ applied: 0, rejected: 1 });
    expect(controller.getState().entries).toEqual([]);
    expect(controller.getState().notices).toMatchObject([
      { stopId: "s1", customerName: "Customer s1", error: "changed_by_office", type: "delivered" },
    ]);
    // Server state wins on the screen too.
    expect(controller.getState().confirmed.s1!.status).toBe("PENDING");
    expect(store.noticeRows.size).toBe(1);
    await controller.dismissNotice("id-1");
    expect(controller.getState().notices).toEqual([]);
    expect(store.noticeRows.size).toBe(0);
  });

  it("finds the entry the server cannot accept by sending the entries one by one", async () => {
    const { controller, requests } = setup((entries) =>
      entries.length > 1 || entries[0]!.stopId === "bad"
        ? json({ error: "invalid" }, 400)
        : applyAll(entries),
    );
    await controller.start("u1");
    for (const id of ["s1", "bad", "s3"]) await controller.enqueue(tap(id));
    const out = await controller.flush();
    expect(requests.map((r) => r.map((e) => e.stopId))).toEqual([
      ["s1", "bad", "s3"],
      ["s1"],
      ["bad"],
      ["s3"],
    ]);
    expect(out).toMatchObject({ applied: 2, rejected: 1, failure: null });
    expect(controller.getState().notices).toMatchObject([{ stopId: "bad", error: "invalid" }]);
    expect(controller.getState().entries).toEqual([]);
  });

  it("keeps entries the server reports as retry", async () => {
    const { controller } = setup((entries) =>
      json({
        results: entries.map((e) => ({
          clientMutationId: e.clientMutationId,
          outcome: e.stopId === "s2" ? "retry" : "applied",
        })),
        tours: [],
        serverTime: "2099-07-02T10:00:00.000Z",
      }),
    );
    await controller.start("u1");
    for (const id of ["s1", "s2"]) await controller.enqueue(tap(id));
    expect(await controller.flush()).toMatchObject({ applied: 1, failure: "server" });
    expect(controller.getState().entries.map((e) => e.stopId)).toEqual(["s2"]);
  });
});

describe("start", () => {
  it("only loads and sends the entries of the signed-in driver", async () => {
    const { controller, store, requests } = setup();
    const base = {
      type: "delivered" as const,
      createdAt: "2099-07-02T07:00:00.000Z",
      seq: 1,
      customerName: "x",
    };
    await store.putEntry({ ...base, clientMutationId: "mine", userId: "u1", stopId: "s1" });
    await store.putEntry({ ...base, clientMutationId: "other", userId: "u2", stopId: "s9" });
    await store.putEntry({
      ...base,
      clientMutationId: "old",
      userId: "u2",
      stopId: "s8",
      createdAt: "2099-06-20T07:00:00.000Z",
    });
    await controller.start("u1");
    expect(controller.getState().entries.map((e) => e.clientMutationId)).toEqual(["mine"]);
    // Another driver's old entry is dropped after three days, a recent one is kept for him.
    expect([...store.entryRows.keys()].sort()).toEqual(["mine", "other"]);
    await controller.flush();
    expect(requests.flat().map((e) => e.clientMutationId)).toEqual(["mine"]);
    expect([...store.entryRows.keys()]).toEqual(["other"]);
  });
});

describe("customer key entries (NUD-142)", () => {
  const keyTap = (stopId: string, hasKey: boolean, keyNumber?: string) => ({
    type: "key" as const,
    stopId,
    hasKey,
    ...(keyNumber ? { keyNumber } : {}),
    customerName: `Customer ${stopId}`,
  });

  it("queues the key with its fields and sends it in the batch", async () => {
    const { controller, requests } = setup((entries) =>
      json({
        results: entries.map((e) => ({ clientMutationId: e.clientMutationId, outcome: "applied" })),
        tours: [
          {
            tourId: "t1",
            status: "RELEASED",
            stops: [
              {
                id: "s1",
                status: "PENDING",
                problemReason: null,
                completedAt: null,
                hasKey: true,
                keyNumber: "17",
              },
            ],
          },
        ],
        serverTime: "2099-07-02T10:00:00.000Z",
      } satisfies SyncResponse),
    );
    await controller.start("u1");
    const queued = await controller.enqueue(keyTap("s1", true, "17"));
    expect(queued).toMatchObject({ type: "key", hasKey: true, keyNumber: "17" });
    const outcome = await controller.flush();
    expect(outcome).toMatchObject({ kind: "ran", applied: 1, rejected: 0, failure: null });
    expect(requests[0]).toEqual([
      expect.objectContaining({ type: "key", stopId: "s1", hasKey: true, keyNumber: "17" }),
    ]);
    expect(controller.getState().confirmed.s1).toMatchObject({ hasKey: true, keyNumber: "17" });
    expect(controller.getState().entries).toEqual([]);
  });

  it("keeps one entry for a double tap with the same value but queues a different value", async () => {
    const { controller, store } = setup();
    await controller.start("u1");
    const a = await controller.enqueue(keyTap("s1", true, "17"));
    const b = await controller.enqueue(keyTap("s1", true, "17"));
    expect(b.clientMutationId).toBe(a.clientMutationId);
    await controller.enqueue(keyTap("s1", true, "71"));
    expect(store.entryRows.size).toBe(2);
  });

  it("a key entry does not break the double-tap rule of the delivery taps", async () => {
    const { controller, store } = setup();
    await controller.start("u1");
    const first = await controller.enqueue(tap("s1"));
    await controller.enqueue(keyTap("s1", true, "17"));
    const again = await controller.enqueue(tap("s1"));
    expect(again.clientMutationId).toBe(first.clientMutationId);
    expect(store.entryRows.size).toBe(2);
  });

  it("turns a rejected key entry into a notice", async () => {
    const { controller } = setup((entries) =>
      json({
        results: entries.map((e) => ({
          clientMutationId: e.clientMutationId,
          outcome: "rejected",
          error: "not_found",
        })),
        tours: [],
        serverTime: "2099-07-02T10:00:00.000Z",
      } satisfies SyncResponse),
    );
    await controller.start("u1");
    await controller.enqueue(keyTap("s1", false));
    await controller.flush();
    expect(controller.getState().notices).toMatchObject([
      { type: "key", error: "not_found", stopId: "s1" },
    ]);
  });
});

describe("departure entries (NUD-151)", () => {
  const departTap = (type: "loading" | "depart") => ({
    type,
    stopId: "s1",
    customerName: "Customer s1",
  });

  it("queues loading and depart as separate entries and sends them in order", async () => {
    const { controller, requests, store } = setup((entries) =>
      json({
        results: entries.map((e) => ({ clientMutationId: e.clientMutationId, outcome: "applied" })),
        tours: [
          {
            tourId: "t1",
            status: "RELEASED",
            loadingStartedAt: "2099-07-02T05:40:00.000Z",
            departedAt: "2099-07-02T05:55:00.000Z",
            stops: [],
          },
        ],
        serverTime: "2099-07-02T10:00:00.000Z",
      } satisfies SyncResponse),
    );
    await controller.start("u1");
    await controller.enqueue(departTap("loading"));
    await controller.enqueue(departTap("depart"));
    expect(store.entryRows.size).toBe(2);
    const outcome = await controller.flush();
    expect(outcome).toMatchObject({ kind: "ran", applied: 2, rejected: 0, failure: null });
    expect(requests[0]!.map((e) => e.type)).toEqual(["loading", "depart"]);
    expect(controller.getState().entries).toEqual([]);
  });

  it("keeps one entry for a double tap on the same button", async () => {
    const { controller, store } = setup();
    await controller.start("u1");
    const a = await controller.enqueue(departTap("depart"));
    const b = await controller.enqueue(departTap("depart"));
    expect(b.clientMutationId).toBe(a.clientMutationId);
    expect(store.entryRows.size).toBe(1);
  });

  it("does not interfere with the delivery taps of the same stop", async () => {
    const { controller, store } = setup();
    await controller.start("u1");
    const first = await controller.enqueue(tap("s1"));
    await controller.enqueue(departTap("depart"));
    const again = await controller.enqueue(tap("s1"));
    expect(again.clientMutationId).toBe(first.clientMutationId);
    expect(store.entryRows.size).toBe(2);
  });
});
