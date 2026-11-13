import type {
  SyncEntry,
  SyncEntryResult,
  SyncMutationType,
  SyncParkingSpot,
  SyncResponse,
  SyncStopState,
  SyncTourState,
} from "@/domain/driver-sync";

/**
 * Pure logic of the driver's offline outbox (NUD-082): what a queued tap is, how an undo cancels
 * it, what the screen shows while it is queued (optimistic overlay), how a server answer settles
 * the queue, and when to retry. No browser, no React: used by the page, the service worker and the
 * unit tests. Free of zod on purpose (the service worker bundles this file).
 */

/** One queued tap of the driver, stored in IndexedDB until the server has answered. */
export type OutboxEntry = {
  clientMutationId: string;
  /** The driver the tap belongs to; entries are only ever sent in that driver's session. */
  userId: string;
  type: SyncMutationType;
  stopId: string;
  /** `ProblemReason` (type "problem" only). */
  reason?: string;
  note?: string;
  /** Type "key" only (NUD-142): a key exists / does not; the number only goes with `true`. */
  hasKey?: boolean;
  keyNumber?: string;
  /** Type "abbreviation" only (NUD-164): the new text; absent clears it. */
  abbreviation?: string;
  /** Type "parking" only (NUD-144): the Parkplatz the driver set. */
  lat?: number;
  lng?: number;
  /** Type "payment" only (D33): the cash collected at the stop, in euro cents. */
  collectedCents?: number;
  /** ISO time of the tap on the device; the server treats this as the time of the action. */
  createdAt: string;
  /** Monotonic order within the queue, breaks ties between taps in the same millisecond. */
  seq: number;
  /** For notices: customer names are never translated, and the stop may be gone later. */
  customerName: string;
};

/** A queued tap the server did not apply (its state won); shown until the driver acknowledges. */
export type OutboxNotice = {
  /** = `clientMutationId` of the rejected tap. */
  id: string;
  userId: string;
  stopId: string;
  customerName: string;
  /** `photo`: a photo the server did not take (NUD-083). */
  type: SyncMutationType | "photo";
  /** Reason code (`changed_by_office`, `not_found`, `already_completed`, ...). */
  error: string;
  /** ISO time the notice arose. */
  createdAt: string;
};

export type StopStatus = "PENDING" | "DELIVERED" | "PROBLEM";

/** Taps that change a stop's status (the others change the customer or the tour). */
export function isStopStatusEntry(type: SyncMutationType): boolean {
  return type === "delivered" || type === "problem" || type === "undo";
}

/** Order the server must see the taps in: the order the driver made them. */
export function sortEntries<T extends Pick<OutboxEntry, "createdAt" | "seq">>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.seq - b.seq,
  );
}

export function nextSeq(entries: readonly Pick<OutboxEntry, "seq">[]): number {
  return entries.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
}

/** The entry as the request body carries it (no local bookkeeping fields). */
export function toSyncEntry(entry: OutboxEntry): SyncEntry {
  return {
    clientMutationId: entry.clientMutationId,
    type: entry.type,
    stopId: entry.stopId,
    ...(entry.type === "problem" && entry.reason ? { reason: entry.reason } : {}),
    ...(entry.type === "problem" && entry.note ? { note: entry.note } : {}),
    ...(entry.type === "key" && entry.hasKey !== undefined ? { hasKey: entry.hasKey } : {}),
    ...(entry.type === "key" && entry.keyNumber ? { keyNumber: entry.keyNumber } : {}),
    ...(entry.type === "abbreviation" && entry.abbreviation
      ? { abbreviation: entry.abbreviation }
      : {}),
    ...(entry.type === "parking" && entry.lat !== undefined && entry.lng !== undefined
      ? { lat: entry.lat, lng: entry.lng }
      : {}),
    ...(entry.type === "payment" && entry.collectedCents !== undefined
      ? { collectedCents: entry.collectedCents }
      : {}),
    createdAt: entry.createdAt,
  };
}

