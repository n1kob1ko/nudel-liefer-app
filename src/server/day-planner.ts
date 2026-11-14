import { z } from "zod";

import { isOpenTour, sortDayTours } from "@/domain/day-tours";
import { secondsOfDayIn } from "@/domain/delivery-window";
import {
  attachToNearestGroup,
  type FleetStop,
  groupChainsByDriver,
  orderTrip,
  packReloadTrips,
  pickStopsWithinLimit,
  RELOAD_SECONDS,
  splitByStandingTours,
  tripLoadsKg,
  tripPausesS,
  vehiclesForLoad,
} from "@/domain/fleet";
import { isPastDeliveryDate, parseCalendarDate } from "@/domain/order";
import { routingPoint } from "@/domain/parking";
import { calendarDayIn, type Depot, DepotNotSetError } from "@/domain/settings";
import { buildStops, departureInstant, partitionByLocation, type PlannedStop } from "@/domain/tour";
import { isTourEditable } from "@/domain/tour-plan";
import { orderWeightKg } from "@/domain/weight";
import { Prisma } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import { listConfirmedOrdersForDate } from "./orders";
import { MAX_STOPS, RoutingError } from "./routing";
import { customerLocationSelect } from "./routing-points";
import { type TourBuilderDeps, type TourWarning } from "./tour-builder";
import { MAX_TOURS_PER_DAY } from "./tour-edit";
import { concatRoutedTrips, routeTrips, scheduleTrips } from "./tour-routing";

/**
 * "Touren planen" (NUD-147, D24): builds all tours of one delivery day at once. The office selects
 * the vehicles (and drivers) that are available; the routing provider distributes the day's stops
 * across the vehicles without exceeding a capacity. Order of preference: every selected vehicle is
 * used before any vehicle gets a reload trip; what still does not fit becomes a second (third, ...)
 * trip of a vehicle that returns to the depot in between (`Stop.trip`).
 *
 * Rules (backlog §9): unreleased tours of the day (DRAFT / OPTIMIZED) are rebuilt (their rows are
 * reused in creation order, surplus ones are emptied, never deleted); a released, running or
 * locked tour of the day refuses the plan; completed tours are history and their orders are left
 * alone. A vehicle that is not needed gets no tour. Drivers are paired with the tours in the
 * order they were selected; missing drivers are assigned later.
 *
 * Fewer drivers than vehicles (NUD-158): there are at most as many tours as selected drivers. A
 * driver who is back at the depot switches into the next vehicle that was loaded in the morning
 * (`VEHICLE_SWITCH_MINUTES`) instead of waiting for a reload; a vehicle is never shared by two
 * drivers. Reload trips remain for what still does not fit.
 *
 * The caller must have checked the ADMIN role (see `tour-actions.ts`).
 */

export type PlanDayError =
  | "invalid"
  | "invalid_date"
  | "date_in_past"
  | "depot_not_set"
  | "no_stops"
  | "no_vehicles"
  | "vehicle_invalid"
  | "driver_invalid"
  | "too_many_stops"
  /** A tour of the day is released or running: it is the driver's now (edit it with "Bearbeiten"). */
  | "tour_not_editable"
  | "tour_locked"
  | "conflict";

export type PlannedTourSummary = {
  tourId: string;
  vehicleId: string;
  driverId: string | null;
  stopCount: number;
  /** Vehicle of each trip (index 0 = trip 1); differs from `vehicleId` after a vehicle switch. */
  tripVehicleIds: string[];
  /** Number of trips (> 1 = reload trips or vehicle switches at the depot). */
  trips: number;
  /** Kilograms per trip. */
  tripLoadsKg: number[];
  /** Trips that start with a reload of the same vehicle. */
  reloads: number;
  /** Trips that start with a switch into another, already loaded vehicle (NUD-158). */
  vehicleSwitches: number;
};

