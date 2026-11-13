import { z } from "zod";

import { MAX_AMOUNT_CENTS } from "@/domain/money";
import { cashDueCents } from "@/domain/payment";
import type { PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import type { Actor } from "./auth/guards";

/**
 * Cash collection at a stop (D33, NUD-196). The driver records what he actually took from the
 * customer; the amount is prefilled from the stop's ON_DELIVERY orders and may differ (paid in
 * part, change given, ...). The office sees the difference on the payments page.
 *
 * Same shape as the other driver-maintained values (key NUD-142, Parkplatz NUD-144, Abkürzung
 * NUD-164): one `StopMutation` row per client id, so a replayed queued tap changes nothing and the
 * offline queue can resend safely; the change is audited with the transaction.
 *
 * A collection is only recorded on a DELIVERED stop of the driver's own RELEASED / IN_PROGRESS tour:
 * the money changes hands when the goods do.
 */

const entrySchema = z.strictObject({
  /** Present on entries of the offline queue; direct calls (tests, actions) may omit it. */
  type: z.literal("payment").optional(),
  clientMutationId: z.uuid(),
  stopId: z.string().min(1).max(64),
  collectedCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
});

export type StopPaymentError =
  "invalid" | "forbidden" | "not_found" | "not_completed" | "tour_not_active" | "mutation_conflict";

export type StopPaymentResult =
  | { ok: true; replayed: boolean; stopId: string; collectedCents: number }
  | { ok: false; error: StopPaymentError };

type ActingDriver = Pick<Actor, "id" | "role">;

type PaymentDb = Pick<
  PrismaClient,
  "stop" | "stopMutation" | "auditLog" | "order" | "$transaction"
>;

export async function applyDriverPayment(
  db: PaymentDb,
  actor: ActingDriver,
  rawEntry: unknown,
  now: Date = new Date(),
  options: { clientCreatedAt?: Date } = {},
): Promise<StopPaymentResult> {
  const parsed = entrySchema.safeParse(rawEntry);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (actor.role !== "DRIVER") return { ok: false, error: "forbidden" };
  const entry = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<StopPaymentResult> => {
      const recorded = await tx.stopMutation.findUnique({ where: { id: entry.clientMutationId } });
      if (recorded) {
        return recorded.kind === "PAYMENT" &&
          recorded.stopId === entry.stopId &&
          recorded.driverId === actor.id
          ? { ok: true, replayed: true, stopId: entry.stopId, collectedCents: entry.collectedCents }
          : { ok: false, error: "mutation_conflict" };
      }

      const stop = await tx.stop.findUnique({
        where: { id: entry.stopId },
        select: {
          id: true,
          status: true,
          customerId: true,
          collectedCents: true,
          tour: { select: { id: true, status: true, driverId: true } },
          orders: {
            select: {
              order: { select: { status: true, paymentTerm: true, amountCents: true } },
            },
          },
        },
      });
      if (!stop || stop.tour.driverId !== actor.id) return { ok: false, error: "not_found" };
      // A COMPLETED tour is normal here: delivering the last stop completes the tour, and the cash of
      // that very stop is collected right after. Only a tour that is not out at all takes no money.
      if (stop.tour.status === "DRAFT" || stop.tour.status === "OPTIMIZED") {
        return { ok: false, error: "tour_not_active" };
      }
      if (stop.status !== "DELIVERED") return { ok: false, error: "not_completed" };

      // What was to be collected is part of the audit entry: the office can see an underpayment
      // later even if the order's amount is edited afterwards.
      const dueCents = cashDueCents(
        stop.orders
          .map((link) => link.order)
          .filter((order) => order.status === "CONFIRMED")
          .map((order) => ({ paymentTerm: order.paymentTerm, amountCents: order.amountCents })),
      );

      await tx.stop.update({
        where: { id: stop.id },
        data: {
          collectedCents: entry.collectedCents,
          collectedAt: now,
          collectedById: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        entity: "Stop",
        entityId: stop.id,
        action: "stop.payment",
        diff: {
          tourId: stop.tour.id,
          customerId: stop.customerId,
          from: stop.collectedCents,
          to: entry.collectedCents,
          dueCents,
          via: options.clientCreatedAt ? "sync" : "driver",
          ...(options.clientCreatedAt
            ? { clientCreatedAt: options.clientCreatedAt.toISOString() }
            : {}),
        },
      });
      await tx.stopMutation.create({
        data: {
          id: entry.clientMutationId,
          stopId: stop.id,
          driverId: actor.id,
          kind: "PAYMENT",
          result: {
            ok: true,
            kind: "PAYMENT",
            collectedCents: entry.collectedCents,
            dueCents,
          },
        },
      });
      return {
        ok: true,
        replayed: false,
        stopId: stop.id,
        collectedCents: entry.collectedCents,
      };
    });
  } catch (error) {
    // The same id arrived twice at once and the other request committed first: it is applied.
    if ((error as { code?: unknown }).code === "P2002") {
      return {
        ok: true,
        replayed: true,
        stopId: entry.stopId,
        collectedCents: entry.collectedCents,
      };
    }
    throw error;
  }
}
