import { z } from "zod";

import { formatCalendarDate, parseCalendarDate } from "@/domain/order";
import {
  billTotalCents,
  cashDueCents,
  type CashState,
  cashState,
  isClosedMonth,
  monthKey,
  type MonthlyState,
  monthlyState,
  monthStart,
  nextMonthStart,
  parseMonthKey,
} from "@/domain/payment";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";

/**
 * Payments for the office (D33, NUD-196). Two questions:
 * - **Cash**: which cash deliveries still have money open (the driver collected nothing, or less
 *   than the order says)?
 * - **Monthly bill**: which customer-months are over, have orders and are not marked paid — and
 *   what exactly is on one month's bill.
 *
 * There are no catalog prices (D33): the amount of an order is what the office typed. An order
 * without an amount therefore contributes 0 to a bill and is counted separately, so a bill can
 * never look complete while orders on it have no amount.
 */

export type PaymentsDb = Pick<
  PrismaClient,
  | "stop"
  | "order"
  | "customer"
  | "monthlyPayment"
  | "monthlyAdjustment"
  | "auditLog"
  | "user"
  | "$queryRaw"
  | "$transaction"
>;

export const idSchema = z.string().trim().min(1).max(64);
const MAX_NOTE = 200;

/**
 * Serialises everything that changes what one customer's monthly bills add up to (NUD-197): marking
 * a month paid and adding or removing a correction take this row lock first, inside their
 * transaction. Without it a correction could slip in between reading the total and writing the
 * "paid" snapshot, and the snapshot would be wrong from its first second.
 *
 * `FOR NO KEY UPDATE`: the callers exclude each other, but creating an order or a stop for the
 * same customer (which only needs the customer row to stay) is not held up.
 */
export async function lockCustomerBilling(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  customerId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Customer" WHERE "id" = ${customerId} FOR NO KEY UPDATE`;
}

/**
 * The orders a monthly bill is made of (D33): CONFIRMED, on monthly bill — and delivered or still to
 * be delivered. An order whose stop ended as a problem ("Geschlossen", "Kein Parkplatz", ...) and
 * that no other stop delivered never reached the customer, so it is not billed (owner 2026-11-13,
 * NUD-209; before, such an order stood on the bill with its amount). One filter for the open months,
 * the month page, the "paid" snapshot, corrections and the export, so they always agree.
 */
export const BILLED_MONTHLY_ORDER = {
  status: "CONFIRMED",
  paymentTerm: "MONTHLY",
  NOT: {
    AND: [
      { stopOrders: { some: { stop: { status: "PROBLEM" } } } },
      { stopOrders: { none: { stop: { status: "DELIVERED" } } } },
    ],
  },
} as const satisfies Prisma.OrderWhereInput;

// ---------------------------------------------------------------------------------------------
// Cash at the stops

export type CashRow = {
  stopId: string;
  tourId: string;
  /** `YYYY-MM-DD` of the tour. */
  date: string;
  tourStatus: string;
  customerId: string;
  customerNumber: string;
  customerName: string;
  driverName: string | null;
  /** Cash to collect at this stop (euro cents). */
  dueCents: number;
  collectedCents: number | null;
  /** `open` (nothing recorded) or `short` (less than due). */
  state: Extract<CashState, "open" | "short">;
  overCents: number;
};

/**
 * Cash deliveries with money still open, newest first. Only stops of a released / running /
 * completed tour count: that is when the goods really changed hands. `over` collections are not
 * listed as open — the money is there (they are shown in the month page and the audit history).
 */
