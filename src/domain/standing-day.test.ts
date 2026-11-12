import { describe, expect, it } from "vitest";

import {
  emptyQuantities,
  isNothing,
  lineChanges,
  planWeightKg,
  positiveLines,
  quantitiesOf,
  rowChanged,
  rowWeightKg,
  sumQuantities,
} from "./standing-day";

const PRODUCTS = [
  { id: "p1", sku: "N-S", name: {}, unit: "PACK", weightKgPerUnit: "3", sortOrder: 1 },
  { id: "p2", sku: "N-K", name: {}, unit: "CRATE", weightKgPerUnit: "10", sortOrder: 2 },
  { id: "p3", sku: "W-T", name: {}, unit: "PIECE", weightKgPerUnit: "0.5", sortOrder: 3 },
];

describe("quantitiesOf", () => {
  it("fills every column and sums duplicates", () => {
    const q = quantitiesOf(
      [
        { productId: "p1", quantity: 2 },
        { productId: "p1", quantity: 3 },
        { productId: "p3", quantity: 1 },
      ],
      ["p1", "p2", "p3"],
    );
    expect(q).toEqual({ p1: 5, p2: 0, p3: 1 });
  });

  it("drops products that are not a column and treats negative or broken quantities as 0", () => {
    const q = quantitiesOf(
      [
        { productId: "gone", quantity: 7 },
        { productId: "p1", quantity: -4 },
        { productId: "p2", quantity: Number.NaN },
        { productId: "p3", quantity: 2 },
      ],
      ["p1", "p2", "p3"],
    );
    expect(q).toEqual({ p1: 0, p2: 0, p3: 2 });
  });

  it("of nothing is the empty row", () => {
    expect(quantitiesOf([], ["p1", "p2", "p3"])).toEqual(emptyQuantities(["p1", "p2", "p3"]));
  });
});

describe("isNothing", () => {
  it("is true only when every column is 0", () => {
    expect(isNothing({ p1: 0, p2: 0, p3: 0 }, ["p1", "p2", "p3"])).toBe(true);
    expect(isNothing({ p1: 0, p2: 1, p3: 0 }, ["p1", "p2", "p3"])).toBe(false);
  });
});

describe("positiveLines", () => {
  it("keeps only what is really ordered, in column order", () => {
    expect(positiveLines({ p1: 0, p2: 4, p3: 2 }, ["p1", "p2", "p3"])).toEqual([
      { productId: "p2", quantity: 4 },
      { productId: "p3", quantity: 2 },
    ]);
  });
});

describe("weights", () => {
  it("weighs a row by quantity times weight per unit", () => {
    expect(rowWeightKg({ p1: 2, p2: 1, p3: 0 }, PRODUCTS)).toBe(16);
    expect(rowWeightKg({ p1: 0, p2: 0, p3: 3 }, PRODUCTS)).toBe(1.5);
    expect(rowWeightKg({}, PRODUCTS)).toBe(0);
  });

  it("weighs a whole plan", () => {
    expect(
      planWeightKg(
        [
          { p1: 1, p2: 0, p3: 0 },
          { p1: 0, p2: 2, p3: 0 },
        ],
        PRODUCTS,
      ),
    ).toBe(23);
  });
});

describe("sumQuantities", () => {
  it("adds per column and ignores negatives", () => {
    expect(
      sumQuantities(
        [
          { p1: 2, p2: 0, p3: 1 },
          { p1: 3, p2: -5, p3: 0 },
        ],
        ["p1", "p2", "p3"],
      ),
    ).toEqual({ p1: 5, p2: 0, p3: 1 });
  });
});

describe("lineChanges / rowChanged", () => {
  it("lists only the products whose quantity differs", () => {
    expect(
      lineChanges({ p1: 2, p2: 0, p3: 1 }, { p1: 0, p2: 0, p3: 1 }, ["p1", "p2", "p3"]),
    ).toEqual([{ productId: "p1", before: 2, after: 0 }]);
  });

  it("reports no change for an identical row", () => {
    const row = { p1: 2, p2: 0, p3: 1 };
    expect(rowChanged(row, { ...row }, ["p1", "p2", "p3"])).toBe(false);
    expect(rowChanged(row, { ...row, p2: 1 }, ["p1", "p2", "p3"])).toBe(true);
  });
});
