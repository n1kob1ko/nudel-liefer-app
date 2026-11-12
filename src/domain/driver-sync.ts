/**
 * Contract and pure rules of the driver's offline mutation sync (NUD-082). Shared by the server
 * (`POST /api/driver/sync`), the page and the service worker, so it imports nothing (no zod, no
 * framework): the request is validated with zod on the server (`server/driver-sync.ts`), the
 * response by the hand-written guard below.
 */

/** A batch carries at most this many queued mutations (the client sends larger queues in chunks). */
export const SYNC_MAX_ENTRIES = 50;

/** Largest request body the endpoint reads (bytes). 50 entries with 500-character notes fit easily. */
export const SYNC_MAX_BODY_BYTES = 256 * 1024;

/**
 * How far in the past the time of a queued tap is trusted. The queue only holds today's work; an
 * older `createdAt` (wrong phone clock, a phone that was off for days) is treated as this old.
 */
export const SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The moment a queued mutation counts as "made" on the server: its client `createdAt`, but never
 * later than the server's `now` (a phone clock that runs ahead) and never earlier than 24 h before
 * it (a clock far behind). It becomes `Stop.completedAt`, the start of the 5-minute undo window and
 * the time the conflict rule compares with the office's changes.
 */
export function effectiveMutationTime(createdAt: Date, now: Date): Date {
  const time = createdAt.getTime();
  if (Number.isNaN(time)) return now;
  return new Date(Math.min(Math.max(time, now.getTime() - SYNC_MAX_AGE_MS), now.getTime()));
}

/**
 * `key`: the driver set or corrected the customer's key (NUD-142); `abbreviation`: set, corrected
 * or cleared the customer's Abkürzung (NUD-164); `parking`: a new Parkplatz
 * (NUD-144); `payment`: the cash he collected at the stop (D33, NUD-196); `loading` / `depart`: the
 * departure checklist was opened / the driver left (NUD-151, they name any stop of the tour and
 * write the tour's timestamps); the others change the stop status.
 */
export type SyncMutationType =
  | "delivered"
  | "problem"
  | "undo"
  | "key"
  | "abbreviation"
  | "parking"
  | "payment"
  | "loading"
  | "depart";

/** One queued mutation as sent to the server. */
export type SyncEntry = {
  clientMutationId: string;
  type: SyncMutationType;
  stopId: string;
  /** `ProblemReason` (type "problem" only). */
  reason?: string;
  note?: string;
  /** Type "key" only: a key exists (`true`) or not (`false`); the number only goes with `true`. */
  hasKey?: boolean;
  keyNumber?: string;
  /** Type "abbreviation" only (NUD-164): the new text; absent clears it. */
  abbreviation?: string;
  /** Type "parking" only (NUD-144): the Parkplatz the driver set, 6 decimals. */
  lat?: number;
  lng?: number;
  /** Type "payment" only (D33): the cash collected at the stop, in euro cents. */
  collectedCents?: number;
  /** ISO time of the driver's tap on the device. */
  createdAt: string;
};

export type SyncRequest = { entries: SyncEntry[] };

/**
 * - `applied`: the server changed the stop; `replayed`: it had applied this id before (nothing
 *   changed, the earlier answer was lost); both mean "done, remove from the queue".
 * - `rejected`: the server's state wins, the mutation will never be applied (`error` says why);
 *   remove it from the queue and tell the driver.
 * - `retry`: not processed (server problem), keep it in the queue.
 */
export type SyncOutcome = "applied" | "replayed" | "rejected" | "retry";

export type SyncEntryResult = {
  clientMutationId: string;
  outcome: SyncOutcome;
  /** Reason code of a rejection (`StopStatusError`: `changed_by_office`, `not_found`, ...). */
  error?: string;
};

export type SyncStopState = {
  id: string;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  problemReason: string | null;
  completedAt: string | null;
  /**
   * The customer's key as the server holds it after the batch (NUD-142); absent in answers of
   * older servers, which the client then ignores.
   */
  hasKey?: boolean | null;
  keyNumber?: string | null;
  /** The customer's Abkürzung after the batch (NUD-164); absent in older answers. */
  abbreviation?: string | null;
  /** The customer's active Parkplätze in display order (NUD-144); absent in older answers. */
  parkingSpots?: SyncParkingSpot[];
  /** Cash the server has recorded for the stop (D33); absent in answers of older servers. */
  collectedCents?: number | null;
};

export type SyncParkingSpot = {
  label: string | null;
  note: string | null;
  lat: number;
  lng: number;
};

