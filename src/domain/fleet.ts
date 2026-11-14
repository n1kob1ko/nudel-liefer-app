/**
 * Several tours per day and reload trips (NUD-147, D24). Pure rules: split the stops of a day
 * across the selected vehicles by capacity (kg), pack what does not fit into reload trips at the
 * depot, keep trip numbers consistent when a tour is edited, and compute the schedule of a tour
 * with reloads. No framework imports.
 */
import { haversineM, heuristicOrder, type LatLng } from "./routing";

/** Time the vehicle stands at the depot to reload between two trips (seconds). */
export const RELOAD_MINUTES = 20;
export const RELOAD_SECONDS = RELOAD_MINUTES * 60;
/**
 * Time a driver needs at the depot to change into another vehicle that was loaded in the morning
 * (NUD-158). Much shorter than a reload, so a free loaded vehicle beats reloading the same one.
 */
export const VEHICLE_SWITCH_MINUTES = 5;
export const VEHICLE_SWITCH_SECONDS = VEHICLE_SWITCH_MINUTES * 60;

export type FleetStop = {
  id: string;
  location: LatLng;
  weightKg: number;
  /** Time-of-day window in seconds since midnight (NUD-148); only the optimiser uses it. */
  timeWindow?: { fromS: number; toS: number };
};
export type FleetVehicle = { id: string; capacityKg: number };

export type FleetRoute = { vehicleId: string; stopIds: string[] };
export type FleetSplit = { routes: FleetRoute[]; unassigned: string[] };

/**
 * Sweep order: the stops sorted by their angle around the depot, starting after the widest empty
 * angular gap, so neighbouring stops end up next to each other. Ties go to the nearer stop, then
 * to the id (deterministic).
 */
export function sweepOrder<T extends { id: string; location: LatLng }>(
  depot: LatLng,
  stops: readonly T[],
): T[] {
  if (stops.length <= 1) return [...stops];
  const keyed = stops
    .map((stop) => ({
      stop,
      angle: Math.atan2(stop.location.lat - depot.lat, stop.location.lng - depot.lng),
      distance: haversineM(depot, stop.location),
    }))
    .sort(
      (a, b) => a.angle - b.angle || a.distance - b.distance || a.stop.id.localeCompare(b.stop.id),
    );
  // Start after the widest gap between two neighbouring angles (including the wrap-around).
  let widest = -1;
  let startIndex = 0;
  for (let i = 0; i < keyed.length; i++) {
    const next = keyed[(i + 1) % keyed.length]!;
    const gap = (next.angle - keyed[i]!.angle + 2 * Math.PI) % (2 * Math.PI);
    if (gap > widest + 1e-12) {
      widest = gap;
      startIndex = (i + 1) % keyed.length;
    }
  }
  return [...keyed.slice(startIndex), ...keyed.slice(0, startIndex)].map((k) => k.stop);
}

/** Fills one trip of `capacityKg` from `remaining` (in order); returns the taken stops. */
function fillTrip<T extends { weightKg: number }>(
  remaining: T[],
  capacityKg: number,
): { taken: T[]; rest: T[] } {
  const taken: T[] = [];
  const rest: T[] = [];
  let load = 0;
  for (const stop of remaining) {
    if (load + stop.weightKg <= capacityKg) {
      taken.push(stop);
      load += stop.weightKg;
    } else rest.push(stop);
  }
  return { taken, rest };
}

/**
 * Capacity-aware greedy split (the heuristic fallback of the VROOM distribution): vehicles are
 * filled one after the other, largest capacity first, each along the sweep order. A vehicle that
 * is not needed gets no route. What fits into no vehicle is returned in `unassigned` (reload
 * trips, `packReloadTrips`). Stop order inside a route is the sweep order; the caller orders it.
 */
export function splitByCapacity(
  depot: LatLng,
  stops: readonly FleetStop[],
  vehicles: readonly FleetVehicle[],
): FleetSplit {
  const byCapacity = vehicles
    .map((vehicle, index) => ({ vehicle, index }))
    .sort((a, b) => b.vehicle.capacityKg - a.vehicle.capacityKg || a.index - b.index);
  let remaining = sweepOrder(depot, stops);
  const routes: FleetRoute[] = [];
  for (const { vehicle } of byCapacity) {
    if (remaining.length === 0) break;
    const { taken, rest } = fillTrip(remaining, vehicle.capacityKg);
    if (taken.length === 0) continue;
    routes.push({ vehicleId: vehicle.id, stopIds: taken.map((s) => s.id) });
    remaining = rest;
  }
  return { routes, unassigned: remaining.map((s) => s.id) };
}

