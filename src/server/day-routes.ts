import { z } from "zod";

import { dayRouteOrder, type Place, resolvePlace, type RoutePath } from "@/domain/day-route";
import { isPastDeliveryDate, parseCalendarDate } from "@/domain/order";
import { routingPoint } from "@/domain/parking";
import type { LatLng } from "@/domain/routing";
import { calendarDayIn, type Depot, DepotNotSetError } from "@/domain/settings";
import { buildStops, departureInstant, partitionByLocation } from "@/domain/tour";
import { isTourEditable } from "@/domain/tour-plan";
import { isReReleasable } from "@/domain/tour-status";
import { orderWeightKg } from "@/domain/weight";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import { listConfirmedOrdersForDate } from "./orders";
import { customerLocationSelect } from "./routing-points";
import type { TourBuilderDeps, TourWarning } from "./tour-builder";
import { reReleaseTourWith } from "./tour-rerelease";
import { routeTrips, scheduleTrips } from "./tour-routing";
import { rebaseOnRelease } from "./tour-schedule";

/**
 * Day routes from standing tours (NUD-212, D34). The route of a delivery day is a standing tour in
 * its fixed order with the customers that ordered, plus the extras of that day (customers of no
 * standing tour), each where it adds the smallest detour unless the office moved it. "An Fahrer
 * senden" on the day plan turns every route into a released tour of its driver, and sends changes
 * again later through the re-release (completed stops stay frozen). Nothing is optimized.
 *
 * The caller must have checked the ADMIN role (`standing-actions.ts`).
 */

type Db = Pick<PrismaClient, "standingTour" | "order" | "customer">;

export type DayRouteDefinition = {
  id: string;
  name: string;
  driverId: string | null;
  vehicleId: string | null;
  /** Standing customers in standing order (all of them, not only today's). */
  members: string[];
  /** Customers of no standing tour with an order that day, placed on this route. */
  extras: Array<{ customerId: string; slot: number; moved: boolean }>;
  /** Every customer of the route in delivery order (members and extras). */
  order: string[];
};

export type DayRoutes = {
  routes: DayRouteDefinition[];
  /** The place of every extra of the day (customer id -> route and slot). */
  places: Map<string, Place & { moved: boolean }>;
  /** Customers of the routes (members and extras) without any location: never a stop. */
  unrouted: Set<string>;
  /** The delivery point of every customer of the routes (`null` = no location). */
  points: Map<string, LatLng | null>;
};

/** The active standing tours in their order; a customer belongs to the first one he is in. */
async function standingRoutes(db: Pick<PrismaClient, "standingTour">) {
  const rows = await db.standingTour.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      driverId: true,
      vehicleId: true,
      customers: {
        where: { customer: { active: true } },
        orderBy: [{ sortOrder: "asc" }, { customerId: "asc" }],
        select: { customerId: true },
      },
    },
  });
  const seen = new Set<string>();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    members: row.customers
      .map((c) => c.customerId)
      .filter((id) => (seen.has(id) ? false : (seen.add(id), true))),
  }));
}

/**
 * The routes of one delivery day: every active standing tour with its members, and the customers
 * of no standing tour that have a CONFIRMED order that day, placed on a route.
 */
