import { keyDisplay } from "./customer-key";

/**
 * Pure rules of the driver's optional departure checklist (NUD-151, F3). The checklist has two
 * kinds of lines: the keys to take (NUD-142) and fixed items the office maintains in the settings.
 * It used to list the products to load as well; the owner decided on 2026-11-16 that the driver
 * never sees totals (only what the current customer gets), so loading goes by the office's load
 * sheet. No framework or database imports.
 */

/** Longest fixed checklist item the office can type (characters). */
export const CHECKLIST_ITEM_MAX = 80;
/** Most fixed items the settings hold. */
export const CHECKLIST_ITEMS_MAX = 12;

export type ChecklistStop = {
  /** Trip of the tour (NUD-147); missing = first trip. */
  trip?: number;
  customerId: string;
  customerName: string;
  /** The customer's key (NUD-142); only a stop with `hasKey === true` adds a key line. */
  hasKey?: boolean | null;
  keyNumber?: string | null;
};

export type ChecklistKeyLine = {
  id: string;
  customerId: string;
  customerName: string;
  /** `null`: the customer has a key but nobody noted its number. */
  keyNumber: string | null;
};

export type DepartureChecklist = {
  keys: ChecklistKeyLine[];
};

/** The keys one trip needs: one line per customer with a key, in delivery order. */
export function buildDepartureChecklist(
  stops: readonly ChecklistStop[],
  trip: number,
): DepartureChecklist {
  const tripStops = stops.filter((stop) => (stop.trip ?? 1) === trip);
  const keys: ChecklistKeyLine[] = [];
  const seen = new Set<string>();
  for (const stop of tripStops) {
    if (stop.hasKey !== true || seen.has(stop.customerId)) continue;
    seen.add(stop.customerId);
    const display = keyDisplay(stop);
    keys.push({
      id: `k:${stop.customerId}`,
      customerId: stop.customerId,
      customerName: stop.customerName,
      keyNumber: display.kind === "number" ? display.number : null,
    });
  }
  return { keys };
}

/** A fixed checklist item as the settings hold it (text per language, `LocalizedText` JSON). */
export type FixedChecklistItem<T = unknown> = { id: string; text: T };

/** Ids of every line of a checklist, for "n of m ticked". */
export function checklistLineIds(
  checklist: DepartureChecklist,
  fixed: ReadonlyArray<{ id: string }>,
): string[] {
  return [...checklist.keys.map((k) => k.id), ...fixed.map((f) => `f:${f.id}`)];
}

/**
 * The card "Abfahrt vorbereiten" is offered until the driver has left (`departedAt`) or the first
 * stop has been worked on: once a stop is delivered or reported, the driver is on the road and the
 * card would only be noise. A tour that is not running (completed) never shows it.
 */
export function showDepartureCard(input: {
  tourStatus: string;
  departedAt: string | null;
  stopStatuses: ReadonlyArray<string>;
}): boolean {
  if (input.departedAt !== null) return false;
  if (input.tourStatus !== "RELEASED" && input.tourStatus !== "IN_PROGRESS") return false;
  return input.stopStatuses.length > 0 && input.stopStatuses.every((s) => s === "PENDING");
}

/** Checklist item keys the driver ticked (stored per tour and trip on the device). */
export function parseTicked(raw: unknown, valid: ReadonlySet<string>): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((id): id is string => typeof id === "string" && valid.has(id)));
}