export async function openCashQuery(
  db: Pick<PaymentsDb, "stop">,
  today: Date,
  limit = 100,
): Promise<CashRow[]> {
  const stops = await db.stop.findMany({
    where: {
      status: "DELIVERED",
      tour: { status: { in: ["RELEASED", "IN_PROGRESS", "COMPLETED"] } },
      orders: {
        some: {
          order: { status: "CONFIRMED", paymentTerm: "ON_DELIVERY" },
        },
      },
    },
    orderBy: [{ tour: { date: "desc" } }, { sequence: "asc" }],
    take: 500,
    select: {
      id: true,
      status: true,
      collectedCents: true,
      customer: { select: { id: true, customerNumber: true, name: true } },
      tour: {
        select: {
          id: true,
          date: true,
          status: true,
          driver: { select: { displayName: true } },
        },
      },
      orders: {
        select: { order: { select: { status: true, paymentTerm: true, amountCents: true } } },
      },
    },
  });

  const rows: CashRow[] = [];
  for (const stop of stops) {
    const dueCents = cashDueCents(
      stop.orders
        .map((link) => link.order)
        .filter((order) => order.status === "CONFIRMED")
        .map((order) => ({ paymentTerm: order.paymentTerm, amountCents: order.amountCents })),
    );
    const state = cashState(dueCents, stop.collectedCents);
    const collected = stop.collectedCents;
    // A cash stop without an amount anywhere is not "open money" — nothing is known about it.
    if (dueCents <= 0) continue;
    const waiting = state === "open" || state === "short";
    if (!waiting) continue;
    rows.push({
      stopId: stop.id,
      tourId: stop.tour.id,
      date: formatCalendarDate(stop.tour.date),
      tourStatus: stop.tour.status,
      customerId: stop.customer.id,
      customerNumber: stop.customer.customerNumber,
      customerName: stop.customer.name,
      driverName: stop.tour.driver?.displayName ?? null,
      dueCents,
      collectedCents: collected,
      state,
      overCents: 0,
    });
    if (rows.length >= limit) break;
  }
  // Future deliveries (tomorrow's cash) are not open yet; today and earlier are.
  const cutoff = formatCalendarDate(today);
  return rows.filter((row) => row.date <= cutoff);
}

// ---------------------------------------------------------------------------------------------
// Monthly bills

export type MonthlyOpenRow = {
  customerId: string;
  customerNumber: string;
  customerName: string;
  /** First day of the month, `YYYY-MM-DD`. */
  periodStart: string;
  monthKey: string;
  amountCents: number;
  orderCount: number;
  /** Orders of that month without an amount — the bill is probably incomplete. */
  noAmountCount: number;
  state: MonthlyState;
};

type MonthlyAggregate = {
  customerId: string;
  period: Date;
  amount: number;
  orderCount: number;
  noAmount: number;
};

/**
 * Customer-months before the current one that have CONFIRMED monthly orders: open, or paid when a
 * paid note exists. Newest month first, then customer name. Aggregated in the database (one row per
 * customer and month), so the page stays cheap with a year of orders.
 */
