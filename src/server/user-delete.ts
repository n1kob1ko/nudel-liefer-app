import type { PrismaClient } from "@/generated/prisma/client";

import { recordAudit } from "./audit";
import { clearFailures, loginKeys } from "./auth/rate-limit";
import { userIdSchema } from "./users";

/**
 * Deleting an account for good (NUD-206, owner's decision 2026-11-13: "not only deactivate").
 * This is the one place a `User` row is removed. Everything else about a user stays soft
 * (`active = false`).
 *
 * What happens to what the account left behind:
 *
 * - **Released tours from today on stop the delete.** A driver who still has a tour to drive cannot
 *   vanish from it; the office gives the tour to another driver first ("Bearbeiten" on the tour).
 * - **Every other tour keeps its stops, times and cash and loses only the driver** (`driverId`
 *   null): finished tours, old ones, and plans that were never released.
 * - **Records that must name a user go to the admin who deletes:** photos, parking spots, order
 *   screenshots, orders, standing orders, "paid" marks and corrections of monthly bills. They are
 *   the office's records; the alternative would be to delete them with the account.
 * - Optional marks ("key number changed by", cash "collected by", default driver of a standing
 *   tour) are cleared, and the working hours go with the driver.
 *
 * `USER_REFERENCES` lists every column that points at `User`; `user-delete.test.ts` compares it
 * with `prisma/schema.prisma`, so a new relation fails the test until this file handles it.
 */

export const USER_REFERENCES = [
  "WorkSchedule.driverId",
  "Customer.keyUpdatedById",
  "Customer.abbreviationUpdatedById",
  "MonthlyPayment.paidById",
  "MonthlyAdjustment.createdById",
  "StandingTour.driverId",
  "ParkingSpot.createdById",
  "Photo.uploadedById",
  "Screenshot.uploadedById",
  "Order.createdById",
  "RecurringOrder.confirmedById",
  "Tour.driverId",
  "Stop.collectedById",
] as const;

export type DeleteUserError = "invalid" | "not_found" | "self" | "open_tours";
export type DeleteUserResult =
  | { ok: true }
  /** `dates`: the days (`YYYY-MM-DD`) of the released tours that stop the delete, at most five. */
  | { ok: false; error: DeleteUserError; dates?: string[] };

type DeleteDb = Pick<PrismaClient, "$transaction" | "loginAttempt">;

/** Sentinel thrown inside the transaction so that nothing of a refused delete is kept. */
class Refused extends Error {
  constructor(readonly dates: string[]) {
    super("open_tours");
  }
}

/**
 * Deletes user `id` for good. `today` is the factory's calendar day as a UTC-midnight date, the
 * same value `Tour.date` holds. An admin cannot delete the own account, so one admin always remains.
 */
export async function deleteUser(
  db: DeleteDb,
  actorId: string,
  id: unknown,
  today: Date,
): Promise<DeleteUserResult> {
  const parsed = userIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const userId = parsed.data;
  if (userId === actorId) return { ok: false, error: "self" };

  let username: string | null = null;
  let role: "ADMIN" | "DRIVER" = "DRIVER";
  try {
    const found = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, username: true },
      });
      if (!user) return false;
      username = user.username;
      role = user.role;

      const open = await tx.tour.findMany({
        where: {
          driverId: userId,
          status: { in: ["RELEASED", "IN_PROGRESS"] },
          date: { gte: today },
        },
        orderBy: { date: "asc" },
        select: { date: true },
        take: 5,
      });
      if (open.length > 0) {
        throw new Refused([...new Set(open.map((tour) => tour.date.toISOString().slice(0, 10)))]);
      }

      // Cleared: the record stays, only the name on it goes.
      const tours = await tx.tour.updateMany({
        where: { driverId: userId },
        data: { driverId: null },
      });
      await tx.standingTour.updateMany({ where: { driverId: userId }, data: { driverId: null } });
      await tx.stop.updateMany({ where: { collectedById: userId }, data: { collectedById: null } });
      await tx.customer.updateMany({
        where: { keyUpdatedById: userId },
        data: { keyUpdatedById: null },
      });
      await tx.customer.updateMany({
        where: { abbreviationUpdatedById: userId },
        data: { abbreviationUpdatedById: null },
      });
      // Handed over: these rows cannot exist without a user.
      const to = { where: { uploadedById: userId }, data: { uploadedById: actorId } };
      const photos = await tx.photo.updateMany(to);
      await tx.screenshot.updateMany(to);
      await tx.parkingSpot.updateMany({
        where: { createdById: userId },
        data: { createdById: actorId },
      });
      const orders = await tx.order.updateMany({
        where: { createdById: userId },
        data: { createdById: actorId },
      });
      await tx.recurringOrder.updateMany({
        where: { confirmedById: userId },
        data: { confirmedById: actorId },
      });
      await tx.monthlyPayment.updateMany({
        where: { paidById: userId },
        data: { paidById: actorId },
      });
      await tx.monthlyAdjustment.updateMany({
        where: { createdById: userId },
        data: { createdById: actorId },
      });
      // Gone with the account.
      await tx.workSchedule.deleteMany({ where: { driverId: userId } });
      await tx.user.delete({ where: { id: userId } });

      await recordAudit(tx, {
        actorId,
        entity: "User",
        entityId: userId,
        action: "user.delete",
        diff: { role: user.role, tours: tours.count, photos: photos.count, orders: orders.count },
      });
      return true;
    });
    if (!found) return { ok: false, error: "not_found" };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: "open_tours", dates: error.dates };
    throw error;
  }
  // The name is free again: a new account with it must not inherit the old lock-out.
  if (role === "DRIVER" && username) await clearFailures(db, loginKeys("driver", username, null));
  return { ok: true };
}
