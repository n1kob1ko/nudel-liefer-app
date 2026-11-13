import { parseCalendarDate } from "@/domain/order";
import type { PrismaClient } from "@/generated/prisma/client";
import { dayInTimezone } from "@/lib/driver-tour-model";
import { type AppLocale, localizedTextSchema, pick } from "@/lib/localized-text";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getSettings } from "./settings";
import { readStopItems } from "./tour-rerelease";

/**
 * The driver's coming tours (NUD-205). The home screen is the tour of today; a tour the office
 * released for tomorrow or a later day used to be invisible until that day, which looked like a
 * release that never arrived. This is a preview only: nothing here can be ticked off, and it is
 * read online (the offline copy holds today's tour).
 */

/** How many days ahead the preview looks, and how many tours it lists at most. */
export const UPCOMING_DAYS = 14;
export const UPCOMING_MAX_TOURS = 10;

export type UpcomingItem = { name: string; unit: string; quantity: number };

export type UpcomingStop = {
  id: string;
  sequence: number;
  customerName: string;
  street: string;
  postalCode: string;
  city: string;
  etaAt: string | null;
  items: UpcomingItem[];
};

export type UpcomingTour = {
  id: string;
  /** `YYYY-MM-DD`, the delivery day. */
  date: string;
  /** 1 = tomorrow. */
  daysAhead: number;
  /** Planned arrival at the first stop, `null` when the tour has no times. */
  firstEtaAt: string | null;
  stops: UpcomingStop[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Released tours of `driverId` on the days after today (factory time zone), nearest day first.
 * The caller has checked that the session user is this driver. Quantities are the released
 * snapshot on each stop, exactly what the driver will see on the day.
 */
export async function getDriverUpcomingTours(
  db: Pick<PrismaClient, "tour" | "product">,
  driverId: string,
  options: { now: Date; timezone: string; locale: AppLocale },
): Promise<UpcomingTour[]> {
  const today = parseCalendarDate(dayInTimezone(options.now, options.timezone));
  if (!today) return [];
  const tours = await db.tour.findMany({
    where: {
      driverId,
      status: { in: ["RELEASED", "IN_PROGRESS"] },
      date: { gt: today, lte: new Date(today.getTime() + UPCOMING_DAYS * DAY_MS) },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: UPCOMING_MAX_TOURS,
    select: {
      id: true,
      date: true,
      stops: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          etaAt: true,
          items: true,
          customer: { select: { name: true, street: true, postalCode: true, city: true } },
        },
      },
    },
  });
  if (tours.length === 0) return [];

  const productIds = new Set(
    tours.flatMap((tour) =>
      tour.stops.flatMap((stop) => readStopItems(stop.items).map((item) => item.productId)),
    ),
  );
  const products = new Map(
    (
      await db.product.findMany({
        where: { id: { in: [...productIds] } },
        select: { id: true, sku: true, name: true, unit: true },
      })
    ).map((product) => [product.id, product]),
  );
  const itemName = (productId: string): string => {
    const product = products.get(productId);
    const name = localizedTextSchema.safeParse(product?.name);
    return (name.success ? pick(name.data, options.locale) : "") || product?.sku || "";
  };

  return tours.map((tour) => {
    const stops: UpcomingStop[] = tour.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      customerName: stop.customer.name,
      street: stop.customer.street,
      postalCode: stop.customer.postalCode,
      city: stop.customer.city,
      etaAt: stop.etaAt?.toISOString() ?? null,
      items: readStopItems(stop.items)
        .filter((item) => item.quantity > 0)
        .map((item) => ({
          name: itemName(item.productId),
          unit: products.get(item.productId)?.unit ?? "PACK",
          quantity: item.quantity,
        })),
    }));
    return {
      id: tour.id,
      date: tour.date.toISOString().slice(0, 10),
      daysAhead: Math.round((tour.date.getTime() - today.getTime()) / DAY_MS),
      firstEtaAt: stops.find((stop) => stop.etaAt !== null)?.etaAt ?? null,
      stops,
    };
  });
}

/** Page query: `requireRole` first, then the actor's own coming tours (an admin has none). */
export async function driverUpcomingQuery(locale: AppLocale): Promise<{
  tours: UpcomingTour[];
  timezone: string;
}> {
  const actor = await requireRole("ADMIN", "DRIVER");
  const settings = await getSettings();
  const timezone = settings?.timezone ?? "Europe/Vienna";
  if (actor.role !== "DRIVER") return { tours: [], timezone };
  const tours = await getDriverUpcomingTours(getDb(), actor.id, {
    now: new Date(),
    timezone,
    locale,
  });
  return { tours, timezone };
}
