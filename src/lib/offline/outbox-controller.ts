import type { SyncMutationType, SyncStopState } from "@/domain/driver-sync";

import {
  afterFailure,
  BACKOFF_MAX_MS,
  type BackoffState,
  FOREIGN_ENTRY_MAX_AGE_MS,
  mayAttempt,
  nextSeq,
  NO_BACKOFF,
  type OutboxEntry,
  type OutboxNotice,
  planUndo,
  sortEntries,
} from "./outbox";
import { type FlushFailure, flushOutbox, type FlushOutcome } from "./outbox-flush";
import type { OutboxStore } from "./outbox-store";

/**
 * The live state of the outbox in one browser tab (NUD-082) and everything that changes it:
 * enqueue a tap, undo (cancel or queue an undo), flush with backoff, acknowledge notices. React
 * reads it through `useOutbox`; the controller itself is plain TypeScript and is unit-tested with
 * a memory store and a fake `fetch`.
 *
 * Source of truth is the `OutboxStore` (IndexedDB): the state is re-read from it after every
 * change, so a second tab or the service worker writing to the same database cannot be lost.
 */
export type OutboxState = {
  /** The driver the queue belongs to; `null` until `start` ran. */
  userId: string | null;
  /** Queued taps of `userId`, in the order they were made. */
  entries: readonly OutboxEntry[];
  /** Entries a request carries right now (a completion in this set can no longer be cancelled). */
  inFlight: ReadonlySet<string>;
  notices: readonly OutboxNotice[];
  flushing: boolean;
  /** Reason the last flush failed (`null` after a success), for the "will retry" hint. */
  failure: FlushFailure | null;
  /**
   * Authoritative stop states the server just returned. Shown on top of the (not yet refreshed)
   * server-rendered page so a settled stop does not flicker back to "pending"; dropped after 20 s.
   */
  confirmed: Readonly<Record<string, SyncStopState>>;
};

export type OutboxControllerDeps = {
  store: OutboxStore;
  fetchImpl: typeof fetch;
  now: () => Date;
  newId: () => string;
  /** Timer functions (replaceable in tests). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

export type NewMutation = {
  type: SyncMutationType;
  stopId: string;
  reason?: string;
  note?: string;
  /** Type "key" only (NUD-142). */
  hasKey?: boolean;
  keyNumber?: string;
  /** Type "abbreviation" only (NUD-164); absent clears it. */
  abbreviation?: string;
  /** Type "parking" only (NUD-144). */
  lat?: number;
  lng?: number;
  /** Type "payment" only (D33, NUD-196): the cash collected at the stop, in euro cents. */
  collectedCents?: number;
  customerName: string;
};

/**
 * Key, Parkplatz and departure entries are no stop completions: each kind is compared only with its
 * own (a second "loading" tap is a double tap, a "depart" after it is something else).
 */
const entryKind = (type: SyncMutationType): SyncMutationType | "stop" =>
  type === "key" ||
  type === "abbreviation" ||
  type === "parking" ||
  type === "loading" ||
  type === "depart"
    ? type
    : "stop";

export const CONFIRMED_TTL_MS = 20_000;

const INITIAL: OutboxState = {
  userId: null,
  entries: [],
  inFlight: new Set(),
  notices: [],
  flushing: false,
  failure: null,
  confirmed: {},
};