/**
 * Reload trips for the stops that fit into no vehicle's first trip. Each new trip goes to the
 * vehicle with the fewest trips so far (then the larger one) and is filled along the sweep order.
 * A stop heavier than any capacity gets a trip of its own (`oversized`; the load indicator turns
 * red, the release needs the override). `tripCounts` = trips each vehicle already has.
 */
export function packReloadTrips(
  depot: LatLng,
  vehicles: readonly FleetVehicle[],
  tripCounts: ReadonlyMap<string, number>,
  leftovers: readonly FleetStop[],
): { trips: FleetRoute[]; oversized: string[] } {
  const counts = new Map(vehicles.map((v) => [v.id, tripCounts.get(v.id) ?? 0]));
  const trips: FleetRoute[] = [];
  const oversized: string[] = [];
  let remaining = sweepOrder(depot, leftovers);
  while (remaining.length > 0) {
    const vehicle = [...vehicles].sort(
      (a, b) =>
        counts.get(a.id)! - counts.get(b.id)! ||
        b.capacityKg - a.capacityKg ||
        vehicles.indexOf(a) - vehicles.indexOf(b),
    )[0];
    if (!vehicle) break;
    const { taken, rest } = fillTrip(remaining, vehicle.capacityKg);
    if (taken.length === 0) {
      // Heavier than the vehicle: a trip of its own, flagged.
      const [first, ...others] = remaining;
      oversized.push(first!.id);
      trips.push({ vehicleId: vehicle.id, stopIds: [first!.id] });
      remaining = others;
    } else {
      trips.push({ vehicleId: vehicle.id, stopIds: taken.map((s) => s.id) });
      remaining = rest;
    }
    counts.set(vehicle.id, counts.get(vehicle.id)! + 1);
  }
  return { trips, oversized };
}

/** Visiting order of one trip (nearest neighbour + 2-opt) as stop ids. */
export function orderTrip(depot: LatLng, stops: readonly FleetStop[]): string[] {
  return heuristicOrder(
    depot,
    stops.map((s) => s.location),
  ).map((i) => stops[i]!.id);
}

/**
 * Trip numbers for stops in tour order: never decreasing and without gaps (1, 1, 2, 2, 3). Used
 * after any edit so a tour never has an empty trip or trips out of order.
 */
export function normalizeTrips(trips: readonly number[]): number[] {
  let highest = 1;
  let current = 0;
  let previousHighest = 0;
  return trips.map((raw, index) => {
    highest = Math.max(highest, Number.isFinite(raw) ? Math.floor(raw) : 1);
    if (index === 0) current = 1;
    else if (highest !== previousHighest) current += 1;
    previousHighest = highest;
    return current;
  });
}

/** Stop indices grouped by trip, in tour order (`trips` must be normalized). */
export function groupByTrip<T>(items: readonly T[], trips: readonly number[]): T[][] {
  const groups: T[][] = [];
  let last = -1;
  items.forEach((item, index) => {
    const trip = trips[index] ?? 1;
    if (trip !== last) {
      groups.push([]);
      last = trip;
    }
    groups[groups.length - 1]!.push(item);
  });
  return groups;
}

/** Kilograms per trip (index 0 = trip 1) from the weight of every stop and its trip number. */
export function tripLoadsKg(stops: ReadonlyArray<{ trip: number; weightKg: number }>): number[] {
  const trips = normalizeTrips(stops.map((s) => s.trip));
  const loads: number[] = [];
  stops.forEach((stop, index) => {
    const slot = trips[index]! - 1;
    loads[slot] = Math.round(((loads[slot] ?? 0) + stop.weightKg) * 100) / 100;
  });
  return loads;
}

export type TripSchedule = {
  /** Arrival time per stop, in tour order. */
  etas: Date[];
  /** When the vehicle is back at the depot for each reload (one entry per reload). */
  reloadAt: Date[];
  /** Back at the depot after the last trip. */
  returnAt: Date;
  /** Driving, service and reload time, depot to depot, in seconds. */
  totalDurationS: number;
};

/**
 * ETAs of a tour with reload trips. `trips[k]` holds the legs into its stops and the leg back to
 * the depot. Every reload adds `reloadSeconds` at the depot. For one trip this equals
 * `computeSchedule` (`domain/tour.ts`).
 */
