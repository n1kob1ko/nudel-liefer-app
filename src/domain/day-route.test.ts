import { describe, expect, it } from "vitest";

import { dayRouteOrder, resolvePlace, type RoutePath, suggestPlace } from "./day-route";

const depot = { lat: 48.2555, lng: 16.4682 };
const at = (lat: number, lng: number) => ({ lat, lng });

describe("dayRouteOrder (NUD-212)", () => {
  it("keeps the standing order and puts an extra after the k-th member", () => {
    expect(
      dayRouteOrder(
        ["a", "b", "c"],
        [
          { customerId: "x", slot: 0 },
          { customerId: "y", slot: 2 },
        ],
      ),
    ).toEqual(["x", "a", "b", "y", "c"]);
  });

  it("keeps the given order of extras in one slot and clamps a slot past the end", () => {
    expect(
      dayRouteOrder(
        ["a", "b"],
        [
          { customerId: "x", slot: 1 },
          { customerId: "y", slot: 1 },
          { customerId: "z", slot: 9 },
        ],
      ),
    ).toEqual(["a", "x", "y", "b", "z"]);
  });

  it("treats a negative or broken slot as 0", () => {
    expect(dayRouteOrder(["a"], [{ customerId: "x", slot: -3 }])).toEqual(["x", "a"]);
    expect(dayRouteOrder(["a"], [{ customerId: "x", slot: Number.NaN }])).toEqual(["x", "a"]);
  });
});

// Two standing routes leaving the depot in 1220: north (1210) and south-west (1030 / 1100).
const north: RoutePath = {
  id: "north",
  members: [
    { customerId: "n1", location: at(48.257, 16.399) },
    { customerId: "n2", location: at(48.28, 16.41) },
    { customerId: "n3", location: at(48.304, 16.415) },
  ],
};
const south: RoutePath = {
  id: "south",
  members: [
    { customerId: "s1", location: at(48.2241, 16.4026) },
    { customerId: "s2", location: null },
    { customerId: "s3", location: at(48.1949, 16.3866) },
    { customerId: "s4", location: at(48.175, 16.378) },
  ],
};

describe("suggestPlace (NUD-212)", () => {
  it("picks the route that passes by and the slot between its nearest members", () => {
    // Löwengasse (1030) lies between s1 (Lassallestraße) and s3 (Ungargasse).
    expect(suggestPlace(depot, [north, south], at(48.2099, 16.3914))).toEqual({
      routeId: "south",
      slot: 2,
    });
    // Between n1 and n2 on the north route.
    expect(suggestPlace(depot, [north, south], at(48.268, 16.404))).toEqual({
      routeId: "north",
      slot: 1,
    });
  });

  it("can put the extra first or last", () => {
    expect(suggestPlace(depot, [north], at(48.256, 16.44))?.slot).toBe(0);
    expect(suggestPlace(depot, [north], at(48.33, 16.42))?.slot).toBe(3);
  });

  it("goes to the end of the first route without a location, and to nothing without routes", () => {
    expect(suggestPlace(depot, [north, south], null)).toEqual({ routeId: "north", slot: 3 });
    expect(suggestPlace(depot, [], at(48.2, 16.4))).toBeNull();
  });

  it("uses a route without any located member as a direct trip", () => {
    const empty: RoutePath = { id: "empty", members: [] };
    expect(suggestPlace(depot, [empty], at(48.2, 16.4))).toEqual({ routeId: "empty", slot: 0 });
  });
});

describe("resolvePlace (NUD-212)", () => {
  const point = at(48.2099, 16.3914);

  it("keeps the office's route and slot", () => {
    expect(resolvePlace(depot, [north, south], point, { routeId: "north", slot: 1 })).toEqual({
      routeId: "north",
      slot: 1,
      moved: true,
    });
  });

  it("clamps the slot and finds the best slot when only the route is given", () => {
    expect(resolvePlace(depot, [north, south], point, { routeId: "north", slot: 40 })).toEqual({
      routeId: "north",
      slot: 3,
      moved: true,
    });
    expect(resolvePlace(depot, [north, south], point, { routeId: "south", slot: null })).toEqual({
      routeId: "south",
      slot: 2,
      moved: true,
    });
  });

  it("falls back to the suggestion when the route is gone or nothing was chosen", () => {
    expect(resolvePlace(depot, [north, south], point, { routeId: "gone", slot: 0 })).toEqual({
      routeId: "south",
      slot: 2,
      moved: false,
    });
    expect(resolvePlace(depot, [north, south], point, { routeId: null, slot: null })).toEqual({
      routeId: "south",
      slot: 2,
      moved: false,
    });
  });
});
