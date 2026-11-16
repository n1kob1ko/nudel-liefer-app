import { sumQuantities } from "./order-overview";

/**
 * Pure rules of the printable packing list / load sheet (NUD-091). The sheet is built from the
 * quantities the TOUR carries (`Stop.items`, what the office released), never from live orders.
 * No framework or database imports.
 */

export const LOAD_SHEET_UNIT_ORDER = ["KG", "PACK", "CRATE", "PIECE"] as const;

export type LoadSheetStopInput = {
  id: string;
  sequence: number;
  items: ReadonlyArray<{ productId: string; quantity: number }>;
};

export type LoadSheetProduct = { id: string; sku: string; unit: string; sortOrder: number };

export type LoadSheetTotal = { productId: string; unit: string; quantity: number };

const unitRank = (unit: string) => {
  const index = (LOAD_SHEET_UNIT_ORDER as readonly string[]).indexOf(unit);
  return index === -1 ? LOAD_SHEET_UNIT_ORDER.length : index;
};

/**
 * Section 1: one total per product and unit over ALL stops, using the shared aggregation
 * `sumQuantities` (the one the order overview uses). Different units are never added together.
 * Sorted by unit, then the catalog order (`sortOrder`, SKU).
 */
export function loadSheetTotals(
  stops: ReadonlyArray<Pick<LoadSheetStopInput, "items">>,
  products: ReadonlyArray<LoadSheetProduct>,
): LoadSheetTotal[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = stops.flatMap((stop) =>
    stop.items.map((item) => ({
      productId: item.productId,
      unit: byId.get(item.productId)?.unit ?? "",
      quantity: item.quantity,
    })),
  );
  return sumQuantities(lines)
    .map((sum) => ({
      productId: sum.productId,
      unit: sum.unit ?? "",
      quantity: sum.quantity,
    }))
    .sort((a, b) => {
      const pa = byId.get(a.productId);
      const pb = byId.get(b.productId);
      return (
        unitRank(a.unit) - unitRank(b.unit) ||
        (pa?.sortOrder ?? 0) - (pb?.sortOrder ?? 0) ||
        (pa?.sku ?? "").localeCompare(pb?.sku ?? "") ||
        a.productId.localeCompare(b.productId)
      );
    });
}

/**
 * Section 2: the stops in delivery order, stop 1 first (owner 2026-11-16: "von 1 bis x"; until then
 * the sheet listed them in reverse load order).
 */
export function deliveryOrder<T extends Pick<LoadSheetStopInput, "sequence">>(
  stops: readonly T[],
): T[] {
  return [...stops].sort((a, b) => a.sequence - b.sequence);
}