export function computeTripSchedule(input: {
  departure: Date;
  trips: ReadonlyArray<{ stopLegDurationsS: readonly number[]; returnLegDurationS: number }>;
  serviceSecondsPerStop: number;
  reloadSeconds?: number;
  /**
   * Time at the depot after each trip but the last (NUD-158: a vehicle switch is shorter than a
   * reload, `tripPausesS`). A missing entry is a reload (`reloadSeconds`).
   */
  pausesS?: readonly number[];
}): TripSchedule {
  const { departure, trips, serviceSecondsPerStop } = input;
  const reloadSeconds = input.reloadSeconds ?? RELOAD_SECONDS;
  const at = (seconds: number) => new Date(departure.getTime() + seconds * 1000);
  const etas: Date[] = [];
  const reloadAt: Date[] = [];
  let elapsed = 0;
  trips.forEach((trip, index) => {
    for (const leg of trip.stopLegDurationsS) {
      elapsed += leg;
      etas.push(at(elapsed));
      elapsed += serviceSecondsPerStop;
    }
    if (trip.stopLegDurationsS.length > 0) elapsed += trip.returnLegDurationS;
    if (index < trips.length - 1) {
      reloadAt.push(at(elapsed));
      elapsed += input.pausesS?.[index] ?? reloadSeconds;
    }
  });
  return { etas, reloadAt, returnAt: at(elapsed), totalDurationS: elapsed };
}

/**
 * Picks at most `max` stops for one planning run when the day has more stops than the routing
 * provider accepts (`MAX_STOPS`). It grows one compact cluster from the depot: the next stop is
 * always the one nearest to the depot or to a stop already picked (Prim-style). The picked stops
 * make the shortest drive; the outlying ones are left over and reported as "not planned today".
 * Ties go to the id (deterministic). Both lists keep the input order.
 */
export function pickStopsWithinLimit<T extends { id: string; location: LatLng }>(
  depot: LatLng,
  stops: readonly T[],
  max: number,
): { picked: T[]; deferred: T[] } {
  if (stops.length <= max) return { picked: [...stops], deferred: [] };
  const distance = stops.map((s) => haversineM(depot, s.location));
  const taken = new Array<boolean>(stops.length).fill(false);
  for (let round = 0; round < Math.max(0, max); round++) {
    let best = -1;
    for (let i = 0; i < stops.length; i++) {
      if (taken[i]) continue;
      if (
        best === -1 ||
        distance[i]! < distance[best]! - 1e-9 ||
        (Math.abs(distance[i]! - distance[best]!) <= 1e-9 &&
          stops[i]!.id.localeCompare(stops[best]!.id) < 0)
      ) {
        best = i;
      }
    }
    if (best === -1) break;
    taken[best] = true;
    for (let i = 0; i < stops.length; i++) {
      if (taken[i]) continue;
      distance[i] = Math.min(distance[i]!, haversineM(stops[best]!.location, stops[i]!.location));
    }
  }
  return {
    picked: stops.filter((_, i) => taken[i]),
    deferred: stops.filter((_, i) => !taken[i]),
  };
}

/**
 * Vehicle of each stop after an edit that keeps trip boundaries by position (NUD-158): a stop gets
 * the vehicle that its (raw, not yet normalized) trip number had on the tour before. A trip number
 * the tour did not have (or `null` there) means the tour's own vehicle (`null`).
 */
export function vehiclesForTrips(
  existing: ReadonlyArray<{ trip: number; vehicleId: string | null }>,
  rawTrips: readonly number[],
): Array<string | null> {
  const byTrip = new Map<number, string | null>();
  for (const stop of existing) if (!byTrip.has(stop.trip)) byTrip.set(stop.trip, stop.vehicleId);
  return rawTrips.map((trip) => byTrip.get(trip) ?? null);
}

/**
 * The vehicle that drives each trip (index 0 = trip 1; `trips` normalized): the `vehicleId` of the
 * trip's first stop, or the tour's vehicle when that is `null`.
 */
export function tripVehicleIds(
  trips: readonly number[],
  stopVehicleIds: ReadonlyArray<string | null | undefined>,
  tourVehicleId: string | null,
): Array<string | null> {
  const result: Array<string | null> = [];
  trips.forEach((trip, index) => {
    if (result.length < trip) result.push(stopVehicleIds[index] ?? tourVehicleId);
  });
  return result;
}

/**
 * Time at the depot between trip k and k+1 (one entry per boundary): the same vehicle again is a
 * reload (`RELOAD_SECONDS`), another vehicle is a switch into an already loaded one
 * (`VEHICLE_SWITCH_SECONDS`, NUD-158).
 */
export function tripPausesS(tripVehicles: ReadonlyArray<string | null>): number[] {
  return tripVehicles
    .slice(1)
    .map((vehicle, index) =>
      vehicle === tripVehicles[index] ? RELOAD_SECONDS : VEHICLE_SWITCH_SECONDS,
    );
}