export async function loadDayRoutes(db: Db, day: Date, depot: LatLng | null): Promise<DayRoutes> {
  const routes = await standingRoutes(db);
  const memberOf = new Set(routes.flatMap((r) => r.members));
  const orders = await db.order.findMany({
    where: { deliveryDate: day, status: "CONFIRMED", customerId: { notIn: [...memberOf] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      customerId: true,
      routeStandingTourId: true,
      routeSlot: true,
      items: { select: { quantity: true } },
    },
  });
  const extraIds: string[] = [];
  const wanted = new Map<string, { routeId: string | null; slot: number | null }>();
  for (const order of orders) {
    if (!order.items.some((i) => i.quantity > 0)) continue;
    if (!wanted.has(order.customerId)) extraIds.push(order.customerId);
    const before = wanted.get(order.customerId);
    // The first order the office placed decides; an unplaced one never overrides it.
    if (!before || (before.routeId === null && order.routeStandingTourId)) {
      wanted.set(order.customerId, {
        routeId: order.routeStandingTourId,
        slot: order.routeSlot,
      });
    }
  }
  const customers = await db.customer.findMany({
    where: { id: { in: [...memberOf, ...extraIds] } },
    select: customerLocationSelect,
  });
  const pointOf = new Map(
    customers.map((c) => {
      const point = routingPoint(c);
      return [c.id, point ? { lat: point.lat, lng: point.lng } : null] as const;
    }),
  );
  const paths: RoutePath[] = routes.map((r) => ({
    id: r.id,
    members: r.members.map((customerId) => ({
      customerId,
      location: pointOf.get(customerId) ?? null,
    })),
  }));
  const places = new Map<string, Place & { moved: boolean }>();
  for (const customerId of extraIds) {
    const place = resolvePlace(
      depot ?? { lat: 0, lng: 0 },
      paths,
      pointOf.get(customerId) ?? null,
      wanted.get(customerId)!,
    );
    if (place) places.set(customerId, place);
  }
  return {
    places,
    points: pointOf,
    unrouted: new Set([...pointOf].filter(([, point]) => point === null).map(([id]) => id)),
    routes: routes.map((route) => {
      const extras = extraIds.flatMap((customerId) => {
        const place = places.get(customerId);
        return place && place.routeId === route.id
          ? [{ customerId, slot: place.slot, moved: place.moved }]
          : [];
      });
      return { ...route, extras, order: dayRouteOrder(route.members, extras) };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Sending

export const sendDaySchema = z
  .object({
    date: z.string().trim().min(1).max(10),
    /** The office confirmed to send although a route is heavier than its vehicle. */
    overrideOverload: z.boolean().optional(),
  })
  .strict();

export type SendDayError =
  | "invalid"
  | "invalid_date"
  | "date_in_past"
  | "depot_not_set"
  | "no_routes"
  | "no_stops"
  | "driver_required"
  | "driver_invalid"
  | "vehicle_required"
  | "vehicle_invalid"
  | "overloaded"
  | "conflict";

export type SendOutcome = "sent" | "updated" | "unchanged" | "empty";

export type SendDayResult =
  | {
      ok: true;
      routes: Array<{
        standingTourId: string;
        tourId: string | null;
        outcome: SendOutcome;
        stopCount: number;
      }>;
      /** Customers with an order but no location at all: on no route. */
      warnings: TourWarning[];
    }
  | {
      ok: false;
      error: SendDayError;
      /** The route the error is about (driver, vehicle, overload). */
      standingTourId?: string;
      /** Overload: kilograms above the capacity. */
      overKg?: number;
    };

class ConflictError extends Error {}

const OPEN = { not: "COMPLETED" } as const;

export async function sendDayWith(
  deps: TourBuilderDeps,
  rawInput: unknown,
): Promise<SendDayResult> {
  const { db } = deps;
  const input = sendDaySchema.safeParse(rawInput);
  if (!input.success) return { ok: false, error: "invalid" };
  const day = parseCalendarDate(input.data.date);
  if (!day) return { ok: false, error: "invalid_date" };

  let depot: Depot;
  try {
    depot = await deps.requireDepot();
  } catch (error) {
    if (error instanceof DepotNotSetError) return { ok: false, error: "depot_not_set" };
    throw error;
  }
  const settings = await deps.loadSettings();
  if (!settings) return { ok: false, error: "depot_not_set" };
  const now = (deps.now ?? (() => new Date()))();
  const { y, m, d } = calendarDayIn(now, settings.timezone);
  if (isPastDeliveryDate(day, new Date(Date.UTC(y, m - 1, d)))) {
    return { ok: false, error: "date_in_past" };
  }
  const depotPoint = { lat: depot.lat, lng: depot.lng };
  const dayText = day.toISOString().slice(0, 10);

  const plan = await loadDayRoutes(db, day, depotPoint);
  if (plan.routes.length === 0) return { ok: false, error: "no_routes" };

  // ---- what each route carries: the day's orders of its customers that are not delivered yet
  const products = (await db.product.findMany({ select: { id: true, weightKgPerUnit: true } })).map(
    (p) => ({ id: p.id, weightKgPerUnit: p.weightKgPerUnit.toString() }),
  );
  const allOrders = await db.order.findMany({
    where: {
      deliveryDate: day,
      status: "CONFIRMED",
      customerId: { in: plan.routes.flatMap((r) => r.order) },
      stopOrders: { none: { stop: { tour: { status: "COMPLETED" } } } },
    },
    select: { customerId: true, items: { select: { productId: true, quantity: true } } },
  });
  const customers = new Map(
    (
      await db.customer.findMany({
        where: { id: { in: [...new Set(allOrders.map((o) => o.customerId))] } },
        select: customerLocationSelect,
      })
    ).map((c) => [c.id, c]),
  );
  const unrouted = new Set(
    [...customers.values()].filter((c) => routingPoint(c) === null).map((c) => c.id),
  );
  const warnings: TourWarning[] = [...unrouted].map((customerId) => {
    const c = customers.get(customerId)!;
    return {
      code: "NO_LOCATION",
      customerId,
      customerNumber: c.customerNumber,
      name: c.name,
      orderIds: [],
    };
  });

  // ---- check every route before anything is written
  const used = plan.routes.filter((route) =>
    allOrders.some(
      (o) =>
        route.order.includes(o.customerId) &&
        !unrouted.has(o.customerId) &&
        o.items.some((i) => i.quantity > 0),
    ),
  );
  const openTours = await db.tour.findMany({
    where: { date: day, status: OPEN },
    select: { id: true, standingTourId: true, status: true, _count: { select: { stops: true } } },
  });
  if (used.length === 0 && !openTours.some((t) => t.standingTourId && t._count.stops > 0)) {
    return { ok: false, error: "no_stops" };
  }
  const people = await db.user.findMany({
    where: { id: { in: used.flatMap((r) => (r.driverId ? [r.driverId] : [])) } },
    select: { id: true, active: true, role: true },
  });
  const vans = await db.vehicle.findMany({
    where: { id: { in: used.flatMap((r) => (r.vehicleId ? [r.vehicleId] : [])) } },
    select: { id: true, active: true, capacityKg: true },
  });
  for (const route of used) {
    const fail = (error: SendDayError, extra: { overKg?: number } = {}): SendDayResult => ({
      ok: false,
      error,
      standingTourId: route.id,
      ...extra,
    });
    if (!route.driverId) return fail("driver_required");
    const driver = people.find((p) => p.id === route.driverId);
    if (!driver?.active || driver.role !== "DRIVER") return fail("driver_invalid");
    if (!route.vehicleId) return fail("vehicle_required");
    const van = vans.find((v) => v.id === route.vehicleId);
    if (!van?.active) return fail("vehicle_invalid");
    const loadKg = orderWeightKg(
      allOrders.filter((o) => route.order.includes(o.customerId)).flatMap((o) => o.items),
      products,
    );
    if (loadKg > van.capacityKg && input.data.overrideOverload !== true) {
      return fail("overloaded", { overKg: Math.round((loadKg - van.capacityKg) * 10) / 10 });
    }
  }

  // ---- tours of the old flow ("Touren planen"): unreleased ones are emptied, released ones of a
  // standing driver are taken over by his route
  const oldFlow = await db.tour.findMany({
    where: { date: day, status: OPEN, standingTourId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, driverId: true, _count: { select: { stops: true } } },
  });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tour:${dayText}`}))`;
    for (const tour of oldFlow) {
      if (isTourEditable(tour.status)) {
        if (tour._count.stops === 0) continue;
        await tx.stop.deleteMany({ where: { tourId: tour.id } });
        await tx.tour.update({
          where: { id: tour.id },
          data: {
            isOutdated: false,
            driverId: null,
            vehicleId: null,
            geometry: Prisma.DbNull,
            totalDistanceM: null,
            totalDurationS: null,
          },
        });
        await recordAudit(tx, {
          actorId: deps.actorId,
          entity: "Tour",
          entityId: tour.id,
          action: "tour.plan_day",
          diff: { date: dayText, mode: "emptied", via: "day_route", stopCount: 0 },
        });
        continue;
      }
      const route = plan.routes.find((r) => r.driverId && r.driverId === tour.driverId);
      const taken = await tx.tour.count({
        where: { date: day, status: OPEN, standingTourId: route?.id ?? "-" },
      });
      if (route && taken === 0) {
        await tx.tour.update({ where: { id: tour.id }, data: { standingTourId: route.id } });
      }
    }
  });

  // ---- send: two passes, because a stop that moves from one route to another must leave the
  // first tour before the second can take its order
  const outcomes = new Map<string, { tourId: string | null; outcome: SendOutcome }>();
  const rank: Record<SendOutcome, number> = { empty: 0, unchanged: 1, updated: 2, sent: 3 };
  const note = (routeId: string, tourId: string | null, outcome: SendOutcome) => {
    const before = outcomes.get(routeId);
    if (!before || rank[outcome] > rank[before.outcome] || (tourId && !before.tourId)) {
      outcomes.set(routeId, {
        tourId: tourId ?? before?.tourId ?? null,
        outcome: before && rank[before.outcome] > rank[outcome] ? before.outcome : outcome,
      });
    }
  };

  try {
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const route of plan.routes) {
        const keys = new Map(route.order.map((id, index) => [id, index]));
        const tour = await db.tour.findFirst({
          where: { date: day, standingTourId: route.id, status: OPEN },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, status: true, driverId: true, vehicleId: true, updatedAt: true },
        });
        if (tour && isReReleasable(tour.status)) {
          const outcome = await updateRoute(deps, route, tour, keys, now);
          note(route.id, tour.id, outcome);
          changed ||= outcome !== "unchanged";
          continue;
        }
        const built = await buildRoute(deps, {
          route,
          day,
          keys,
          depot,
          settings,
          now,
          unrouted,
          reuse: tour && isTourEditable(tour.status) ? tour.id : null,
        });
        note(route.id, built.tourId, built.outcome);
        changed ||= built.outcome === "sent";
      }
      if (!changed) break;
    }
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, error: "conflict" };
    throw error;
  }

  const counts = await db.stop.groupBy({
    by: ["tourId"],
    where: { tourId: { in: [...outcomes.values()].flatMap((o) => (o.tourId ? [o.tourId] : [])) } },
    _count: { _all: true },
  });
  return {
    ok: true,
    warnings,
    routes: plan.routes.map((route) => {
      const result = outcomes.get(route.id) ?? { tourId: null, outcome: "empty" as const };
      return {
        standingTourId: route.id,
        tourId: result.tourId,
        outcome: result.outcome,
        stopCount: counts.find((c) => c.tourId === result.tourId)?._count._all ?? 0,
      };
    }),
  };
}