/** The authoritative state of every stop of a tour the batch touched. */
export type SyncTourState = {
  tourId: string;
  status: string;
  /** Departure checklist times (NUD-151, ISO or null); absent in answers of older servers. */
  loadingStartedAt?: string | null;
  departedAt?: string | null;
  stops: SyncStopState[];
};

export type SyncResponse = {
  results: SyncEntryResult[];
  tours: SyncTourState[];
  serverTime: string;
};

const OUTCOMES: readonly string[] = ["applied", "replayed", "rejected", "retry"];
const STATUSES: readonly string[] = ["PENDING", "DELIVERED", "PROBLEM"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

/** Checks a decoded server answer; `null` for anything that is not a well-formed `SyncResponse`. */
export function parseSyncResponse(raw: unknown): SyncResponse | null {
  if (!isRecord(raw) || !Array.isArray(raw.results) || !Array.isArray(raw.tours)) return null;
  const results: SyncEntryResult[] = [];
  for (const r of raw.results) {
    if (
      !isRecord(r) ||
      typeof r.clientMutationId !== "string" ||
      typeof r.outcome !== "string" ||
      !OUTCOMES.includes(r.outcome) ||
      (r.error !== undefined && typeof r.error !== "string")
    ) {
      return null;
    }
    results.push({
      clientMutationId: r.clientMutationId,
      outcome: r.outcome as SyncOutcome,
      ...(typeof r.error === "string" ? { error: r.error } : {}),
    });
  }
  const tours: SyncTourState[] = [];
  for (const t of raw.tours) {
    if (
      !isRecord(t) ||
      typeof t.tourId !== "string" ||
      typeof t.status !== "string" ||
      !Array.isArray(t.stops) ||
      (t.loadingStartedAt !== undefined && !isNullableString(t.loadingStartedAt)) ||
      (t.departedAt !== undefined && !isNullableString(t.departedAt))
    ) {
      return null;
    }
    const stops: SyncStopState[] = [];
    for (const s of t.stops) {
      if (
        !isRecord(s) ||
        typeof s.id !== "string" ||
        typeof s.status !== "string" ||
        !STATUSES.includes(s.status) ||
        !isNullableString(s.problemReason) ||
        !isNullableString(s.completedAt) ||
        (s.hasKey !== undefined && s.hasKey !== null && typeof s.hasKey !== "boolean") ||
        (s.keyNumber !== undefined && !isNullableString(s.keyNumber)) ||
        (s.abbreviation !== undefined && !isNullableString(s.abbreviation)) ||
        (s.collectedCents !== undefined &&
          s.collectedCents !== null &&
          typeof s.collectedCents !== "number") ||
        (s.parkingSpots !== undefined && parseParkingSpots(s.parkingSpots) === null)
      ) {
        return null;
      }
      stops.push({
        id: s.id,
        status: s.status as SyncStopState["status"],
        problemReason: s.problemReason,
        completedAt: s.completedAt,
        ...(s.hasKey !== undefined ? { hasKey: s.hasKey as boolean | null } : {}),
        ...(s.keyNumber !== undefined ? { keyNumber: s.keyNumber as string | null } : {}),
        ...(s.abbreviation !== undefined ? { abbreviation: s.abbreviation as string | null } : {}),
        ...(s.collectedCents !== undefined
          ? { collectedCents: s.collectedCents as number | null }
          : {}),
        ...(s.parkingSpots !== undefined
          ? { parkingSpots: parseParkingSpots(s.parkingSpots)! }
          : {}),
      });
    }
    tours.push({
      tourId: t.tourId,
      status: t.status,
      ...(t.loadingStartedAt !== undefined
        ? { loadingStartedAt: t.loadingStartedAt as string | null }
        : {}),
      ...(t.departedAt !== undefined ? { departedAt: t.departedAt as string | null } : {}),
      stops,
    });
  }
  return {
    results,
    tours,
    serverTime: typeof raw.serverTime === "string" ? raw.serverTime : new Date().toISOString(),
  };
}

function parseParkingSpots(raw: unknown): SyncParkingSpot[] | null {
  if (!Array.isArray(raw) || raw.length > 20) return null;
  const spots: SyncParkingSpot[] = [];
  for (const item of raw) {
    if (
      !isRecord(item) ||
      !isNullableString(item.label) ||
      !isNullableString(item.note) ||
      typeof item.lat !== "number" ||
      typeof item.lng !== "number"
    ) {
      return null;
    }
    spots.push({ label: item.label, note: item.note, lat: item.lat, lng: item.lng });
  }
  return spots;
}
