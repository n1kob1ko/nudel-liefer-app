import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OfflineRecord } from "./store";

const stored = vi.hoisted(() => ({ record: null as unknown }));
// jsdom has no IndexedDB: the copy a previous visit left behind is handed in here.
vi.mock("./store", () => ({
  createIndexedDbStore: () => ({}),
  loadCurrentRecord: async () => stored.record,
}));

import { getOfflineStatus, loadOfflineStatus, purgeOfflineData } from "./browser";

const record = {
  userId: "u1",
  date: "2099-07-02",
  savedAt: "2099-07-02T05:12:00.000Z",
  data: { timezone: "Europe/Vienna", tour: { id: "t1" }, tours: [] },
} as unknown as OfflineRecord;

describe("loadOfflineStatus", () => {
  beforeEach(async () => {
    stored.record = null;
    await purgeOfflineData().catch(() => undefined);
  });

  it("reports when the stored copy was saved without claiming that photos are missing", async () => {
    stored.record = record;

    await loadOfflineStatus("u1");

    const status = getOfflineStatus();
    expect(status.savedAt).toBe("2099-07-02T05:12:00.000Z");
    expect(status.timezone).toBe("Europe/Vienna");
    expect(status.tourIds).toEqual(["t1"]);
    // Nothing has compared the photos with the server yet: "partial" would make the driver home
    // flash "0 von 0 Fotos" above the tour until the first sync starts (a layout shift).
    expect(status.phase).toBe("idle");
    expect(status.photos).toEqual({ total: 0, cached: 0 });
  });
});
