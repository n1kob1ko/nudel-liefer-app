/**
 * Deleting settled orders (NUD-201). Pure: no framework, no database.
 *
 * Orders, their stops and tours and the monthly "paid" notes are deleted for good once they are
 * paid and the period after the payment is over. What is not paid stays, whatever its age.
 */

/** Days after the payment before an order is deleted, unless `ORDER_RETENTION_DAYS` says otherwise. */
export const DEFAULT_ORDER_RETENTION_DAYS = 30;
export const MIN_ORDER_RETENTION_DAYS = 7;
export const MAX_ORDER_RETENTION_DAYS = 3650;

/** A stop with every order it carries; `expired` = its tour drove before the period started. */
export type PurgeStop = { id: string; orderIds: readonly string[]; expired: boolean };

export type PurgeSelection = { orderIds: string[]; stopIds: string[] };

/**
 * What may be deleted together. An order and the stops it was delivered with go as one piece, so
 * nothing half-deleted is left behind:
 * - a stop goes only when its tour is old enough and every one of its orders goes,
 * - an order goes only when every stop it is on goes.
 * One order that has to stay (not paid yet) keeps its stop, the stop keeps its other orders, and
 * those keep their other stops: the rule is applied until nothing changes any more.
 *
 * `settledOrderIds` are the orders that are paid long enough; every order id on a stop that is
 * not in this list counts as "has to stay". `stops` must hold every stop of every listed order.
 */
export function purgeSelection(
  settledOrderIds: readonly string[],
  stops: readonly PurgeStop[],
): PurgeSelection {
  const going = new Set(settledOrderIds);
  const staying = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const stop of stops) {
      if (staying.has(stop.id)) continue;
      if (stop.expired && stop.orderIds.every((id) => going.has(id))) continue;
      staying.add(stop.id);
      for (const id of stop.orderIds) going.delete(id);
      changed = true;
    }
  }
  return {
    orderIds: settledOrderIds.filter((id) => going.has(id)),
    stopIds: stops.filter((stop) => !staying.has(stop.id)).map((stop) => stop.id),
  };
}

/** The moment from which something paid at `settledAt` is deleted by the next run. */
export function deletionDue(settledAt: Date, retentionDays: number): Date {
  return new Date(settledAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}
