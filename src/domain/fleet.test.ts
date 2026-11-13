import { describe, expect, it } from "vitest";

import {
  attachToNearestGroup,
  computeTripSchedule,
  groupByTrip,
  groupChainsByDriver,
  normalizeTrips,
  orderTrip,
  packReloadTrips,
  pickStopsWithinLimit,
  RELOAD_SECONDS,
  splitByCapacity,
  splitByStandingTours,
  sweepOrder,
  tripLoadsKg,
  tripPausesS,
  tripVehicleIds,
  VEHICLE_SWITCH_SECONDS,
  vehiclesForLoad,
  vehiclesForTrips,
} from "./fleet";
import { computeSchedule } from "./tour";

const depot = { lat: 48.2, lng: 16.37 };
const stop = (id: string, dLat: number, dLng: number, weightKg: number) => ({
  id,
  location: { lat: depot.lat + dLat, lng: depot.lng + dLng },
  weightKg,
});

// Eight stops of 100 kg around the depot = 800 kg.
const ring = [
  stop("n", 0.05, 0, 100),
  stop("ne", 0.04, 0.04, 100),
  stop("e", 0, 0.05, 100),
  stop("se", -0.04, 0.04, 100),
  stop("s", -0.05, 0, 100),
  stop("sw", -0.04, -0.04, 100),
  stop("w", 0, -0.05, 100),
  stop("nw", 0.04, -0.04, 100),
];
const weightOf = (ids: string[]) =>
  ids.reduce((sum, id) => sum + ring.find((s) => s.id === id)!.weightKg, 0);

describe("splitByCapacity", () => {
  it("2 vehicles x 500 kg, 800 kg of stops -> two routes, none over capacity, nothing left", () => {
    const split = splitByCapacity(depot, ring, [
      { id: "v1", capacityKg: 500 },
      { id: "v2", capacityKg: 500 },
    ]);
    expect(split.routes).toHaveLength(2);
    expect(split.unassigned).toEqual([]);
    for (const route of split.routes) expect(weightOf(route.stopIds)).toBeLessThanOrEqual(500);
    expect(split.routes.flatMap((r) => r.stopIds).sort()).toEqual(ring.map((s) => s.id).sort());
  });

  it("1 vehicle x 500 kg, 800 kg of stops -> 300 kg are left over", () => {
    const split = splitByCapacity(depot, ring, [{ id: "v1", capacityKg: 500 }]);
    expect(split.routes).toHaveLength(1);
    expect(weightOf(split.routes[0]!.stopIds)).toBe(500);
    expect(weightOf(split.unassigned)).toBe(300);
  });

  it("does not use a vehicle that is not needed and fills the larger one first", () => {
    const split = splitByCapacity(depot, ring.slice(0, 2), [
      { id: "small", capacityKg: 300 },
      { id: "big", capacityKg: 1000 },
    ]);
    expect(split.routes).toEqual([{ vehicleId: "big", stopIds: expect.any(Array) }]);
    expect(split.routes[0]!.stopIds).toHaveLength(2);
  });

  it("is deterministic", () => {
    const vehicles = [
      { id: "v1", capacityKg: 500 },
      { id: "v2", capacityKg: 500 },
    ];
    expect(splitByCapacity(depot, ring, vehicles)).toEqual(
      splitByCapacity(depot, [...ring].reverse(), vehicles),
    );
  });

  it("no stops -> no routes", () => {
    expect(splitByCapacity(depot, [], [{ id: "v", capacityKg: 10 }])).toEqual({
      routes: [],
      unassigned: [],
    });
  });
});

