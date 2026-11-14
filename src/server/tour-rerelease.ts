import { z } from "zod";

import { toAuditQuantity } from "@/domain/audit";
import { normalizeTrips, tripPausesS, tripVehicleIds, vehiclesForTrips } from "@/domain/fleet";
import { routingPoint } from "@/domain/parking";
import { departureInstant, type StopItem } from "@/domain/tour";
import {
  type ItemChange,
  planReRelease,
  type ReleasePlan,
  type SnapshotStop,
  type TourDiff,
} from "@/domain/tour-diff";
import {
  canTransition,
  deriveTourStatus,
  isReleasedStatus,
  isReReleasable,
} from "@/domain/tour-status";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import { listConfirmedOrdersForDate } from "./orders";
import { RoutingError, type RoutingProvider } from "./routing";
import { customerLocationSelect } from "./routing-points";
import type { AppSettings } from "./settings";
import type { PlanResult } from "./tour-planning";
import { routeTrips, scheduleTrips } from "./tour-routing";
import { rebaseOnRelease } from "./tour-schedule";

/**
 * Re-release (NUD-043): a released tour whose orders changed (`isOutdated`) is updated in place
 * and handed to the driver again, with a revision number, change markers per stop and the
 * quantities the driver must see. Completed stops are frozen: their status, completion data,
 * quantities and order links are never touched. Callers have checked the ADMIN role.
 *
 * Rules (see backlog §9): the order of the open stops is kept, new customers are appended, open
 * stops without orders are removed, ETAs / legs are recomputed with `route()` over the whole
 * sequence and written to open stops only. A re-release that changes nothing the driver sees
 * only clears the outdated flag.
 */

// unbounded-ok-start: Stop.items snapshot JSON written by the server
const itemsSchema = z.array(
  z.object({ productId: z.string(), quantity: z.number().int().nonnegative() }),
);
// unbounded-ok-end

/** `Stop.items` JSON as typed list; anything malformed counts as "no items". */
export function readStopItems(value: unknown): StopItem[] {
  const parsed = itemsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

const tourInclude = {
  stops: {
    orderBy: { sequence: "asc" },
    include: {
      orders: { select: { orderId: true } },
      customer: { select: customerLocationSelect },
    },
  },
  driver: { select: { active: true, role: true } },
} satisfies Prisma.TourInclude;

export type ReleaseTour = Prisma.TourGetPayload<{ include: typeof tourInclude }>;

type ReleaseDb = Pick<PrismaClient, "tour" | "order" | "customer" | "product">;

export function loadReleaseTour(db: Pick<PrismaClient, "tour">, tourId: string) {
  return db.tour.findUnique({ where: { id: tourId }, include: tourInclude });
}

/** Fingerprint of the stops (id + status): a driver completing a stop meanwhile changes it. */
function stopSignature(stops: ReadonlyArray<{ id: string; status: string }>): string {
  return [...stops]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => `${s.id}:${s.status}`)
    .join("|");
}

function orderSignature(orders: ReadonlyArray<{ id: string; updatedAt: Date }>): string {
  return orders.map((o) => `${o.id}@${o.updatedAt.getTime()}`).join("|");
}

const hasRoutingPoint = (customer: Parameters<typeof routingPoint>[0] | undefined) =>
  !!customer && routingPoint(customer) !== null;

/**
 * A day route (NUD-212): the customers that belong on this tour and the position of each in the
 * route. Orders of other customers are left out; stops are written in route order.
 */
export type DayRouteScope = {
  customerIds: ReadonlySet<string>;
  /** Position of a customer in the route; `undefined` keeps the stop where it is. */
  orderKey: (customerId: string) => number | undefined;
};

export type LoadedReleasePlan = {
  plan: ReleasePlan;
  orderSignature: string;
  stopSignature: string;
  customers: Map<string, ReleaseTour["stops"][number]["customer"]>;
};

/**
 * Compares the stops of a released tour with the CONFIRMED orders of its day. Customers with no
 * location at all (no Parkplatz, no address point) cannot be routed, so their orders are left out (the planning page lists them as
 * warnings); orders linked to a completed stop are always kept so that their edits are reported.
 */