/**
 * Puts the work of the vehicles onto the drivers (NUD-158). A chain is everything one vehicle
 * drives (its first trip plus its reload trips), with its duration. With fewer drivers than
 * chains, a driver who is back at the depot takes the next loaded vehicle: chains are handed out
 * longest first, each to the driver with the least work so far (+ a vehicle switch), so the day
 * ends as early as possible. A vehicle is never shared by two drivers. Without drivers (assigned
 * later) or with enough of them, every chain is a tour of its own. Returns, per tour, the chain
 * indices in driving order.
 */
export function groupChainsByDriver(
  chains: ReadonlyArray<{ durationS: number }>,
  driverCount: number,
  switchSeconds: number = VEHICLE_SWITCH_SECONDS,
): number[][] {
  if (driverCount <= 0 || driverCount >= chains.length) return chains.map((_, i) => [i]);
  const order = chains
    .map((chain, index) => ({ index, durationS: chain.durationS }))
    .sort((a, b) => b.durationS - a.durationS || a.index - b.index);
  const tours: Array<{ chains: number[]; workS: number }> = Array.from(
    { length: driverCount },
    () => ({ chains: [], workS: 0 }),
  );
  for (const { index, durationS } of order) {
    let target = tours[0]!;
    for (const tour of tours) if (tour.workS < target.workS) target = tour;
    target.workS += durationS + (target.chains.length > 0 ? switchSeconds : 0);
    target.chains.push(index);
  }
  return tours.map((t) => t.chains);
}

/**
 * The vehicles to load in the morning when there are fewer drivers than vehicles (NUD-158): the
 * largest ones, until their capacities cover the day's load, but at least one per driver (every
 * driver gets a tour) and never more than there are. Keeps the order of `vehicles`.
 */
export function vehiclesForLoad<V extends FleetVehicle>(
  vehicles: readonly V[],
  driverCount: number,
  stops: ReadonlyArray<{ weightKg: number }>,
): V[] {
  const totalKg = stops.reduce((sum, s) => sum + s.weightKg, 0);
  const byCapacity = vehicles
    .map((vehicle, index) => ({ vehicle, index }))
    .sort((a, b) => b.vehicle.capacityKg - a.vehicle.capacityKg || a.index - b.index);
  const chosen = new Set<number>();
  let capacityKg = 0;
  for (const { vehicle, index } of byCapacity) {
    if (chosen.size >= driverCount && capacityKg >= totalKg) break;
    chosen.add(index);
    capacityKg += vehicle.capacityKg;
  }
  return vehicles.filter((_, index) => chosen.has(index));
}

/**
 * Standing tours in "Touren planen" (NUD-209). Every customer of a standing tour whose default
 * driver is available goes to that driver; a driver with several standing tours drives them as one
 * tour. A customer in more than one standing tour belongs to the first one (in `standing` order)
 * whose driver is available. The rest (`loose`) is planned freely. Groups come in the order of
 * `driverIds`, stop ids keep the order of `stops`.
 */
export function splitByStandingTours<S extends { id: string }>(
  stops: readonly S[],
  standing: ReadonlyArray<{ driverId: string | null; customerIds: readonly string[] }>,
  driverIds: readonly string[],
): { groups: Array<{ driverId: string; stops: S[] }>; loose: S[] } {
  const available = new Set(driverIds);
  const driverOf = new Map<string, string>();
  for (const tour of standing) {
    if (!tour.driverId || !available.has(tour.driverId)) continue;
    for (const customerId of tour.customerIds) {
      if (!driverOf.has(customerId)) driverOf.set(customerId, tour.driverId);
    }
  }
  const byDriver = new Map<string, S[]>();
  const loose: S[] = [];
  for (const stop of stops) {
    const driverId = driverOf.get(stop.id);
    if (!driverId) {
      loose.push(stop);
      continue;
    }
    const list = byDriver.get(driverId) ?? [];
    list.push(stop);
    byDriver.set(driverId, list);
  }
  const groups = driverIds
    .filter((id) => byDriver.has(id))
    .map((driverId) => ({ driverId, stops: byDriver.get(driverId)! }));
  return { groups, loose };
}

/**
 * Hands each stop of `loose` to the group with the nearest stop (NUD-209): used when no driver or
 * vehicle is left for the customers outside the standing tours. Groups must not be empty.
 */
export function attachToNearestGroup<S extends { location: LatLng }, G extends { stops: S[] }>(
  groups: readonly G[],
  loose: readonly S[],
): void {
  for (const stop of loose) {
    let best = groups[0]!;
    let bestM = Number.POSITIVE_INFINITY;
    for (const group of groups) {
      for (const member of group.stops) {
        const m = haversineM(member.location, stop.location);
        if (m < bestM) {
          bestM = m;
          best = group;
        }
      }
    }
    best.stops.push(stop);
  }
}