describe("packReloadTrips", () => {
  it("packs the leftover into reload trips, each within the capacity", () => {
    const leftovers = ring.slice(0, 5);
    const { trips, oversized } = packReloadTrips(
      depot,
      [{ id: "v1", capacityKg: 300 }],
      new Map([["v1", 1]]),
      leftovers,
    );
    expect(oversized).toEqual([]);
    expect(trips.map((t) => t.vehicleId)).toEqual(["v1", "v1"]);
    expect(trips.map((t) => weightOf(t.stopIds))).toEqual([300, 200]);
  });

  it("gives trips to the vehicle with the fewest trips", () => {
    const { trips } = packReloadTrips(
      depot,
      [
        { id: "v1", capacityKg: 200 },
        { id: "v2", capacityKg: 200 },
      ],
      new Map([
        ["v1", 1],
        ["v2", 1],
      ]),
      ring.slice(0, 4),
    );
    expect(trips.map((t) => t.vehicleId)).toEqual(["v1", "v2"]);
  });

  it("a stop heavier than the vehicle gets a trip of its own and is reported", () => {
    const heavy = { ...stop("heavy", 0.01, 0.01, 900), weightKg: 900 };
    const { trips, oversized } = packReloadTrips(
      depot,
      [{ id: "v1", capacityKg: 500 }],
      new Map(),
      [heavy, ring[0]!],
    );
    expect(oversized).toEqual(["heavy"]);
    expect(trips.map((t) => t.stopIds).sort()).toEqual([["heavy"], ["n"]]);
  });
});

describe("sweepOrder / orderTrip", () => {
  it("keeps neighbours together and covers every stop once", () => {
    const order = sweepOrder(depot, ring).map((s) => s.id);
    expect([...order].sort()).toEqual(ring.map((s) => s.id).sort());
    // consecutive stops in the sweep are neighbours on the ring
    const ringOrder = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
    const idx = order.map((id) => ringOrder.indexOf(id));
    for (let i = 1; i < idx.length; i++) {
      expect(Math.min((idx[i]! - idx[i - 1]! + 8) % 8, (idx[i - 1]! - idx[i]! + 8) % 8)).toBe(1);
    }
  });

  it("orders a trip by nearest neighbour + 2-opt", () => {
    expect(orderTrip(depot, ring).sort()).toEqual(ring.map((s) => s.id).sort());
    expect(orderTrip(depot, [])).toEqual([]);
  });
});

describe("normalizeTrips / groupByTrip / tripLoadsKg", () => {
  it("makes trips non-decreasing and gap-free", () => {
    expect(normalizeTrips([1, 1, 2, 2, 3])).toEqual([1, 1, 2, 2, 3]);
    expect(normalizeTrips([2, 2, 4])).toEqual([1, 1, 2]);
    expect(normalizeTrips([1, 3, 2, 3])).toEqual([1, 2, 2, 2]);
    expect(normalizeTrips([])).toEqual([]);
    expect(normalizeTrips([0, 1])).toEqual([1, 1]);
  });

  it("groups by trip in tour order", () => {
    expect(groupByTrip(["a", "b", "c"], [1, 1, 2])).toEqual([["a", "b"], ["c"]]);
    expect(groupByTrip(["a"], [1])).toEqual([["a"]]);
  });

  it("sums the load per trip", () => {
    expect(
      tripLoadsKg([
        { trip: 1, weightKg: 100.5 },
        { trip: 1, weightKg: 200 },
        { trip: 2, weightKg: 50 },
      ]),
    ).toEqual([300.5, 50]);
    expect(tripLoadsKg([])).toEqual([]);
  });
});

describe("computeTripSchedule", () => {
  const departure = new Date("2026-10-27T05:00:00Z");

  it("equals computeSchedule for one trip", () => {
    const legs = [600, 300, 450, 900];
    const single = computeTripSchedule({
      departure,
      trips: [{ stopLegDurationsS: legs.slice(0, 3), returnLegDurationS: 900 }],
      serviceSecondsPerStop: 120,
    });
    const reference = computeSchedule({
      departure,
      legDurationsS: legs,
      serviceSecondsPerStop: 120,
    });
    expect(single.etas).toEqual(reference.etas);
    expect(single.returnAt).toEqual(reference.returnAt);
    expect(single.totalDurationS).toBe(reference.totalDurationS);
    expect(single.reloadAt).toEqual([]);
  });

  it("adds the way back, the reload time and the next trip", () => {
    const schedule = computeTripSchedule({
      departure,
      trips: [
        { stopLegDurationsS: [600], returnLegDurationS: 500 },
        { stopLegDurationsS: [400], returnLegDurationS: 300 },
      ],
      serviceSecondsPerStop: 100,
    });
    // trip 1: 600 -> eta, +100 service, +500 back = 1200 at the depot; reload 1200 s; trip 2: +400
    expect(schedule.etas.map((e) => (e.getTime() - departure.getTime()) / 1000)).toEqual([
      600,
      1200 + RELOAD_SECONDS + 400,
    ]);
    expect((schedule.reloadAt[0]!.getTime() - departure.getTime()) / 1000).toBe(1200);
    expect(schedule.totalDurationS).toBe(1200 + RELOAD_SECONDS + 400 + 100 + 300);
  });

  it("no stops: nothing happens", () => {
    const schedule = computeTripSchedule({
      departure,
      trips: [],
      serviceSecondsPerStop: 100,
    });
    expect(schedule).toMatchObject({ etas: [], totalDurationS: 0 });
    expect(schedule.returnAt).toEqual(departure);
  });
});