export async function loadReleasePlan(
  db: Pick<PrismaClient, "order" | "customer">,
  tour: ReleaseTour,
  route?: DayRouteScope,
): Promise<LoadedReleasePlan> {
  // Orders on a stop of another tour of the day (a completed tour before a follow-up) are not ours.
  const dayOrders = await listConfirmedOrdersForDate(db, tour.date, { tourId: tour.id });
  // A day route (NUD-212) carries only its own customers; an order already on a completed stop of
  // this tour stays, so its later edit is still reported.
  const ownCompleted = new Set(
    tour.stops.filter((s) => s.status !== "PENDING").flatMap((s) => s.orders.map((o) => o.orderId)),
  );
  const orders = route
    ? dayOrders.filter((o) => route.customerIds.has(o.customerId) || ownCompleted.has(o.id))
    : dayOrders;
  const customerIds = [
    ...new Set([...orders.map((o) => o.customerId), ...tour.stops.map((s) => s.customerId)]),
  ];
  const rows = await db.customer.findMany({
    where: { id: { in: customerIds } },
    select: customerLocationSelect,
  });
  const customers = new Map(rows.map((c) => [c.id, c]));
  const frozen = new Set(
    tour.stops.filter((s) => s.status !== "PENDING").flatMap((s) => s.orders.map((o) => o.orderId)),
  );
  const usable = orders.filter(
    (o) => frozen.has(o.id) || hasRoutingPoint(customers.get(o.customerId)),
  );
  const snapshot: SnapshotStop[] = tour.stops.map((s) => ({
    id: s.id,
    customerId: s.customerId,
    sequence: s.sequence,
    completed: s.status !== "PENDING",
    orderIds: s.orders.map((o) => o.orderId),
    items: readStopItems(s.items),
  }));
  const plan = planReRelease(snapshot, usable);
  if (route) {
    // The stops follow the route (NUD-212), completed ones included; unknown keys keep their place.
    const key = (customerId: string) => route.orderKey(customerId) ?? Number.POSITIVE_INFINITY;
    plan.entries = plan.entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => key(a.entry.customerId) - key(b.entry.customerId) || a.index - b.index)
      .map((x) => x.entry);
  }
  return {
    plan,
    orderSignature: orderSignature(dayOrders),
    stopSignature: stopSignature(tour.stops),
    customers,
  };
}

/** True when the driver would see something different (completed-stop edits alone do not count). */
export function isDispatchable(diff: TourDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}

// ---- read model for the admin banner ----

export type DiffItemView = {
  productId: string;
  sku: string;
  /** `LocalizedText` JSON; the client picks the locale. */
  name: unknown;
  unit: string;
  before: number;
  after: number;
};
export type DiffStopView = {
  stopId: string | null;
  customerId: string;
  customerNumber: string;
  name: string;
  items: DiffItemView[];
};
export type TourDiffView = {
  added: DiffStopView[];
  removed: DiffStopView[];
  changed: DiffStopView[];
  completedChanged: DiffStopView[];
};

/** The diff of an outdated released tour with customer and product names, for the banner. */
export async function getTourDiffView(db: ReleaseDb, tour: ReleaseTour): Promise<TourDiffView> {
  const { plan, customers } = await loadReleasePlan(db, tour);
  const productIds = new Set<string>();
  const collect = (items: Array<StopItem | ItemChange>) =>
    items.forEach((i) => productIds.add(i.productId));
  const d = plan.diff;
  d.added.forEach((e) => collect(e.items));
  d.removed.forEach((e) => collect(e.items));
  d.changed.forEach((e) => collect(e.items));
  d.completedChanged.forEach((e) => collect(e.items));
  const products = new Map(
    (
      await db.product.findMany({
        where: { id: { in: [...productIds] } },
        select: { id: true, sku: true, name: true, unit: true },
      })
    ).map((p) => [p.id, p]),
  );
  const view = (
    stopId: string | null,
    customerId: string,
    lines: Array<{ productId: string; before: number; after: number }>,
  ): DiffStopView => {
    const c = customers.get(customerId);
    return {
      stopId,
      customerId,
      customerNumber: c?.customerNumber ?? "",
      name: c?.name ?? "",
      items: lines.map((l) => ({
        ...l,
        sku: products.get(l.productId)?.sku ?? "",
        name: products.get(l.productId)?.name ?? null,
        unit: products.get(l.productId)?.unit ?? "PACK",
      })),
    };
  };
  const asAdded = (items: StopItem[]) =>
    items.map((i) => ({ productId: i.productId, before: 0, after: i.quantity }));
  const asRemoved = (items: StopItem[]) =>
    items.map((i) => ({ productId: i.productId, before: i.quantity, after: 0 }));
  return {
    added: d.added.map((e) => view(null, e.customerId, asAdded(e.items))),
    removed: d.removed.map((e) => view(e.stopId, e.customerId, asRemoved(e.items))),
    changed: d.changed.map((e) => view(e.stopId, e.customerId, e.items)),
    completedChanged: d.completedChanged.map((e) => view(e.stopId, e.customerId, e.items)),
  };
}

