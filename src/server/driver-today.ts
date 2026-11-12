import type { PrismaClient } from "@/generated/prisma/client";
import {
  dayInTimezone,
  type DriverToday,
  type TodayItem,
  type TodayStop,
  toDriverOtherTours,
  toDriverToday,
} from "@/lib/driver-tour-model";
import type { AppLocale } from "@/lib/localized-text";

import { type Actor, requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getDriverTourResponse } from "./driver-tour-payload";
import { getSettings } from "./settings";

// The screen models live in the shared driver data model (NUD-081); re-exported for the screens.
export type { DriverToday, TodayItem, TodayStop };

/** `YYYY-MM-DD` of `now` in the factory time zone. */
export function todayInTimezone(now: Date, timeZone: string): string {
  return dayInTimezone(now, timeZone);
}

type Db = Pick<PrismaClient, "tour" | "product" | "customer" | "photo" | "settings" | "stop">;

/**
 * The driver's day as the home screen needs it (NUD-163): the active tour (`primary`, "Tour 2 of 2")
 * and the other open tours of the day, oldest first (`others`), so the pending stops of every open
 * tour stay reachable. Empty `others` on the ordinary one-tour day and once the day is finished.
 */
export type DriverDay = { primary: DriverToday | null; others: DriverToday[] };

/**
 * The tours `actor` drives today (released, assigned to him, date = today in the factory time zone)
 * for the driver screen: the shared driver data model (`getDriverTourResponse`) with the texts
 * picked in the viewer's locale. The driver id always comes from the authenticated actor, never
 * from a request parameter; only an actual DRIVER has a tour (an admin in the support view sees none).
 */
export async function getDriverDay(
  db: Db,
  actor: Pick<Actor, "id" | "role" | "locale">,
  options: { now: Date; timezone: string; serviceMinutesPerStop: number; locale?: AppLocale },
): Promise<DriverDay> {
  const response = await getDriverTourResponse(db, actor, options);
  const locale = options.locale ?? (actor.locale as AppLocale);
  return {
    primary: toDriverToday(response, locale),
    others: toDriverOtherTours(response, locale),
  };
}

/** The active tour only (the screens that show a single tour). */
export async function getDriverToday(
  db: Db,
  actor: Pick<Actor, "id" | "role" | "locale">,
  options: { now: Date; timezone: string; serviceMinutesPerStop: number; locale?: AppLocale },
): Promise<DriverToday | null> {
  return (await getDriverDay(db, actor, options)).primary;
}

/** Page query: `requireRole` first, then the actor's own tours for today. */
export async function driverDayQuery(locale: AppLocale): Promise<DriverDay> {
  const actor = await requireRole("ADMIN", "DRIVER");
  const settings = await getSettings();
  return getDriverDay(getDb(), actor, {
    now: new Date(),
    timezone: settings?.timezone ?? "Europe/Vienna",
    serviceMinutesPerStop: settings?.serviceMinutesPerStop ?? 10,
    locale,
  });
}

/** Page query for the active tour only. */
export async function driverTodayQuery(locale: AppLocale): Promise<DriverToday | null> {
  return (await driverDayQuery(locale)).primary;
}
