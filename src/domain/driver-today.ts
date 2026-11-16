/** Pure rules of the driver's "today" screen (NUD-051). */

export const UNIT_ORDER = ["KG", "PACK", "CRATE", "PIECE"] as const;

type StopLike = { sequence: number; status: string };

/** The next stop is the lowest-sequence stop that is still PENDING (`null` when all are done). */
export function nextPendingStop<T extends StopLike>(stops: readonly T[]): T | null {
  let next: T | null = null;
  for (const stop of stops) {
    if (stop.status === "PENDING" && (next === null || stop.sequence < next.sequence)) next = stop;
  }
  return next;
}

/** Stops that are not PENDING any more (delivered or reported as a problem) / all stops. */
export function progressOf(stops: readonly StopLike[]): { done: number; total: number } {
  return { done: stops.filter((s) => s.status !== "PENDING").length, total: stops.length };
}

export type SummaryTotal = { unit: string; quantity: number };

/**
 * "N varieties and X per unit": the number of distinct products plus one total PER UNIT. Different
 * units are never added together (5 packs + 2 kg is not 7 of anything).
 */
export function summarizeItems(
  items: ReadonlyArray<{ productId: string; unit: string; quantity: number }>,
): {
  kinds: number;
  totals: SummaryTotal[];
} {
  const byUnit = new Map<string, number>();
  for (const item of items) {
    byUnit.set(item.unit, (byUnit.get(item.unit) ?? 0) + item.quantity);
  }
  const rank = (unit: string) => {
    const index = (UNIT_ORDER as readonly string[]).indexOf(unit);
    return index === -1 ? UNIT_ORDER.length : index;
  };
  return {
    kinds: new Set(items.map((i) => i.productId)).size,
    totals: [...byUnit]
      .map(([unit, quantity]) => ({ unit, quantity }))
      .sort((a, b) => rank(a.unit) - rank(b.unit) || a.unit.localeCompare(b.unit)),
  };
}

/**
 * Estimated time still needed: driving legs arriving at the open stops plus service time per open
 * stop. The way back to the depot is not included. A missing leg counts as 0 (never invented).
 */
export function remainingSeconds(
  stops: ReadonlyArray<StopLike & { legDurationS: number | null }>,
  serviceSecondsPerStop: number,
): number {
  return stops
    .filter((s) => s.status === "PENDING")
    .reduce((sum, s) => sum + (s.legDurationS ?? 0) + serviceSecondsPerStop, 0);
}

/** Whole minutes, rounded up to 5, so the estimate does not look more exact than it is. */
export function roundedMinutes(seconds: number): number {
  return Math.max(0, Math.ceil(seconds / 60 / 5) * 5);
}

/**
 * End of the tour (NUD-172, QA 2026-10-29 F3): arrival at the last open stop plus the service time
 * there. The stored ETAs are the one basis for every time on the driver's screen and in the office,
 * so "Ende ca." is derived from them instead of adding the remaining work a second time.
 */
export function tourFinishAt(
  lastEta: Date | string | null,
  serviceSecondsPerStop: number,
): Date | null {
  if (lastEta === null) return null;
  const at = lastEta instanceof Date ? lastEta : new Date(lastEta);
  if (!Number.isFinite(at.getTime())) return null;
  return new Date(at.getTime() + Math.max(serviceSecondsPerStop, 0) * 1000);
}

/** Stops whose change the driver has not seen yet (`seenRevision` = last revision acknowledged). */
export function isUnseenChange(
  stop: { change: "ADDED" | "CHANGED" | null; changedInRevision: number | null },
  seenRevision: number,
): boolean {
  return stop.change !== null && (stop.changedInRevision ?? 0) > seenRevision;
}

/**
 * Reload stop (NUD-147): the stops of a tour carry a trip number; where it goes up from one stop
 * to the next, the vehicle returns to the depot to reload in between. Returns, for every stop that
 * starts a later trip, that trip number (`stopId -> trip`).
 */
export function reloadBeforeStops(
  stops: ReadonlyArray<{ id: string; trip?: number }>,
): Map<string, number> {
  const before = new Map<string, number>();
  stops.forEach((stop, index) => {
    const trip = stop.trip ?? 1;
    if (index > 0 && trip > (stops[index - 1]!.trip ?? 1)) before.set(stop.id, trip);
  });
  return before;
}

/**
 * Vehicle switch (NUD-158): the name of the vehicle that drives `trip` when it is not the one of
 * the trip before (the driver changes into an already loaded vehicle at the depot instead of
 * reloading); `null` when the same vehicle is reloaded.
 */
export function switchVehicle(
  stops: ReadonlyArray<{ trip?: number; vehicleName?: string | null }>,
  trip: number,
): string | null {
  const vehicleOf = (t: number) => stops.find((s) => (s.trip ?? 1) === t)?.vehicleName ?? null;
  const next = vehicleOf(trip);
  return next !== null && next !== vehicleOf(trip - 1) ? next : null;
}
