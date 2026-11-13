import { formatCalendarDate } from "@/domain/order";
import {
  DEFAULT_ORDER_RETENTION_DAYS,
  MAX_ORDER_RETENTION_DAYS,
  MIN_ORDER_RETENTION_DAYS,
  type PurgeSelection,
  purgeSelection,
  type PurgeStop,
} from "@/domain/order-retention";
import { calendarDayIn } from "@/domain/settings";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_TIMEZONE } from "@/lib/format";

import type { Storage } from "./storage/types";

/**
 * Deleting settled orders (NUD-201): the customer does not want orders, tours and bills kept.
 * Everything that is paid is deleted for good once the period after the payment is over
 * (`ORDER_RETENTION_DAYS`, default 30). What is not paid stays, whatever its age. Customers,
 * products, settings, standing tours and standing orders are never touched.
 *
 * The run only counts unless `ORDER_RETENTION_MODE=delete` is set: a new deployment never starts
 * deleting by itself. See `docs/audit-and-retention.md`.
 */

export const ORDER_RETENTION_MODES = ["off", "dry-run", "delete"] as const;
export type OrderRetentionMode = (typeof ORDER_RETENTION_MODES)[number];

/** Orders looked at per transaction and the most batches per run (the rest follows the next day). */
export const ORDER_RETENTION_BATCH_SIZE = 200;
export const ORDER_RETENTION_MAX_BATCHES = 25;
/** How often a batch follows "this stop also carries that order" before it lets the rest wait. */
const MAX_LINK_ROUNDS = 5;
/**
 * Two runs at once (the cron and a call by hand) take their batches in turn instead of locking
 * each other's rows in different order. Held until the end of the transaction that took it.
 */
