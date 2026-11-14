import { z } from "zod";

import { diffOrderUpdate, type LineChange, toAuditQuantity } from "@/domain/audit";
import { formatTimeOfDay, type OrderWindow, parseTimeOfDay } from "@/domain/delivery-window";
import { amountInputValue } from "@/domain/money";
import {
  formatCalendarDate,
  isPastDeliveryDate,
  orderInputSchema,
  parseCalendarDate,
} from "@/domain/order";
import { aggregateTotalsByDate, isOrderEditable, type OrderFilters } from "@/domain/order-overview";
import { calendarDayIn } from "@/domain/settings";
import { type OrderState, outdatedTourTargets } from "@/domain/tour-diff";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { isScreenshotKey, MAX_UPLOAD_BYTES } from "@/lib/uploads";

import { recordAudit } from "./audit";
import { type PlannedDayWarning, resolvePlannedDay } from "./planned-day";
import type { Storage } from "./storage/types";
import type { TourDb, TourService } from "./tour-service";

/** What the order mutations need from the tour side (see `tour-service.ts`). */
export type TourHook = Pick<TourService, "markOutdatedForDate">;

type OrderDb = Pick<
  PrismaClient,
  | "order"
  | "customer"
  | "product"
  | "screenshot"
  | "auditLog"
  | "settings"
  | "vehicle"
  | "$transaction"
>;

/** Window as one comparable text for the audit log: `2026-11-03..2026-11-05 08:00-11:00`. */
export function windowText(w: {
  from: Date;
  to: Date;
  fromTime: string | null;
  toTime: string | null;
}): string {
  const days = `${formatCalendarDate(w.from)}..${formatCalendarDate(w.to)}`;
  if (!w.fromTime && !w.toTime) return days;
  const t = (v: string | null) =>
    v && parseTimeOfDay(v) !== null ? formatTimeOfDay(parseTimeOfDay(v)!) : "";
  return `${days} ${t(w.fromTime)}-${t(w.toTime)}`;
}

/** Non-blocking hints the order form shows after saving (NUD-148). */
export type OrderPlanWarning = Exclude<PlannedDayWarning, "ok">;

/** Maps the loaded stop link to OrderTourLink; null when the order is on no stop. */
function tourLink(
  stopOrders: ReadonlyArray<{
    stop: {
      id: string;
      tourId: string;
      status: string;
      completedAt: Date | null;
      tour: { id: string; date: Date; status: string };
    };
  }>,
): OrderTourLink | null {
  const stop = stopOrders[0]?.stop;
  if (!stop) return null;
  return {
    tourId: stop.tour.id,
    stopId: stop.id,
    date: formatCalendarDate(stop.tour.date),
    tourStatus: stop.tour.status as OrderTourLink["tourStatus"],
    stopStatus: stop.status as OrderTourLink["stopStatus"],
    completedAt: stop.completedAt?.toISOString() ?? null,
  };
}

function rowWindow(row: {
  windowFrom: Date;
  windowTo: Date;
  windowFromTime: string | null;
  windowToTime: string | null;
}): OrderWindow {
  return {
    from: row.windowFrom,
    to: row.windowTo,
    fromTime: row.windowFromTime,
    toTime: row.windowToTime,
  };
}

/**
 * Flags the tours of every delivery day that a change from `before` to `after` affects, through
 * the transaction client of the order write (so both succeed or both fail). Draft edits and saves
 * that change nothing a tour contains flag nothing.
 */
async function flagAffectedTours(
  tours: TourHook,
  tx: TourDb,
  before: OrderState | null,
  after: OrderState | null,
): Promise<void> {
  for (const { date, customerIds } of outdatedTourTargets(before, after)) {
    await tours.markOutdatedForDate(date, tx, { customerIds });
  }
}

export type OrderSaveResult =
  | {
      ok: true;
      id: string;
      status: "CONFIRMED" | "DRAFT";
      /** The planned day (`YYYY-MM-DD`) and why it may not be ideal (NUD-148). */
      plannedDate: string;
      warnings: OrderPlanWarning[];
    }
  | {
      ok: false;
      error:
        | "invalid"
        | "date_in_past"
        | "customer_not_found"
        | "customer_inactive"
        | "product_not_found"
        | "product_inactive"
        | "screenshot_missing"
        | "screenshot_in_use";
    };

