/**
 * Pure rules of the day plan ("Tagesplanung", NUD-186): the office opens the deliveries of one day
 * per standing tour ("Stammtour") and sees the same customers every day. Nothing here touches a
 * framework or the database.
 *
 * The table is one row per customer and one column per active product; a quantity of 0 means "the
 * customer wants nothing that day" (D32 in backlog §9).
 */

import { orderWeightKg } from "./weight";

/** Largest number of customer rows one save may carry (all routes of a day plus the ad-hoc ones). */
export const MAX_PLAN_ROWS = 400;
/** Largest number of active customers one standing tour may contain. */
export const MAX_STANDING_CUSTOMERS = 200;
/** Largest number of standing tours (one card per tour on the page). */
export const MAX_STANDING_TOURS = 12;

/** One product column of the day plan. */
export type PlanProduct = {
  id: string;
  sku: string;
  /** LocalizedText JSON; the UI resolves it for the current locale. */
  name: unknown;
  unit: string;
  /** Weight per unit in kg as a decimal string (Prisma `Decimal`), see `orderWeightKg`. */
  weightKgPerUnit: string;
  sortOrder: number;
};

/** Quantity per product of one customer row; a product without a key counts as 0. */
export type Quantities = Record<string, number>;

/**
 * Where the quantities of a row come from:
 * - `order`: a CONFIRMED order of that day exists,
 * - `rule`: no order yet, but the customer's recurring rule delivers that day (a suggestion that
 *   is only stored when the office saves it),
 * - `none`: no order and no rule — the row is empty.
 */
export type RowSource = "order" | "rule" | "none";

/** One customer in the day plan of one delivery day. */
export type DayPlanRow = {
  customerId: string;
  customerNumber: string;
  name: string;
  city: string;
  /** `null` while the customer has no CONFIRMED order for that day. */
  orderId: string | null;
  /** How many CONFIRMED orders the customer has that day; a save merges them into one. */
  orderCount: number;
  /** A CANCELLED order for that day exists: the office said "nothing", so no rule suggestion. */
  cancelled: boolean;
  source: RowSource;
  quantities: Quantities;
  /** Every quantity 0 although an order exists ("nichts bestellt", kept in the orders list). */
  nothing: boolean;
  /** Weight of `quantities` in kg, two decimals. */
  weightKg: number;
};

/** One standing tour of the day: its customers and their rows, in delivery order. */
export type DayPlanRoute = {
  id: string;
  name: string;
  driverId: string | null;
  driverName: string | null;
  rows: DayPlanRow[];
};

/** Today and earlier days are history; a released or running tour belongs to the driver (D32). */
export type ReadOnlyReason = "released" | "past";

export type DayPlan = {
  /** `YYYY-MM-DD` */
  date: string;
  /** Active products, the columns of every table (sort order of the catalog). */
  products: PlanProduct[];
  routes: DayPlanRoute[];
  /** Active customers in no standing tour: the bottom list. */
  offRoute: DayPlanRow[];
  editable: boolean;
  readOnly: ReadOnlyReason | null;
};

/** A quantity of 0 for every product column. */
export function emptyQuantities(productIds: readonly string[]): Quantities {
  return Object.fromEntries(productIds.map((id) => [id, 0]));
}

/**
 * Quantities of a set of order lines per product column: duplicates are summed and products that
 * are not a column are dropped. Negative or non-finite quantities count as 0.
 */
export function quantitiesOf(
  items: ReadonlyArray<{ productId: string; quantity: number }>,
  productIds: readonly string[],
): Quantities {
  const quantities = emptyQuantities(productIds);
  for (const item of items) {
    if (!(item.productId in quantities)) continue;
    const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0;
    quantities[item.productId] = (quantities[item.productId] ?? 0) + quantity;
  }
  return quantities;
}

/** True when no product of the row has a positive quantity ("nothing ordered"). */
export function isNothing(quantities: Quantities, productIds: readonly string[]): boolean {
  return productIds.every((id) => (quantities[id] ?? 0) <= 0);
}

/** The positive lines of a row, in column order: exactly what is stored on the order. */
export function positiveLines(
  quantities: Quantities,
  productIds: readonly string[],
): Array<{ productId: string; quantity: number }> {
  return productIds
    .map((productId) => ({ productId, quantity: quantities[productId] ?? 0 }))
    .filter((line) => line.quantity > 0);
}

/** Weight of one row in kg (two decimals); an unknown product counts as 0 kg. */
export function rowWeightKg(quantities: Quantities, products: readonly PlanProduct[]): number {
  return orderWeightKg(
    positiveLines(
      quantities,
      products.map((p) => p.id),
    ),
    products,
  );
}

/** Sum per product over several rows. */
export function sumQuantities(
  rows: ReadonlyArray<Quantities>,
  productIds: readonly string[],
): Quantities {
  const total = emptyQuantities(productIds);
  for (const row of rows) {
    for (const id of productIds) total[id] = (total[id] ?? 0) + Math.max(0, row[id] ?? 0);
  }
  return total;
}

/** Weight of several rows in kg. */
export function planWeightKg(
  rows: ReadonlyArray<Quantities>,
  products: readonly PlanProduct[],
): number {
  const productIds = products.map((p) => p.id);
  return orderWeightKg(positiveLines(sumQuantities(rows, productIds), productIds), products);
}

/**
 * Quantities that differ between two states of one row (whole numbers, not hundredths). Products
 * that are 0 on both sides are left out, so a save that changes nothing produces an empty list.
 */
export function lineChanges(
  before: Quantities,
  after: Quantities,
  productIds: readonly string[],
): Array<{ productId: string; before: number; after: number }> {
  return productIds
    .map((productId) => ({
      productId,
      before: Math.max(0, before[productId] ?? 0),
      after: Math.max(0, after[productId] ?? 0),
    }))
    .filter((line) => line.before !== line.after);
}

/** True when saving `after` would change anything of the row. */
export function rowChanged(
  before: Quantities,
  after: Quantities,
  productIds: readonly string[],
): boolean {
  return lineChanges(before, after, productIds).length > 0;
}