const takeTurn = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(2026111320100::bigint)`;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `ORDER_RETENTION_MODE`: `off` | `dry-run` | `delete`; anything else, also unset, is `dry-run`
 * (counts only, nothing is deleted). Same convention as `DATA_RETENTION_MODE`.
 */
export function orderRetentionMode(
  raw: string | undefined = process.env.ORDER_RETENTION_MODE,
): OrderRetentionMode {
  const value = raw?.trim().toLowerCase();
  return (ORDER_RETENTION_MODES as readonly string[]).includes(value ?? "")
    ? (value as OrderRetentionMode)
    : "dry-run";
}

/**
 * `ORDER_RETENTION_DAYS` as whole days (7..3650); 30 when it is not set. A value that is set but
 * unusable (`60d`, `4000`, `1.5`) gives `null` and the run refuses to start: unlike the other
 * retention jobs this one must not fall back to the default, because the default is the shortest
 * sensible period and a typo would delete earlier than intended, for good.
 */
export function orderRetentionDays(
  raw: string | undefined = process.env.ORDER_RETENTION_DAYS,
): number | null {
  const value = raw?.trim();
  if (!value) return DEFAULT_ORDER_RETENTION_DAYS;
  if (!/^\d+$/.test(value)) return null;
  const days = Number(value);
  if (days < MIN_ORDER_RETENTION_DAYS || days > MAX_ORDER_RETENTION_DAYS) return null;
  return days;
}

/**
 * For the pages: is deleting switched on, and after how many days. With an unusable period the
 * run refuses to delete, so the pages announce nothing.
 */
export function orderRetentionPolicy(env: Record<string, string | undefined> = process.env): {
  active: boolean;
  days: number;
} {
  const days = orderRetentionDays(env.ORDER_RETENTION_DAYS);
  return {
    active: days !== null && orderRetentionMode(env.ORDER_RETENTION_MODE) === "delete",
    days: days ?? DEFAULT_ORDER_RETENTION_DAYS,
  };
}

export type OrderRetentionReport = {
  mode: OrderRetentionMode;
  retentionDays: number;
  /** Paid before this moment = the period is over. */
  cutoff: string;
  /** Delivery days and tours before this day (`YYYY-MM-DD`, factory time zone) are old enough. */
  cutoffDay: string;
  /** Orders deleted (dry-run: orders that would be deleted). */
  orders: number;
  /** Stops deleted (dry-run: stops that would go with those orders). */
  stops: number;
  /** Tours deleted because no stop was left. Always 0 in dry-run. */
  tours: number;
  /** Monthly "paid" notes deleted. Always 0 in dry-run. */
  payments: number;
  /** Correction lines deleted with their month. Always 0 in dry-run. */
  adjustments: number;
  /** Screenshots (file and row) deleted because no order uses them any more. */
  screenshots: number;
  /** Screenshot files that could not be removed; the screenshot job (NUD-093) retries them. */
  screenshotsFailed: number;
  batches: number;
  /** The run stopped at its batch limit; the next run goes on. */
  more: boolean;
};

type Db = Pick<
  PrismaClient,
  "$transaction" | "$queryRaw" | "stop" | "tour" | "screenshot" | "settings"
>;
type Tx = Prisma.TransactionClient;

type Limits = { cutoffIso: string; cutoffDay: string; cutoffDate: Date };

/**
 * "This order is settled and its period is over" as a condition on `"Order" o`:
 * - the delivery day is old enough, and
 * - a draft or a cancelled order: nothing was ever to be paid;
 * - an order on the monthly bill: its month is marked paid (not taken back) long enough;
 * - a cash order: no delivery of it has money open or paid in part, and the money (or, with
 *   nothing to collect, the delivery) is old enough. A delivery without any recorded time never
 *   counts as old enough. A stop the driver never ticked off on a tour that was released keeps
 *   the order too while money is due there: nobody knows whether it was delivered and paid. Only
 *   an order that is on no such stop (no tour at all, a tour that never left the office, or a
 *   reported problem) was never delivered, and nothing is to pay.
 * The times are compared in UTC whatever the time zone of the database session is.
 */
function settledSql({ cutoffIso, cutoffDay }: Limits): Prisma.Sql {
  const cutoff = Prisma.sql`(${cutoffIso}::timestamptz AT TIME ZONE 'UTC')`;
  // Cash still owed at stop `s`: what its confirmed cash orders add up to (`cashDueCents`) is more
  // than what was collected (`cashState` open or short).
  const owed = Prisma.sql`(
              SELECT COALESCE(SUM(o2."amountCents"), 0)
              FROM "StopOrder" so2 JOIN "Order" o2 ON o2."id" = so2."orderId"
              WHERE so2."stopId" = s."id"
                AND o2."status" = 'CONFIRMED' AND o2."paymentTerm" = 'ON_DELIVERY'
            ) > COALESCE(s."collectedCents", 0)`;
  return Prisma.sql`
    o."deliveryDate" < ${cutoffDay}::date
    AND (
      o."status" IN ('DRAFT', 'CANCELLED')
      OR (o."status" = 'CONFIRMED' AND o."paymentTerm" = 'MONTHLY' AND EXISTS (
        SELECT 1 FROM "MonthlyPayment" p
        WHERE p."customerId" = o."customerId"
          AND p."periodStart" = date_trunc('month', o."deliveryDate")::date
          AND p."voidedAt" IS NULL
          AND p."paidAt" < ${cutoff}))
      OR (o."status" = 'CONFIRMED' AND o."paymentTerm" = 'ON_DELIVERY' AND NOT EXISTS (
        SELECT 1 FROM "StopOrder" so
          JOIN "Stop" s ON s."id" = so."stopId"
          JOIN "Tour" t ON t."id" = s."tourId"
        WHERE so."orderId" = o."id"
          AND (
            (s."status" = 'DELIVERED' AND (
              COALESCE(s."collectedAt", s."completedAt", 'infinity'::timestamp) >= ${cutoff}
              OR ${owed}))
            OR (s."status" = 'PENDING'
              AND t."status" IN ('RELEASED', 'IN_PROGRESS', 'COMPLETED')
              AND ${owed})
          )))
    )`;
}

async function settledAmong(tx: Tx, limits: Limits, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT o."id" FROM "Order" o
    WHERE o."id" IN (${Prisma.join(ids)}) AND ${settledSql(limits)}`;
  return rows.map((row) => row.id);
}

