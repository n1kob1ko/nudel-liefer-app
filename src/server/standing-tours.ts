import { z } from "zod";

import { diffOrderLines, type LineChange, toAuditQuantity } from "@/domain/audit";
import {
  formatCalendarDate,
  isPastDeliveryDate,
  MAX_ORDER_LINES,
  MAX_QUANTITY,
  parseCalendarDate,
} from "@/domain/order";
import {
  itemsForWeekday,
  occursOn,
  parseMonthlyRules,
  type RecurringSchedule,
} from "@/domain/recurring-order";
import { isoWeekday } from "@/domain/settings";
import {
  type DayPlan,
  type DayPlanRow,
  emptyQuantities,
  MAX_PLAN_ROWS,
  MAX_STANDING_CUSTOMERS,
  MAX_STANDING_TOURS,
  type PlanProduct,
  positiveLines,
  type Quantities,
  quantitiesOf,
  rowChanged,
  rowWeightKg,
} from "@/domain/standing-day";
import { isTourEditable } from "@/domain/tour-plan";
import type { PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import type { TourHook } from "./orders";

/**
 * Standing tours and the day plan (NUD-186, D32).
 *
 * A standing tour ("Stammtour") is a named group of customers with a default driver that delivers
 * every day the same customers. It is a planning aid for the office, not a `Tour`: the tours of a
 * delivery day are still built by "Touren planen" from the CONFIRMED orders (NUD-147).
 *
 * `/admin/planning` shows one table per standing tour with one column per active product; the office
 * edits the quantities of the delivery day right there. The bottom list holds the active customers
 * that are in no standing tour, with "add for this delivery day" (off-route orders are one-offs; the
 * membership never changes from here).
 *
 * A save writes normal CONFIRMED orders (whole-number quantities, delivery window = that day), so
 * the result flows unchanged into tour planning, the driver app and the packing list:
 * - quantities that differ from the stored order are written; an unchanged row is left alone,
 * - a quantity of 0 drops that line,
 * - a row where nothing is ordered keeps its order (without lines) so the office sees "nothing
 *   ordered" in the orders list instead of a silently deleted order; `buildStops` never turns it into
 *   a stop (D32),
 * - several CONFIRMED orders of one customer for that day are merged into the first one, the others
 *   are cancelled (audited) because the table shows one row per customer,
 * - a customer without an order gets none while the row stays empty (nothing was ordered, nothing to
 *   store).
 * Everything happens in one transaction that also flags the day's open tours as outdated.
 */

export type StandingDb = Pick<
  PrismaClient,
  | "standingTour"
  | "standingTourCustomer"
  | "customer"
  | "product"
  | "order"
  | "tour"
  | "user"
  | "recurringOrder"
  | "auditLog"
  | "$transaction"
>;

const idSchema = z.string().trim().min(1).max(64);
const dateTextSchema = z.string().trim().length(10);
const MAX_NAME = 80;

/** Result of loading one customer's delivery state of the day. */
type RowState = {
  orderIds: string[];
  confirmedItems: Array<{ productId: string; quantity: number }>;
  cancelled: boolean;
  suggestedItems: Array<{ productId: string; quantity: number }>;
};

/**
 * The day plan of one delivery day: every active standing tour with its customers and, at the
 * bottom, the active customers that are in no standing tour. `today` decides whether the day is
 * history (read-only). Pass `null` as the date to fall back to `today`.
 */
export async function standingDayQuery(
  db: StandingDb,
  rawDate: unknown,
  today: Date,
): Promise<DayPlan> {
  const parsed = typeof rawDate === "string" ? parseCalendarDate(rawDate.trim()) : null;
  const day = parsed ?? today;

  const [productRows, customerRows, tourRows, standingRows] = await Promise.all([
    db.product.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { sku: "asc" }],
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        weightKgPerUnit: true,
        sortOrder: true,
      },
    }),
    db.customer.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { customerNumber: "asc" }],
      select: { id: true, customerNumber: true, name: true, city: true },
    }),
    db.tour.findMany({ where: { date: day }, select: { id: true, status: true } }),
    db.standingTour.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        driverId: true,
        driver: { select: { displayName: true } },
        customers: {
          orderBy: [{ sortOrder: "asc" }, { customerId: "asc" }],
          select: { customerId: true },
        },
      },
    }),
  ]);

  const products: PlanProduct[] = productRows.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    weightKgPerUnit: p.weightKgPerUnit.toString(),
    sortOrder: p.sortOrder,
  }));
  const productIds = products.map((p) => p.id);
  const customerById = new Map(customerRows.map((c) => [c.id, c]));

  const standingOf = new Map<string, string>();
  for (const tour of standingRows) {
    for (const member of tour.customers) standingOf.set(member.customerId, tour.id);
  }
  const ofInterest = new Set<string>();
  for (const tour of standingRows)
    for (const member of tour.customers) ofInterest.add(member.customerId);
  for (const customer of customerRows) {
    if (!standingOf.has(customer.id)) ofInterest.add(customer.id);
  }
  const ids = [...ofInterest];

  const [orderRows, ruleRows] = await Promise.all([
    db.order.findMany({
      where: {
        deliveryDate: day,
        customerId: { in: ids },
        status: { in: ["CONFIRMED", "CANCELLED"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        customerId: true,
        status: true,
        items: { select: { productId: true, quantity: true } },
      },
    }),
    db.recurringOrder.findMany({
      where: { customerId: { in: ids }, active: true, pausedByCustomer: false },
      orderBy: [{ id: "asc" }],
      select: {
        customerId: true,
        weekdays: true,
        everyNWeeks: true,
        anchorDate: true,
        seasonFrom: true,
        seasonTo: true,
        exceptions: true,
        monthlyRules: true,
        skipFrom: true,
        skipTo: true,
        endsOn: true,
        items: { select: { productId: true, quantity: true } },
        dayItems: { select: { weekday: true, productId: true, quantity: true } },
      },
    }),
  ]);

  const states = new Map<string, RowState>();
  const stateOf = (customerId: string): RowState => {
    let state = states.get(customerId);
    if (!state) {
      state = { orderIds: [], confirmedItems: [], cancelled: false, suggestedItems: [] };
      states.set(customerId, state);
    }
    return state;
  };
  for (const order of orderRows) {
    const state = stateOf(order.customerId);
    if (order.status === "CANCELLED") state.cancelled = true;
    else {
      state.orderIds.push(order.id);
      state.confirmedItems.push(...order.items);
    }
  }

  // Suggestion from the recurring rules for rows that have no order yet (nothing stored until saved).
  const weekday = isoWeekday(day);
  for (const rule of ruleRows) {
    const state = stateOf(rule.customerId);
    if (state.orderIds.length > 0 || state.cancelled) continue;
    const schedule: RecurringSchedule = {
      weekdays: rule.weekdays,
      everyNWeeks: rule.everyNWeeks,
      anchorDate: rule.anchorDate,
      seasonFrom: rule.seasonFrom,
      seasonTo: rule.seasonTo,
      exceptions: rule.exceptions,
      monthlyRules: parseMonthlyRules(rule.monthlyRules),
      skipFrom: rule.skipFrom,
      skipTo: rule.skipTo,
      endsOn: rule.endsOn,
    };
    if (!occursOn(schedule, day)) continue;
    // Several rules may deliver on the same day; the orders they generate merge into one stop, so the
    // suggestion adds them up. `maxDeliveries` is not evaluated here (a suggestion, not generation).
    state.suggestedItems.push(...itemsForWeekday(schedule, weekday, rule.items, rule.dayItems));
  }

  const rowOf = (customerId: string): DayPlanRow | null => {
    const customer = customerById.get(customerId);
    if (!customer) return null;
    const state = stateOf(customerId);
    const hasOrder = state.orderIds.length > 0;
    const source = hasOrder ? "order" : state.suggestedItems.length > 0 ? "rule" : "none";
    const items = hasOrder ? state.confirmedItems : state.suggestedItems;
    const quantities = quantitiesOf(items, productIds);
    return {
      customerId,
      customerNumber: customer.customerNumber,
      name: customer.name,
      city: customer.city,
      orderId: state.orderIds[0] ?? null,
      orderCount: state.orderIds.length,
      cancelled: state.cancelled,
      source,
      quantities,
      nothing: hasOrder && Object.values(quantities).every((q) => q <= 0),
      weightKg: rowWeightKg(quantities, products),
    };
  };

  const routes = standingRows.map((tour) => ({
    id: tour.id,
    name: tour.name,
    driverId: tour.driverId,
    driverName: tour.driver?.displayName ?? null,
    rows: tour.customers
      .map((member) => rowOf(member.customerId))
      .filter((row): row is DayPlanRow => row !== null),
  }));
  const offRoute = customerRows
    .filter((customer) => !standingOf.has(customer.id))
    .map((customer) => rowOf(customer.id))
    .filter((row): row is DayPlanRow => row !== null);

  const readOnly: DayPlan["readOnly"] = isPastDeliveryDate(day, today)
    ? "past"
    : tourRows.some((tour) => !isTourEditable(tour.status))
      ? "released"
      : null;

  return {
    date: formatCalendarDate(day),
    products,
    routes,
    offRoute,
    editable: readOnly === null,
    readOnly,
  };
}

// ---------------------------------------------------------------------------------------------
// Saving the day

export const dayRowSchema = z
  .object({
    customerId: idSchema,
    lines: z
      .array(
        z
          .object({
            productId: idSchema,
            /** 0 = the customer wants nothing of that product (D32). */
            quantity: z.number().int().min(0).max(MAX_QUANTITY),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_ORDER_LINES),
  })
  .strict();

export const standingDaySaveSchema = z
  .object({
    date: dateTextSchema,
    rows: z.array(dayRowSchema).min(1).max(MAX_PLAN_ROWS),
  })
  .strict();

export type StandingDaySaveInput = z.input<typeof standingDaySaveSchema>;

export type StandingDaySaveError =
  | "invalid"
  | "date_in_past"
  /** A tour of that day is released or running: edit it with "Bearbeiten" (D32). */
  | "tour_released"
  | "customer_not_found"
  | "customer_inactive"
  | "product_not_found"
  | "product_inactive";

export type StandingDaySaveResult =
  | {
      ok: true;
      /** Rows that really changed something. */
      written: number;
      created: number;
      updated: number;
      /** Extra orders of a customer that were merged into the first one and cancelled. */
      merged: number;
    }
  | { ok: false; error: StandingDaySaveError };

/**
 * Writes the edited day plan. The caller checked the ADMIN role. Only rows whose quantities differ
 * from the stored orders are written; an unchanged save changes nothing (and logs nothing).
 */
export async function saveStandingDay(
  db: StandingDb,
  actorId: string,
  rawInput: unknown,
  today: Date,
  tours: TourHook,
): Promise<StandingDaySaveResult> {
  const parsed = standingDaySaveSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  const day = parseCalendarDate(input.date);
  if (!day) return { ok: false, error: "invalid" };
  if (isPastDeliveryDate(day, today)) return { ok: false, error: "date_in_past" };

  const customerIds = [...new Set(input.rows.map((row) => row.customerId))];
  const productIds = [...new Set(input.rows.flatMap((row) => row.lines.map((l) => l.productId)))];

  const [customers, products, dayTours] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, active: true },
    }),
    db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, active: true },
    }),
    db.tour.findMany({ where: { date: day }, select: { id: true, status: true } }),
  ]);
  if (customers.length !== customerIds.length) return { ok: false, error: "customer_not_found" };
  if (customers.some((customer) => !customer.active))
    return { ok: false, error: "customer_inactive" };
  if (products.length !== productIds.length) return { ok: false, error: "product_not_found" };
  if (products.some((product) => !product.active)) return { ok: false, error: "product_inactive" };
  if (dayTours.some((tour) => !isTourEditable(tour.status))) {
    return { ok: false, error: "tour_released" };
  }

  const dayText = formatCalendarDate(day);
  return db.$transaction(
    async (tx): Promise<StandingDaySaveResult> => {
      // Same key as "Touren planen": a plan run and a day-plan save of one date never interleave.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tour:${dayText}`}))`;
      const currentTours = await tx.tour.findMany({
        where: { date: day },
        select: { status: true },
      });
      if (currentTours.some((tour) => !isTourEditable(tour.status))) {
        return { ok: false, error: "tour_released" };
      }

      let created = 0;
      let updated = 0;
      let merged = 0;
      const changedCustomers = new Set<string>();

      for (const row of input.rows) {
        const after: Quantities = emptyQuantities(productIds);
        for (const line of row.lines) after[line.productId] = line.quantity;
        const existing = await tx.order.findMany({
          where: { customerId: row.customerId, deliveryDate: day, status: "CONFIRMED" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, items: { select: { productId: true, quantity: true } } },
        });
        const beforeItems = existing.flatMap((order) => order.items);
        const before = quantitiesOf(beforeItems, productIds);
        if (!rowChanged(before, after, productIds)) continue;

        const lines = positiveLines(after, productIds);
        const [first, ...extra] = existing;

        if (!first) {
          // Nothing ordered and no order yet: nothing to store (an empty row is not an "order").
          if (lines.length === 0) continue;
          const order = await tx.order.create({
            data: {
              customerId: row.customerId,
              deliveryDate: day,
              // The office wanted exactly this day, the whole day (NUD-148).
              windowFrom: day,
              windowTo: day,
              status: "CONFIRMED",
              source: "MANUAL",
              createdById: actorId,
              items: { create: lines },
            },
            select: { id: true },
          });
          await recordAudit(tx, {
            actorId,
            entity: "Order",
            entityId: order.id,
            action: "order.create",
            diff: {
              via: "standing_day",
              customerId: row.customerId,
              status: "CONFIRMED",
              deliveryDate: dayText,
              lines: lines.map((line): LineChange => ({
                productId: line.productId,
                before: null,
                after: toAuditQuantity(line.quantity),
              })),
            },
          });
          created += 1;
          changedCustomers.add(row.customerId);
          continue;
        }

        // One row per customer: the first order takes the new quantities, the rest are merged into it.
        await tx.order.update({
          where: { id: first.id },
          data: { items: { deleteMany: {}, create: lines } },
          select: { id: true },
        });
        const changes = diffOrderLines(beforeItems, lines);
        if (changes.length > 0) {
          await recordAudit(tx, {
            actorId,
            entity: "Order",
            entityId: first.id,
            action: "order.update",
            diff: { via: "standing_day", deliveryDate: dayText, lines: changes },
          });
        }
        for (const order of extra) {
          await tx.order.update({
            where: { id: order.id },
            data: { status: "CANCELLED" },
            select: { id: true },
          });
          await recordAudit(tx, {
            actorId,
            entity: "Order",
            entityId: order.id,
            action: "order.cancel",
            diff: {
              via: "standing_day",
              status: { from: "CONFIRMED", to: "CANCELLED" },
              mergedInto: first.id,
            },
          });
          merged += 1;
        }
        updated += 1;
        changedCustomers.add(row.customerId);
      }

      if (changedCustomers.size > 0) {
        await tours.markOutdatedForDate(day, tx, { customerIds: [...changedCustomers] });
      }
      return {
        ok: true,
        written: changedCustomers.size,
        created,
        updated,
        merged,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

// ---------------------------------------------------------------------------------------------
// Managing the standing tours themselves

export const standingTourSaveSchema = z
  .object({
    id: idSchema.nullish(),
    name: z.string().trim().min(1).max(MAX_NAME),
    /** Default driver of the group; `null`/omitted = none. */
    driverId: idSchema.nullish(),
    customerIds: z.array(idSchema).max(MAX_STANDING_CUSTOMERS),
  })
  .strict();

export type StandingTourSaveError =
  | "invalid"
  | "not_found"
  | "name_taken"
  | "too_many"
  | "driver_invalid"
  | "customer_not_found"
  | "customer_inactive"
  /** The customer already belongs to another standing tour: one group per customer. */
  | "customer_in_other";

export type StandingTourSaveResult =
  { ok: true; id: string; created: boolean } | { ok: false; error: StandingTourSaveError };

/**
 * Creates or edits one standing tour: its name, its default driver and exactly the given customers
 * (in the given order). Membership rows are replaced as a whole; nothing is deleted that the group
 * itself is not. The caller checked the ADMIN role.
 */
export async function saveStandingTour(
  db: StandingDb,
  actorId: string,
  rawInput: unknown,
): Promise<StandingTourSaveResult> {
  const parsed = standingTourSaveSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  const driverId = input.driverId ?? null;
  const customerIds = [...new Set(input.customerIds)];

  if (driverId) {
    const driver = await db.user.findUnique({
      where: { id: driverId },
      select: { role: true, active: true },
    });
    if (!driver || driver.role !== "DRIVER" || !driver.active) {
      return { ok: false, error: "driver_invalid" };
    }
  }
  if (customerIds.length > 0) {
    const found = await db.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, active: true },
    });
    if (found.length !== customerIds.length) return { ok: false, error: "customer_not_found" };
    if (found.some((customer) => !customer.active))
      return { ok: false, error: "customer_inactive" };
  }

  const existing = input.id
    ? await db.standingTour.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          driverId: true,
          customers: { select: { customerId: true } },
        },
      })
    : null;
  if (input.id && !existing) return { ok: false, error: "not_found" };
  const name = input.name.trim();
  const sameName = await db.standingTour.findFirst({
    where: {
      active: true,
      ...(existing ? { id: { not: existing.id } } : {}),
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (sameName) return { ok: false, error: "name_taken" };
  if (!existing) {
    const count = await db.standingTour.count({ where: { active: true } });
    if (count >= MAX_STANDING_TOURS) return { ok: false, error: "too_many" };
  }
  // One group per customer: the day plan shows one row per customer, so membership is exclusive.
  if (customerIds.length > 0) {
    const taken = await db.standingTourCustomer.findMany({
      where: {
        customerId: { in: customerIds },
        standingTour: {
          active: true,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
      },
      select: { customerId: true },
    });
    if (taken.length > 0) return { ok: false, error: "customer_in_other" };
  }

  return db.$transaction(async (tx): Promise<StandingTourSaveResult> => {
    const id = existing
      ? (
          await tx.standingTour.update({
            where: { id: existing.id },
            data: { name, driverId },
            select: { id: true },
          })
        ).id
      : (
          await tx.standingTour.create({
            data: {
              name,
              driverId,
              sortOrder: await tx.standingTour.count(),
            },
            select: { id: true },
          })
        ).id;
    // Replace the membership as a whole: the row order of `customerIds` is the delivery order.
    await tx.standingTourCustomer.deleteMany({ where: { standingTourId: id } });
    if (customerIds.length > 0) {
      await tx.standingTourCustomer.createMany({
        data: customerIds.map((customerId, index) => ({
          standingTourId: id,
          customerId,
          sortOrder: index,
        })),
      });
    }
    // Membership changes of a group do not change any order: the day plan only lists other rows.
    const previous = new Set(existing?.customers.map((member) => member.customerId) ?? []);
    await recordAudit(tx, {
      actorId,
      entity: "StandingTour",
      entityId: id,
      action: existing ? "standing_tour.update" : "standing_tour.create",
      diff: {
        name: existing && existing.name !== name ? { from: existing.name, to: name } : undefined,
        driverId:
          existing && existing.driverId !== driverId
            ? { from: existing.driverId, to: driverId }
            : undefined,
        added: customerIds.filter((customerId) => !previous.has(customerId)),
        removed: [...previous].filter((customerId) => !customerIds.includes(customerId)),
        customerIds,
      },
    });
    return { ok: true, id, created: !existing };
  });
}

export type StandingTourEditError = "invalid" | "not_found";

export type StandingTourEditResult =
  { ok: true; id: string; active: boolean } | { ok: false; error: StandingTourEditError };

/** Sets the default driver of a standing tour ("he is ill or replaced"), audited. */
export async function setStandingTourDriver(
  db: StandingDb,
  actorId: string,
  rawId: unknown,
  rawDriverId: unknown,
): Promise<StandingTourEditResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "invalid" };
  let nextDriverId: string | null = null;
  if (rawDriverId !== null && rawDriverId !== undefined && rawDriverId !== "") {
    const parsedDriver = idSchema.safeParse(rawDriverId);
    if (!parsedDriver.success) return { ok: false, error: "invalid" };
    nextDriverId = parsedDriver.data;
  }
  if (nextDriverId) {
    const driver = await db.user.findUnique({
      where: { id: nextDriverId },
      select: { role: true, active: true },
    });
    if (!driver || driver.role !== "DRIVER" || !driver.active) {
      return { ok: false, error: "invalid" };
    }
  }
  const existing = await db.standingTour.findUnique({
    where: { id: id.data },
    select: { id: true, driverId: true, active: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  await db.$transaction(async (tx) => {
    await tx.standingTour.update({
      where: { id: id.data },
      data: { driverId: nextDriverId },
      select: { id: true },
    });
    if (existing.driverId !== nextDriverId) {
      await recordAudit(tx, {
        actorId,
        entity: "StandingTour",
        entityId: id.data,
        action: "standing_tour.driver",
        diff: { from: existing.driverId, to: nextDriverId },
      });
    }
  });
  return { ok: true, id: id.data, active: existing.active };
}

/** Archives (`active=false`) or restores a standing tour; the membership rows stay. */
export async function setStandingTourActive(
  db: StandingDb,
  actorId: string,
  rawId: unknown,
  rawActive: unknown,
): Promise<StandingTourEditResult> {
  const id = idSchema.safeParse(rawId);
  const active = z.boolean().safeParse(rawActive);
  if (!id.success || !active.success) return { ok: false, error: "invalid" };
  const existing = await db.standingTour.findUnique({
    where: { id: id.data },
    select: { id: true, active: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  await db.$transaction(async (tx) => {
    await tx.standingTour.update({
      where: { id: id.data },
      data: { active: active.data },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      entity: "StandingTour",
      entityId: id.data,
      action: active.data ? "standing_tour.activate" : "standing_tour.deactivate",
      diff: { active: { from: existing.active, to: active.data } },
    });
  });
  return { ok: true, id: id.data, active: active.data };
}

/** Active drivers for the driver selects (sorted by name). */
export async function listActiveDrivers(
  db: Pick<PrismaClient, "user">,
): Promise<Array<{ id: string; displayName: string }>> {
  return db.user.findMany({
    where: { role: "DRIVER", active: true },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: { id: true, displayName: true },
  });
}
