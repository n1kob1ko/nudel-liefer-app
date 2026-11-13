/**
 * Pure tour-building logic (NUD-041): orders -> stops, routing-point filtering (NUD-141), schedule (ETAs) and the
 * rules for re-running the builder on an existing tour. No framework imports.
 */

import { type OrderWindow, stopTimeWindow, type TimeWindowS } from "./delivery-window";
import { type ParkingPointLike, routingPoint } from "./parking";

export type StopOrderInput = {
  id: string;
  customerId: string;
  items: ReadonlyArray<{ productId: string; quantity: number }>;
  /** Planned day and requested window (NUD-148); absent in tests that do not care. */
  deliveryDate?: Date;
  windowFrom?: Date;
  windowTo?: Date;
  windowFromTime?: string | null;
  windowToTime?: string | null;
};

export type StopItem = { productId: string; quantity: number };

export type PlannedStop = {
  customerId: string;
  /** Every CONFIRMED order of the customer for the day (the `StopOrder` links), input order. */
  orderIds: string[];
  /** Quantities summed per product, in order of first appearance. */
  items: StopItem[];
  /**
   * Time-of-day constraint of the stop on its planned day (NUD-148): the intersection of the time
   * parts of its orders' windows. Absent = unconstrained.
   */
  timeWindow?: TimeWindowS & { conflict: boolean };
};

/**
 * One stop per customer: all given (confirmed) orders of a customer are merged, quantities are
 * summed per product (whole numbers) and every order stays linked. Stops are returned in
 * order of the customer's first order. The caller passes only CONFIRMED orders of one day.
 *
 * An order without a single positive quantity never becomes a stop (NUD-186): the day plan keeps
 * such an order as "nothing ordered" instead of cancelling it, and there is nothing to unload.
 */
export function buildStops(orders: readonly StopOrderInput[]): PlannedStop[] {
  const stops = new Map<string, PlannedStop>();
  for (const order of orders) {
    if (!order.items.some((item) => item.quantity > 0)) continue;
    let stop = stops.get(order.customerId);
    if (!stop) {
      stop = { customerId: order.customerId, orderIds: [], items: [] };
      stops.set(order.customerId, stop);
    }
    stop.orderIds.push(order.id);
    for (const item of order.items) {
      const line = stop.items.find((i) => i.productId === item.productId);
      if (line) line.quantity += item.quantity;
      else stop.items.push({ productId: item.productId, quantity: item.quantity });
    }
  }
  for (const stop of stops.values()) {
    const windows: OrderWindow[] = [];
    let day: Date | undefined;
    for (const order of orders) {
      if (order.customerId !== stop.customerId || !order.deliveryDate || !order.windowFrom)
        continue;
      day = order.deliveryDate;
      windows.push({
        from: order.windowFrom,
        to: order.windowTo ?? order.windowFrom,
        fromTime: order.windowFromTime ?? null,
        toTime: order.windowToTime ?? null,
      });
    }
    const timeWindow = day ? stopTimeWindow(windows, day) : null;
    if (timeWindow) stop.timeWindow = timeWindow;
  }
  return [...stops.values()];
}

/** What `routingPoint` needs from a customer (NUD-141). */
export type CustomerLocation = {
  id: string;
  lat: number | null;
  lng: number | null;
  parkingSpots: readonly ParkingPointLike[];
};

/**
 * Splits stops into routable ones and the customers with no location at all (reported as
 * warnings). `withoutParking` lists the routable stops that go to the address point because the
 * customer has no Parkplatz: a flag, never a reason to leave the stop out (D22).
 */
export function partitionByLocation(
  stops: readonly PlannedStop[],
  customers: ReadonlyMap<string, CustomerLocation>,
): { routable: PlannedStop[]; unrouted: PlannedStop[]; withoutParking: PlannedStop[] } {
  const routable: PlannedStop[] = [];
  const unrouted: PlannedStop[] = [];
  const withoutParking: PlannedStop[] = [];
  for (const stop of stops) {
    const customer = customers.get(stop.customerId);
    const point = customer ? routingPoint(customer) : null;
    if (!point) unrouted.push(stop);
    else {
      routable.push(stop);
      if (point.source === "address") withoutParking.push(stop);
    }
  }
  return { routable, unrouted, withoutParking };
}

/**
 * Stop order for a LOCKED tour: stops already in the tour keep their position (only those that
 * still have a routable stop), new customers are appended in input order.
 */
export function mergeLockedOrder(
  existingCustomerIds: readonly string[],
  routable: readonly PlannedStop[],
): { stops: PlannedStop[]; added: string[]; removed: string[] } {
  const byCustomer = new Map(routable.map((s) => [s.customerId, s]));
  const kept: PlannedStop[] = [];
  const removed: string[] = [];
  for (const id of existingCustomerIds) {
    const stop = byCustomer.get(id);
    if (stop) kept.push(stop);
    else removed.push(id);
  }
  const known = new Set(existingCustomerIds);
  const appended = routable.filter((s) => !known.has(s.customerId));
  return { stops: [...kept, ...appended], added: appended.map((s) => s.customerId), removed };
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` shows `time` ("HH:MM") on the calendar day
 * `date` (a `DATE` value held as UTC midnight).
 */
export function departureInstant(date: Date, time: string, timeZone: string): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new Error(`Invalid departure time "${time}"`);
  const wall = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Number(match[1]),
    Number(match[2]),
  );
  let result = wall - zoneOffsetMs(wall, timeZone);
  // The offset can differ at the corrected instant (daylight saving switch): settle once more.
  result = wall - zoneOffsetMs(result, timeZone);
  return new Date(result);
}

export type Schedule = {
  /** Arrival time per stop, in stop order. */
  etas: Date[];
  /** Back at the depot after the last stop (the departure time for a tour without stops). */
  returnAt: Date;
  /** Driving time plus service time, depot to depot, in seconds. */
  totalDurationS: number;
};

/**
 * ETAs: departure + cumulative driving legs + service time at every earlier stop. `legs` has
 * n + 1 entries (depot -> stop 1 ... stop n -> depot) as the routing providers return them.
 */
export function computeSchedule(input: {
  departure: Date;
  legDurationsS: readonly number[];
  serviceSecondsPerStop: number;
}): Schedule {
  const { departure, legDurationsS, serviceSecondsPerStop } = input;
  const stopCount = Math.max(legDurationsS.length - 1, 0);
  const etas: Date[] = [];
  let elapsed = 0;
  for (let i = 0; i < stopCount; i += 1) {
    elapsed += legDurationsS[i];
    etas.push(new Date(departure.getTime() + elapsed * 1000));
    elapsed += serviceSecondsPerStop;
  }
  if (stopCount > 0) elapsed += legDurationsS[stopCount];
  return {
    etas,
    returnAt: new Date(departure.getTime() + elapsed * 1000),
    totalDurationS: elapsed,
  };
}