export type PlanDayResult =
  | {
      ok: true;
      tours: PlannedTourSummary[];
      reloadTrips: number;
      /** Times a driver changes into another loaded vehicle at the depot (NUD-158). */
      vehicleSwitches: number;
      approximate: boolean;
      /** Customers with no location at all (left out). */
      warnings: TourWarning[];
      /** Customers whose stop alone is heavier than any selected vehicle. */
      oversizedCustomerIds: string[];
      /** Customers that go to the address point because they have no Parkplatz. */
      parkingMissing: TourWarning[];
      /**
       * Customers not planned today (STOP_LIMIT): the day has more than `MAX_STOPS` stops, so only
       * the compact cluster around the depot is planned; these orders stay on no tour.
       */
      deferred: TourWarning[];
    }
  | { ok: false; error: PlanDayError; maxStops?: number; warnings: TourWarning[] };

const idSchema = z.string().trim().min(1).max(64);

export const planDaySchema = z
  .object({
    date: z.string().trim().min(1).max(10),
    /** Available vehicles; omitted = every active vehicle. */
    vehicleIds: z.array(idSchema).max(MAX_TOURS_PER_DAY).optional(),
    /** Available drivers; omitted = every active driver. */
    driverIds: z.array(idSchema).max(MAX_TOURS_PER_DAY).optional(),
  })
  .strict();

function orderSignature(orders: ReadonlyArray<{ id: string; updatedAt: Date }>): string {
  return orders.map((o) => `${o.id}@${o.updatedAt.getTime()}`).join("|");
}

function toursSignature(tours: ReadonlyArray<{ id: string; updatedAt: Date; status: string }>) {
  return tours.map((t) => `${t.id}@${t.updatedAt.getTime()}@${t.status}`).join("|");
}

