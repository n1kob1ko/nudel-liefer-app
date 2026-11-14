"use server";

import { requireRole } from "./auth/guards";
import { type SendDayResult, sendDayWith } from "./day-routes";
import { getDb } from "./db";
import { todayIn } from "./orders";
import { getRoutingProvider } from "./routing";
import { getFactoryTimezone, getSettings, requireDepotConfigured } from "./settings";
import {
  moveExtra,
  type MoveExtraResult,
  saveStandingDay,
  saveStandingTour,
  setStandingTourActive,
  setStandingTourDriver,
  setStandingTourVehicle,
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

/** NUD-212: the vehicle of a standing tour's day routes (`null` clears it). */
export async function setStandingTourVehicleAction(
  id: unknown,
  vehicleId: unknown,
): Promise<StandingTourEditResult> {
  const actor = await requireRole("ADMIN");
  return setStandingTourVehicle(getDb(), actor.id, id, vehicleId);
}

/** NUD-212: puts a customer of no standing tour on a route and position for one delivery day. */
export async function moveExtraAction(input: unknown): Promise<MoveExtraResult> {
  const actor = await requireRole("ADMIN");
  return moveExtra(getDb(), actor.id, input, todayIn(await getFactoryTimezone()), getTourService());
}

/**
 * NUD-212 "An Fahrer senden": every route of the day (standing tour in fixed order plus the
 * extras) becomes a released tour of its driver, or its changes are sent again.
 */
export async function sendDayAction(input: unknown): Promise<SendDayResult> {
  const actor = await requireRole("ADMIN");
  return sendDayWith(
    {
      db: getDb(),
      actorId: actor.id,
      provider: getRoutingProvider(),
      requireDepot: requireDepotConfigured,
      loadSettings: getSettings,
    },
    input,
  );
}
