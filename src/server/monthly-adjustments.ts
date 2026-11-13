import { z } from "zod";

import { parseAmountToCents } from "@/domain/money";
import { formatCalendarDate } from "@/domain/order";
import {
  ADJUSTMENT_KINDS,
  MAX_ADJUSTMENT_LABEL,
  nextMonthStart,
  parseMonthKey,
  signedAdjustmentCents,
} from "@/domain/payment";

import { recordAudit } from "./audit";
import { idSchema, lockCustomerBilling, type PaymentsDb } from "./payments";

/**
 * Correction lines on a customer's monthly bill (NUD-197): a discount or credit note the office
 * grants, or an extra charge. One line is a short text and a fixed euro amount; it counts into the
 * month's total next to the orders (`monthlyBillQuery`, `monthlyOverviewQuery`, `markMonthlyPaid`).
 *
 * Two rules keep a paid month honest: while a "paid" note exists the lines are frozen (the note is
 * a snapshot of the total), and a removed line stays in the table with `voidedAt`. The audit entry
 * holds ids and the amount, never the typed text.
 */

export type AdjustmentError = "invalid" | "not_found" | "locked" | "no_orders";

export type AddAdjustmentResult =
  { ok: true; id: string; amountCents: number } | { ok: false; error: AdjustmentError };

export type RemoveAdjustmentResult = { ok: true } | { ok: false; error: AdjustmentError };

const addSchema = z
  .object({
    customerId: idSchema,
    /** `YYYY-MM` of the billed month. */
    month: z
      .string()
      .trim()
      .max(7)
      .refine((value) => parseMonthKey(value) !== null),
    kind: z.enum(ADJUSTMENT_KINDS),
    label: z.string().trim().min(1).max(MAX_ADJUSTMENT_LABEL),
    /** What the office typed, e.g. `10` or `10,50`; always positive, the kind carries the sign. */
    amount: z.string().trim().max(16),
  })
  .strict();

const removeSchema = z.object({ adjustmentId: idSchema }).strict();

async function isMonthPaid(
  tx: Pick<PaymentsDb, "monthlyPayment">,
  customerId: string,
  periodStart: Date,
): Promise<boolean> {
  const payment = await tx.monthlyPayment.findUnique({
    where: { customerId_periodStart: { customerId, periodStart } },
    select: { voidedAt: true },
  });
  return payment !== null && payment.voidedAt === null;
}

/**
 * Adds one correction to a customer-month. Refused while the month is marked paid (`locked`) and
 * for a month without orders on monthly bill (`no_orders`).
 */
export async function addMonthlyAdjustment(
  db: PaymentsDb,
  actorId: string,
  rawInput: unknown,
): Promise<AddAdjustmentResult> {
  const parsed = addSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  const period = parseMonthKey(input.month);
  const cents = parseAmountToCents(input.amount);
  // An amount of 0 corrects nothing; it would only be a confusing line on the bill.
  if (!period || cents === null || cents === 0) return { ok: false, error: "invalid" };
  const amountCents = signedAdjustmentCents(input.kind, cents);

  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true },
  });
  if (!customer) return { ok: false, error: "not_found" };

  return db.$transaction(async (tx): Promise<AddAdjustmentResult> => {
    await lockCustomerBilling(tx, customer.id);
    if (await isMonthPaid(tx, customer.id, period)) return { ok: false, error: "locked" };
    // A month without orders on monthly bill has no bill: it is never listed as open and cannot
    // be marked paid, so a correction on it would be money nobody sees again.
    const orders = await tx.order.count({
      where: {
        customerId: customer.id,
        status: "CONFIRMED",
        paymentTerm: "MONTHLY",
        deliveryDate: { gte: period, lt: nextMonthStart(period) },
      },
    });
    if (orders === 0) return { ok: false, error: "no_orders" };
    const created = await tx.monthlyAdjustment.create({
      data: {
        customerId: customer.id,
        periodStart: period,
        label: input.label,
        amountCents,
        createdById: actorId,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Customer",
      entityId: customer.id,
      action: "monthly.adjust",
      diff: {
        periodStart: formatCalendarDate(period),
        adjustmentId: created.id,
        amountCents,
      },
    });
    return { ok: true, id: created.id, amountCents };
  });
}

/** Takes one correction off the bill (the row stays with `voidedAt`). Refused while paid. */
export async function removeMonthlyAdjustment(
  db: PaymentsDb,
  actorId: string,
  rawInput: unknown,
): Promise<RemoveAdjustmentResult> {
  const parsed = removeSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const found = await db.monthlyAdjustment.findUnique({
    where: { id: parsed.data.adjustmentId },
    select: { id: true, customerId: true, periodStart: true },
  });
  if (!found) return { ok: false, error: "not_found" };

  return db.$transaction(async (tx): Promise<RemoveAdjustmentResult> => {
    await lockCustomerBilling(tx, found.customerId);
    if (await isMonthPaid(tx, found.customerId, found.periodStart)) {
      return { ok: false, error: "locked" };
    }
    // `voidedAt: null` in the filter: two people removing the same line leave one audit entry.
    const removed = await tx.monthlyAdjustment.updateManyAndReturn({
      where: { id: found.id, voidedAt: null },
      data: { voidedAt: new Date(), voidedById: actorId },
      select: { amountCents: true },
    });
    const row = removed[0];
    if (!row) return { ok: false, error: "not_found" };
    await recordAudit(tx, {
      actorId,
      entity: "Customer",
      entityId: found.customerId,
      action: "monthly.adjust_remove",
      diff: {
        periodStart: formatCalendarDate(found.periodStart),
        adjustmentId: found.id,
        amountCents: row.amountCents,
      },
    });
    return { ok: true };
  });
}