/** A released or running tour of the route: driver / vehicle taken over, then re-released. */
async function updateRoute(
  deps: TourBuilderDeps,
  route: DayRouteDefinition,
  tour: { id: string; driverId: string | null; vehicleId: string | null },
  keys: ReadonlyMap<string, number>,
  now: Date,
): Promise<SendOutcome> {
  const { db } = deps;
  let reassigned = false;
  if (
    (route.driverId && route.driverId !== tour.driverId) ||
    (route.vehicleId && route.vehicleId !== tour.vehicleId)
  ) {
    await db.$transaction(async (tx) => {
      await tx.tour.update({
        where: { id: tour.id },
        data: {
          ...(route.driverId ? { driverId: route.driverId } : {}),
          ...(route.vehicleId ? { vehicleId: route.vehicleId } : {}),
        },
      });
      if (route.driverId && route.driverId !== tour.driverId) {
        await recordAudit(tx, {
          actorId: deps.actorId,
          entity: "Tour",
          entityId: tour.id,
          action: "tour.assign_driver",
          diff: { driverId: { from: tour.driverId, to: route.driverId }, via: "day_route" },
        });
      }
      if (route.vehicleId && route.vehicleId !== tour.vehicleId) {
        await recordAudit(tx, {
          actorId: deps.actorId,
          entity: "Tour",
          entityId: tour.id,
          action: "tour.assign_vehicle",
          diff: { vehicleId: { from: tour.vehicleId, to: route.vehicleId }, via: "day_route" },
        });
      }
    });
    reassigned = true;
  }
  const fresh = await db.tour.findUniqueOrThrow({
    where: { id: tour.id },
    select: { updatedAt: true },
  });
  const result = await reReleaseTourWith(
    {
      db,
      actorId: deps.actorId,
      provider: deps.provider,
      loadSettings: deps.loadSettings,
      route: { customerIds: new Set(keys.keys()), orderKey: (id) => keys.get(id) },
    },
    { tourId: tour.id, version: fresh.updatedAt.toISOString() },
    now,
  );
  if (!result.ok) {
    if (result.error === "conflict") throw new ConflictError();
    throw new Error(`Re-release of day route failed: ${result.error}`);
  }
  return result.changed || reassigned ? "updated" : "unchanged";
}