const idSchema = z.string().trim().min(1).max(64);

/** States in which a photo of the order inbox (NUD-210) still waits for the office. */
const OPEN_INBOX_STATUSES = ["NEW", "READING", "READY", "FAILED"] as const;

function isOpenInboxStatus(status: string | null): boolean {
  return (OPEN_INBOX_STATUSES as readonly string[]).includes(status ?? "");
}

/** The factory-time-zone calendar day of `now` as a `DATE` value (UTC midnight). */
export function todayIn(timezone: string, now: Date = new Date()): Date {
  const { y, m, d } = calendarDayIn(now, timezone);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Creates an order (status CONFIRMED or DRAFT) with its items in one statement. Source is MANUAL,
 * or SCREENSHOT when a screenshot is attached (NUD-031): the key must be one the upload endpoint
 * issues (`screenshots/<uuid>.<ext>`), the object must really exist in storage and the key may be
 * attached only once; then a `Screenshot` row is created together with the order. A photo that waits
 * in the order inbox (NUD-210) already has its row: it is attached and marked done instead. The caller checked the role. Validation is repeated here because the client is
 * never trusted: quantities > 0, at least one line, same product merged, customer and products
 * must exist and be active (archived customers / inactive products are not accepted), and the
 * delivery day must not lie in the past. Afterwards the tours of that day are flagged outdated.
 */
export async function createOrder(
  db: OrderDb,
  actorId: string,
  rawInput: unknown,
  today: Date,
  storage: Pick<Storage, "head">,
  tours: TourHook,
): Promise<OrderSaveResult> {
  const parsed = orderInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (isPastDeliveryDate(v.window.to, today)) return { ok: false, error: "date_in_past" };
  if (v.deliveryDate && isPastDeliveryDate(v.deliveryDate, today)) {
    return { ok: false, error: "date_in_past" };
  }

  const customer = await db.customer.findUnique({
    where: { id: v.customerId },
    select: { active: true },
  });
  if (!customer) return { ok: false, error: "customer_not_found" };
  if (!customer.active) return { ok: false, error: "customer_inactive" };

  const products = await db.product.findMany({
    where: { id: { in: v.lines.map((l) => l.productId) } },
    select: { id: true, active: true },
  });
  if (products.length !== v.lines.length) return { ok: false, error: "product_not_found" };
  if (products.some((p) => !p.active)) return { ok: false, error: "product_inactive" };

  let inboxPhotoId: string | null = null;
  if (v.screenshotKey) {
    const stored = await storage.head(v.screenshotKey);
    if (!stored) return { ok: false, error: "screenshot_missing" };
    if (stored.bytes <= 0 || stored.bytes > MAX_UPLOAD_BYTES)
      return { ok: false, error: "invalid" };
    const used = await db.screenshot.findFirst({
      where: { storageKey: v.screenshotKey },
      select: { id: true, inboxStatus: true, _count: { select: { orders: true } } },
    });
    if (used) {
      // A photo of the order inbox (NUD-210) that still waits there is attached to this order;
      // any other known key already belongs to an order (or was thrown away).
      if (!isOpenInboxStatus(used.inboxStatus) || used._count.orders > 0) {
        return { ok: false, error: "screenshot_in_use" };
      }
      inboxPhotoId = used.id;
    }
  }

  const planned = await resolvePlannedDay(db, {
    window: v.window,
    requested: v.deliveryDate,
    items: v.lines,
    today,
  });

  const order = await db.$transaction(async (tx) => {
    if (inboxPhotoId) {
      // One order per photo: whoever marks the photo done first wins, the other save is refused.
      const { count } = await tx.screenshot.updateMany({
        where: {
          id: inboxPhotoId,
          inboxStatus: { in: [...OPEN_INBOX_STATUSES] },
          orders: { none: {} },
        },
        data: { inboxStatus: "DONE", readStartedAt: null },
      });
      if (count !== 1) return null;
    }
    const created = await tx.order.create({
      data: {
        customer: { connect: { id: v.customerId } },
        deliveryDate: planned.day,
        windowFrom: v.window.from,
        windowTo: v.window.to,
        windowFromTime: v.window.fromTime,
        windowToTime: v.window.toTime,
        status: v.status,
        source: v.screenshotKey ? "SCREENSHOT" : "MANUAL",
        paymentTerm: v.paymentTerm,
        amountCents: v.amountCents,
        screenshot: inboxPhotoId
          ? { connect: { id: inboxPhotoId } }
          : v.screenshotKey
            ? { create: { storageKey: v.screenshotKey, uploadedById: actorId } }
            : undefined,
        internalNote: v.internalNote,
        // AI order draft (NUD-150): the pasted message and what the model read, both optional.
        sourceText: v.sourceText,
        aiExtraction: v.aiExtraction
          ? (v.aiExtraction as unknown as Prisma.InputJsonValue)
          : undefined,
        createdBy: { connect: { id: actorId } },
        items: {
          create: v.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
          })),
        },
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Order",
      entityId: created.id,
      action: "order.create",
      diff: {
        customerId: v.customerId,
        status: v.status,
        paymentTerm: v.paymentTerm,
        amountCents: v.amountCents,
        deliveryDate: formatCalendarDate(planned.day),
        window: windowText(v.window),
        source: v.screenshotKey ? "SCREENSHOT" : "MANUAL",
        internalNote: v.internalNote ?? null,
        lines: v.lines.map((l): LineChange => ({
          productId: l.productId,
          before: null,
          after: toAuditQuantity(l.quantity),
        })),
      },
    });
    await flagAffectedTours(tours, tx, null, {
      status: v.status,
      customerId: v.customerId,
      deliveryDate: planned.day,
      items: v.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
      })),
    });
    return created;
  });
  if (!order) return { ok: false, error: "screenshot_in_use" };
  return {
    ok: true,
    id: order.id,
    status: v.status,
    plannedDate: formatCalendarDate(planned.day),
    warnings: planned.warnings,
  };
}