export async function monthlyOverviewQuery(
  db: PaymentsDb,
  today: Date,
  limit = 200,
): Promise<MonthlyOpenRow[]> {
  const currentMonth = monthStart(today);
  const aggregates = await db.$queryRaw<MonthlyAggregate[]>`
    SELECT o."customerId" AS "customerId",
           date_trunc('month', o."deliveryDate")::date AS "period",
           SUM(COALESCE(o."amountCents", 0))::int AS "amount",
           COUNT(*)::int AS "orderCount",
           COUNT(*) FILTER (WHERE o."amountCents" IS NULL)::int AS "noAmount"
    FROM "Order" o
    WHERE o."status" = 'CONFIRMED'
      AND o."paymentTerm" = 'MONTHLY'
      AND o."deliveryDate" < ${currentMonth}
      -- BILLED_MONTHLY_ORDER: not an order that only a problem stop carried (not delivered).
      AND NOT (
        EXISTS (SELECT 1 FROM "StopOrder" so JOIN "Stop" s ON s."id" = so."stopId"
                WHERE so."orderId" = o."id" AND s."status" = 'PROBLEM')
        AND NOT EXISTS (SELECT 1 FROM "StopOrder" so JOIN "Stop" s ON s."id" = so."stopId"
                        WHERE so."orderId" = o."id" AND s."status" = 'DELIVERED')
      )
    GROUP BY 1, 2
    ORDER BY 2 DESC, 1
  `;
  if (aggregates.length === 0) return [];

  const customerIds = [...new Set(aggregates.map((row) => row.customerId))];
  const [customers, paidRows, adjustmentRows] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, customerNumber: true, name: true },
    }),
    db.monthlyPayment.findMany({
      where: { customerId: { in: customerIds }, voidedAt: null },
      select: { customerId: true, periodStart: true },
    }),
    // Corrections (NUD-197) count into the month's total exactly like on the month page.
    db.monthlyAdjustment.groupBy({
      by: ["customerId", "periodStart"],
      where: { customerId: { in: customerIds }, voidedAt: null, periodStart: { lt: currentMonth } },
      _sum: { amountCents: true },
    }),
  ]);
  const adjusted = new Map(
    adjustmentRows.map((row) => [
      `${row.customerId}:${formatCalendarDate(row.periodStart)}`,
      row._sum.amountCents ?? 0,
    ]),
  );
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const paid = new Set(
    paidRows.map((row) => `${row.customerId}:${formatCalendarDate(row.periodStart)}`),
  );

  return aggregates
    .flatMap((row) => {
      const customer = customerById.get(row.customerId);
      const period = new Date(`${formatCalendarDate(row.period)}T00:00:00Z`);
      if (!customer || !isClosedMonth(period, today)) return [];
      const paidHere = paid.has(`${row.customerId}:${formatCalendarDate(period)}`);
      return [
        {
          customerId: customer.id,
          customerNumber: customer.customerNumber,
          customerName: customer.name,
          periodStart: formatCalendarDate(period),
          monthKey: monthKey(period),
          amountCents:
            row.amount + (adjusted.get(`${row.customerId}:${formatCalendarDate(period)}`) ?? 0),
          orderCount: row.orderCount,
          noAmountCount: row.noAmount,
          state: monthlyState({
            periodStart: period,
            today,
            paid: paidHere,
            orderCount: row.orderCount,
          }),
        } satisfies MonthlyOpenRow,
      ];
    })
    .slice(0, limit);
}

export type MonthlyBillOrder = {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  status: string;
  amountCents: number | null;
  paymentTerm: string;
  itemCount: number;
  items: Array<{ productName: unknown; sku: string; unit: string; quantity: number }>;
};

export type MonthlyBillAdjustment = {
  id: string;
  label: string;
  /** Signed euro cents: negative = deduction, positive = surcharge. */
  amountCents: number;
};

export type MonthlyBill = {
  customer: {
    id: string;
    customerNumber: string;
    name: string;
    street: string;
    postalCode: string;
    city: string;
    /** Legal entity, VAT id and billing address, when the office filled them in (NUD-198). */
    companyName: string | null;
    vatId: string | null;
    billingStreet: string | null;
    billingPostalCode: string | null;
    billingCity: string | null;
  };
  /** `YYYY-MM-DD` of the first day. */
  periodStart: string;
  monthKey: string;
  closed: boolean;
  orders: MonthlyBillOrder[];
  /** Corrections of the month (NUD-197), oldest first; removed ones are not listed. */
  adjustments: MonthlyBillAdjustment[];
  /** Sum of the orders alone, before corrections. */
  ordersTotalCents: number;
  /** What the month costs: orders plus corrections. */
  totalCents: number;
  noAmountCount: number;
  state: MonthlyState;
  payment: {
    amountCents: number;
    orderCount: number;
    paidAt: string;
    paidByName: string | null;
    note: string | null;
  } | null;
};

/**
 * One customer's accumulated bill of one month: every CONFIRMED monthly order of that month with
 * its amount, the corrections of the month (NUD-197), the total of both and the paid note if there
 * is one.
 */