/** Every stop that carries one of the orders, with all of its orders. */
async function stopsOf(tx: Tx, limits: Limits, orderIds: readonly string[]): Promise<PurgeStop[]> {
  if (orderIds.length === 0) return [];
  const rows = await tx.stop.findMany({
    where: { orders: { some: { orderId: { in: [...orderIds] } } } },
    select: {
      id: true,
      tour: { select: { date: true } },
      orders: { select: { orderId: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    orderIds: row.orders.map((link) => link.orderId),
    expired: row.tour.date.getTime() < limits.cutoffDate.getTime(),
  }));
}

/**
 * What can go when these settled orders go. Orders that share a stop with them are looked at as
 * well (they may be settled too, just not in this batch): otherwise two settled orders on one
 * stop that fall into different batches would wait for each other forever.
 */
async function selectPurge(
  tx: Tx,
  limits: Limits,
  settledIds: readonly string[],
): Promise<PurgeSelection> {
  const settled = new Set(settledIds);
  const checked = new Set(settledIds);
  let stops = await stopsOf(tx, limits, [...settled]);
  for (let round = 0; round < MAX_LINK_ROUNDS; round += 1) {
    const linked = [...new Set(stops.flatMap((stop) => stop.orderIds))].filter(
      (id) => !checked.has(id),
    );
    if (linked.length === 0) break;
    for (const id of linked) checked.add(id);
    const more = await settledAmong(tx, limits, linked);
    if (more.length === 0) break;
    for (const id of more) settled.add(id);
    stops = await stopsOf(tx, limits, [...settled]);
  }
  // `stops` always belongs to exactly the orders in `settled`: an order whose links were not
  // followed to the end has a stop with an unknown order and therefore stays.
  return purgeSelection([...settled], stops);
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

type BatchResult = {
  /** Candidates read (0 = nothing left behind the cursor). */
  candidates: number;
  cursor: { day: string; id: string } | null;
  selection: PurgeSelection;
  screenshotIds: string[];
};

/**
 * One batch in one transaction: the next settled orders behind the cursor, what goes with them,
 * and (in `delete`) the deletion itself. Before anything is deleted the rows are locked and the
 * selection is made a second time: a month that was just marked unpaid again, or cash that was
 * just corrected, makes the batch step back instead of deleting something that is owed.
 */
async function runBatch(
  db: Db,
  limits: Limits,
  cursor: BatchResult["cursor"],
  batchSize: number,
  remove: boolean,
): Promise<BatchResult> {
  return db.$transaction(
    async (tx) => {
      await takeTurn(tx);
      const behindCursor = cursor
        ? Prisma.sql`AND (o."deliveryDate", o."id") > (${cursor.day}::date, ${cursor.id})`
        : Prisma.empty;
      const candidates = await tx.$queryRaw<{ id: string; deliveryDate: Date }[]>`
        SELECT o."id", o."deliveryDate" FROM "Order" o
        WHERE ${settledSql(limits)} ${behindCursor}
        ORDER BY o."deliveryDate" ASC, o."id" ASC
        LIMIT ${batchSize}`;
      const last = candidates.at(-1);
      const next = last ? { day: formatCalendarDate(last.deliveryDate), id: last.id } : cursor;
      const nothing: BatchResult = {
        candidates: candidates.length,
        cursor: next,
        selection: { orderIds: [], stopIds: [] },
        screenshotIds: [],
      };
      if (candidates.length === 0) return nothing;

      const selection = await selectPurge(
        tx,
        limits,
        candidates.map((row) => row.id),
      );
      if (!remove) return { ...nothing, selection };
      if (selection.orderIds.length === 0) return nothing;

      const orderIds = Prisma.join(selection.orderIds);
      if (selection.stopIds.length > 0) {
        await tx.$queryRaw`
          SELECT "id" FROM "Stop" WHERE "id" IN (${Prisma.join(selection.stopIds)}) FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" IN (${orderIds}) FOR UPDATE`;
      await tx.$queryRaw`
        SELECT p."id" FROM "MonthlyPayment" p
        WHERE EXISTS (
          SELECT 1 FROM "Order" o
          WHERE o."id" IN (${orderIds})
            AND o."customerId" = p."customerId"
            AND p."periodStart" = date_trunc('month', o."deliveryDate")::date)
        FOR UPDATE OF p`;
      const stillSettled = await settledAmong(tx, limits, selection.orderIds);
      const again = sameIds(stillSettled, selection.orderIds)
        ? await selectPurge(tx, limits, stillSettled)
        : null;
      if (
        !again ||
        !sameIds(again.orderIds, selection.orderIds) ||
        !sameIds(again.stopIds, selection.stopIds)
      ) {
        // Something changed under the batch. Nothing was deleted; the next run looks again.
        return nothing;
      }

      const withScreenshot = await tx.order.findMany({
        where: { id: { in: selection.orderIds }, screenshotId: { not: null } },
        select: { screenshotId: true },
      });
      // Stops first: the link from a stop to its orders does not let an order go before the stop.
      await tx.stop.deleteMany({ where: { id: { in: selection.stopIds } } });
      await tx.order.deleteMany({ where: { id: { in: selection.orderIds } } });
      return {
        ...nothing,
        selection,
        screenshotIds: [...new Set(withScreenshot.map((row) => row.screenshotId!))],
      };
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

/**
 * Screenshots no order uses any more: the file first, then the row (same order and reason as in
 * `screenshot-retention.ts`). A failure is counted and the row is left; the screenshot job
 * deletes it when its own period is over.
 */
async function purgeOrphanScreenshots(db: Db, storage: Storage, ids: readonly string[]) {
  let deleted = 0;
  let failed = 0;
  if (ids.length === 0) return { deleted, failed };
  const unused = await db.screenshot.findMany({
    where: { id: { in: [...ids] }, orders: { none: {} } },
    select: { id: true, storageKey: true },
  });
  for (const shot of unused) {
    try {
      await storage.delete(shot.storageKey);
      const { count } = await db.screenshot.deleteMany({
        where: { id: shot.id, orders: { none: {} } },
      });
      deleted += count;
    } catch (error) {
      failed += 1;
      console.error(
        `[order-retention] screenshot ${shot.id} not removed:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  return { deleted, failed };
}

/**
 * Monthly "paid" notes whose period is over and whose month has no order left on the bill, with
 * the correction lines of those months. A note stays while one order of its month has to wait
 * (it shares a stop with something unpaid): without the note that order would look unpaid again.
 * A month that is not over long enough keeps its note too, whatever is on it.
 */
async function purgePaidNotes(db: Db, limits: Limits) {
  return db.$transaction(async (tx) => {
    await takeTurn(tx);
    const notes = await tx.$queryRaw<{ customerId: string; periodStart: Date }[]>`
      DELETE FROM "MonthlyPayment" p
      WHERE p."voidedAt" IS NULL
        AND p."paidAt" < (${limits.cutoffIso}::timestamptz AT TIME ZONE 'UTC')
        AND (p."periodStart" + interval '1 month') <= ${limits.cutoffDay}::date
        AND NOT EXISTS (
          SELECT 1 FROM "Order" o
          WHERE o."customerId" = p."customerId"
            AND o."status" = 'CONFIRMED' AND o."paymentTerm" = 'MONTHLY'
            AND o."deliveryDate" >= p."periodStart"
            AND o."deliveryDate" < (p."periodStart" + interval '1 month'))
      RETURNING p."customerId", p."periodStart"`;
    let adjustments = 0;
    for (let i = 0; i < notes.length; i += 100) {
      const { count } = await tx.monthlyAdjustment.deleteMany({
        where: {
          OR: notes.slice(i, i + 100).map((note) => ({
            customerId: note.customerId,
            periodStart: note.periodStart,
          })),
        },
      });
      adjustments += count;
    }
    return { payments: notes.length, adjustments };
  });
}

/**
 * Deletes what is settled long enough (see the file comment and `settledSql`). An order and the
 * stops it was delivered with always go together (`purgeSelection`); a tour goes when its last
 * stop went. Idempotent, batched, and `dry-run` (the default) only counts orders and stops.
 *
 * The change log (`AuditLog`) is not touched: its entries have their own period (NUD-111). The
 * run itself writes no audit entry (no user action, no actor).
 */
export async function purgeSettledOrders(deps: {
  db: Db;
  storage: Storage;
  now?: Date;
  /** IANA zone of the factory; read from the settings when left out. */
  timezone?: string;
  mode?: OrderRetentionMode;
  /** `null` = configured but unusable: the run refuses. */
  retentionDays?: number | null;
  batchSize?: number;
  maxBatches?: number;
}): Promise<OrderRetentionReport> {
  const { db, storage } = deps;
  const mode = deps.mode ?? orderRetentionMode();
  const retentionDays =
    deps.retentionDays === undefined ? orderRetentionDays() : deps.retentionDays;
  if (retentionDays === null) {
    throw new Error(
      `ORDER_RETENTION_DAYS is not a whole number of days from ${MIN_ORDER_RETENTION_DAYS} to ${MAX_ORDER_RETENTION_DAYS}; nothing was deleted`,
    );
  }
  if (!Number.isInteger(retentionDays) || retentionDays < MIN_ORDER_RETENTION_DAYS) {
    throw new Error(`order retention below ${MIN_ORDER_RETENTION_DAYS} days refused`);
  }
  const batchSize = deps.batchSize ?? ORDER_RETENTION_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? ORDER_RETENTION_MAX_BATCHES;
  const now = deps.now ?? new Date();
  const timezone =
    deps.timezone ??
    (await db.settings.findFirst({ select: { timezone: true } }))?.timezone ??
    DEFAULT_TIMEZONE;
  const today = calendarDayIn(now, timezone);
  const cutoffDate = new Date(Date.UTC(today.y, today.m - 1, today.d) - retentionDays * DAY_MS);
  const limits: Limits = {
    cutoffIso: new Date(now.getTime() - retentionDays * DAY_MS).toISOString(),
    cutoffDay: formatCalendarDate(cutoffDate),
    cutoffDate,
  };
  const report: OrderRetentionReport = {
    mode,
    retentionDays,
    cutoff: limits.cutoffIso,
    cutoffDay: limits.cutoffDay,
    orders: 0,
    stops: 0,
    tours: 0,
    payments: 0,
    adjustments: 0,
    screenshots: 0,
    screenshotsFailed: 0,
    batches: 0,
    more: false,
  };
  if (mode === "off") return report;

  const remove = mode === "delete";
  // Dry-run deletes nothing, so an order that goes with an earlier batch shows up again as a
  // candidate of its own: count every id once.
  const orders = new Set<string>();
  const stops = new Set<string>();
  let cursor: BatchResult["cursor"] = null;
  while (report.batches < maxBatches) {
    const batch = await runBatch(db, limits, cursor, batchSize, remove);
    if (batch.candidates === 0) break;
    cursor = batch.cursor;
    report.batches += 1;
    for (const id of batch.selection.orderIds) orders.add(id);
    for (const id of batch.selection.stopIds) stops.add(id);
    if (remove) {
      const shots = await purgeOrphanScreenshots(db, storage, batch.screenshotIds);
      report.screenshots += shots.deleted;
      report.screenshotsFailed += shots.failed;
    }
    if (batch.candidates < batchSize) break;
    if (report.batches === maxBatches) report.more = true;
  }
  report.orders = orders.size;
  report.stops = stops.size;
  if (!remove) return report;

  // Old stops that carry no order at all, then old tours without a stop.
  const emptyStops = await db.stop.deleteMany({
    where: { orders: { none: {} }, tour: { date: { lt: cutoffDate } } },
  });
  report.stops += emptyStops.count;
  report.tours = (
    await db.tour.deleteMany({ where: { date: { lt: cutoffDate }, stops: { none: {} } } })
  ).count;
  const notes = await purgePaidNotes(db, limits);
  report.payments = notes.payments;
  report.adjustments = notes.adjustments;
  return report;
}
