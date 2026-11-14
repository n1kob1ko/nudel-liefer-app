"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import {
  type AddAdjustmentResult,
  addMonthlyAdjustment,
  type RemoveAdjustmentResult,
  removeMonthlyAdjustment,
} from "./monthly-adjustments";
import { todayIn } from "./orders";
import {
  markMonthlyPaid,
  type MonthlyMarkResult,
  type MonthlyUnmarkResult,
  unmarkMonthlyPaid,
} from "./payments";
import { getFactoryTimezone } from "./settings";
import { applyOfficeCashReceipt, type OfficeCashResult } from "./stop-payment";

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

/** Adds a correction line (discount, credit note, surcharge) to a customer-month (NUD-197). */
export async function addMonthlyAdjustmentAction(input: unknown): Promise<AddAdjustmentResult> {
  const actor = await requireRole("ADMIN");
  return addMonthlyAdjustment(getDb(), actor.id, input);
}

/** Takes a correction line off the bill; the row and the audit history stay (NUD-197). */
export async function removeMonthlyAdjustmentAction(
  input: unknown,
): Promise<RemoveAdjustmentResult> {
  const actor = await requireRole("ADMIN");
  return removeMonthlyAdjustment(getDb(), actor.id, input);
}

/** The office records cash it received for a delivered stop (NUD-209), audited like the driver's. */
export async function recordOfficeCashAction(input: unknown): Promise<OfficeCashResult> {
  const actor = await requireRole("ADMIN");
  return applyOfficeCashReceipt(getDb(), actor, input);
}