export type OrderableCustomer = {
  id: string;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
};

/** Customers that may receive new orders: active ones only (archived customers are never offered). */
export async function listOrderableCustomers(
  db: Pick<PrismaClient, "customer">,
): Promise<OrderableCustomer[]> {
  return db.customer.findMany({
    where: { active: true },
    orderBy: [{ name: "asc" }, { customerNumber: "asc" }],
    select: {
      id: true,
      customerNumber: true,
      name: true,
      street: true,
      postalCode: true,
      city: true,
    },
  });
}

/** How many CONFIRMED orders the customer already has for that day (they merge into one stop). */
export async function countConfirmedOrders(
  db: Pick<PrismaClient, "order">,
  rawCustomerId: unknown,
  rawDate: unknown,
  rawExcludeOrderId?: unknown,
): Promise<number> {
  const customerId = idSchema.safeParse(rawCustomerId);
  const date = typeof rawDate === "string" ? parseCalendarDate(rawDate.trim()) : null;
  if (!customerId.success || !date) return 0;
  const exclude = idSchema.safeParse(rawExcludeOrderId);
  return db.order.count({
    where: {
      customerId: customerId.data,
      deliveryDate: date,
      status: "CONFIRMED",
      ...(exclude.success ? { id: { not: exclude.data } } : {}),
    },
  });
}

/**
 * True when the day has tours and all of them are COMPLETED (NUD-116): an order confirmed for that
 * day is late and needs a follow-up tour. A day with an open (e.g. follow-up) tour is not flagged.
 */
export async function isDayTourCompleted(
  db: Pick<PrismaClient, "tour">,
  rawDate: unknown,
): Promise<boolean> {
  const date = typeof rawDate === "string" ? parseCalendarDate(rawDate.trim()) : null;
  if (!date) return false;
  const [total, open] = await Promise.all([
    db.tour.count({ where: { date } }),
    db.tour.count({ where: { date, status: { not: "COMPLETED" } } }),
  ]);
  return total > 0 && open === 0;
}

/**
 * NUD-178 (QA 2026-10-29, F6 + F11): the ONE description of "which tour is this order in".
 * Before, the order detail and the tours page each had their own rule, so a cancelled order could
 * still claim to be part of a tour and an order planned onto a tour of another delivery day (D25
 * windows) counted as "waiting for a tour" on its own day at the same time.
 */
export type OrderTourLink = {
  tourId: string;
  stopId: string;
  /** The tour's delivery day (YYYY-MM-DD, the day it actually drives). */
  date: string;
  tourStatus: "DRAFT" | "OPTIMIZED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED";
  stopStatus: "PENDING" | "DELIVERED" | "PROBLEM";
  /** When the stop was completed (ISO), else null. */
  completedAt: string | null;
};

