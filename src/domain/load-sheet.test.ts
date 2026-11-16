import { describe, expect, it } from "vitest";

import { deliveryOrder, type LoadSheetProduct, loadSheetTotals } from "./load-sheet";
import { sumQuantities } from "./order-overview";

const products: LoadSheetProduct[] = [
  { id: "p-spag", sku: "SPAG-5", unit: "PACK", sortOrder: 2 },
  { id: "p-pen", sku: "PEN-5", unit: "PACK", sortOrder: 1 },
  { id: "p-flour", sku: "FLOUR", unit: "KG", sortOrder: 5 },
  { id: "p-crate", sku: "CR", unit: "CRATE", sortOrder: 0 },
];

function thirtyStops() {
  return Array.from({ length: 30 }, (_, i) => ({
    id: `s${i + 1}`,
    sequence: i + 1,
    items: [
      { productId: "p-spag", quantity: (i % 5) + 1 },
      { productId: "p-pen", quantity: 3 },
      ...(i % 3 === 0 ? [{ productId: "p-flour", quantity: 13 + i }] : []),
      ...(i % 7 === 0 ? [{ productId: "p-crate", quantity: 1 }] : []),
    ],
  }));
}

describe("loadSheetTotals", () => {
  it("equals the sum of all stops, per product, for a 30-stop tour", () => {
    const stops = thirtyStops();
    const totals = loadSheetTotals(stops, products);
    for (const total of totals) {
      const expected = stops
        .flatMap((s) => s.items)
        .filter((i) => i.productId === total.productId)
        .reduce((sum, i) => sum + i.quantity, 0);
      expect(total.quantity).toBe(expected);
    }
    // nothing lost, nothing invented: grand total over all lines is identical
    const grand = (xs: Array<{ quantity: number }>) => xs.reduce((a, x) => a + x.quantity, 0);
    expect(grand(totals)).toBe(grand(stops.flatMap((s) => s.items)));
    expect(totals.find((t) => t.productId === "p-pen")?.quantity).toBe(30 * 3);
  });

  it("uses the same aggregation function as the order overview", () => {
    const stops = thirtyStops();
    const viaOverview = sumQuantities(stops.flatMap((s) => s.items)).map(
      (s) => [s.productId, s.quantity] as const,
    );
    const viaSheet = loadSheetTotals(stops, products).map(
      (t) => [t.productId, t.quantity] as const,
    );
    expect(new Map(viaSheet)).toEqual(new Map(viaOverview));
  });

  it("adds whole numbers exactly", () => {
    const stops = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      sequence: i + 1,
      items: [{ productId: "p-flour", quantity: 10 }],
    }));
    expect(loadSheetTotals(stops, products)).toEqual([
      { productId: "p-flour", unit: "KG", quantity: 100 },
    ]);
  });

  it("never adds different units together, even for one product id", () => {
    const sums = sumQuantities([
      { productId: "p", unit: "PACK", quantity: 5 },
      { productId: "p", unit: "KG", quantity: 2 },
      { productId: "p", unit: "PACK", quantity: 1 },
    ]);
    expect(sums).toEqual([
      { productId: "p", unit: "KG", quantity: 2 },
      { productId: "p", unit: "PACK", quantity: 6 },
    ]);
  });

  it("sorts by unit, then catalog order, and keeps unknown products visible", () => {
    const totals = loadSheetTotals(
      [
        {
          items: [
            { productId: "p-flour", quantity: 1 },
            { productId: "p-spag", quantity: 1 },
            { productId: "p-pen", quantity: 1 },
            { productId: "p-crate", quantity: 1 },
            { productId: "gone", quantity: 3 },
          ],
        },
      ],
      products,
    );
    expect(totals.map((t) => t.productId)).toEqual([
      "p-flour",
      "p-pen",
      "p-spag",
      "p-crate",
      "gone",
    ]);
    expect(totals.at(-1)).toMatchObject({ unit: "", quantity: 3 });
  });

  it("returns nothing for a tour without items", () => {
    expect(loadSheetTotals([], products)).toEqual([]);
  });
});

describe("deliveryOrder", () => {
  it("lists the stops from stop 1 to the last one", () => {
    const ordered = deliveryOrder([{ sequence: 2 }, { sequence: 1 }, { sequence: 3 }]);
    expect(ordered).toEqual([{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }]);
  });

  it("does not change the input", () => {
    const input = [{ sequence: 2 }, { sequence: 1 }];
    deliveryOrder(input);
    expect(input).toEqual([{ sequence: 2 }, { sequence: 1 }]);
  });
});
