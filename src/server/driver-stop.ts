import type { PrismaClient } from "@/generated/prisma/client";
import { type DriverStopDetail, type StopPhoto, toDriverStopDetail } from "@/lib/driver-tour-model";
import type { AppLocale } from "@/lib/localized-text";

import { type Actor, requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getDriverTourResponse } from "./driver-tour-payload";
import { getSettings } from "./settings";
import { getStorage } from "./storage";
import type { Storage } from "./storage/types";

export type { DriverStopDetail, StopPhoto };

type Db = Pick<PrismaClient, "tour" | "product" | "customer" | "photo" | "settings" | "stop">;

/**
 * The detail of one stop of the tour `actor` drives today. Authorization by construction: the stop
 * is looked up inside the actor's own released tour of today (the shared driver data model), so any
 * other stop id (another driver's, another day, unreleased) yields `null`. Quantities are the
 * released snapshot, i.e. the merged quantities of the stop's confirmed orders at release time.
 */
export async function getDriverStopDetail(
  db: Db,
  storage: Pick<Storage, "getReadUrl">,
  actor: Pick<Actor, "id" | "role" | "locale">,
  options: {
    now: Date;
    timezone: string;
    serviceMinutesPerStop: number;
    locale?: AppLocale;
    stopId: string;
  },
): Promise<DriverStopDetail | null> {
  const response = await getDriverTourResponse(db, actor, {
    ...options,
    photos: { storage, onlyStopId: options.stopId },
  });
  return toDriverStopDetail(
    response,
    options.stopId,
    options.locale ?? (actor.locale as AppLocale),
  );
}

/** Page query: `requireRole` first, then the stop inside the actor's own tour of today. */
export async function driverStopQuery(
  locale: AppLocale,
  stopId: string,
): Promise<DriverStopDetail | null> {
  const actor = await requireRole("ADMIN", "DRIVER");
  const settings = await getSettings();
  return getDriverStopDetail(getDb(), getStorage(), actor, {
    now: new Date(),
    timezone: settings?.timezone ?? "Europe/Vienna",
    serviceMinutesPerStop: settings?.serviceMinutesPerStop ?? 10,
    locale,
    stopId,
  });
}