export async function monthlyBillQuery(
  db: PaymentsDb,
  rawCustomerId: unknown,
  rawMonth: unknown,
  today: Date,
): Promise<MonthlyBill | null> {
  const customerId = idSchema.safeParse(rawCustomerId);
  const period = typeof rawMonth === "string" ? parseMonthKey(rawMonth) : null;
  if (!customerId.success || !period) return null;
  const customer = await db.customer.findUnique({
    where: { id: customerId.data },
    select: {
      id: true,
      customerNumber: true,
      name: true,
      street: true,
      postalCode: true,
      city: true,
      companyName: true,
      vatId: true,
      billingStreet: true,
      billingPostalCode: true,
      billingCity: true,
    },
  });
  if (!customer) return null;

  const [orders, payment, adjustments] = await Promise.all([
    db.order.findMany({
      where: {
        customerId: customer.id,
        ...BILLED_MONTHLY_ORDER,
        deliveryDate: { gte: period, lt: nextMonthStart(period) },
      },
      orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        deliveryDate: true,
        status: true,
        amountCents: true,
        paymentTerm: true,
        items: {
          select: {
            quantity: true,
            product: { select: { name: true, sku: true, unit: true } },
          },
          orderBy: { id: "asc" },
        },
      },
    }),
    db.monthlyPayment.findUnique({
      where: { customerId_periodStart: { customerId: customer.id, periodStart: period } },
      select: {
        amountCents: true,
        orderCount: true,
        paidAt: true,
        note: true,
        voidedAt: true,
        paidBy: { select: { displayName: true } },
      },
    }),
    db.monthlyAdjustment.findMany({
      where: { customerId: customer.id, periodStart: period, voidedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, label: true, amountCents: true },
    }),
  ]);

  const paid = payment !== null && payment.voidedAt === null;
  const orderAmounts = orders.map((order) => order.amountCents);
  return {
    customer,
    periodStart: formatCalendarDate(period),
    monthKey: monthKey(period),
    closed: isClosedMonth(period, today),
    orders: orders.map((order) => ({
      id: order.id,
      date: formatCalendarDate(order.deliveryDate),
      status: order.status,
      amountCents: order.amountCents,
      paymentTerm: order.paymentTerm,
      itemCount: order.items.length,
      items: order.items.map((item) => ({
        productName: item.product.name,
        sku: item.product.sku,
        unit: item.product.unit,
        quantity: item.quantity,
      })),
    })),
    adjustments,
    ordersTotalCents: billTotalCents(orderAmounts, []),
    totalCents: billTotalCents(
      orderAmounts,
      adjustments.map((adjustment) => adjustment.amountCents),
    ),
    noAmountCount: orders.filter((order) => order.amountCents === null).length,
    state: monthlyState({
      periodStart: period,
      today,
      paid,
      orderCount: orders.length,
    }),
    payment:
      paid && payment
        ? {
            amountCents: payment.amountCents,
            orderCount: payment.orderCount,
            paidAt: payment.paidAt.toISOString(),
            paidByName: payment.paidBy?.displayName ?? null,
            note: payment.note,
          }
        : null,
  };
}

