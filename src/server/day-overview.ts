import { type DayOverview, type OverviewTour, summarizeDay } from "@/domain/day-overview";
import { parseCalendarDate } from "@/domain/order";
import type { PrismaClient } from "@/generated/prisma/client";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { todayInTimezone } from "./driver-today";
import { getSettings } from "./settings";

/**
 * Read model of the office overview for a day with several drivers (redesign RD2, step 3): one row
 * per tour of today plus the sums and the problems of all of them. See `domain/day-overview`.
 */
export type DayOverviewView = DayOverview & {
  /** `YYYY-MM-DD` in the factory time zone. */
  date: string;
  timezone: string;
};

type Db = Pick<PrismaClient, "tour">;

/** All tours of today in the factory time zone, read once, summarised by the domain rules. */
export async function getDayOverview(
  db: Db,
  options: { now: Date; timezone: string; serviceMinutesPerStop: number },
): Promise<DayOverviewView> {
  const date = todayInTimezone(options.now, options.timezone);
  const day = parseCalendarDate(date);
  if (!day) throw new Error("Unreachable: todayInTimezone returns a valid date");
  const tours = await db.tour.findMany({
    where: { date: day },
    select: {
      id: true,
      status: true,
      createdAt: true,
      departedAt: true,
      driver: { select: { displayName: true } },
      vehicle: { select: { name: true } },
      stops: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          status: true,
          etaAt: true,
          completedAt: true,
          problemReason: true,
          customer: { select: { name: true, lat: true, lng: true } },
        },
      },
    },
  });
  const input: OverviewTour[] = tours.map((tour) => ({
    id: tour.id,
    status: tour.status,
    createdAt: tour.createdAt,
    departedAt: tour.departedAt,
    driverName: tour.driver?.displayName ?? null,
    vehicleName: tour.vehicle?.name ?? null,
    stops: tour.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      status: stop.status,
      name: stop.customer.name,
      etaAt: stop.etaAt,
      completedAt: stop.completedAt,
      problemReason: stop.problemReason,
      lat: stop.customer.lat,
      lng: stop.customer.lng,
    })),
  }));
  return {
    date,
    timezone: options.timezone,
    ...summarizeDay(input, options.serviceMinutesPerStop * 60),
  };
}

/** Admin-only read for the overview; the role is checked before anything is read. */
export async function dayOverviewQuery(now: Date = new Date()): Promise<DayOverviewView> {
  await requireRole("ADMIN");
  const settings = await getSettings();
  return getDayOverview(getDb(), {
    now,
    timezone: settings?.timezone ?? "Europe/Vienna",
    serviceMinutesPerStop: settings?.serviceMinutesPerStop ?? 10,
  });
}