describe("pickStopsWithinLimit", () => {
  const depot = { lat: 48.2, lng: 16.3 };
  const at = (id: string, dLat: number, dLng: number) => ({
    id,
    location: { lat: depot.lat + dLat, lng: depot.lng + dLng },
  });

  it("keeps every stop when the limit is not exceeded", () => {
    const stops = [at("a", 0.01, 0), at("b", 0.02, 0)];
    expect(pickStopsWithinLimit(depot, stops, 2)).toEqual({ picked: stops, deferred: [] });
  });

  it("plans the compact cluster and leaves the outlying stops for another day", () => {
    // A chain going north from the depot, plus two far-away stops in the south-east.
    const stops = [
      at("far1", -0.3, 0.3),
      at("n1", 0.01, 0),
      at("n2", 0.02, 0),
      at("far2", -0.31, 0.31),
      at("n3", 0.03, 0),
    ];
    const { picked, deferred } = pickStopsWithinLimit(depot, stops, 3);
    expect(picked.map((s) => s.id)).toEqual(["n1", "n2", "n3"]);
    expect(deferred.map((s) => s.id)).toEqual(["far1", "far2"]);
  });

  it("grows along neighbours, not only by distance to the depot", () => {
    // n2 is farther from the depot than s1, but right next to n1.
    const stops = [at("n1", 0.02, 0), at("n2", 0.025, 0), at("s1", -0.022, 0)];
    expect(pickStopsWithinLimit(depot, stops, 2).picked.map((s) => s.id)).toEqual(["n1", "n2"]);
  });
});