export const monthInputSchema = z
  .object({
    customerId: idSchema,
    /** `YYYY-MM` of the billed month. */
    month: z
      .string()
      .trim()
      .max(7)
      .refine((value) => parseMonthKey(value) !== null),
    note: z
      .string()
      .trim()
      .max(MAX_NOTE)
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .strict();

export type MonthlyMarkError = "invalid" | "not_found" | "nothing_to_pay" | "conflict";

export type MonthlyMarkResult =
  | { ok: true; customerId: string; month: string; amountCents: number; orderCount: number }
  | { ok: false; error: MonthlyMarkError };

/**
 * Marks one customer-month as paid. The amount (orders plus corrections, NUD-197) and the number of
 * orders are a snapshot: orders can still be edited afterwards, and the note says what was paid, not
 * what is there today. Marking an already paid month again updates the note and clears a previous
 * "unpaid" (the row stays).
 */
export async function markMonthlyPaid(
  db: PaymentsDb,
  actorId: string,
  rawInput: unknown,
  today: Date,
): Promise<MonthlyMarkResult> {
  const parsed = monthInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  const period = parseMonthKey(input.month);
  if (!period) return { ok: false, error: "invalid" };
  if (!isClosedMonth(period, today)) return { ok: false, error: "nothing_to_pay" };

  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true },
  });
  if (!customer) return { ok: false, error: "not_found" };

  return db.$transaction(async (tx): Promise<MonthlyMarkResult> => {
    await lockCustomerBilling(tx, customer.id);
    // Read after the lock: the snapshot is the orders and corrections as they stand right now.
    const orders = await tx.order.findMany({
      where: {
        customerId: customer.id,
        ...BILLED_MONTHLY_ORDER,
        deliveryDate: { gte: period, lt: nextMonthStart(period) },
      },
      select: { amountCents: true },
    });
    if (orders.length === 0) return { ok: false, error: "nothing_to_pay" };
    const adjustments = await tx.monthlyAdjustment.findMany({
      where: { customerId: customer.id, periodStart: period, voidedAt: null },
      select: { amountCents: true },
    });
    const amountCents = billTotalCents(
      orders.map((order) => order.amountCents),
      adjustments.map((adjustment) => adjustment.amountCents),
    );
    const existing = await tx.monthlyPayment.findUnique({
      where: { customerId_periodStart: { customerId: customer.id, periodStart: period } },
      select: { paidAt: true, amountCents: true, voidedAt: true },
    });
    await tx.monthlyPayment.upsert({
      where: { customerId_periodStart: { customerId: customer.id, periodStart: period } },
      create: {
        customerId: customer.id,
        periodStart: period,
        amountCents,
        orderCount: orders.length,
        note: input.note,
        paidById: actorId,
      },
      update: {
        amountCents,
        orderCount: orders.length,
        note: input.note,
        paidAt: new Date(),
        paidById: actorId,
        voidedAt: null,
        voidedById: null,
      },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Customer",
      entityId: customer.id,
      action: "monthly.pay",
      diff: {
        periodStart: formatCalendarDate(period),
        amountCents,
        orderCount: orders.length,
        before: existing
          ? { amountCents: existing.amountCents, paidAt: existing.paidAt.toISOString() }
          : null,
        note: input.note,
      },
    });
    return {
      ok: true,
      customerId: customer.id,
      month: input.month,
      amountCents,
      orderCount: orders.length,
    };
  });
}

export type MonthlyUnmarkResult =
  { ok: true; customerId: string; month: string } | { ok: false; error: "invalid" | "not_found" };

/** Takes the "paid" note back (the row stays with `voidedAt`, the audit log keeps the change). */
export async function unmarkMonthlyPaid(
  db: PaymentsDb,
  actorId: string,
  rawInput: unknown,
): Promise<MonthlyUnmarkResult> {
  const parsed = monthInputSchema.safeParse({ ...(rawInput as object), note: null });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const period = parseMonthKey(parsed.data.month);
  if (!period) return { ok: false, error: "invalid" };
  const existing = await db.monthlyPayment.findUnique({
    where: {
      customerId_periodStart: { customerId: parsed.data.customerId, periodStart: period },
    },
    select: { amountCents: true, orderCount: true, voidedAt: true },
  });
  if (!existing || existing.voidedAt !== null) return { ok: false, error: "not_found" };

  await db.$transaction(async (tx) => {
    await tx.monthlyPayment.update({
      where: {
        customerId_periodStart: { customerId: parsed.data.customerId, periodStart: period },
      },
      data: { voidedAt: new Date(), voidedById: actorId },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Customer",
      entityId: parsed.data.customerId,
      action: "monthly.unpay",
      diff: {
        periodStart: formatCalendarDate(period),
        amountCents: existing.amountCents,
        orderCount: existing.orderCount,
      },
    });
  });
  return { ok: true, customerId: parsed.data.customerId, month: parsed.data.month };
}

/** A `YYYY-MM-DD` day from a search parameter, or `null`. */
export function parseDay(value: unknown): Date | null {
  return typeof value === "string" ? parseCalendarDate(value.trim()) : null;
}