export function createOutboxController(deps: OutboxControllerDeps) {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let state: OutboxState = INITIAL;
  const listeners = new Set<() => void>();
  const flushedListeners = new Set<(outcome: Extract<FlushOutcome, { kind: "ran" }>) => void>();
  let backoff: BackoffState = NO_BACKOFF;
  let retryTimer: unknown = null;
  let running: Promise<FlushOutcome> | null = null;
  let again: { force: boolean } | null = null;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  // Writes to the store are chained so that two quick taps get distinct `seq` values.
  let writes: Promise<unknown> = Promise.resolve();

  const set = (next: Partial<OutboxState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = writes.then(task, task);
    writes = run.catch(() => undefined);
    return run;
  };

  /** Re-reads queue and notices of the current user from the store. */
  async function reload(): Promise<void> {
    const userId = state.userId;
    if (!userId) return;
    const [entries, notices] = await Promise.all([deps.store.entries(), deps.store.notices()]);
    set({
      entries: sortEntries(entries.filter((e) => e.userId === userId)),
      notices: notices
        .filter((n) => n.userId === userId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    });
  }

  /**
   * Starts the queue for `userId`: loads it, and drops what cannot be sent any more. Entries of
   * another driver (shared phone) are kept for three days after their tap, in case that driver comes
   * back, and then removed; they are never sent in this session.
   */
  async function start(userId: string): Promise<void> {
    if (state.userId !== userId) {
      set({ ...INITIAL, userId });
    }
    try {
      const now = deps.now().getTime();
      for (const entry of await deps.store.entries()) {
        if (
          entry.userId !== userId &&
          now - Date.parse(entry.createdAt) > FOREIGN_ENTRY_MAX_AGE_MS
        ) {
          await deps.store.removeEntry(entry.clientMutationId);
        }
      }
      for (const notice of await deps.store.notices()) {
        if (
          notice.userId !== userId &&
          now - Date.parse(notice.createdAt) > FOREIGN_ENTRY_MAX_AGE_MS
        ) {
          await deps.store.removeNotice(notice.id);
        }
      }
      await reload();
    } catch {
      // No storage (private mode): the queue just stays empty, taps then fail visibly in `enqueue`.
    } finally {
      resolveReady();
    }
  }

  async function enqueue(mutation: NewMutation): Promise<OutboxEntry> {
    await ready;
    const userId = state.userId;
    if (!userId) throw new Error("outbox: no user");
    return serial(async () => {
      const queued = sortEntries((await deps.store.entries()).filter((e) => e.userId === userId));
      // A second tap on the same thing (double tap) is the same intent: keep the first entry.
      const last = queued
        .filter(
          (e) => e.stopId === mutation.stopId && entryKind(e.type) === entryKind(mutation.type),
        )
        .at(-1);
      if (
        last &&
        last.type === mutation.type &&
        mutation.type !== "undo" &&
        !state.inFlight.has(last.clientMutationId) &&
        (mutation.type !== "key" ||
          (last.hasKey === mutation.hasKey &&
            (last.keyNumber ?? "") === (mutation.keyNumber ?? ""))) &&
        (mutation.type !== "abbreviation" ||
          (last.abbreviation ?? "") === (mutation.abbreviation ?? "")) &&
        (mutation.type !== "parking" || (last.lat === mutation.lat && last.lng === mutation.lng)) &&
        (mutation.type !== "payment" || last.collectedCents === mutation.collectedCents)
      ) {
        return last;
      }
      const entry: OutboxEntry = {
        clientMutationId: deps.newId(),
        userId,
        type: mutation.type,
        stopId: mutation.stopId,
        ...(mutation.reason ? { reason: mutation.reason } : {}),
        ...(mutation.note ? { note: mutation.note } : {}),
        ...(mutation.type === "key" && mutation.hasKey !== undefined
          ? { hasKey: mutation.hasKey }
          : {}),
        ...(mutation.type === "key" && mutation.keyNumber ? { keyNumber: mutation.keyNumber } : {}),
        ...(mutation.type === "abbreviation" && mutation.abbreviation
          ? { abbreviation: mutation.abbreviation }
          : {}),
        ...(mutation.type === "parking" && mutation.lat !== undefined && mutation.lng !== undefined
          ? { lat: mutation.lat, lng: mutation.lng }
          : {}),
        ...(mutation.type === "payment" && mutation.collectedCents !== undefined
          ? { collectedCents: mutation.collectedCents }
          : {}),
        createdAt: deps.now().toISOString(),
        seq: nextSeq(queued),
        customerName: mutation.customerName,
      };
      await deps.store.putEntry(entry);
      await reload();
      return entry;
    });
  }

  /**
   * "Undo" for a stop: removes the queued completion if it has not been sent (the server never
   * learns about it), otherwise queues an undo behind it.
   */
  async function undo(
    stopId: string,
    customerName: string,
  ): Promise<"cancelled" | "queued" | "none"> {
    await ready;
    const userId = state.userId;
    if (!userId) throw new Error("outbox: no user");
    return serial(async () => {
      const queued = (await deps.store.entries()).filter((e) => e.userId === userId);
      const plan = planUndo(queued, stopId, state.inFlight);
      if (plan.action === "cancel") {
        await deps.store.removeEntry(plan.clientMutationId);
        await reload();
        return "cancelled";
      }
      if (plan.action === "none") return "none";
      const entry: OutboxEntry = {
        clientMutationId: deps.newId(),
        userId,
        type: "undo",
        stopId,
        createdAt: deps.now().toISOString(),
        seq: nextSeq(queued),
        customerName,
      };
      await deps.store.putEntry(entry);
      await reload();
      return "queued";
    });
  }

  function scheduleRetry() {
    if (retryTimer !== null) clearTimer(retryTimer);
    const wait = Math.min(Math.max(backoff.retryAt - deps.now().getTime(), 0), BACKOFF_MAX_MS);
    retryTimer = setTimer(() => {
      retryTimer = null;
      void flush();
    }, wait);
  }

  /**
   * Sends the queue. `force` ignores the backoff (the `online` event, "send now"). A call during a
   * running flush makes it run once more afterwards, so a tap made meanwhile is not left behind.
   */
  function flush(options: { force?: boolean } = {}): Promise<FlushOutcome> {
    const force = options.force ?? false;
    if (running) {
      again = { force: force || (again?.force ?? false) };
      return running;
    }
    if (!state.userId) return Promise.resolve({ kind: "empty" });
    if (!mayAttempt(backoff, deps.now().getTime(), force))
      return Promise.resolve({ kind: "empty" });
    const userId = state.userId;
    running = (async (): Promise<FlushOutcome> => {
      set({ flushing: true });
      let last: FlushOutcome = { kind: "empty" };
      try {
        do {
          const wantForce = again?.force ?? force;
          again = null;
          if (!mayAttempt(backoff, deps.now().getTime(), wantForce)) break;
          const outcome = await flushOutbox(userId, {
            store: deps.store,
            fetchImpl: deps.fetchImpl,
            now: deps.now,
            onSending: (ids) => set({ inFlight: new Set([...state.inFlight, ...ids]) }),
            onSettled: (ids) => {
              const next = new Set(state.inFlight);
              for (const id of ids) next.delete(id);
              set({ inFlight: next });
            },
          });
          last = outcome;
          if (outcome.kind === "ran") {
            handleRan(outcome);
            if (outcome.failure) break;
          }
        } while (again);
      } finally {
        running = null;
        again = null;
        set({ flushing: false });
        await reload().catch(() => undefined);
      }
      return last;
    })();
    return running;
  }

  function handleRan(outcome: Extract<FlushOutcome, { kind: "ran" }>) {
    if (outcome.failure) {
      backoff = afterFailure(backoff, deps.now().getTime());
      set({ failure: outcome.failure });
      scheduleRetry();
    } else {
      backoff = NO_BACKOFF;
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
      set({ failure: null });
    }
    if (outcome.states.size > 0) {
      const confirmed = { ...state.confirmed };
      for (const [id, s] of outcome.states) {
        confirmed[id] = s;
        setTimer(() => {
          if (state.confirmed[id] !== s) return;
          const rest = { ...state.confirmed };
          delete rest[id];
          set({ confirmed: rest });
        }, CONFIRMED_TTL_MS);
      }
      set({ confirmed });
    }
    if (outcome.applied + outcome.rejected > 0) {
      for (const listener of flushedListeners) listener(outcome);
    }
  }

  async function dismissNotice(id: string): Promise<void> {
    await deps.store.removeNotice(id);
    await reload();
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Called after a flush settled at least one entry (the page refreshes its server data). */
    onFlushed(listener: (outcome: Extract<FlushOutcome, { kind: "ran" }>) => void) {
      flushedListeners.add(listener);
      return () => void flushedListeners.delete(listener);
    },
    start,
    reload,
    enqueue,
    undo,
    flush,
    dismissNotice,
    /** Waits until the queue is loaded. */
    ready: () => ready,
  };
}

export type OutboxController = ReturnType<typeof createOutboxController>;