/** Splits the queue into requests of at most `size` entries, keeping the order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * What "Undo" does for `stopId`:
 * - the newest queued entry of the stop is a completion that no request carries right now ->
 *   `cancel`: remove it, the server never hears about it (no delivered + undo pair);
 * - the newest entry is a completion that is on its way (`inFlight`), or there is none (the server
 *   already holds the completion) -> `enqueue`: queue a real undo, ordered after it;
 * - the newest entry already is a queued undo -> `none` (a second tap changes nothing).
 */
export type UndoPlan =
  { action: "cancel"; clientMutationId: string } | { action: "enqueue" } | { action: "none" };

export function planUndo(
  entries: readonly OutboxEntry[],
  stopId: string,
  inFlight: ReadonlySet<string>,
): UndoPlan {
  // A queued key, Abkürzung, Parkplatz or departure entry is not a completion: it neither gets cancelled nor
  // hides one.
  const last = sortEntries(
    entries.filter((e) => e.stopId === stopId && isStopStatusEntry(e.type)),
  ).at(-1);
  if (!last) return { action: "enqueue" };
  if (last.type === "undo") return { action: "none" };
  if (inFlight.has(last.clientMutationId)) return { action: "enqueue" };
  return { action: "cancel", clientMutationId: last.clientMutationId };
}

type StopLike = {
  id: string;
  status: StopStatus;
  problemReason: string | null;
  completedAt: string | null;
};

type SpotStop = {
  lat?: number | null;
  lng?: number | null;
  parkingSpots?: Array<{ label: string | null; note: string | null; lat: number; lng: number }>;
};

/**
 * A queued Parkplatz (NUD-144) shows at once: appended to the stop's list, and the routing point
 * (`lat`/`lng`) when there was no Parkplatz yet. Screens without Parkplatz data are left alone.
 */
function withQueuedSpot<T>(stop: T, entry: OutboxEntry): T {
  const current = stop as SpotStop;
  if (entry.lat === undefined || entry.lng === undefined || current.parkingSpots === undefined) {
    return stop;
  }
  const { lat, lng } = entry;
  if (current.parkingSpots.some((s) => s.lat === lat && s.lng === lng)) return stop;
  return {
    ...stop,
    ...(current.parkingSpots.length === 0 ? { lat, lng } : {}),
    parkingSpots: [...current.parkingSpots, { label: null, note: null, lat, lng }],
  };
}

/**
 * The stop after the queued taps (in order) are applied to the state the server last told us. A
 * queued key entry (NUD-142) shows the new key at once; it is independent of the stop status.
 */
export function overlayStop<T extends StopLike>(stop: T, entries: readonly OutboxEntry[]): T {
  let next = stop;
  for (const entry of sortEntries(entries.filter((e) => e.stopId === stop.id))) {
    if (entry.type === "loading" || entry.type === "depart") {
      continue; // tour-level, shown by `overlayDeparture`
    } else if (entry.type === "parking") {
      next = withQueuedSpot(next, entry);
    } else if (entry.type === "key") {
      const hasKey = entry.hasKey ?? null;
      next = { ...next, hasKey, keyNumber: hasKey === true ? (entry.keyNumber ?? null) : null };
    } else if (entry.type === "abbreviation") {
      next = { ...next, abbreviation: entry.abbreviation ?? null };
    } else if (entry.type === "payment") {
      // Cash collected at the stop (D33): the amount shows at once, independent of the status.
      next = { ...next, collectedCents: entry.collectedCents ?? null };
    } else if (entry.type === "undo") {
      next = { ...next, status: "PENDING", problemReason: null, completedAt: null };
    } else if (next.status === "PENDING") {
      // The server would refuse a second completion; the screen mirrors that.
      next = {
        ...next,
        status: entry.type === "delivered" ? "DELIVERED" : "PROBLEM",
        problemReason: entry.type === "problem" ? (entry.reason ?? null) : null,
        completedAt: entry.createdAt,
      };
    }
  }
  return next;
}

/**
 * The departure checklist times of a tour (NUD-151) with the queued `loading` / `depart` taps on
 * top: a queued tap shows at once, with the time of the tap. The first tap wins, like on the server.
 */