// ---- the mutation ----

export type ReReleaseDeps = {
  db: PrismaClient;
  /** The admin who re-releases; recorded in the audit log. */
  actorId: string;
  provider: RoutingProvider;
  loadSettings: () => Promise<Pick<
    AppSettings,
    "timezone" | "departureTime" | "serviceMinutesPerStop"
  > | null>;
  /** NUD-212: re-release as a day route (own customers only, stops in route order). */
  route?: DayRouteScope;
};

export type ReReleaseOk = {
  /** False when nothing changed for the driver: only the outdated flag was cleared. */
  changed: boolean;
  revision: number;
  added: number;
  removed: number;
  changedStops: number;
  /** Delivered / problem stops whose orders were edited afterwards (reported, never re-dispatched). */
  completedChanged: number;
};

const reReleaseSchema = z
  .object({ tourId: z.string().trim().min(1).max(64), version: z.string().max(40) })
  .strict();

class ConflictError extends Error {}

const fail = (error: Extract<PlanResult, { ok: false }>["error"]) => ({
  ok: false as const,
  error,
});

const depotSchema = z.object({ lat: z.number(), lng: z.number() });

/** The audit view of a diff: per customer the quantities before / after (ids only, quantities in the audit encoding). */
function auditStops(diff: TourDiff) {
  const asAdded = (items: StopItem[]) =>
    items.map((i) => ({
      productId: i.productId,
      before: null,
      after: toAuditQuantity(i.quantity),
    }));
  const asRemoved = (items: StopItem[]) =>
    items.map((i) => ({
      productId: i.productId,
      before: toAuditQuantity(i.quantity),
      after: null,
    }));
  const asChanged = (items: ItemChange[]) =>
    items.map((i) => ({
      productId: i.productId,
      before: toAuditQuantity(i.before),
      after: toAuditQuantity(i.after),
    }));
  return [
    ...diff.added.map((e) => ({
      kind: "added",
      customerId: e.customerId,
      items: asAdded(e.items),
    })),
    ...diff.removed.map((e) => ({
      kind: "removed",
      customerId: e.customerId,
      items: asRemoved(e.items),
    })),
    ...diff.changed.map((e) => ({
      kind: "changed",
      customerId: e.customerId,
      items: asChanged(e.items),
    })),
    ...diff.completedChanged.map((e) => ({
      kind: "completed_changed",
      customerId: e.customerId,
      items: asChanged(e.items),
    })),
  ];
}

/**
 * Updates a RELEASED / IN_PROGRESS tour to the current confirmed orders and releases it again.
 * `version` is the tour's `updatedAt` the office saw next to the diff; if the tour, its stops or
 * the orders changed since, nothing is written (`conflict`).
 */