export type OrderOverviewRow = {
  id: string;
  /** PLANNED day, `DATE` value as UTC midnight. */
  deliveryDate: Date;
  /** Requested delivery window (NUD-148). */
  window: OrderWindow;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  source: "MANUAL" | "SCREENSHOT";
  /** Generated from a recurring rule ("aus Dauerbestellung", NUD-149). */
  fromRecurring: boolean;
  /** Monthly bill or cash at the stop (D33); `amountCents` null = no amount set. */
  paymentTerm: "MONTHLY" | "ON_DELIVERY";
  amountCents: number | null;
  customer: { id: string; customerNumber: string; name: string };
  items: Array<{ id: string; productName: unknown; unit: string; quantity: number }>;
  /** The tour this order is part of (through its stop), or `null` while no tour contains it. */
  tour: OrderTourLink | null;
  /**
   * Confirmed after the tour of that day was completed and on no stop (NUD-099). Set by
   * `orderOverviewQuery`, not by `listOrderOverview`.
   */
  late?: boolean;
};

export const OVERVIEW_LIMIT = 300;

/**
 * Orders matching the filters (date range inclusive, optional customer / status / source), oldest
 * day first. Cancelled orders are listed (with their status) unless a status filter says
 * otherwise. `truncated` is true when more than `OVERVIEW_LIMIT` orders match.
 */
export async function listOrderOverview(
  db: Pick<PrismaClient, "order">,
  filters: OrderFilters,
): Promise<{ rows: OrderOverviewRow[]; truncated: boolean }> {
  const from = parseCalendarDate(filters.from);
  const to = parseCalendarDate(filters.to);
  if (!from || !to) return { rows: [], truncated: false };
  const rows = await db.order.findMany({
    where: {
      deliveryDate: { gte: from, lte: to },
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.source ? { source: filters.source } : {}),
    },
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: OVERVIEW_LIMIT + 1,
    include: {
      customer: { select: { id: true, customerNumber: true, name: true } },
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { id: "asc" },
      },
      stopOrders: {
        select: {
          stop: {
            select: {
              id: true,
              tourId: true,
              status: true,
              completedAt: true,
              tour: { select: { id: true, date: true, status: true } },
            },
          },
        },
        // The link of the planned day wins; a link on another day`s tour is the fallback (D25).
        take: 1,
      },
    },
  });
  return {
    truncated: rows.length > OVERVIEW_LIMIT,
    rows: rows.slice(0, OVERVIEW_LIMIT).map((o) => ({
      id: o.id,
      deliveryDate: o.deliveryDate,
      window: rowWindow(o),
      status: o.status,
      source: o.source,
      fromRecurring: o.recurringOrderId !== null,
      paymentTerm: o.paymentTerm,
      amountCents: o.amountCents,
      customer: o.customer,
      items: o.items.map((i) => ({
        id: i.id,
        productName: i.product.name,
        unit: i.product.unit,
        quantity: i.quantity,
      })),
      tour: tourLink(o.stopOrders),
    })),
  };
}

export type DateTotalsView = {
  /** `YYYY-MM-DD` */
  date: string;
  orderCount: number;
  products: Array<{
    productId: string;
    productName: unknown;
    sku: string;
    unit: string;
    /** Sum of whole-number quantities. */
    quantity: number;
  }>;
};

/**
 * Totals panel: sum per product for every date in the range, from CONFIRMED orders only (via the
 * pure `aggregateTotalsByDate`). Deliberately independent of the customer / status / source
 * filters: it answers "what must be produced and loaded for that day".
 */
