import { describe, expect, it } from "vitest";

import {
  buildStops,
  computeSchedule,
  departureInstant,
  mergeLockedOrder,
  partitionByLocation,
} from "./tour";

describe("buildStops", () => {
  const orders = [
    {
      id: "o1",
      customerId: "c1",
      items: [
        { productId: "p1", quantity: 3 },
        { productId: "p2", quantity: 1 },
      ],
    },
    { id: "o2", customerId: "c2", items: [{ productId: "p1", quantity: 4 }] },
    {
      id: "o3",
      customerId: "c1",
      items: [
        { productId: "p1", quantity: 2 },
        { productId: "p3", quantity: 6 },
      ],
    },
  ];

  it("turns 3 orders of 2 customers into 2 stops with quantities merged per product", () => {
    const stops = buildStops(orders);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toEqual({
      customerId: "c1",
      orderIds: ["o1", "o3"],
      items: [
        { productId: "p1", quantity: 5 },
        { productId: "p2", quantity: 1 },
        { productId: "p3", quantity: 6 },
      ],
    });
    expect(stops[1]).toEqual({
      customerId: "c2",
      orderIds: ["o2"],
      items: [{ productId: "p1", quantity: 4 }],
    });
  });

  it("returns no stops for no orders and does not mutate the input", () => {
    expect(buildStops([])).toEqual([]);
    const copy = structuredClone(orders);
    buildStops(orders);
    expect(orders).toEqual(copy);
  });

  it("skips an order that carries nothing (NUD-186: kept as 'nothing ordered', never driven to)", () => {
    const stops = buildStops([
      ...orders,
      { id: "o4", customerId: "c3", items: [{ productId: "p1", quantity: 0 }] },
      { id: "o5", customerId: "c4", items: [] },
    ]);
    expect(stops.map((s) => s.customerId)).toEqual(["c1", "c2"]);
  });

  it("keeps a customer who has a nothing order next to a real one", () => {
    const stops = buildStops([
      { id: "o1", customerId: "c1", items: [{ productId: "p1", quantity: 0 }] },
      { id: "o2", customerId: "c1", items: [{ productId: "p1", quantity: 2 }] },
    ]);
    expect(stops).toEqual([
      { customerId: "c1", orderIds: ["o2"], items: [{ productId: "p1", quantity: 2 }] },
    ]);
  });
});

describe("partitionByLocation (NUD-141)", () => {
  const stop = (customerId: string) => ({ customerId, orderIds: [customerId], items: [] });
  const spot = (lat: number, lng: number, sortOrder = 0, active = true) => ({
    lat,
    lng,
    sortOrder,
    active,
  });
  it("routes everyone with a location, flags missing Parkplatz, reports 'no location'", () => {
    const customers = new Map([
      ["a", { id: "a", lat: 48, lng: 16, parkingSpots: [spot(48.1, 16.1)] }],
      ["b", { id: "b", lat: 48, lng: 16, parkingSpots: [] }],
      ["c", { id: "c", lat: null, lng: null, parkingSpots: [] }],
      ["e", { id: "e", lat: null, lng: null, parkingSpots: [spot(47, 15)] }],
    ]);
    const { routable, unrouted, withoutParking } = partitionByLocation(
      [stop("a"), stop("b"), stop("c"), stop("d"), stop("e")],
      customers,
    );
    expect(routable.map((s) => s.customerId)).toEqual(["a", "b", "e"]);
    expect(unrouted.map((s) => s.customerId)).toEqual(["c", "d"]);
    expect(withoutParking.map((s) => s.customerId)).toEqual(["b"]);
  });
});

describe("mergeLockedOrder", () => {
  const stop = (customerId: string) => ({ customerId, orderIds: [customerId], items: [] });
  it("keeps existing positions, drops customers without orders, appends new ones", () => {
    const result = mergeLockedOrder(
      ["c3", "c1", "c2"],
      [stop("c1"), stop("c4"), stop("c3"), stop("c5")],
    );
    expect(result.stops.map((s) => s.customerId)).toEqual(["c3", "c1", "c4", "c5"]);
    expect(result.added).toEqual(["c4", "c5"]);
    expect(result.removed).toEqual(["c2"]);
  });
});

describe("departureInstant", () => {
  const day = new Date("2099-07-01T00:00:00Z");
  it("uses the offset of the factory time zone (summer and winter)", () => {
    expect(departureInstant(day, "07:00", "Europe/Vienna").toISOString()).toBe(
      "2099-07-01T05:00:00.000Z",
    );
    expect(
      departureInstant(new Date("2099-01-15T00:00:00Z"), "07:00", "Europe/Vienna").toISOString(),
    ).toBe("2099-01-15T06:00:00.000Z");
    expect(departureInstant(day, "07:30", "UTC").toISOString()).toBe("2099-07-01T07:30:00.000Z");
  });

  it("handles the day the clocks change", () => {
    // 2026-03-29: Vienna switches to summer time at 02:00 -> 07:00 is already UTC+2
    expect(
      departureInstant(new Date("2026-03-29T00:00:00Z"), "07:00", "Europe/Vienna").toISOString(),
    ).toBe("2026-03-29T05:00:00.000Z");
    // 2026-10-25: back to winter time -> 07:00 is UTC+1
    expect(
      departureInstant(new Date("2026-10-25T00:00:00Z"), "07:00", "Europe/Vienna").toISOString(),
    ).toBe("2026-10-25T06:00:00.000Z");
  });

  it("rejects malformed times", () => {
    expect(() => departureInstant(day, "7:00", "UTC")).toThrow();
  });
});

describe("computeSchedule", () => {
  const departure = new Date("2099-07-01T05:00:00Z");
  it("adds cumulative legs and the service time of every earlier stop", () => {
    // legs: depot->1 600 s, 1->2 300 s, 2->depot 900 s; service 10 min
    const s = computeSchedule({
      departure,
      legDurationsS: [600, 300, 900],
      serviceSecondsPerStop: 600,
    });
    expect(s.etas.map((d) => d.toISOString())).toEqual([
      "2099-07-01T05:10:00.000Z", // 600
      "2099-07-01T05:25:00.000Z", // 600 + 600 + 300
    ]);
    expect(s.totalDurationS).toBe(600 + 600 + 300 + 600 + 900);
    expect(s.returnAt.toISOString()).toBe("2099-07-01T05:50:00.000Z");
  });

  it("handles a tour without stops", () => {
    const s = computeSchedule({ departure, legDurationsS: [], serviceSecondsPerStop: 600 });
    expect(s.etas).toEqual([]);
    expect(s.totalDurationS).toBe(0);
    expect(s.returnAt).toEqual(departure);
  });
});