/**
 * A route without an open tour (or with an unreleased one of the old flow): its free orders become
 * a new released tour of the route's driver, stops in route order.
 */
async function buildRoute(
  deps: TourBuilderDeps,
  input: {
    route: DayRouteDefinition;
    day: Date;
    keys: ReadonlyMap<string, number>;
    depot: Depot;
    settings: NonNullable<Awaited<ReturnType<TourBuilderDeps["loadSettings"]>>>;
    now: Date;
    unrouted: ReadonlySet<string>;
    reuse: string | null;
  },
): Promise<{ tourId: string | null; outcome: SendOutcome }> {
  const { db, provider } = deps;
  const { route, day, keys, depot, settings, now } = input;
  const dayText = day.toISOString().slice(0, 10);
  const scope = { tourId: input.reuse };
  const signatureOf = (orders: ReadonlyArray<{ id: string; updatedAt: Date }>) =>
    orders.map((o) => `${o.id}@${o.updatedAt.getTime()}`).join("|");
  const free = (await listConfirmedOrdersForDate(db, day, scope)).filter((o) =>
    keys.has(o.customerId),
  );
  const customers = new Map(
    (
      await db.customer.findMany({
        where: { id: { in: [...new Set(free.map((o) => o.customerId))] } },
        select: customerLocationSelect,
      })
    ).map((c) => [c.id, c]),
  );
  const { routable } = partitionByLocation(buildStops(free), customers);
  const stops = routable.sort((a, b) => keys.get(a.customerId)! - keys.get(b.customerId)!);
  if (stops.length === 0) return { tourId: input.reuse, outcome: "empty" };

  const points = stops.map((s) => {
    const p = routingPoint(customers.get(s.customerId)!)!;
    return { lat: p.lat, lng: p.lng };
  });
  const depotPoint = { lat: depot.lat, lng: depot.lng };
  const trips = stops.map(() => 1);
  const routed = await routeTrips(provider, depotPoint, points, trips);
  const schedule = scheduleTrips(routed, trips, {
    departure: departureInstant(day, settings.departureTime, settings.timezone),
    serviceSecondsPerStop: settings.serviceMinutesPerStop * 60,
  });
  const signature = signatureOf(free);

  const tourId = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tour:${dayText}`}))`;
      const current = (await listConfirmedOrdersForDate(tx, day, scope)).filter((o) =>
        keys.has(o.customerId),
      );
      if (signatureOf(current) !== signature) throw new ConflictError();
      const data = {
        status: "RELEASED" as const,
        isOutdated: false,
        locked: false,
        driverId: route.driverId,
        vehicleId: route.vehicleId,
        standingTourId: route.id,
        depotSnapshot: { name: depot.name, address: depot.address, lat: depot.lat, lng: depot.lng },
        geometry: routed.geometry,
        totalDistanceM: routed.totalDistanceM,
        totalDurationS: schedule.totalDurationS,
        approximate: routed.approximate,
        optimizedAt: now,
        releasedAt: now,
        releaseRevision: 1,
      };
      let id: string;
      if (input.reuse) {
        await tx.stop.deleteMany({ where: { tourId: input.reuse } });
        id = (await tx.tour.update({ where: { id: input.reuse }, data })).id;
      } else {
        id = (await tx.tour.create({ data: { date: day, ...data } })).id;
      }
      for (const [index, stop] of stops.entries()) {
        await tx.stop.create({
          data: {
            tourId: id,
            customerId: stop.customerId,
            sequence: index + 1,
            trip: 1,
            etaAt: schedule.etas[index],
            legDistanceM: routed.stopLegs[index]!.distanceM,
            legDurationS: routed.stopLegs[index]!.durationS,
            items: stop.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
            orders: { create: stop.orderIds.map((orderId) => ({ orderId })) },
          },
        });
      }
      await recordAudit(tx, {
        actorId: deps.actorId,
        entity: "Tour",
        entityId: id,
        action: "tour.release",
        diff: {
          date: dayText,
          via: "day_route",
          standingTourId: route.id,
          stopCount: stops.length,
          driverId: route.driverId,
          vehicleId: route.vehicleId,
          releasedAt: now.toISOString(),
          customerIds: stops.map((s) => s.customerId),
        },
      });
      await rebaseOnRelease(tx, id, now);
      return id;
    },
    { timeout: 30_000 + 500 * stops.length, maxWait: 10_000 },
  );
  return { tourId, outcome: "sent" };
}