export async function getDateTotals(
  db: Pick<PrismaClient, "order">,
  filters: Pick<OrderFilters, "from" | "to">,
): Promise<DateTotalsView[]> {
  const from = parseCalendarDate(filters.from);
  const to = parseCalendarDate(filters.to);
  if (!from || !to) return [];
  const orders = await db.order.findMany({
    where: { deliveryDate: { gte: from, lte: to }, status: "CONFIRMED" },
    select: {
      deliveryDate: true,
      status: true,
      items: {
        select: {
          productId: true,
          quantity: true,
          product: { select: { name: true, sku: true, unit: true, sortOrder: true } },
        },
      },
    },
  });
  const products = new Map<
    string,
    { name: unknown; sku: string; unit: string; sortOrder: number }
  >();
  const parsed = orders.map((o) => ({
    deliveryDate: formatCalendarDate(o.deliveryDate),
    status: o.status,
    items: o.items.flatMap((i) => {
      products.set(i.productId, i.product);
      return [{ productId: i.productId, quantity: i.quantity }];
    }),
  }));
  return aggregateTotalsByDate(parsed).map((day) => ({
    date: day.date,
    orderCount: day.orderCount,
    products: day.products
      .map((p) => ({ ...p, info: products.get(p.productId) }))
      .filter((p): p is typeof p & { info: NonNullable<typeof p.info> } => Boolean(p.info))
      .sort((a, b) => a.info.sortOrder - b.info.sortOrder || a.info.sku.localeCompare(b.info.sku))
      .map((p) => ({
        productId: p.productId,
        productName: p.info.name,
        sku: p.info.sku,
        unit: p.info.unit,
        quantity: p.quantity,
      })),
  }));
}

/**
 * Which tour a read of the day's orders is for (NUD-099). A day normally has one tour, but after a
 * completed tour a follow-up tour can exist. Orders already on a stop of ANOTHER tour of that day
 * belong to that tour, so they must not be planned, diffed or counted again.
 * - `{ tourId: "x" }`: the orders for tour x = every order not on a stop of another tour.
 * - `{ tourId: null }`: the orders for a tour that does not exist yet = orders on no stop at all.
 * NUD-154: an order on no stop whose customer has a stop on another open tour (and none on the
 * tour(s) in scope) belongs to that other tour and is left out; a customer on no stop stays in scope.
 */
export type TourOrderScope =
  | { tourId: string | null }
  /**
   * NUD-147: the orders for a whole-day plan that rebuilds the given (unreleased) tours = every
   * order that is not on a stop of any other tour of the day.
   */
  | { rebuildTourIds: string[] };

/**
 * The CONFIRMED orders of one delivery day with their items: the only orders a tour may contain
 * (NUD-041 builds stops from this). Drafts and cancelled orders are never returned. Without
 * `scope` all of the day's confirmed orders are returned; tour code passes the scope of its tour.
 */