export function overlayDeparture(
  server: { loadingStartedAt: string | null; departedAt: string | null },
  entries: readonly OutboxEntry[],
  stopIds: ReadonlySet<string>,
): { loadingStartedAt: string | null; departedAt: string | null } {
  let { loadingStartedAt, departedAt } = server;
  for (const entry of sortEntries(entries.filter((e) => stopIds.has(e.stopId)))) {
    if (entry.type === "loading") loadingStartedAt ??= entry.createdAt;
    else if (entry.type === "depart") departedAt ??= entry.createdAt;
  }
  return { loadingStartedAt, departedAt };
}

/** `overlayStop` for a whole list; returns the same array when nothing is queued for it. */
export function overlayStops<T extends StopLike>(
  stops: readonly T[],
  entries: readonly OutboxEntry[],
): readonly T[] {
  if (entries.length === 0) return stops;
  const queued = new Set(entries.map((e) => e.stopId));
  return stops.map((stop) => (queued.has(stop.id) ? overlayStop(stop, entries) : stop));
}

/** True when `stopId` has a tap in the queue (shown as "waiting to be sent"). */
export function hasQueued(entries: readonly OutboxEntry[], stopId: string): boolean {
  return entries.some((e) => e.stopId === stopId);
}

// ---------------------------------------------------------------------------------------------
// Settling the queue with the server's answer
// ---------------------------------------------------------------------------------------------

export type Settlement = {
  /** Entries the server is done with: remove them from the queue. */
  done: string[];
  /** Rejected entries: the driver gets a notice for each. */
  notices: OutboxNotice[];
  /** Entries to keep and send again. */
  retry: string[];
};

/** Maps the per-entry results of a response to queue operations. */
export function settle(
  sent: readonly OutboxEntry[],
  results: readonly SyncEntryResult[],
  now: Date,
): Settlement {
  const byId = new Map(results.map((r) => [r.clientMutationId, r]));
  const settlement: Settlement = { done: [], notices: [], retry: [] };
  for (const entry of sent) {
    const result = byId.get(entry.clientMutationId);
    if (!result || result.outcome === "retry") {
      settlement.retry.push(entry.clientMutationId);
    } else if (result.outcome === "rejected") {
      settlement.done.push(entry.clientMutationId);
      settlement.notices.push({
        id: entry.clientMutationId,
        userId: entry.userId,
        stopId: entry.stopId,
        customerName: entry.customerName,
        type: entry.type,
        error: result.error ?? "invalid",
        createdAt: now.toISOString(),
      });
    } else {
      settlement.done.push(entry.clientMutationId);
    }
  }
  return settlement;
}

/** The Parkplätze a sync answer carries and the routing point they imply (first = default). */
export function withServerSpots(state: Pick<SyncStopState, "parkingSpots">): {
  parkingSpots?: SyncParkingSpot[];
  lat?: number;
  lng?: number;
} {
  const spots = state.parkingSpots;
  if (spots === undefined) return {};
  const first = spots[0];
  return { parkingSpots: spots, ...(first ? { lat: first.lat, lng: first.lng } : {}) };
}

/** One stop of the stored tour JSON that a sync answer updates (structural, no zod). */
type PatchableStop = {
  id: string;
  status: StopStatus;
  problemReason: string | null;
  completedAt: string | null;
  hasKey?: boolean | null;
  keyNumber?: string | null;
  abbreviation?: string | null;
  lat?: number | null;
  lng?: number | null;
  parkingSpots?: SyncParkingSpot[];
};

/** One tour of the stored tour JSON that a sync answer updates (structural, no zod). */
type PatchableTour = {
  id: string;
  status: string;
  loadingStartedAt?: string | null;
  departedAt?: string | null;
  stops: PatchableStop[];
};

/**
 * The part of the stored tour JSON that a sync answer updates: `tours` carries every open tour of the
 * day and `tour` the active one (NUD-163); a copy cached before that has `tour` only.
 */
