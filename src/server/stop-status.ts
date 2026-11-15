import { z } from "zod";

import {
  isWithinUndoWindow,
  nextPendingAfter,
  PROBLEM_NOTE_MAX,
  PROBLEM_REASONS,
  undoDeadline,
} from "@/domain/stop-status";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { type AppLocale, createLocalizedText, localeSchema } from "@/lib/localized-text";

import { recordAudit } from "./audit";
import type { Actor } from "./auth/guards";
import { rebaseTourSchedule } from "./tour-schedule";
import { syncTourProgress } from "./tour-service";

/**
 * Driver stop status (NUD-053): "delivered", "problem" (reason + optional free text) and "undo".
 * One function for one mutation, `applyStopMutation`, so the batch sync of NUD-082 can call it per
 * queued entry (pass the entry's own `clientMutationId`; replays are harmless).
 *
 * Rules:
 * - The stop must belong to a RELEASED / IN_PROGRESS tour assigned to the acting driver, otherwise
 *   `not_found` (the same answer for foreign and unknown stops). Not limited to "today", so a queued
 *   mutation that syncs after midnight still lands.
 * - Everything runs in one transaction behind the per-date advisory lock that release and
 *   re-release use (`tour:<YYYY-MM-DD>`), and the tour status follows via `syncTourProgress`.
 * - Idempotent by `clientMutationId`: the id is recorded (`StopMutation`) in the same transaction.
 *   Replaying an accepted id returns the stored result with `replayed: true` and changes nothing;
 *   the same id used for something else is `mutation_conflict`. Rejected mutations are not recorded.
 * - Undo is allowed for 5 minutes after the stop was completed (server clock). Once the tour is
 *   COMPLETED nothing can be undone (COMPLETED is final in the tour status machine). The tour never
 *   moves back from IN_PROGRESS, also not when the only completed stop is undone.
 * - Offline queue (NUD-082): the batch sync `POST /api/driver/sync` calls this per queued entry with
 *   `now` = the moment the driver made the tap (the entry's `createdAt`, clamped to sane bounds by
 *   `effectiveMutationTime`) so `completedAt` and the 5-minute undo window follow the driver's
 *   action, not the delivery of the request, and passes `clientCreatedAt` to switch on the conflict
 *   rule: a stop the office changed (re-release) after that moment is NOT changed
 *   (`changed_by_office`, server state wins).
 */

const mutationFields = {
  clientMutationId: z.uuid(),
  stopId: z.string().min(1).max(64),
};

export const stopMutationSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("delivered"), ...mutationFields }),
  z.strictObject({
    type: z.literal("problem"),
    ...mutationFields,
    reason: z.enum(PROBLEM_REASONS),
    note: z.string().max(PROBLEM_NOTE_MAX).optional(),
  }),
  z.strictObject({ type: z.literal("undo"), ...mutationFields }),
]);
export type StopMutationInput = z.input<typeof stopMutationSchema>;

export type StopStatusError =
  | "invalid"
  | "forbidden"
  | "not_found"
  | "already_completed"
  | "not_completed"
  | "undo_expired"
  | "tour_completed"
  | "tour_not_active"
  | "mutation_conflict"
  /** Offline queue only: the office changed the stop after the driver's tap, server state wins. */
  | "changed_by_office";

export type StopStatusOk = {
  ok: true;
  /** True when this id was already applied: nothing changed, this is the stored result. */
  replayed: boolean;
  kind: "COMPLETE" | "UNDO";
  stopId: string;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  tourId: string;
  tourStatus: string;
  /** Stops that are not PENDING / all stops of the tour. */
  done: number;
  total: number;
  /** Stop to open next (next pending in tour order); `null` when the tour is finished. */
  nextStopId: string | null;
  completedAt: string | null;
  /** End of the undo window (ISO); `null` when the stop cannot be undone (pending, or tour completed). */
  undoUntil: string | null;
};
export type StopStatusResult = StopStatusOk | { ok: false; error: StopStatusError };

const fail = (error: StopStatusError): StopStatusResult => ({ ok: false, error });

class Rejected extends Error {
  constructor(readonly error: StopStatusError) {
    super(error);
  }
}

