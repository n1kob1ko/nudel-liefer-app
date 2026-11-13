import { z } from "zod";

import { isScreenshotKey } from "@/lib/uploads";

import { isValidWindow, type OrderWindow, parseTimeOfDay } from "./delivery-window";
import { parseAmountToCents } from "./money";
import { extractionAnswerSchema, MAX_SOURCE_TEXT } from "./order-extraction-answer";
import { DEFAULT_PAYMENT_TERM, PAYMENT_TERMS } from "./payment";

/**
 * Pure order-entry rules (NUD-030): quantity parsing, line merging, input validation and the
 * non-blocking warnings. No framework or database imports.
 */

/** Quantities are whole numbers (D23): `Int` column, at most 5 digits, no halves of anything. */
export const MAX_QUANTITY = 99_999;
export const MAX_ORDER_LINES = 100;
export const MAX_NOTE_LENGTH = 1000;

/**
 * Parses what an office user types into a whole-number quantity (1..MAX_QUANTITY), or `null`.
 * Only digits are accepted: "2,5", "2.5", "3.0", "1e3", "0", negative numbers and thousands
 * separators are rejected, not rounded or guessed - a wrong delivery quantity is worse than a
 * rejected input.
 */
export function parseQuantity(input: string | number): number | null {
  const text = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : input;
  if (!/^\d{1,5}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 1 && value <= MAX_QUANTITY ? value : null;
}

export type OrderLine = { productId: string; quantity: number };

/**
 * Decision (backlog §9): the same product twice in one order is MERGED (quantities added),
 * not rejected. Order of first appearance is kept. Returns `null` if the sum exceeds
 * `MAX_QUANTITY`.
 */
export function mergeOrderLines(lines: readonly OrderLine[]): OrderLine[] | null {
  const merged = new Map<string, number>();
  for (const line of lines) {
    const sum = (merged.get(line.productId) ?? 0) + line.quantity;
    if (sum > MAX_QUANTITY) return null;
    merged.set(line.productId, sum);
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/** True if at least one product appears more than once (the form tells the user it will be merged). */
export function hasDuplicateProducts(productIds: readonly string[]): boolean {
  return new Set(productIds).size !== productIds.length;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` to a `DATE` value (UTC midnight); `null` for anything that is not a real day. */
export function parseCalendarDate(value: string): Date | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/** A `DATE` value (UTC midnight) as `YYYY-MM-DD`. */
export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Orders for days before `today` (both UTC midnight `DATE` values) are not accepted. */
export function isPastDeliveryDate(date: Date, today: Date): boolean {
  return date.getTime() < today.getTime();
}

const idSchema = z.string().trim().min(1).max(64);

/** Optional `YYYY-MM-DD`; empty or missing = `null`, anything else must be a real day. */
function dateField(message: string) {
  return z
    .string()
    .trim()
    .max(10)
    .nullish()
    .transform((value, ctx) => {
      if (!value) return null;
      const date = parseCalendarDate(value);
      if (!date) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return date;
    });
}

/** Optional "HH:MM"; an empty string counts as not set. */
function timeField(message: string) {
  return z
    .string()
    .trim()
    .max(5)
    .nullish()
    .transform((value, ctx) => {
      if (!value) return null;
      if (parseTimeOfDay(value) === null) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return value;
    });
}

const quantitySchema = z.union([z.string().max(32), z.number()]).transform((value, ctx) => {
  const quantity = parseQuantity(value);
  if (quantity === null) {
    ctx.addIssue({ code: "custom", message: "quantity" });
    return z.NEVER;
  }
  return quantity;
});

/**
 * Input of "create order". Quantities are whole numbers (strings of digits or integers); the output has merged
 * lines. At least one line, every quantity >= 1.
 */
export const orderInputSchema = z
  .object({
    customerId: idSchema,
    /**
     * PLANNED day (NUD-148). Optional: without it the server picks the earliest day of the window
     * with vehicle capacity. Alone (no window fields) it is also the window: the whole day.
     */
    deliveryDate: dateField("deliveryDate"),
    windowFrom: dateField("windowFrom"),
    windowTo: dateField("windowTo"),
    windowFromTime: timeField("windowFromTime"),
    windowToTime: timeField("windowToTime"),
    status: z.enum(["CONFIRMED", "DRAFT"]).default("CONFIRMED"),
    /**
     * Cash at the stop or on the monthly bill (D33, NUD-196). Monthly is the default; the order form
     * always sends it, `updateOrder` falls back to the stored value when it is missing.
     */
    paymentTerm: z.enum(PAYMENT_TERMS).default(DEFAULT_PAYMENT_TERM),
    /**
     * Amount of this order as typed in the office ("42,50", "42.5", a number); the catalog has no
     * prices (D33), so this is the only source of money. Empty = no amount.
     */
    amount: z
      .union([z.string().max(20), z.number().nullable(), z.null()])
      .nullish()
      .transform((value, ctx) => {
        if (value === null || value === undefined) return null;
        if (typeof value === "string" && value.trim() === "") return null;
        const cents = parseAmountToCents(value);
        if (cents === null) {
          ctx.addIssue({ code: "custom", message: "amount" });
          return z.NEVER;
        }
        return cents;
      }),
    internalNote: z
      .string()
      .trim()
      .max(MAX_NOTE_LENGTH)
      .nullish()
      .transform((v) => (v ? v : null)),
    /**
     * Optional screenshot the order was typed from (NUD-031): a key issued by `POST /api/uploads`
     * for purpose `screenshot`. Its presence makes the order `source=SCREENSHOT`; the client
     * cannot choose the source otherwise.
     */
    screenshotKey: z
      .string()
      .max(200)
      .refine(isScreenshotKey)
      .nullish()
      .transform((v) => v ?? null),
    /**
     * Pasted customer message the order was typed from (NUD-150). Stored for review and for the
     * dispute about quantities; never parsed again, so it cannot influence an order.
     */
    sourceText: z
      .string()
      .trim()
      .max(MAX_SOURCE_TEXT)
      .nullish()
      .transform((v) => (v ? v : null)),
    /**
     * Raw answer of the AI extraction (NUD-150), kept next to the order so the office can see what
     * the model read. Validated against the extraction contract - arbitrary client JSON is refused.
     */
    aiExtraction: extractionAnswerSchema
      .nullish()
      .transform((v) => v ?? null),
    lines: z
      .array(z.object({ productId: idSchema, quantity: quantitySchema }))
      .min(1)
      .max(MAX_ORDER_LINES),
  })
  .transform((value, ctx) => {
    const merged = mergeOrderLines(
      value.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    );
    if (!merged) {
      ctx.addIssue({ code: "custom", message: "quantity" });
      return z.NEVER;
    }
    // Window (NUD-148): explicit, or the planned day alone = that whole day.
    const from = value.windowFrom ?? value.deliveryDate;
    const to = value.windowTo ?? value.windowFrom ?? value.deliveryDate;
    if (!from || !to) {
      ctx.addIssue({ code: "custom", message: "windowFrom" });
      return z.NEVER;
    }
    const window: OrderWindow = {
      from,
      to,
      fromTime: value.windowFromTime,
      toTime: value.windowToTime,
    };
    if (!isValidWindow(window)) {
      ctx.addIssue({ code: "custom", message: "window" });
      return z.NEVER;
    }
    const { amount, ...rest } = value;
    return { ...rest, amountCents: amount, lines: merged, window };
  });

export type OrderInput = z.input<typeof orderInputSchema>;
export type ValidOrder = z.output<typeof orderInputSchema>;

export type OrderWarning = "combined_stop" | "tour_completed";

/**
 * Warnings (never errors) shown while entering an order: the customer already has confirmed
 * orders that day (they become one stop). A missing Parkplatz is no order warning (D22, NUD-141).
 */
export function orderWarnings(input: {
  confirmedOrdersOnDate: number;
  /** Every tour of that day is COMPLETED (NUD-116): a confirmed order needs a follow-up tour. */
  tourCompletedOnDate?: boolean;
}): OrderWarning[] {
  const warnings: OrderWarning[] = [];
  if (input.confirmedOrdersOnDate > 0) warnings.push("combined_stop");
  if (input.tourCompletedOnDate) warnings.push("tour_completed");
  return warnings;
}