export async function reReleaseTourWith(
  deps: ReReleaseDeps,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<PlanResult<ReReleaseOk>> {
  const input = reReleaseSchema.safeParse(rawInput);
  if (!input.success) return fail("invalid");
  const version = new Date(input.data.version);
  if (!Number.isFinite(version.getTime())) return fail("invalid");
  const { db, provider } = deps;

  const tour = await loadReleaseTour(db, input.data.tourId);
  if (!tour) return fail("not_found");
  if (!isReReleasable(tour.status)) {
    return fail(isReleasedStatus(tour.status) ? "tour_not_editable" : "not_released");
  }
  if (!tour.driverId) return fail("driver_required");
  if (!tour.driver?.active || tour.driver.role !== "DRIVER") return fail("driver_invalid");
  if (tour.updatedAt.getTime() !== version.getTime()) return fail("conflict");

  const loaded = await loadReleasePlan(db, tour, deps.route);
  const { plan } = loaded;
  // A day route may only have changed its order (an extra moved): that is news for the driver too.
  const stopOrder = (ids: ReadonlyArray<string | null>) => ids.join("|");
  const reordered =
    !!deps.route &&
    stopOrder(plan.entries.flatMap((e) => (e.kind === "new" ? [] : [e.stopId]))) !==
      stopOrder(tour.stops.filter((s) => !plan.removedStopIds.includes(s.id)).map((s) => s.id));
  const dispatchable = isDispatchable(plan.diff) || reordered;
  const lockKey = `tour:${tour.date.toISOString().slice(0, 10)}`;
  const counts = {
    added: plan.diff.added.length,
    removed: plan.diff.removed.length,
    changedStops: plan.diff.changed.length,
    completedChanged: plan.diff.completedChanged.length,
  };

  // Guards shared by both paths, run inside the transaction behind the per-date lock.
  const recheck = async (tx: Pick<PrismaClient, "tour" | "stop" | "order">) => {
    const fresh = await tx.tour.findUnique({
      where: { id: tour.id },
      select: { updatedAt: true, status: true, stops: { select: { id: true, status: true } } },
    });
    if (
      !fresh ||
      fresh.updatedAt.getTime() !== tour.updatedAt.getTime() ||
      !isReReleasable(fresh.status) ||
      stopSignature(fresh.stops) !== loaded.stopSignature ||
      orderSignature(await listConfirmedOrdersForDate(tx, tour.date, { tourId: tour.id })) !==
        loaded.orderSignature
    ) {
      throw new ConflictError();
    }
  };
  const replaceLinks = async (
    tx: Pick<PrismaClient, "stop" | "stopOrder">,
    stopId: string,
    orderIds: string[],
    data: Prisma.StopUncheckedUpdateManyInput,
  ) => {
    // Guarded on PENDING: a stop the driver completed meanwhile is never touched.
    const updated = await tx.stop.updateMany({ where: { id: stopId, status: "PENDING" }, data });
    if (updated.count !== 1) throw new ConflictError();
    await tx.stopOrder.deleteMany({ where: { stopId } });
    await tx.stopOrder.createMany({ data: orderIds.map((orderId) => ({ stopId, orderId })) });
  };

  if (!dispatchable) {
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          await recheck(tx);
          for (const entry of plan.entries) {
            if (entry.kind === "existing") {
              // `sequence` unchanged: a real UPDATE whose row count proves the stop is still PENDING.
              await replaceLinks(tx, entry.stopId, entry.orderIds, {
                sequence: tour.stops.find((s) => s.id === entry.stopId)!.sequence,
              });
            }
          }
          await tx.tour.update({ where: { id: tour.id }, data: { isOutdated: false } });
          await recordAudit(tx, {
            actorId: deps.actorId,
            entity: "Tour",
            entityId: tour.id,
            action: "tour.rerelease",
            diff: {
              date: tour.date.toISOString().slice(0, 10),
              changed: false,
              revision: tour.releaseRevision,
              ...counts,
              stops: auditStops(plan.diff),
            },
          });
        },
        { timeout: 20_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (error instanceof ConflictError) return fail("conflict");
      throw error;
    }
    return { ok: true, changed: false, revision: tour.releaseRevision, ...counts };
  }

  // Dispatchable change: route over the new sequence (outside the transaction, like the builder).
  const settings = await deps.loadSettings();
  const depot = depotSchema.safeParse(tour.depotSnapshot);
  if (!settings || !depot.success) return fail("invalid");
  const customerPoint = (customerId: string) => {
    const c = loaded.customers.get(customerId);
    const point = c ? routingPoint(c) : null;
    return point ? { lat: point.lat, lng: point.lng } : null;
  };
  const points: Array<{ lat: number; lng: number }> = [];
  for (const entry of plan.entries) {
    const point = customerPoint(entry.customerId);
    if (!point) return fail("pin_missing");
    points.push(point);
  }
  // Reload trips (NUD-147): kept stops keep their trip, a new stop joins the last trip.
  const tripByStop = new Map(tour.stops.map((s) => [s.id, s.trip]));
  let lastTrip = 1;
  const rawTrips = plan.entries.map((entry) => {
    if (entry.kind !== "new") lastTrip = Math.max(lastTrip, tripByStop.get(entry.stopId) ?? 1);
    return entry.kind === "new" ? lastTrip : (tripByStop.get(entry.stopId) ?? 1);
  });
  const trips = normalizeTrips(rawTrips);
  // Each trip keeps its vehicle (NUD-158); a new stop rides with the last trip's vehicle.
  const vehicleIds = vehiclesForTrips(tour.stops, rawTrips);
  let route;
  try {
    route = await routeTrips(provider, depot.data, points, trips);
  } catch (error) {
    if (error instanceof RoutingError && error.code === "TOO_MANY_STOPS") {
      return fail("too_many_stops");
    }
    throw error;
  }
  const legs = route.stopLegs;
  const schedule = scheduleTrips(route, trips, {
    departure: departureInstant(tour.date, settings.departureTime, settings.timezone),
    serviceSecondsPerStop: settings.serviceMinutesPerStop * 60,
    pausesS: tripPausesS(tripVehicleIds(trips, vehicleIds, tour.vehicleId)),
  });

  const revision = tour.releaseRevision + 1;
  const stopById = new Map(tour.stops.map((s) => [s.id, s]));
  const customerLabel = (customerId: string) => {
    const c = loaded.customers.get(customerId);
    return { customerId, customerNumber: c?.customerNumber ?? "", name: c?.name ?? "" };
  };
  const lastChange = {
    revision,
    at: now.toISOString(),
    added: plan.diff.added.map((e) => ({ ...customerLabel(e.customerId), items: e.items })),
    removed: plan.diff.removed.map((e) => ({ ...customerLabel(e.customerId), items: e.items })),
    changed: plan.diff.changed.map((e) => ({
      stopId: e.stopId,
      ...customerLabel(e.customerId),
      items: e.items,
    })),
  };
  const finalStatuses = plan.entries.map((e) =>
    e.kind === "completed" ? stopById.get(e.stopId)!.status : "PENDING",
  );
  const nextStatus = deriveTourStatus(tour.status, finalStatuses);
  if (!canTransition(tour.status, nextStatus)) {
    throw new Error(`Illegal tour transition ${tour.status} -> ${nextStatus}`);
  }

  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        await recheck(tx);

        if (plan.removedStopIds.length > 0) {
          const deleted = await tx.stop.deleteMany({
            where: { id: { in: plan.removedStopIds }, status: "PENDING" },
          });
          if (deleted.count !== plan.removedStopIds.length) throw new ConflictError();
        }

        for (const [index, entry] of plan.entries.entries()) {
          const sequence = index + 1;
          if (entry.kind === "completed") {
            // Frozen: only the position may move (a stop removed before it closes the gap).
            const frozen = stopById.get(entry.stopId)!;
            const vehicleId = vehicleIds[index] ?? null;
            if (
              frozen.sequence !== sequence ||
              frozen.trip !== trips[index] ||
              frozen.vehicleId !== vehicleId
            ) {
              await tx.stop.update({
                where: { id: entry.stopId },
                data: { sequence, trip: trips[index], vehicleId },
              });
            }
            continue;
          }
          const timing = {
            sequence,
            trip: trips[index],
            vehicleId: vehicleIds[index] ?? null,
            etaAt: schedule.etas[index],
            legDistanceM: legs[index].distanceM,
            legDurationS: legs[index].durationS,
            items: entry.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
            })),
          };
          if (entry.kind === "existing") {
            const marker =
              entry.changes.length > 0
                ? {
                    previousItems: readStopItems(stopById.get(entry.stopId)!.items),
                    changeKind: "CHANGED" as const,
                    changedInRevision: revision,
                    adminChangedAt: now,
                  }
                : {};
            await replaceLinks(tx, entry.stopId, entry.orderIds, { ...timing, ...marker });
          } else {
            await tx.stop.create({
              data: {
                ...timing,
                tourId: tour.id,
                customerId: entry.customerId,
                changeKind: "ADDED",
                changedInRevision: revision,
                adminChangedAt: now,
                orders: { create: entry.orderIds.map((orderId) => ({ orderId })) },
              },
            });
          }
        }

        // NUD-172 (QA 2026-10-29 F3): a change mid-tour is re-anchored to the driver's real
        // departure instead of the planned one, so the re-release does not resurrect 06:30 times.
        await rebaseOnRelease(tx, tour.id, now);
        await tx.tour.update({
          where: { id: tour.id },
          data: {
            geometry: route.geometry,
            totalDistanceM: route.totalDistanceM,
            totalDurationS: schedule.totalDurationS,
            approximate: route.approximate,
            isOutdated: false,
            releaseRevision: revision,
            reReleasedAt: now,
            lastChange,
            status: nextStatus,
            ...(nextStatus === "COMPLETED" ? { completedAt: now } : {}),
          },
        });
        await recordAudit(tx, {
          actorId: deps.actorId,
          entity: "Tour",
          entityId: tour.id,
          action: "tour.rerelease",
          diff: {
            date: tour.date.toISOString().slice(0, 10),
            changed: true,
            revision,
            ...counts,
            stops: auditStops(plan.diff),
          },
        });
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof ConflictError) return fail("conflict");
    throw error;
  }
  return { ok: true, changed: true, revision, ...counts };
}