export async function listConfirmedOrdersForDate(
  db: Pick<PrismaClient, "order">,
  date: Date,
  scope?: TourOrderScope,
) {
  // NUD-154: the tours this read is for; an order on no stop whose customer has a stop on another
  // open tour (and none on these) belongs to that other tour.
  const ownTourIds = !scope
    ? null
    : "rebuildTourIds" in scope
      ? scope.rebuildTourIds
      : scope.tourId
        ? [scope.tourId]
        : [];
  return db.order.findMany({
    where: {
      deliveryDate: date,
      status: "CONFIRMED",
      ...(scope
        ? {
            stopOrders: {
              none: {
                stop: {
                  tour: {
                    // NUD-178 (QA 2026-10-29 F6): planned means planned — an order that already
                    // sits on a tour of ANOTHER delivery day (D25 windows) is not "waiting for a
                    // tour" on its own day any more, which is what made the order page and the
                    // tours counter contradict each other.
                    ...("rebuildTourIds" in scope
                      ? scope.rebuildTourIds.length > 0
                        ? { id: { notIn: scope.rebuildTourIds } }
                        : {}
                      : scope.tourId
                        ? { id: { not: scope.tourId } }
                        : {}),
                  },
                },
              },
            },
            NOT: {
              stopOrders: { none: { stop: { tour: { date } } } },
              customer: {
                stops: {
                  some: {
                    tour: { date, status: { not: "COMPLETED" }, id: { notIn: ownTourIds! } },
                  },
                },
                NOT: { stops: { some: { tour: { date, id: { in: ownTourIds! } } } } },
              },
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { items: { orderBy: { id: "asc" } } },
  });
}

export type FilterCustomer = { id: string; customerNumber: string; name: string; city: string };

/** All customers (archived ones too: their old orders can still be filtered) for the filter. */
export async function listCustomersForFilter(
  db: Pick<PrismaClient, "customer">,
): Promise<FilterCustomer[]> {
  return db.customer.findMany({
    orderBy: [{ name: "asc" }, { customerNumber: "asc" }],
    select: { id: true, customerNumber: true, name: true, city: true },
  });
}

export type OrderDetail = {
  id: string;
  /** PLANNED day, `DATE` value as UTC midnight. */
  deliveryDate: Date;
  /** Requested delivery window (NUD-148). */
  window: OrderWindow;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  source: "MANUAL" | "SCREENSHOT";
  /** Generated from a recurring rule (NUD-149). */
  fromRecurring: boolean;
  /** Monthly bill or cash at the stop (D33); `amountCents` null = no amount set. */
  paymentTerm: "MONTHLY" | "ON_DELIVERY";
  amountCents: number | null;
  internalNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { displayName: string };
  customer: {
    id: string;
    customerNumber: string;
    name: string;
    city: string;
    active: boolean;
  };
  items: Array<{
    id: string;
    productId: string;
    sku: string;
    productName: unknown;
    unit: string;
    quantity: number;
  }>;
  /** Open order of today or a later day: it can be edited and cancelled. */
  editable: boolean;
  /** The tour this order is part of, if any. */
  tour: OrderTourLink | null;
  /** Attached screenshot with a signed, short-lived read URL (the bucket stays private). */
  screenshot: { id: string; url: string } | null;
};

/**
 * Order detail (NUD-031; NUD-032 adds `editable` and the tour link). Returns `null` for an
 * unknown id. The screenshot URL is signed on the server for each request.
 */
export async function getOrderDetail(
  db: Pick<PrismaClient, "order">,
  storage: Pick<Storage, "getReadUrl">,
  rawId: unknown,
  today: Date,
): Promise<OrderDetail | null> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return null;
  const o = await db.order.findUnique({
    where: { id: id.data },
    include: {
      customer: {
        select: {
          id: true,
          customerNumber: true,
          name: true,
          city: true,
          active: true,
        },
      },
      createdBy: { select: { displayName: true } },
      screenshot: { select: { id: true, storageKey: true } },
      items: {
        include: { product: { select: { name: true, unit: true, sku: true } } },
        orderBy: { id: "asc" },
      },
      stopOrders: {
        select: {
          stop: {
            select: {
              id: true,
              tourId: true,
              status: true,
              completedAt: true,
              tour: { select: { id: true, date: true, status: true } },
            },
          },
        },
        // The link of the planned day wins; a link on another day`s tour is the fallback (D25).
        take: 1,
      },
    },
  });
  if (!o) return null;
  return {
    id: o.id,
    deliveryDate: o.deliveryDate,
    window: rowWindow(o),
    status: o.status,
    source: o.source,
    fromRecurring: o.recurringOrderId !== null,
    paymentTerm: o.paymentTerm,
    amountCents: o.amountCents,
    internalNote: o.internalNote,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    createdBy: o.createdBy,
    customer: o.customer,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      sku: i.product.sku,
      productName: i.product.name,
      unit: i.product.unit,
      quantity: i.quantity,
    })),
    editable: isOrderEditable(o, today),
    tour: tourLink(o.stopOrders),
    screenshot: o.screenshot
      ? { id: o.screenshot.id, url: await storage.getReadUrl(o.screenshot.storageKey) }
      : null,
  };
}

/**
 * Signed preview URL for a just-uploaded screenshot, shown in the split view before the order is
 * saved. Only keys of the screenshot namespace whose object exists are signed.
 */
export async function getScreenshotPreviewUrl(
  storage: Pick<Storage, "head" | "getReadUrl">,
  rawKey: unknown,
): Promise<string | null> {
  const key = typeof rawKey === "string" && rawKey.length <= 200 ? rawKey : "";
  if (!isScreenshotKey(key)) return null;
  if (!(await storage.head(key))) return null;
  return storage.getReadUrl(key);
}

export type OrderMutationError =
  | "invalid"
  | "not_found"
  | "not_editable"
  | "date_in_past"
  | "customer_inactive"
  | "product_not_found"
  | "product_inactive";

