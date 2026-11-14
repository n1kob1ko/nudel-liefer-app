/**
 * Day routes from standing tours (NUD-212, D34): the route of a delivery day is a standing tour in
 * its fixed order, with only the customers that ordered, plus the extras of that day (customers of
 * no standing tour). Nothing is optimized: an extra is placed where it adds the smallest
 * straight-line detour, and the office can move it. Pure functions, no framework imports.
 */
import { haversineM, type LatLng } from "./routing";

export type RouteMember = { customerId: string; location: LatLng | null };
/** One standing tour as a path: all its customers in standing order (not only today's). */
export type RoutePath = { id: string; members: readonly RouteMember[] };
/** Where an extra rides: on route `routeId`, after `slot` standing customers (0 = first). */
export type Place = { routeId: string; slot: number };

function cleanSlot(slot: number, max: number): number {
  if (!Number.isFinite(slot) || slot < 0) return 0;
  return Math.min(Math.floor(slot), max);
}

/**
 * The stop order of a day route: the members in standing order, an extra with slot k right after
 * the k-th member (slots past the end go last), extras of one slot in the given order.
 */
export function dayRouteOrder(
  members: readonly string[],
  extras: ReadonlyArray<{ customerId: string; slot: number }>,
): string[] {
  const bySlot = new Map<number, string[]>();
  for (const extra of extras) {
    const slot = cleanSlot(extra.slot, members.length);
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), extra.customerId]);
  }
  const out: string[] = [];
  for (let slot = 0; slot <= members.length; slot++) {
    out.push(...(bySlot.get(slot) ?? []));
    if (slot < members.length) out.push(members[slot]!);
  }
  return out;
}

/** Best slot of one route for `point` and the detour in metres it costs. */
function bestSlot(depot: LatLng, route: RoutePath, point: LatLng): { slot: number; cost: number } {
  // The path depot -> located members -> depot; `slot` of a gap = members before its far end.
  const stops = route.members.flatMap((m, index) => (m.location ? [{ index, at: m.location }] : []));
  let best = { slot: route.members.length, cost: Number.POSITIVE_INFINITY };
  for (let gap = 0; gap <= stops.length; gap++) {
    const from = gap === 0 ? depot : stops[gap - 1]!.at;
    const to = gap === stops.length ? depot : stops[gap]!.at;
    const cost = haversineM(from, point) + haversineM(point, to) - haversineM(from, to);
    const slot = gap === stops.length ? route.members.length : stops[gap]!.index;
    if (cost < best.cost - 1e-6) best = { slot, cost };
  }
  return best;
}

/**
 * Route and slot with the smallest straight-line detour for an extra at `point`. Without a
 * location it goes to the end of the first route; without routes there is no place (`null`).
 */
export function suggestPlace(
  depot: LatLng,
  routes: readonly RoutePath[],
  point: LatLng | null,
): Place | null {
  const first = routes[0];
  if (!first) return null;
  if (!point) return { routeId: first.id, slot: first.members.length };
  let best: (Place & { cost: number }) | null = null;
  for (const route of routes) {
    const candidate = bestSlot(depot, route, point);
    if (!best || candidate.cost < best.cost - 1e-6) best = { routeId: route.id, ...candidate };
  }
  return { routeId: best!.routeId, slot: best!.slot };
}

/**
 * The place of an extra: the office's choice while its route still exists (the slot clamped to the
 * route, a missing slot = the best one of that route), otherwise the suggestion. `moved` tells
 * whether the office chose it.
 */
export function resolvePlace(
  depot: LatLng,
  routes: readonly RoutePath[],
  point: LatLng | null,
  wanted: { routeId: string | null; slot: number | null },
): (Place & { moved: boolean }) | null {
  const route = wanted.routeId ? routes.find((r) => r.id === wanted.routeId) : undefined;
  if (route) {
    const slot =
      wanted.slot !== null
        ? cleanSlot(wanted.slot, route.members.length)
        : point
          ? bestSlot(depot, route, point).slot
          : route.members.length;
    return { routeId: route.id, slot, moved: true };
  }
  const suggested = suggestPlace(depot, routes, point);
  return suggested ? { ...suggested, moved: false } : null;
}
