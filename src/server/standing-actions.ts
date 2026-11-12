"use server";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { todayIn } from "./orders";
import { getFactoryTimezone } from "./settings";
import {
  saveStandingDay,
  saveStandingTour,
  setStandingTourActive,
  setStandingTourDriver,
  type StandingDaySaveResult,
  type StandingTourEditResult,
  type StandingTourSaveResult,
} from "./standing-tours";
import { getTourService } from "./tour-service";

/**
 * Admin-only server actions of the day plan ("Tagesplanung", NUD-186). The role is checked against
 * the database before the input is read; everything else is validated again in the service layer.
 */

/** Writes the edited day plan (quantities per customer of the standing tours and the ad-hoc rows). */
export async function saveStandingDayAction(input: unknown): Promise<StandingDaySaveResult> {
  const actor = await requireRole("ADMIN");
  return saveStandingDay(
    getDb(),
    actor.id,
    input,
    todayIn(await getFactoryTimezone()),
    getTourService(),
  );
}

/** Creates or edits one standing tour: name, default driver and its customers. */
export async function saveStandingTourAction(input: unknown): Promise<StandingTourSaveResult> {
  const actor = await requireRole("ADMIN");
  return saveStandingTour(getDb(), actor.id, input);
}

/** Changes the default driver of a standing tour (illness, replacement). */
export async function setStandingTourDriverAction(
  id: unknown,
  driverId: unknown,
): Promise<StandingTourEditResult> {
  const actor = await requireRole("ADMIN");
  return setStandingTourDriver(getDb(), actor.id, id, driverId);
}

/** Archives or restores a standing tour; its customers stay in the group. */
export async function setStandingTourActiveAction(
  id: unknown,
  active: unknown,
): Promise<StandingTourEditResult> {
  const actor = await requireRole("ADMIN");
  return setStandingTourActive(getDb(), actor.id, id, active);
}