type PatchableTours = { tour: PatchableTour | null; tours?: PatchableTour[] };

/**
 * The stored tour with the authoritative stop states of a sync answer applied (status, reason,
 * time, tour status) — for the active tour *and* every other open tour of the day (NUD-163: a queued
 * tap can belong to either). Stops the answer does not know are left as they are; the tour JSON is
 * refreshed from the server right afterwards anyway.
 */
export function patchTourStates<T extends PatchableTours>(
  data: T,
  tours: readonly SyncTourState[],
): T {
  const states = new Map(tours.map((state) => [state.tourId, state]));
  const patch = (tour: PatchableTour): PatchableTour => {
    const state = states.get(tour.id);
    if (!state) return tour;
    const byId = new Map<string, SyncStopState>(state.stops.map((s) => [s.id, s]));
    return {
      ...tour,
      status: state.status,
      ...(state.loadingStartedAt !== undefined ? { loadingStartedAt: state.loadingStartedAt } : {}),
      ...(state.departedAt !== undefined ? { departedAt: state.departedAt } : {}),
      stops: tour.stops.map((stop) => {
        const s = byId.get(stop.id);
        return s
          ? {
              ...stop,
              status: s.status,
              problemReason: s.problemReason,
              completedAt: s.completedAt,
              ...(s.hasKey !== undefined ? { hasKey: s.hasKey } : {}),
              ...(s.keyNumber !== undefined ? { keyNumber: s.keyNumber } : {}),
              ...(s.abbreviation !== undefined ? { abbreviation: s.abbreviation } : {}),
              ...withServerSpots(s),
            }
          : stop;
      }),
    };
  };
  const touched =
    (data.tour !== null && states.has(data.tour.id)) ||
    (data.tours ?? []).some((tour) => states.has(tour.id));
  if (!touched) return data;
  const next = { ...data, tour: data.tour ? patch(data.tour) : data.tour } as T;
  if (!data.tours) return next;
  return { ...next, tours: data.tours.map(patch) };
}

/** Authoritative states of the stops named in `entries`, keyed by stop id. */
export function statesForEntries(
  entries: readonly Pick<OutboxEntry, "stopId">[],
  response: Pick<SyncResponse, "tours">,
): Map<string, SyncStopState> {
  const wanted = new Set(entries.map((e) => e.stopId));
  const out = new Map<string, SyncStopState>();
  for (const tour of response.tours) {
    for (const stop of tour.stops) if (wanted.has(stop.id)) out.set(stop.id, stop);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Retry timing
// ---------------------------------------------------------------------------------------------

export const BACKOFF_BASE_MS = 2_000;
/**
 * NUD-173 (QA 2026-10-29 F4): a dead server does not flip `navigator.onLine`, so no `online` event
 * and no Background Sync ever arrive — the backoff timer is then the only trigger. Five minutes of
 * silence was the reason the report's queue stayed unsent; one minute is short enough to feel
 * automatic and long enough not to be polling (it only runs while entries are failing).
 */
export const BACKOFF_MAX_MS = 60_000;

/** Wait after the `failures`-th failed attempt in a row: 2 s, 4 s, 8 s ... capped at 5 minutes. */
export function backoffDelayMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

export type BackoffState = { failures: number; retryAt: number };
export const NO_BACKOFF: BackoffState = { failures: 0, retryAt: 0 };

export function afterFailure(state: BackoffState, nowMs: number): BackoffState {
  const failures = state.failures + 1;
  return { failures, retryAt: nowMs + backoffDelayMs(failures) };
}

/**
 * Whether a trigger may start a request. Regular triggers (timer, focus, new entry) respect the
 * backoff; `force` is for signals that the situation changed (the browser's `online` event, the
 * driver pressing "send now"), which are worth one attempt right away.
 */
export function mayAttempt(state: BackoffState, nowMs: number, force: boolean): boolean {
  return force || nowMs >= state.retryAt;
}

/** Entries of other drivers are dropped after this long (a shared phone must not keep them forever). */
export const FOREIGN_ENTRY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