export type OrderUpdateResult =
  | {
      ok: true;
      id: string;
      status: "CONFIRMED" | "DRAFT";
      plannedDate: string;
      warnings: OrderPlanWarning[];
    }
  | { ok: false; error: OrderMutationError };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Edits an open order (status DRAFT / CONFIRMED, delivery day today or later): delivery date,
 * status, internal note and the lines. The customer and the screenshot never change here. The
 * input goes through exactly the same validation as order entry (`orderInputSchema`: quantities
 * > 0 with at most 2 decimals, at least one line, same product merged); the lines are replaced
 * in one statement. A product that was deactivated meanwhile may stay in the order, but cannot
 * be added. The tours of the old and of the new delivery day are flagged outdated.
 */
export async function updateOrder(
  db: OrderDb,
  actorId: string,
  rawId: unknown,
  rawInput: unknown,
  today: Date,
  tours: TourHook,
): Promise<OrderUpdateResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "not_found" };
  const existing = await db.order.findUnique({
    where: { id: id.data },
    select: {
      customerId: true,
      status: true,
      deliveryDate: true,
      paymentTerm: true,
      amountCents: true,
      items: { select: { productId: true } },
    },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (!isOrderEditable(existing, today)) return { ok: false, error: "not_editable" };

  // An edit that does not carry the payment fields (an older screen, a script) keeps what is stored;
  // the order form always sends both (D33).
  const fields = isRecord(rawInput) ? rawInput : {};
  const parsed = orderInputSchema.safeParse({
    ...fields,
    customerId: existing.customerId,
    screenshotKey: null,
    paymentTerm: fields.paymentTerm ?? existing.paymentTerm,
    amount: "amount" in fields ? fields.amount : amountInputValue(existing.amountCents),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (isPastDeliveryDate(v.window.to, today)) return { ok: false, error: "date_in_past" };
  if (v.deliveryDate && isPastDeliveryDate(v.deliveryDate, today)) {
    return { ok: false, error: "date_in_past" };
  }

  const products = await db.product.findMany({
    where: { id: { in: v.lines.map((l) => l.productId) } },
    select: { id: true, active: true },
  });
  if (products.length !== v.lines.length) return { ok: false, error: "product_not_found" };
  const planned = await resolvePlannedDay(db, {
    window: v.window,
    requested: v.deliveryDate,
    items: v.lines,
    today,
    excludeOrderId: id.data,
  });
  const already = new Set(existing.items.map((i) => i.productId));
  if (products.some((p) => !p.active && !already.has(p.id))) {
    return { ok: false, error: "product_inactive" };
  }

  const stored = await db.$transaction(async (tx) => {
    // Read the state we replace inside the transaction: the flag must reflect what was really there.
    const before = await tx.order.findUnique({
      where: { id: id.data },
      select: {
        customerId: true,
        status: true,
        deliveryDate: true,
        windowFrom: true,
        windowTo: true,
        windowFromTime: true,
        windowToTime: true,
        internalNote: true,
        paymentTerm: true,
        amountCents: true,
        items: { select: { productId: true, quantity: true } },
      },
    });
    if (!before) return false;
    await tx.order.update({
      where: { id: id.data },
      data: {
        deliveryDate: planned.day,
        windowFrom: v.window.from,
        windowTo: v.window.to,
        windowFromTime: v.window.fromTime,
        windowToTime: v.window.toTime,
        status: v.status,
        internalNote: v.internalNote,
        paymentTerm: v.paymentTerm,
        amountCents: v.amountCents,
        items: {
          deleteMany: {},
          create: v.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
          })),
        },
      },
      select: { id: true },
    });
    // One entry per save, with exactly what differs; a save that changes nothing writes none.
    const diff = diffOrderUpdate(
      {
        status: before.status,
        deliveryDate: formatCalendarDate(before.deliveryDate),
        window: windowText(rowWindow(before)),
        internalNote: before.internalNote,
        items: before.items,
        paymentTerm: before.paymentTerm,
        amountCents: before.amountCents,
      },
      {
        status: v.status,
        deliveryDate: formatCalendarDate(planned.day),
        window: windowText(v.window),
        internalNote: v.internalNote ?? null,
        items: v.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
        })),
        paymentTerm: v.paymentTerm,
        amountCents: v.amountCents,
      },
    );
    if (diff) {
      await recordAudit(tx, {
        actorId,
        entity: "Order",
        entityId: id.data,
        action: "order.update",
        diff,
      });
    }
    await flagAffectedTours(tours, tx, before, {
      status: v.status,
      customerId: before.customerId,
      deliveryDate: planned.day,
      items: v.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
      })),
    });
    return true;
  });
  if (!stored) return { ok: false, error: "not_found" };
  return {
    ok: true,
    id: id.data,
    status: v.status,
    plannedDate: formatCalendarDate(planned.day),
    warnings: planned.warnings,
  };
}

