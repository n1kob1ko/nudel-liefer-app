import { beforeEach, describe, expect, it } from "vitest";

import { DRIVER_TOUR_SCHEMA_VERSION, type DriverTourResponse } from "@/lib/driver-tour-model";

import { toursChanged } from "./browser";
import { photoCacheUrl } from "./constants";
import { type PhotoCache, syncPhotos } from "./photos";
import {
  createMemoryStore,
  loadCurrentRecord,
  type OfflineRecord,
  purgeStaleRecords,
  saveRecord,
} from "./store";
import { syncDriverTour } from "./sync";

const photo = (id: string) => ({ id, url: `https://s3.test/${id}?sig=1`, width: 4, height: 3 });
const text = {
  de: "x",
  meta: { source: "de" as const, machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
};

function response(date: string, photoIds: string[] = ["a", "b"]): DriverTourResponse {
  return {
    schemaVersion: DRIVER_TOUR_SCHEMA_VERSION,
    date,
    generatedAt: `${date}T05:00:00.000Z`,
    timezone: "Europe/Vienna",
    serviceSecondsPerStop: 600,
    tour: {
      id: "t1",
      status: "RELEASED",
      revision: 1,
      updated: false,
      tourNumber: 1,
      tourCount: 1,
      removedCustomers: [],
      depot: null,
      geometry: null,
      loadingStartedAt: null,
      departedAt: null,
      checklist: [],
      stops: photoIds.map((id, i) => ({
        id: `s${i}`,
        sequence: i + 1,
        trip: 1,
        vehicleName: null,
        status: "PENDING",
        problemReason: null,
        problemNote: null,
        completedAt: null,
        etaAt: null,
        legDurationS: null,
        change: null,
        changedInRevision: null,
        customerId: `c${i}`,
        customerNumber: `K${i}`,
        customerName: "N",
        street: "S",
        postalCode: "1",
        city: "C",
        lat: null,
        lng: null,
        addressLat: null,
        addressLng: null,
        parkingSpots: [],
        notes: text,
        deliveryHoursInfo: null,
        hasKey: null,
        keyNumber: null,
        abbreviation: null,
        cashDueCents: 0,
        collectedCents: null,
        photos: { STORE: photo(id), PARKING: null },
        items: [],
      })),
    },
    tours: [],
  };
}

const record = (
  userId: string,
  date: string,
  savedAt = `${date}T06:00:00.000Z`,
): OfflineRecord => ({
  userId,
  date,
  savedAt,
  data: response(date),
});

class MemoryPhotos implements PhotoCache {
  map = new Map<string, Response>();
  cleared = 0;
  async ids() {
    return [...this.map.keys()];
  }
  async put(id: string, r: Response) {
    this.map.set(id, r);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
  async clear() {
    this.cleared += 1;
    this.map.clear();
  }
}

const image = () => new Response("img", { status: 200, headers: { "content-type": "image/jpeg" } });

describe("offline store rules", () => {
  it("keeps one user's tour: saving removes everybody else's data", async () => {
    const store = createMemoryStore();
    await saveRecord(store, record("u1", "2099-07-02"));
    await saveRecord(store, record("u2", "2099-07-02"));
    expect([...store.rows.keys()]).toEqual(["u2"]);
  });

  it("purges previous days and never shows them", async () => {
    const store = createMemoryStore();
    await store.put(record("u1", "2099-07-01"));
    const now = new Date("2099-07-02T07:00:00Z");
    expect(await loadCurrentRecord(store, now)).toBeNull();
    expect(store.rows.size).toBe(0);
  });

  it("uses the factory time zone for 'today' (22:30 UTC is already tomorrow in Vienna)", async () => {
    const store = createMemoryStore();
    await store.put(record("u1", "2099-07-02"));
    const lateEvening = new Date("2099-07-01T22:30:00Z");
    expect((await loadCurrentRecord(store, lateEvening))?.userId).toBe("u1");
    await purgeStaleRecords(store, new Date("2099-07-03T10:00:00Z"));
    expect(store.rows.size).toBe(0);
  });

  it("loads only the asked user's record", async () => {
    const store = createMemoryStore();
    await store.put(record("u1", "2099-07-02"));
    const now = new Date("2099-07-02T07:00:00Z");
    expect(await loadCurrentRecord(store, now, "u2")).toBeNull();
    expect((await loadCurrentRecord(store, now, "u1"))?.userId).toBe("u1");
  });

  it("drops damaged or old-schema records", async () => {
    const store = createMemoryStore();
    store.rows.set("u1", {
      userId: "u1",
      date: "2099-07-02",
      savedAt: "x",
      data: { schemaVersion: 0 },
    });
    expect(await loadCurrentRecord(store, new Date("2099-07-02T07:00:00Z"))).toBeNull();
    expect(store.rows.size).toBe(0);
  });
});

describe("photo prefetch", () => {
  let cache: MemoryPhotos;
  beforeEach(() => void (cache = new MemoryPhotos()));

  it("downloads missing photos once, keyed by the stable photo id", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => (urls.push(url), image())) as unknown as typeof fetch;
    const photos = [photo("a"), photo("b")];
    expect(await syncPhotos(cache, photos, f)).toEqual({ total: 2, cached: 2, failed: 0 });
    // second run (the signed URLs changed, the ids did not): nothing is downloaded again
    const again = [photo("a"), photo("b")].map((p) => ({ ...p, url: `${p.url}&new=1` }));
    expect(await syncPhotos(cache, again, f)).toEqual({ total: 2, cached: 2, failed: 0 });
    expect(urls).toHaveLength(2);
    expect(photoCacheUrl("a")).toBe("/api/driver/photo-cache/a");
  });

  it("deletes photos that left the tour", async () => {
    const f = (async () => image()) as unknown as typeof fetch;
    await syncPhotos(cache, [photo("a"), photo("b")], f);
    await syncPhotos(cache, [photo("b")], f);
    expect([...cache.map.keys()]).toEqual(["b"]);
  });

  it("counts failed downloads instead of pretending", async () => {
    const f = (async (url: string) =>
      url.includes("/b?")
        ? new Response("no", { status: 403 })
        : image()) as unknown as typeof fetch;
    expect(await syncPhotos(cache, [photo("a"), photo("b")], f)).toEqual({
      total: 2,
      cached: 1,
      failed: 1,
    });
    const throwing = (async () => {
      throw new TypeError("cors");
    }) as unknown as typeof fetch;
    const c2 = new MemoryPhotos();
    expect((await syncPhotos(c2, [photo("a")], throwing)).failed).toBe(1);
  });

  it("refuses non-image answers", async () => {
    const f = (async () =>
      new Response("<html>", {
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    expect((await syncPhotos(cache, [photo("a")], f)).failed).toBe(1);
  });
});

describe("syncDriverTour", () => {
  const now = () => new Date("2099-07-02T05:30:00Z");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  function deps(
    fetchImpl: typeof fetch,
    store = createMemoryStore(),
    photoCache = new MemoryPhotos(),
  ) {
    return { store, photoCache, fetchImpl, now };
  }
  const routed = (body: unknown, status = 200) =>
    (async (url: string) =>
      url.startsWith("/api/") ? json(body, status) : image()) as unknown as typeof fetch;

  it("stores the tour and its photos", async () => {
    const d = deps(routed(response("2099-07-02")));
    const out = await syncDriverTour("u1", d);
    expect(out).toMatchObject({ kind: "saved", photos: { total: 2, cached: 2, failed: 0 } });
    expect([...d.store.rows.keys()]).toEqual(["u1"]);
    expect((d.photoCache as MemoryPhotos).map.size).toBe(2);
    if (out.kind === "saved") expect(out.record.savedAt).toBe("2099-07-02T05:30:00.000Z");
  });

  it("removes a stored tour when nothing is released today", async () => {
    const store = createMemoryStore();
    await store.put(record("u1", "2099-07-02"));
    const d = deps(routed({ ...response("2099-07-02"), tour: null }), store);
    expect(await syncDriverTour("u1", d)).toEqual({ kind: "no-tour", date: "2099-07-02" });
    expect(store.rows.size).toBe(0);
  });

  it("keeps the old copy when the network, the server or the answer is bad", async () => {
    const store = createMemoryStore();
    await store.put(record("u1", "2099-07-02"));
    const down = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await syncDriverTour("u1", deps(down, store))).toEqual({
      kind: "error",
      reason: "network",
    });
    expect(await syncDriverTour("u1", deps(routed({}, 500), store))).toEqual({
      kind: "error",
      reason: "server",
    });
    expect(await syncDriverTour("u1", deps(routed({ nonsense: true }), store))).toEqual({
      kind: "error",
      reason: "invalid",
    });
    expect(store.rows.size).toBe(1);
  });

  it("reports an ended session without touching the stored data", async () => {
    const store = createMemoryStore();
    await store.put(record("u1", "2099-07-02"));
    expect(await syncDriverTour("u1", deps(routed({ error: "x" }, 401), store))).toEqual({
      kind: "unauthorized",
      status: 401,
    });
    expect(store.rows.size).toBe(1);
  });

  it("switches the stored copy and the photos to the released follow-up tour (NUD-118)", async () => {
    const first = response("2099-07-02", ["a", "b"]);
    const finished = { ...first, tour: { ...first.tour!, status: "COMPLETED" as const } };
    const followUp = response("2099-07-02", ["b", "c"]);
    const second = {
      ...followUp,
      tour: { ...followUp.tour!, id: "t2", tourNumber: 2, tourCount: 2 },
    };
    const d = deps(routed(finished));
    await syncDriverTour("u1", d);
    const photos = d.photoCache as MemoryPhotos;
    expect([...photos.map.keys()].sort()).toHaveLength(2);

    const out = await syncDriverTour("u1", { ...d, fetchImpl: routed(second) });
    expect(out).toMatchObject({ kind: "saved", photos: { total: 2, cached: 2 } });
    const stored = (await loadCurrentRecord(d.store, now(), "u1"))!;
    expect(stored.data.tour).toMatchObject({ id: "t2", tourNumber: 2, tourCount: 2 });
    expect([...d.store.rows.keys()]).toEqual(["u1"]);
    // The finished tour's own photo is gone, the shared one stays, the new one is stored.
    expect([...photos.map.keys()].map((k) => k.split("/").pop()).sort()).toEqual(["b", "c"]);
  });

  it("stores every open tour of the day with its photos (NUD-163)", async () => {
    const first = response("2099-07-02", ["a"]);
    const second = response("2099-07-02", ["b"]);
    const both = {
      ...first,
      // Two open tours: tour 1 is still open, tour 2 is the active one (the last of `tours`).
      tour: { ...second.tour!, id: "t2", tourNumber: 2, tourCount: 2 },
      tours: [
        { ...first.tour!, id: "t1", tourNumber: 1, tourCount: 2 },
        { ...second.tour!, id: "t2", tourNumber: 2, tourCount: 2 },
      ],
    };
    const d = deps(routed(both));
    const out = await syncDriverTour("u1", d);
    expect(out).toMatchObject({ kind: "saved", photos: { total: 2, cached: 2 } });
    const stored = (await loadCurrentRecord(d.store, now(), "u1"))!;
    expect(stored.data.tours.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(stored.data.tour?.id).toBe("t2");
    // Both tours' photos are cached: the driver reaches the stops of either tour offline.
    expect(
      [...(d.photoCache as MemoryPhotos).map.keys()].map((k) => k.split("/").pop()).sort(),
    ).toEqual(["a", "b"]);
  });

  it("a different user on the phone replaces the previous driver's data", async () => {
    const d = deps(routed(response("2099-07-02")));
    await d.store.put(record("old", "2099-07-02"));
    await syncDriverTour("new", d);
    expect([...d.store.rows.keys()]).toEqual(["new"]);
  });
});

describe("toursChanged", () => {
  it("is true only when a known set of tours was replaced by another one", () => {
    expect(toursChanged(["t1"], ["t2"])).toBe(true);
    expect(toursChanged(["t1"], ["t1"])).toBe(false);
    expect(toursChanged([], ["t1"])).toBe(false);
    expect(toursChanged(["t1"], [])).toBe(false);
  });

  it("notices a second open tour of the day and its disappearance (NUD-163)", () => {
    expect(toursChanged(["t1"], ["t1", "t2"])).toBe(true);
    expect(toursChanged(["t1", "t2"], ["t1", "t2"])).toBe(false);
    expect(toursChanged(["t1", "t2"], ["t1"])).toBe(true);
  });
});
