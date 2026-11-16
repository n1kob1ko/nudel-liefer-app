import { describe, expect, it } from "vitest";

import {
  buildDepartureChecklist,
  checklistLineIds,
  type ChecklistStop,
  parseTicked,
  showDepartureCard,
} from "./departure-checklist";

const STOPS: ChecklistStop[] = [
  {
    customerId: "c1",
    customerName: "KundeTest2",
    hasKey: true,
    keyNumber: "12",
  },
  {
    customerId: "c2",
    customerName: "Bei Wang",
    hasKey: false,
    keyNumber: null,
  },
  {
    customerId: "c3",
    customerName: "Ohne Nummer",
    hasKey: true,
    keyNumber: null,
  },
  {
    customerId: "c4",
    customerName: "Unbekannt",
    hasKey: null,
  },
  {
    trip: 2,
    customerId: "c5",
    customerName: "Zweite Fahrt",
    hasKey: true,
    keyNumber: "31",
  },
];

describe("buildDepartureChecklist", () => {
  it("has no product lines: the driver never sees totals (owner 2026-11-16)", () => {
    expect(Object.keys(buildDepartureChecklist(STOPS, 1))).toEqual(["keys"]);
  });

  it("builds one checklist per trip", () => {
    const second = buildDepartureChecklist(STOPS, 2);
    expect(second.keys.map((k) => k.keyNumber)).toEqual(["31"]);
    expect(buildDepartureChecklist(STOPS, 3)).toEqual({ keys: [] });
  });

  it("lists one line per customer whose key exists, in delivery order", () => {
    const { keys } = buildDepartureChecklist(STOPS, 1);
    expect(keys.map((k) => [k.customerName, k.keyNumber])).toEqual([
      ["KundeTest2", "12"],
      ["Ohne Nummer", null], // a key without a noted number is still taken along
    ]);
  });

  it("lists a customer with two stops of the trip once", () => {
    const twice = [STOPS[0]!, { ...STOPS[0]! }];
    expect(buildDepartureChecklist(twice, 1).keys).toHaveLength(1);
  });

  it("gives every line a stable id and counts the fixed items", () => {
    const list = buildDepartureChecklist(STOPS, 1);
    const ids = checklistLineIds(list, [{ id: "c1" }]);
    expect(ids).toEqual(["k:c1", "k:c3", "f:c1"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("showDepartureCard", () => {
  const base = { tourStatus: "RELEASED", departedAt: null, stopStatuses: ["PENDING", "PENDING"] };
  it("is offered before the first stop", () => {
    expect(showDepartureCard(base)).toBe(true);
    expect(showDepartureCard({ ...base, tourStatus: "IN_PROGRESS" })).toBe(true);
  });
  it("is gone once the driver has left, started the stops or the tour is over", () => {
    expect(showDepartureCard({ ...base, departedAt: "2099-07-02T05:55:00Z" })).toBe(false);
    expect(showDepartureCard({ ...base, stopStatuses: ["DELIVERED", "PENDING"] })).toBe(false);
    expect(showDepartureCard({ ...base, stopStatuses: ["PROBLEM", "PENDING"] })).toBe(false);
    expect(showDepartureCard({ ...base, tourStatus: "COMPLETED" })).toBe(false);
    expect(showDepartureCard({ ...base, stopStatuses: [] })).toBe(false);
  });
});

describe("parseTicked", () => {
  it("keeps only known ids of a well-formed list", () => {
    const valid = new Set(["p:a", "k:b"]);
    expect([...parseTicked(["p:a", "gone", 5, "k:b"], valid)]).toEqual(["p:a", "k:b"]);
    expect(parseTicked("nope", valid).size).toBe(0);
    expect(parseTicked(null, valid).size).toBe(0);
  });
});
