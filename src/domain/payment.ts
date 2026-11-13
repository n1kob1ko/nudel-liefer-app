/**
 * Payment terms and money states of a delivery day or a month (D33, NUD-196). Pure: no framework,
 * no database. Amounts are whole euro cents (see `money.ts`).
 */

import { sumCents } from "./money";

export const PAYMENT_TERMS = ["MONTHLY", "ON_DELIVERY"] as const;
export type PaymentTerm = (typeof PAYMENT_TERMS)[number];

/** Monthly is the default; cash at the stop is the exception the office switches on (D33). */
export const DEFAULT_PAYMENT_TERM: PaymentTerm = "MONTHLY";

/** What the stop's cash total is made of: one amount per CONFIRMED order of the stop. */
export type PaymentOrder = {
  paymentTerm: string;
  amountCents: number | null;
};

/** Orders the driver has to collect at the stop. */
export function cashOrders<T extends PaymentOrder>(orders: readonly T[]): T[] {
  return orders.filter((order) => order.paymentTerm === "ON_DELIVERY");
}

/**
 * Cash to collect at one stop: the amounts of its ON_DELIVERY orders. Orders without an amount
 * count as 0 (the office did not price them yet), so the driver sees only what is really known.
 */
export function cashDueCents(orders: readonly PaymentOrder[]): number {
  return sumCents(cashOrders(orders).map((order) => order.amountCents));
}

/**
 * State of a cash collection:
 * - `none`: the stop has no cash order (monthly bill) — nothing to collect,
 * - `open`: cash is due, the driver has not recorded anything,
 * - `short` / `over`: recorded amount differs from the due amount (paid in part, gave change, ...),
 * - `exact`: the recorded amount equals the due amount.
 */
export type CashState = "none" | "open" | "short" | "exact" | "over";

export function cashState(dueCents: number, collectedCents: number | null | undefined): CashState {
  if (dueCents <= 0) return "none";
  if (collectedCents === null || collectedCents === undefined) return "open";
  if (collectedCents === dueCents) return "exact";
  return collectedCents < dueCents ? "short" : "over";
}

/** First day of the month a `DATE` value (UTC midnight) belongs to. */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** `delta` months added to a month start (the first day is kept). */
export function addMonths(periodStart: Date, delta: number): Date {
  return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + delta, 1));
}

/** First day of the month after `periodStart` (the exclusive end of the month). */
export function nextMonthStart(periodStart: Date): Date {
  return addMonths(periodStart, 1);
}

/** `YYYY-MM` of a month start, the key of the month pages and links. */
export function monthKey(periodStart: Date): string {
  return `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Parses `YYYY-MM` into the first day of that month; `null` for anything else. */
export function parseMonthKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

/**
 * True once a month is over (its last day lies before `today`): only then can an accumulated bill
 * be "open" — the current month is still being filled.
 */
export function isClosedMonth(periodStart: Date, today: Date): boolean {
  return nextMonthStart(periodStart).getTime() <= monthStart(today).getTime();
}

/** State of one customer-month pair for the office. */
export type MonthlyState =
  /** a paid note exists (`paidAt` set, not voided) */
  | "paid"
  /** the month is over, orders exist and no paid note exists */
  | "open"
  /** the current (or a future) month, still being delivered */
  | "current";

export function monthlyState(input: {
  periodStart: Date;
  today: Date;
  paid: boolean;
  orderCount: number;
}): MonthlyState {
  if (input.paid) return "paid";
  if (!isClosedMonth(input.periodStart, input.today)) return "current";
  return input.orderCount > 0 ? "open" : "current";
}