export type OrderCancelResult =
  { ok: true; id: string } | { ok: false; error: "invalid" | "not_found" | "not_editable" };

/**
 * Cancels an open order: status CANCELLED, nothing is deleted (items, screenshot and stop links
 * stay as history). Cancelled orders leave the totals and can never be part of a tour. Orders of
 * past days and already cancelled orders are rejected with `not_editable`.
 */
export async function cancelOrder(
  db: Pick<PrismaClient, "order" | "auditLog" | "$transaction">,
  actorId: string,
  rawId: unknown,
  today: Date,
  tours: TourHook,
): Promise<OrderCancelResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "invalid" };
  const existing = await db.order.findUnique({
    where: { id: id.data },
    select: { status: true, deliveryDate: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (!isOrderEditable(existing, today)) return { ok: false, error: "not_editable" };
  const cancelled = await db.$transaction(async (tx) => {
    const before = await tx.order.findUnique({
      where: { id: id.data },
      select: {
        customerId: true,
        status: true,
        deliveryDate: true,
        items: { select: { productId: true, quantity: true } },
      },
    });
    if (!before) return false;
    await tx.order.update({
      where: { id: id.data },
      data: { status: "CANCELLED" },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Order",
      entityId: id.data,
      action: "order.cancel",
      diff: { status: { from: before.status, to: "CANCELLED" } },
    });
    await flagAffectedTours(tours, tx, before, { ...before, status: "CANCELLED" });
    return true;
  });
  if (!cancelled) return { ok: false, error: "not_found" };
  return { ok: true, id: id.data };
}

export type OrderDuplicateResult =
  { ok: true; id: string } | { ok: false; error: OrderMutationError };

/**
 * Copies an order (any status) to another delivery day, today or later: same customer, lines
 * and internal note. The copy is a DRAFT with source MANUAL and without screenshot (the
 * screenshot belongs to the original message); it must be confirmed on purpose. The customer
 * must still be active and all products active.
 */
export async function duplicateOrder(
  db: OrderDb,
  actorId: string,
  rawId: unknown,
  rawDate: unknown,
  today: Date,
  tours: TourHook,
): Promise<OrderDuplicateResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "not_found" };
  const date = typeof rawDate === "string" ? parseCalendarDate(rawDate.trim()) : null;
  if (!date) return { ok: false, error: "invalid" };
  if (isPastDeliveryDate(date, today)) return { ok: false, error: "date_in_past" };
  const source = await db.order.findUnique({
    where: { id: id.data },
    select: {
      customerId: true,
      internalNote: true,
      customer: { select: { active: true } },
      items: { select: { productId: true, quantity: true, product: { select: { active: true } } } },
    },
  });
  if (!source) return { ok: false, error: "not_found" };
  if (!source.customer.active) return { ok: false, error: "customer_inactive" };
  if (source.items.some((i) => !i.product.active)) return { ok: false, error: "product_inactive" };
  const copy = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        customer: { connect: { id: source.customerId } },
        deliveryDate: date,
        // A copy for a chosen day is wanted exactly that day (the whole day, NUD-148).
        windowFrom: date,
        windowTo: date,
        status: "DRAFT",
        source: "MANUAL",
        internalNote: source.internalNote,
        createdBy: { connect: { id: actorId } },
        items: {
          create: source.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
        },
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "Order",
      entityId: created.id,
      action: "order.duplicate",
      diff: {
        sourceOrderId: id.data,
        customerId: source.customerId,
        status: "DRAFT",
        deliveryDate: formatCalendarDate(date),
        internalNote: source.internalNote ?? null,
        lines: source.items.map((i): LineChange => ({
          productId: i.productId,
          before: null,
          after: toAuditQuantity(i.quantity),
        })),
      },
    });
    // A copy is a draft, so this flags nothing; it stays here so the rule lives in one place.
    await flagAffectedTours(tours, tx, null, {
      status: "DRAFT",
      customerId: source.customerId,
      deliveryDate: date,
      items: source.items,
    });
    return created;
  });
  return { ok: true, id: copy.id };
}