// unbounded-ok-start: result row the server stored itself (StopMutation.result)
const storedResultSchema = z.object({
  ok: z.literal(true),
  kind: z.enum(["COMPLETE", "UNDO"]),
  stopId: z.string(),
  status: z.enum(["PENDING", "DELIVERED", "PROBLEM"]),
  tourId: z.string(),
  tourStatus: z.string(),
  done: z.number(),
  total: z.number(),
  nextStopId: z.string().nullable(),
  completedAt: z.string().nullable(),
  undoUntil: z.string().nullable(),
});
// unbounded-ok-end

type ActingDriver = Pick<Actor, "id" | "role" | "locale">;

export type ApplyStopMutationOptions = {
  /**
   * When the mutation was made on the device (offline queue). Switches on the conflict rule: the
   * mutation is rejected with `changed_by_office` if the office changed the stop after this moment.
   */
  clientCreatedAt?: Date;
};

/**
 * Applies one stop-status mutation for `actor` (a DRIVER; the caller has run `requireRole`). `now`
 * is the server clock (injectable for tests). Never throws for business rejections.
 */
export async function applyStopMutation(
  db: PrismaClient,
  actor: ActingDriver,
  rawInput: unknown,
  now: Date = new Date(),
  options: ApplyStopMutationOptions = {},
): Promise<StopStatusResult> {
  const parsed = stopMutationSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid");
  if (actor.role !== "DRIVER") return fail("forbidden");
  const input = parsed.data;

  // The date of the tour is needed for the lock key; everything is re-checked under the lock.
  const preliminary = await db.stop.findUnique({
    where: { id: input.stopId },
    select: { tour: { select: { date: true, driverId: true } } },
  });
  if (!preliminary || preliminary.tour.driverId !== actor.id) return fail("not_found");
  const lockKey = `tour:${preliminary.tour.date.toISOString().slice(0, 10)}`;

  const parsedLocale = localeSchema.safeParse(actor.locale);
  const locale: AppLocale = parsedLocale.success ? parsedLocale.data : "de";
  const kind = input.type === "undo" ? "UNDO" : "COMPLETE";

  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        const recorded = await tx.stopMutation.findUnique({
          where: { id: input.clientMutationId },
        });
        if (recorded) {
          const stored = storedResultSchema.safeParse(recorded.result);
          if (
            !stored.success ||
            recorded.stopId !== input.stopId ||
            recorded.driverId !== actor.id ||
            recorded.kind !== kind
          ) {
            throw new Rejected("mutation_conflict");
          }
          return { ...stored.data, replayed: true } satisfies StopStatusOk;
        }

        const stop = await tx.stop.findUnique({
          where: { id: input.stopId },
          select: {
            id: true,
            status: true,
            completedAt: true,
            adminChangedAt: true,
            customerId: true,
            problemReason: true,
            collectedCents: true,
            tour: { select: { id: true, status: true, driverId: true } },
          },
        });
        if (!stop || stop.tour.driverId !== actor.id) throw new Rejected("not_found");
        if (
          options.clientCreatedAt &&
          stop.adminChangedAt &&
          stop.adminChangedAt.getTime() > options.clientCreatedAt.getTime()
        ) {
          throw new Rejected("changed_by_office");
        }
        const tourStatus = stop.tour.status;
        const active = tourStatus === "RELEASED" || tourStatus === "IN_PROGRESS";

        if (input.type === "undo") {
          if (stop.status === "PENDING") throw new Rejected("not_completed");
          if (tourStatus === "COMPLETED") throw new Rejected("tour_completed");
          if (!active) throw new Rejected("tour_not_active");
          if (!stop.completedAt || !isWithinUndoWindow(stop.completedAt, now)) {
            throw new Rejected("undo_expired");
          }
          const reopened = await tx.stop.updateMany({
            where: { id: stop.id, status: { not: "PENDING" } },
            data: {
              status: "PENDING",
              problemReason: null,
              problemNote: Prisma.DbNull,
              completedAt: null,
              clientMutationId: null,
              // Owner 2026-11-14: cash is recorded together with "Geliefert"; taking the delivery
              // back takes the cash back too, the next "Geliefert" asks for it again.
              collectedCents: null,
              collectedAt: null,
              collectedById: null,
            },
          });
          if (reopened.count !== 1) throw new Rejected("not_completed");
        } else {
          if (stop.status !== "PENDING") throw new Rejected("already_completed");
          if (!active) throw new Rejected("tour_not_active");
          const note = input.type === "problem" ? input.note?.trim() : undefined;
          const completed = await tx.stop.updateMany({
            where: { id: stop.id, status: "PENDING" },
            data: {
              status: input.type === "delivered" ? "DELIVERED" : "PROBLEM",
              problemReason: input.type === "problem" ? input.reason : null,
              problemNote: note
                ? (createLocalizedText({ [locale]: note }, locale, {
                    now,
                    // Non-German text is stored with the pending marker (NUD-072): the office sees
                    // "translation pending" until `translateStopProblemNote` (after the commit) or
                    // the cron retry job fills the German version. German needs no translation.
                    pendingTranslation: locale !== "de",
                  }) as Prisma.InputJsonValue)
                : Prisma.DbNull,
              completedAt: now,
              clientMutationId: input.clientMutationId,
            },
          });
          if (completed.count !== 1) throw new Rejected("already_completed");
        }

        // NUD-172 (QA 2026-10-29 F3): the remaining plan follows the driver's real progress, so the
        // next arrival and the end of the tour are the same numbers on the phone and in the office.
        // Completed stops keep the ETA they had when the driver worked them.
        await rebaseTourSchedule(tx, stop.tour.id, now);

        const newTourStatus = (await syncTourProgress(tx, stop.tour.id, now)) ?? tourStatus;
        const stops = await tx.stop.findMany({
          where: { tourId: stop.tour.id },
          select: { id: true, sequence: true, status: true },
        });
        const mine = stops.find((s) => s.id === stop.id)!;
        const result: StopStatusOk = {
          ok: true,
          replayed: false,
          kind,
          stopId: stop.id,
          status: mine.status,
          tourId: stop.tour.id,
          tourStatus: newTourStatus,
          done: stops.filter((s) => s.status !== "PENDING").length,
          total: stops.length,
          nextStopId: nextPendingAfter(stops, stop.id)?.id ?? null,
          completedAt: kind === "COMPLETE" ? now.toISOString() : null,
          // The last stop completes the tour, and a completed tour cannot be reopened.
          undoUntil:
            kind === "COMPLETE" && newTourStatus !== "COMPLETED"
              ? undoDeadline(now).toISOString()
              : null,
        };
        // The history entry belongs to the same transaction as the status change. `clientCreatedAt`
        // is the moment of the tap for entries that came through the offline queue (NUD-082).
        await recordAudit(tx, {
          actorId: actor.id,
          entity: "Stop",
          entityId: stop.id,
          action:
            input.type === "undo"
              ? "stop.undo"
              : input.type === "delivered"
                ? "stop.delivered"
                : "stop.problem",
          diff: {
            tourId: stop.tour.id,
            customerId: stop.customerId,
            status: { from: stop.status, to: mine.status },
            ...(input.type === "problem"
              ? // The driver's text itself is not copied into the append-only audit log (NUD-121):
                // it would outlive the stop's own text (NUD-112) and cannot be scrubbed there.
                {
                  reason: input.reason,
                  hasNote: Boolean(input.note?.trim()),
                  ...(input.note?.trim() ? { noteLength: input.note.trim().length } : {}),
                }
              : {}),
            ...(input.type === "undo"
              ? {
                  previousReason: stop.problemReason,
                  ...(stop.collectedCents !== null
                    ? { previousCollectedCents: stop.collectedCents }
                    : {}),
                }
              : {}),
            ...(newTourStatus !== tourStatus
              ? { tourStatus: { from: tourStatus, to: newTourStatus } }
              : {}),
            via: options.clientCreatedAt ? "sync" : "online",
            ...(options.clientCreatedAt
              ? { clientCreatedAt: options.clientCreatedAt.toISOString() }
              : {}),
          },
        });
        await tx.stopMutation.create({
          data: {
            id: input.clientMutationId,
            stopId: stop.id,
            driverId: actor.id,
            kind,
            result,
          },
        });
        return result;
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof Rejected) return fail(error.error);
    // A concurrent request with the same id on another date's lock: the id is unique.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("mutation_conflict");
    }
    throw error;
  }
}
