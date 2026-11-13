"use server";

import { parseCalendarDate } from "@/domain/order";
import { dayInTimezone } from "@/lib/driver-tour-model";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getFactoryTimezone } from "./settings";
import { deleteUser, type DeleteUserResult } from "./user-delete";
import { createAdmin, createDriver, resetDriverPin, setDriverLocale, setUserActive } from "./users";

/**
 * Admin-only server actions. Every action re-checks the role against the database first;
 * a driver / anonymous / deactivated caller gets an AuthorizationError before any input is read.
 */

export async function createDriverAction(input: unknown) {
  await requireRole("ADMIN");
  return createDriver(getDb(), input);
}

export async function createAdminAction(input: unknown) {
  await requireRole("ADMIN");
  return createAdmin(getDb(), input);
}

export async function resetDriverPinAction(id: unknown) {
  await requireRole("ADMIN");
  return resetDriverPin(getDb(), id);
}

export async function setUserActiveAction(id: unknown, active: unknown) {
  const actor = await requireRole("ADMIN");
  return setUserActive(getDb(), actor.id, id, active);
}

export async function setDriverLocaleAction(id: unknown, locale: unknown) {
  await requireRole("ADMIN");
  return setDriverLocale(getDb(), id, locale);
}

/**
 * Admin-only (NUD-206): removes an account for good. Refused for the own account and for a driver
 * who still has a released tour from today on (`open_tours`, with the days).
 */
export async function deleteUserAction(id: unknown): Promise<DeleteUserResult> {
  const actor = await requireRole("ADMIN");
  const today = parseCalendarDate(dayInTimezone(new Date(), await getFactoryTimezone()));
  if (!today) return { ok: false, error: "invalid" };
  return deleteUser(getDb(), actor.id, id, today);
}