export async function planDayWith(
  deps: TourBuilderDeps,
  rawInput: unknown,
): Promise<PlanDayResult> {
  const { db, provider } = deps;
  const fail = (
    error: PlanDayError,
    warnings: TourWarning[] = [],
    extra: { maxStops?: number } = {},
  ): PlanDayResult => ({ ok: false, error, warnings, ...extra });

  const parsedInput = planDaySchema.safeParse(rawInput);
  if (!parsedInput.success) return fail("invalid");
  const date = parseCalendarDate(parsedInput.data.date);
  if (!date) return fail("invalid_date");

  let depot: Depot;
  try {
    depot = await deps.requireDepot();
  } catch (error) {
    if (error instanceof DepotNotSetError) return fail("depot_not_set");
    throw error;
  }
  const settings = await deps.loadSettings();
  if (!settings) return fail("depot_not_set");
  const now = (deps.now ?? (() => new Date()))();
  const { y, m, d } = calendarDayIn(now, settings.timezone);
  if (isPastDeliveryDate(date, new Date(Date.UTC(y, m - 1, d)))) return fail("date_in_past");

  // ---- the tours of the day
  const dayTours = sortDayTours(
    await db.tour.findMany({
      where: { date },
      select: { id: true, status: true, locked: true, createdAt: true, updatedAt: true },
    }),
  );
  const open = dayTours.filter((t) => isOpenTour(t.status));
  if (open.some((t) => !isTourEditable(t.status))) return fail("tour_not_editable");
  if (open.some((t) => t.locked)) return fail("tour_locked");
  const rebuild = open;

  // ---- vehicles and drivers
  const requestedVehicles = [...new Set(parsedInput.data.vehicleIds ?? [])];
  const vehicleRows = await db.vehicle.findMany({
    where: {
      active: true,
      ...(parsedInput.data.vehicleIds ? { id: { in: requestedVehicles } } : {}),
    },
    orderBy: [{ capacityKg: "desc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, capacityKg: true },
  });
  if (parsedInput.data.vehicleIds && vehicleRows.length !== requestedVehicles.length) {
    return fail("vehicle_invalid");
  }
  const vehicles = (
    parsedInput.data.vehicleIds
      ? requestedVehicles.map((id) => vehicleRows.find((v) => v.id === id)!)
      : vehicleRows
  ).slice(0, MAX_TOURS_PER_DAY);
  if (vehicles.length === 0) return fail("no_vehicles");

  const requestedDrivers = [...new Set(parsedInput.data.driverIds ?? [])];
  const driverRows = await db.user.findMany({
    where: {
      role: "DRIVER",
      active: true,
      ...(parsedInput.data.driverIds ? { id: { in: requestedDrivers } } : {}),
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (parsedInput.data.driverIds && driverRows.length !== requestedDrivers.length) {
    return fail("driver_invalid");
  }
  const driverIds = parsedInput.data.driverIds ? requestedDrivers : driverRows.map((r) => r.id);

  // ---- the stops of the day (orders that no other tour of the day already carries)
  const orders = await listConfirmedOrdersForDate(db, date, {
    rebuildTourIds: rebuild.map((t) => t.id),
  });
  const planned = buildStops(orders);
  const customers = await db.customer.findMany({
    where: { id: { in: planned.map((s) => s.customerId) } },
    select: customerLocationSelect,
  });
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const { routable, unrouted, withoutParking } = partitionByLocation(planned, customerById);
  const toWarning = (stop: PlannedStop): TourWarning => {
    const c = customerById.get(stop.customerId);
    return {
      code: "NO_LOCATION",
      customerId: stop.customerId,
      customerNumber: c?.customerNumber ?? "",
      name: c?.name ?? "",
      orderIds: stop.orderIds,
    };
  };
  const warnings = unrouted.map(toWarning);
  if (routable.length === 0) return fail("no_stops", warnings);
  const depotPoint = { lat: depot.lat, lng: depot.lng };
  // One routing call takes at most MAX_STOPS stops. Instead of refusing the day, plan the compact
  // cluster around the depot (shortest drive) and report the outlying customers as not planned.
  const limited = pickStopsWithinLimit(
    depotPoint,
    routable.map((stop) => {
      const point = routingPoint(customerById.get(stop.customerId)!)!;
      return { id: stop.customerId, location: { lat: point.lat, lng: point.lng }, stop };
    }),
    MAX_STOPS,
  );
  const toPlan = limited.picked.map((p) => p.stop);
  const deferred: TourWarning[] = limited.deferred.map((p) => ({
    ...toWarning(p.stop),
    code: "STOP_LIMIT",
  }));
  const planIds = new Set(toPlan.map((s) => s.customerId));
  const parkingMissing = withoutParking.filter((s) => planIds.has(s.customerId)).map(toWarning);

  const productIds = [...new Set(toPlan.flatMap((s) => s.items.map((i) => i.productId)))];
  const products = (
    await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, weightKgPerUnit: true },
    })
  ).map((p) => ({ id: p.id, weightKgPerUnit: p.weightKgPerUnit.toString() }));

  const serviceSeconds = settings.serviceMinutesPerStop * 60;
  const departureS = secondsOfDayIn(
    departureInstant(date, settings.departureTime, settings.timezone),
    settings.timezone,
  );
  const byCustomer = new Map(toPlan.map((s) => [s.customerId, s]));
  const fleetStops = toPlan.map((s) => {
    const point = routingPoint(customerById.get(s.customerId)!)!;
    return {
      id: s.customerId,
      location: { lat: point.lat, lng: point.lng },
      weightKg: orderWeightKg(s.items, products),
      ...(s.timeWindow ? { timeWindow: { fromS: s.timeWindow.fromS, toS: s.timeWindow.toS } } : {}),
    } satisfies FleetStop;
  });
  const fleetById = new Map(fleetStops.map((s) => [s.id, s]));

  // ---- distribute, then reload trips for what fits nowhere, then route every tour
  const signature = orderSignature(orders);
  const dayState = toursSignature(dayTours);
  /** What one vehicle drives: its first trip and its reload trips (stop ids per trip). */
  type VehicleChain = { vehicleId: string; trips: string[][] };
  /** A tour = one driver's day: one or more vehicle chains after one another (NUD-158). */
  type BuiltTour = {
    /** The driver of the tour, `null` = assigned later. */
    driverId: string | null;
    vehicleIds: string[];
    ordered: PlannedStop[];
    tripOfStop: number[];
    /** Per stop: the vehicle of its trip, `null` = the tour's vehicle (the first chain's). */
    stopVehicleIds: Array<string | null>;
    tripVehicles: string[];
    pausesS: number[];
    routed: Awaited<ReturnType<typeof routeTrips>>;
    schedule: ReturnType<typeof scheduleTrips>;
    loads: number[];
  };
  let oversized: string[] = [];
  let approximate = false;
  const built: BuiltTour[] = [];
  const departure = departureInstant(date, settings.departureTime, settings.timezone);

  /**
   * Builds the tours of `subset` with the vehicles `fleet` and the drivers `tourDrivers` (paired in
   * order; none = assigned later): distribute, reload trips for what fits nowhere, route.
   */
  async function buildTours(
    subset: FleetStop[],
    fleet: typeof vehicles,
    tourDrivers: readonly string[],
  ): Promise<BuiltTour[]> {
    const tours: BuiltTour[] = [];
    // Fewer drivers than vehicles (NUD-158): load only as many vehicles as the day needs (the
    // largest first), but at least one per driver. The drivers who come back early take the
    // next loaded vehicle; reloading one comes last.
    const firstLoadVehicles =
      tourDrivers.length > 0 && tourDrivers.length < fleet.length
        ? vehiclesForLoad(fleet, tourDrivers.length, subset)
        : fleet;
    const distribution = await provider.distribute({
      depot: depotPoint,
      vehicles: firstLoadVehicles.map((v) => ({ id: v.id, capacityKg: v.capacityKg })),
      stops: subset.map((s) => ({ ...s, serviceSeconds })),
      departureS,
    });
    approximate = approximate || distribution.approximate;
    const tripsByVehicle = new Map<string, string[][]>(fleet.map((v) => [v.id, [] as string[][]]));
    for (const route of distribution.routes)
      tripsByVehicle.get(route.vehicleId)?.push(route.stopIds);
    // What fits nowhere: a vehicle that is still loaded and unused first, then reload trips.
    const reload = packReloadTrips(
      depotPoint,
      fleet,
      new Map([...tripsByVehicle].map(([id, trips]) => [id, trips.length])),
      distribution.unassigned.map((id) => fleetById.get(id)!),
    );
    oversized = [...oversized, ...reload.oversized];
    for (const trip of reload.trips) {
      const stops = trip.stopIds.map((id) => fleetById.get(id)!);
      let order = trip.stopIds;
      if (stops.length > 1) {
        const optimized = await provider.optimize({
          depot: depotPoint,
          departureS,
          stops: stops.map((s) => ({
            id: s.id,
            location: s.location,
            serviceSeconds,
            ...(s.timeWindow ? { timeWindow: s.timeWindow } : {}),
          })),
        });
        approximate = approximate || optimized.approximate;
        order =
          optimized.orderedStopIds.length === stops.length
            ? optimized.orderedStopIds
            : orderTrip(depotPoint, stops);
      }
      tripsByVehicle.get(trip.vehicleId)!.push(order);
    }
    const chains: VehicleChain[] = fleet
      .map((v) => ({ vehicleId: v.id, trips: tripsByVehicle.get(v.id)! }))
      .filter((v) => v.trips.length > 0);

    // Route every chain on its own (depot to depot), then hand the chains to the drivers.
    const routedChains: Array<{
      chain: VehicleChain;
      ordered: PlannedStop[];
      tripOfStop: number[];
      routed: Awaited<ReturnType<typeof routeTrips>>;
      durationS: number;
    }> = [];
    for (const chain of chains) {
      const ordered = chain.trips.flat().map((id) => byCustomer.get(id)!);
      const tripOfStop = chain.trips.flatMap((ids, index) => ids.map(() => index + 1));
      const points = ordered.map((s) => fleetById.get(s.customerId)!.location);
      const routed = await routeTrips(provider, depotPoint, points, tripOfStop);
      approximate = approximate || routed.approximate;
      const schedule = scheduleTrips(routed, tripOfStop, {
        departure,
        serviceSecondsPerStop: serviceSeconds,
      });
      routedChains.push({ chain, ordered, tripOfStop, routed, durationS: schedule.totalDurationS });
    }

    for (const group of groupChainsByDriver(routedChains, tourDrivers.length)) {
      const parts = group.map((index) => routedChains[index]!);
      const ordered = parts.flatMap((p) => p.ordered);
      const tripOfStop: number[] = [];
      const stopVehicleIds: Array<string | null> = [];
      const tripVehicles: string[] = [];
      for (const [partIndex, part] of parts.entries()) {
        const offset = tripVehicles.length;
        tripOfStop.push(...part.tripOfStop.map((trip) => trip + offset));
        stopVehicleIds.push(
          ...part.ordered.map(() => (partIndex === 0 ? null : part.chain.vehicleId)),
        );
        tripVehicles.push(...part.chain.trips.map(() => part.chain.vehicleId));
      }
      const pausesS = tripPausesS(tripVehicles);
      const routed = concatRoutedTrips(parts.map((p) => p.routed));
      const schedule = scheduleTrips(routed, tripOfStop, {
        departure,
        serviceSecondsPerStop: serviceSeconds,
        pausesS,
      });
      const loads = tripLoadsKg(
        ordered.map((s, i) => ({
          trip: tripOfStop[i]!,
          weightKg: fleetById.get(s.customerId)!.weightKg,
        })),
      );
      tours.push({
        driverId: tourDrivers[tours.length] ?? null,
        vehicleIds: parts.map((p) => p.chain.vehicleId),
        ordered,
        tripOfStop,
        stopVehicleIds,
        tripVehicles,
        pausesS,
        routed,
        schedule,
        loads,
      });
    }
    return tours;
  }

  try {
    // Standing tours (NUD-209): the customers of a standing tour go to its default driver, each
    // standing driver in a vehicle of his own (the heaviest group gets the largest vehicle). The
    // customers outside the standing tours go to the remaining drivers and vehicles; when none are
    // left, to the standing tour with the nearest customer. Without a standing tour for the
    // selected drivers, or with more standing drivers than vehicles, the whole day is planned
    // freely as before.
    const standing = await db.standingTour.findMany({
      where: { active: true, driverId: { in: driverIds } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        driverId: true,
        customers: { orderBy: { sortOrder: "asc" }, select: { customerId: true } },
      },
    });
    const split = splitByStandingTours(
      fleetStops,
      standing.map((tour) => ({
        driverId: tour.driverId,
        customerIds: tour.customers.map((c) => c.customerId),
      })),
      driverIds,
    );
    if (split.groups.length === 0 || split.groups.length > vehicles.length) {
      built.push(...(await buildTours(fleetStops, vehicles, driverIds)));
    } else {
      const weight = (stops: FleetStop[]) => stops.reduce((sum, s) => sum + s.weightKg, 0);
      const byCapacity = [...vehicles].sort((a, b) => b.capacityKg - a.capacityKg);
      const heaviestFirst = [...split.groups].sort((a, b) => weight(b.stops) - weight(a.stops));
      const vehicleOf = new Map(heaviestFirst.map((group, i) => [group.driverId, byCapacity[i]!]));
      const spareVehicles = byCapacity.slice(split.groups.length);
      const standingDrivers = new Set(split.groups.map((g) => g.driverId));
      const freeDrivers = driverIds.filter((id) => !standingDrivers.has(id));
      const looseOnOwn =
        split.loose.length > 0 && freeDrivers.length > 0 && spareVehicles.length > 0;
      if (split.loose.length > 0 && !looseOnOwn) attachToNearestGroup(split.groups, split.loose);
      // `split.groups` is in the order of the selected drivers, so the result reads like the selection.
      for (const group of split.groups) {
        built.push(
          ...(await buildTours(group.stops, [vehicleOf.get(group.driverId)!], [group.driverId])),
        );
      }
      if (looseOnOwn) built.push(...(await buildTours(split.loose, spareVehicles, freeDrivers)));
    }
  } catch (error) {
    if (error instanceof RoutingError && error.code === "TOO_MANY_STOPS") {
      return fail("too_many_stops", warnings, { maxStops: MAX_STOPS });
    }
    throw error;
  }

  const optimizedAt = now;
  const summaries: PlannedTourSummary[] = [];

  return db.$transaction(
    async (tx): Promise<PlanDayResult> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tour:${date.toISOString().slice(0, 10)}`}))`;
      // Orders or tours changed while we were routing: the plan would be stale.
      const currentTours = sortDayTours(
        await tx.tour.findMany({
          where: { date },
          select: { id: true, status: true, updatedAt: true, createdAt: true },
        }),
      );
      const currentOrders = await listConfirmedOrdersForDate(tx, date, {
        rebuildTourIds: rebuild.map((t) => t.id),
      });
      if (
        toursSignature(currentTours) !== dayState ||
        orderSignature(currentOrders) !== signature
      ) {
        return fail("conflict", warnings);
      }

      // Existing stops of the tours that are rebuilt go; their orders are on the new stops below.
      if (rebuild.length > 0) {
        await tx.stop.deleteMany({ where: { tourId: { in: rebuild.map((t) => t.id) } } });
      }

      for (const [index, item] of built.entries()) {
        const driverId = item.driverId;
        const data = {
          status: "OPTIMIZED" as const,
          isOutdated: false,
          locked: false,
          driverId,
          vehicleId: item.vehicleIds[0]!,
          depotSnapshot: {
            name: depot.name,
            address: depot.address,
            lat: depot.lat,
            lng: depot.lng,
          },
          geometry: item.routed.geometry,
          totalDistanceM: item.routed.totalDistanceM,
          totalDurationS: item.schedule.totalDurationS,
          approximate: item.routed.approximate,
          optimizedAt,
        };
        const existing = rebuild[index];
        const tourId = existing
          ? (await tx.tour.update({ where: { id: existing.id }, data })).id
          : (await tx.tour.create({ data: { date, ...data } })).id;

        for (const [position, stop] of item.ordered.entries()) {
          await tx.stop.create({
            data: {
              tourId,
              customerId: stop.customerId,
              sequence: position + 1,
              trip: item.tripOfStop[position]!,
              vehicleId: item.stopVehicleIds[position] ?? null,
              etaAt: item.schedule.etas[position],
              legDistanceM: item.routed.stopLegs[position]!.distanceM,
              legDurationS: item.routed.stopLegs[position]!.durationS,
              items: stop.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
              orders: { create: stop.orderIds.map((orderId) => ({ orderId })) },
            },
          });
        }
        const summary: PlannedTourSummary = {
          tourId,
          vehicleId: item.vehicleIds[0]!,
          tripVehicleIds: item.tripVehicles,
          driverId,
          stopCount: item.ordered.length,
          trips: item.tripVehicles.length,
          tripLoadsKg: item.loads,
          reloads: item.pausesS.filter((p) => p === RELOAD_SECONDS).length,
          vehicleSwitches: item.pausesS.filter((p) => p !== RELOAD_SECONDS).length,
        };
        summaries.push(summary);
        await recordAudit(tx, {
          actorId: deps.actorId,
          entity: "Tour",
          entityId: tourId,
          action: "tour.plan_day",
          diff: {
            date: date.toISOString().slice(0, 10),
            mode: existing ? "replaced" : "created",
            vehicleId: item.vehicleIds[0]!,
            tripVehicleIds: item.tripVehicles,
            driverId,
            stopCount: item.ordered.length,
            trips: summary.trips,
            tripLoadsKg: summary.tripLoadsKg,
            customerIds: item.ordered.map((s) => s.customerId),
            approximate: item.routed.approximate,
            deferredCustomerIds: deferred.map((w) => w.customerId),
            oversizedCustomerIds: oversized.filter((id) =>
              item.ordered.some((s) => s.customerId === id),
            ),
          },
        });
      }

      // Surplus unreleased tours of the day: emptied, kept as empty tours (soft: nothing is deleted).
      for (const surplus of rebuild.slice(built.length)) {
        await tx.tour.update({
          where: { id: surplus.id },
          data: {
            status: "OPTIMIZED",
            isOutdated: false,
            driverId: null,
            vehicleId: null,
            geometry: Prisma.DbNull,
            totalDistanceM: null,
            totalDurationS: null,
            approximate: false,
            optimizedAt,
          },
        });
        await recordAudit(tx, {
          actorId: deps.actorId,
          entity: "Tour",
          entityId: surplus.id,
          action: "tour.plan_day",
          diff: {
            date: date.toISOString().slice(0, 10),
            mode: "emptied",
            stopCount: 0,
            trips: 0,
            tripLoadsKg: [],
            customerIds: [],
          },
        });
      }

      return {
        ok: true,
        tours: summaries,
        reloadTrips: summaries.reduce((sum, t) => sum + t.reloads, 0),
        vehicleSwitches: summaries.reduce((sum, t) => sum + t.vehicleSwitches, 0),
        approximate,
        warnings,
        oversizedCustomerIds: oversized,
        parkingMissing,
        deferred,
      };
    },
    // No stop limit: the stops are written one by one, so the deadline grows with the day's size.
    { timeout: 30_000 + 500 * toPlan.length, maxWait: 10_000 },
  );
}