describe("vehicle switch between trips (NUD-158)", () => {
  it("groupChainsByDriver: 3 vehicle loads, 2 drivers -> one driver drives two vehicles", () => {
    const groups = groupChainsByDriver(
      [{ durationS: 3600 }, { durationS: 3000 }, { durationS: 2000 }],
      2,
    );
    expect(groups).toEqual([[0], [1, 2]]);
  });

  it("groupChainsByDriver: balances the work, longest chain first", () => {
    const groups = groupChainsByDriver(
      [1000, 4000, 3000, 2000, 1500].map((durationS) => ({ durationS })),
      2,
    );
    // 4000 | 3000 -> +2000 (5000+switch) vs 4000 -> +1500 ... ends balanced, every chain used once.
    expect(groups.flat().sort()).toEqual([0, 1, 2, 3, 4]);
    expect(groups).toHaveLength(2);
    expect(groups[0]![0]).toBe(1);
    expect(groups[1]![0]).toBe(2);
  });

  it("groupChainsByDriver: no drivers or enough drivers -> one tour per vehicle", () => {
    const chains = [{ durationS: 1 }, { durationS: 2 }];
    expect(groupChainsByDriver(chains, 0)).toEqual([[0], [1]]);
    expect(groupChainsByDriver(chains, 5)).toEqual([[0], [1]]);
  });

  it("vehiclesForLoad: as many as the load needs, at least one per driver, largest first", () => {
    const vehicles = [
      { id: "small", capacityKg: 500 },
      { id: "big", capacityKg: 1500 },
      { id: "mid", capacityKg: 1000 },
      { id: "mid2", capacityKg: 1000 },
      { id: "tiny", capacityKg: 200 },
    ];
    const stops = (kg: number) => [{ weightKg: kg }];
    expect(vehiclesForLoad(vehicles, 2, stops(3200)).map((v) => v.id)).toEqual([
      "big",
      "mid",
      "mid2",
    ]);
    expect(vehiclesForLoad(vehicles, 2, stops(3600)).map((v) => v.id)).toEqual([
      "small",
      "big",
      "mid",
      "mid2",
    ]);
    expect(vehiclesForLoad(vehicles, 2, stops(100)).map((v) => v.id)).toEqual(["big", "mid"]);
    expect(vehiclesForLoad(vehicles, 2, stops(99_999))).toHaveLength(5);
  });

  it("tripPausesS: same vehicle = reload, another vehicle = switch", () => {
    expect(tripPausesS(["a", "a", "b"])).toEqual([RELOAD_SECONDS, VEHICLE_SWITCH_SECONDS]);
    expect(tripPausesS([null, "b"])).toEqual([VEHICLE_SWITCH_SECONDS]);
    expect(tripPausesS(["a"])).toEqual([]);
  });

  it("tripVehicleIds and vehiclesForTrips keep a trip's vehicle by its position", () => {
    expect(tripVehicleIds([1, 1, 2, 3], [null, null, "b", null], "a")).toEqual(["a", "b", "a"]);
    const existing = [
      { trip: 1, vehicleId: null },
      { trip: 2, vehicleId: "b" },
      { trip: 2, vehicleId: "b" },
    ];
    expect(vehiclesForTrips(existing, [2, 1, 2, 3])).toEqual(["b", null, "b", null]);
  });

  it("computeTripSchedule uses the pause of each boundary", () => {
    const schedule = computeTripSchedule({
      departure: new Date("2099-01-01T07:00:00Z"),
      serviceSecondsPerStop: 0,
      trips: [
        { stopLegDurationsS: [100], returnLegDurationS: 100 },
        { stopLegDurationsS: [100], returnLegDurationS: 100 },
      ],
      pausesS: [VEHICLE_SWITCH_SECONDS],
    });
    expect(schedule.totalDurationS).toBe(400 + VEHICLE_SWITCH_SECONDS);
  });
});

describe("splitByStandingTours (NUD-209)", () => {
  const stops = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

  it("gives each available standing driver his customers and leaves the rest loose", () => {
    const result = splitByStandingTours(
      stops,
      [
        { driverId: "anna", customerIds: ["c", "a"] },
        { driverId: "bruno", customerIds: ["b"] },
        { driverId: "cem", customerIds: ["d"] },
        { driverId: null, customerIds: ["e"] },
      ],
      ["bruno", "anna"],
    );
    expect(result.groups).toEqual([
      { driverId: "bruno", stops: [{ id: "b" }] },
      { driverId: "anna", stops: [{ id: "a" }, { id: "c" }] },
    ]);
    // Cem is not working today and "e" has no driver: both are planned freely.
    expect(result.loose).toEqual([{ id: "d" }, { id: "e" }]);
  });

  it("merges two standing tours of one driver; a customer in two belongs to the first available", () => {
    const result = splitByStandingTours(
      stops.slice(0, 3),
      [
        { driverId: "cem", customerIds: ["a"] },
        { driverId: "anna", customerIds: ["a", "b"] },
        { driverId: "anna", customerIds: ["c"] },
      ],
      ["anna"],
    );
    expect(result).toEqual({
      groups: [{ driverId: "anna", stops: [{ id: "a" }, { id: "b" }, { id: "c" }] }],
      loose: [],
    });
  });
});

describe("attachToNearestGroup (NUD-209)", () => {
  it("adds each loose stop to the group with the nearest stop", () => {
    const at = (id: string, lat: number) => ({ id, location: { lat, lng: 16 } });
    const north = { stops: [at("n1", 48.3)] };
    const south = { stops: [at("s1", 48.1)] };
    attachToNearestGroup([north, south], [at("x", 48.28), at("y", 48.12)]);
    expect(north.stops.map((s) => s.id)).toEqual(["n1", "x"]);
    expect(south.stops.map((s) => s.id)).toEqual(["s1", "y"]);
  });
});
