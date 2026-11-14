/**
 * Audit log vocabulary and pure helpers (NUD-092). Pure: no framework or database imports.
 *
 * What an entry stores: ids, enum values, dates and quantities only (in hundredths, see `toAuditQuantity`).
 * Names (customers, products, drivers) are resolved when the history is read, so a renamed
 * product shows its current name and the log never holds a copy of personal data. Free text
 * (internal order notes; driver problem notes are not stored at all, NUD-121) is truncated to `AUDIT_TEXT_MAX` characters.
 */

export const AUDIT_ENTITIES = [
  "Order",
  "Tour",
  "Stop",
  "Customer",
  "Vehicle",
  "RecurringOrder",
  "Driver",
  "StandingTour",
  "User",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const AUDIT_ACTIONS = [
  "order.create",
  "order.update",
  "order.cancel",
  "order.duplicate",
  "tour.generate",
  "tour.followup",
  "tour.plan_day",
  "tour.reoptimize",
  "tour.reorder",
  "tour.lock",
  "tour.unlock",
  "tour.assign_driver",
  "tour.assign_vehicle",
  "tour.move_stop",
  "tour.create_empty",
  "tour.release",
  "tour.rerelease",
  "tour.loading_started",
  "tour.departed",
  "stop.delivered",
  "stop.problem",
  "stop.undo",
  "stop.payment",
  "monthly.pay",
  "monthly.unpay",
  "monthly.adjust",
  "monthly.adjust_remove",
  "photo.add",
  "photo.replace",
  "parking.create",
  "parking.update",
  "parking.reorder",
  "parking.deactivate",
  "customer.key",
  "customer.abbreviation",
  "customer.deactivate",
  "customer.activate",
  "recurring.create",
  "recurring.update",
  "recurring.pause",
  "recurring.resume",
  "vehicle.create",
  "vehicle.update",
  "vehicle.activate",
  "vehicle.deactivate",
  "driver.schedule_update",
  "standing_tour.create",
  "standing_tour.update",
  "standing_tour.driver",
  "standing_tour.vehicle",
  "standing_tour.activate",
  "standing_tour.deactivate",
  "user.delete",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/** Longest free text kept in a diff (characters, including the ellipsis). */
export const AUDIT_TEXT_MAX = 200;
/** Longest list kept in a diff (stop sequences, line lists); the rest is dropped. */
export const AUDIT_LIST_MAX = 200;
const MAX_DEPTH = 6;

/** Keys that must never appear in a diff, whatever a caller passes (secrets, signed URLs). */
const FORBIDDEN_KEY =
  /pass(word)?|hash|secret|token|signature|signedurl|credential|cookie|^url$|Url$/i;

export function truncateText(value: string, max: number = AUDIT_TEXT_MAX): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Makes a diff safe to store: drops forbidden keys, undefined values and non-finite numbers,
 * truncates strings and lists, converts dates to ISO strings and caps the nesting depth.
 */
export function sanitizeAuditDiff(value: unknown, depth = 0): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncateText(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    return value.slice(0, AUDIT_LIST_MAX).map((v) => sanitizeAuditDiff(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || FORBIDDEN_KEY.test(key)) continue;
      out[key] = sanitizeAuditDiff(v, depth + 1);
    }
    return out;
  }
  return null;
}

// ---- order diffs ----

export type OrderSnapshot = {
  status: string;
  /** `YYYY-MM-DD` */
  deliveryDate: string;
  /** Requested window as text, e.g. `2026-11-03..2026-11-05 08:00-11:00` (NUD-148); omitted = not tracked. */
  window?: string;
  internalNote: string | null;
  items: ReadonlyArray<{ productId: string; quantity: number }>;
  /** `MONTHLY` | `ON_DELIVERY` (D33); omitted = not tracked. */
  paymentTerm?: string;
  /** Amount of the order in euro cents (D33); `null` = no amount. Omitted = not tracked. */
  amountCents?: number | null;
};

export type LineChange = {
  productId: string;
  /** Hundredths; `null` = the product was not on the order. */
  before: number | null;
  after: number | null;
};

/**
 * Quantities are whole numbers since NUD-137, but the audit log is append-only and its older rows
 * hold hundredths. New entries keep that encoding so one reader (`audit-timeline`) handles both.
 */
export function toAuditQuantity(quantity: number): number {
  return quantity * 100;
}

/** Quantity changes between two item lists: only products whose quantity differs, added or removed. */
export function diffOrderLines(
  before: OrderSnapshot["items"],
  after: OrderSnapshot["items"],
): LineChange[] {
  const b = new Map(before.map((i) => [i.productId, toAuditQuantity(i.quantity)]));
  const a = new Map(after.map((i) => [i.productId, toAuditQuantity(i.quantity)]));
  const changes: LineChange[] = [];
  for (const [productId, stored] of a) {
    const was = b.get(productId);
    if (was !== stored) changes.push({ productId, before: was ?? null, after: stored });
  }
  for (const [productId, stored] of b) {
    if (!a.has(productId)) changes.push({ productId, before: stored, after: null });
  }
  return changes;
}

export type FieldChange<T = string | null> = { from: T; to: T };

export type OrderUpdateDiff = {
  status?: FieldChange<string>;
  deliveryDate?: FieldChange<string>;
  window?: FieldChange<string>;
  internalNote?: FieldChange;
  lines?: LineChange[];
  paymentTerm?: FieldChange<string>;
  amountCents?: FieldChange<number | null>;
};

/** What an order edit changed; `null` when nothing a person can see differs (no entry is written). */
export function diffOrderUpdate(
  before: OrderSnapshot,
  after: OrderSnapshot,
): OrderUpdateDiff | null {
  const diff: OrderUpdateDiff = {};
  if (before.status !== after.status) diff.status = { from: before.status, to: after.status };
  if (before.deliveryDate !== after.deliveryDate) {
    diff.deliveryDate = { from: before.deliveryDate, to: after.deliveryDate };
  }
  if (before.window !== undefined && after.window !== undefined && before.window !== after.window) {
    diff.window = { from: before.window, to: after.window };
  }
  const noteBefore = before.internalNote?.trim() || null;
  const noteAfter = after.internalNote?.trim() || null;
  if (noteBefore !== noteAfter) {
    diff.internalNote = {
      from: noteBefore === null ? null : truncateText(noteBefore),
      to: noteAfter === null ? null : truncateText(noteAfter),
    };
  }
  const lines = diffOrderLines(before.items, after.items);
  if (lines.length > 0) diff.lines = lines;
  if (
    before.paymentTerm !== undefined &&
    after.paymentTerm !== undefined &&
    before.paymentTerm !== after.paymentTerm
  ) {
    diff.paymentTerm = { from: before.paymentTerm, to: after.paymentTerm };
  }
  if (
    before.amountCents !== undefined &&
    after.amountCents !== undefined &&
    before.amountCents !== after.amountCents
  ) {
    diff.amountCents = { from: before.amountCents, to: after.amountCents };
  }
  return Object.keys(diff).length > 0 ? diff : null;
}
