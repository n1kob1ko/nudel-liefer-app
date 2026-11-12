"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { todayIn } from "./orders";
import {
  markMonthlyPaid,
  type MonthlyMarkResult,
  type MonthlyUnmarkResult,
  unmarkMonthlyPaid,
} from "./payments";
import { getFactoryTimezone } from "./settings";

/**
 * Admin-only server actions for the payments page (D33, NUD-196). The role is checked against the
 * database before the input is read; the service layer validates everything again.
 */

/** Marks one customer-month as paid (snapshot of total and order count), audited. */
export async function markMonthlyBillPaidAction(input: unknown): Promise<MonthlyMarkResult> {
  const actor = await requireRole("ADMIN");
  return markMonthlyPaid(getDb(), actor.id, input, todayIn(await getFactoryTimezone()));
}

/** Takes the "paid" note back; the row and the audit history stay. */
export async function unmarkMonthlyBillPaidAction(input: unknown): Promise<MonthlyUnmarkResult> {
  const actor = await requireRole("ADMIN");
  return unmarkMonthlyPaid(getDb(), actor.id, input);
}
