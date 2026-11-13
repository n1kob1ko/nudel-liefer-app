import { z } from "zod";

import { activeParkingSpots, routingPoint } from "@/domain/parking";
import { cashDueCents } from "@/domain/payment";
import type { PhotoKind } from "@/domain/photos";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  dayInTimezone,
  DRIVER_TOUR_SCHEMA_VERSION,
  type DriverTourResponse,
  type PayloadPhoto,
  type PayloadStop,
} from "@/lib/driver-tour-model";
import { localizedTextSchema } from "@/lib/localized-text";

import type { Actor } from "./auth/guards";
import { parkingSpotsForDriver } from "./routing-points";
import { parseDepartureChecklist } from "./settings";
import type { Storage } from "./storage/types";
import { getDriverTours } from "./tour-driver";

/**
 * Validity of the signed photo URLs in the tour payload. The driver app downloads the photos right
 * after loading the tour, but the URLs must stay usable for a whole working day (NUD-081: >= 12 h),
 * e.g. when a prefetch is retried after a dead spot.
 */
export const DRIVER_PHOTO_URL_TTL_SECONDS = 12 * 60 * 60;

type Db = Pick<PrismaClient, "tour" | "product" | "customer" | "photo" | "settings" | "stop">;

const depotSchema = z.object({ name: z.string(), lat: z.number(), lng: z.number() });
const geometrySchema = z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) });

export type DriverTourPayloadOptions = {
  now: Date;
  timezone: string;
  serviceMinutesPerStop: number;
  /**
   * Signed photo URLs are only generated when a storage is given. `onlyStopId` limits them to the
   * customer of that stop (the stop detail page needs no photos of the other stops).
   */
  photos?: { storage: Pick<Storage, "getReadUrl">; onlyStopId?: string };
};

/**
 * The tours `actor` drives today (released, assigned to him, date = today in the factory time zone)
 * as the shared driver data model. NUD-163: `tours` carries every open tour of the day, oldest first
 * (the last one is also `tour`, the active one), and only the newest completed one once the day is
 * finished. The driver id always comes from the authenticated actor, never from a request parameter;
 * only an actual DRIVER has a tour (an admin in the support view gets `tour: null`). Quantities are
 * the released snapshot (`getDriverTours`, NUD-043).
 */
export async function getDriverTourResponse(
  db: Db,
  actor: Pick<Actor, "id" | "role">,
  options: DriverTourPayloadOptions,
): Promise<DriverTourResponse> {
  const date = dayInTimezone(options.now, options.timezone);
  const base = {
    schemaVersion: DRIVER_TOUR_SCHEMA_VERSION,
    date,
    generatedAt: options.now.toISOString(),
    timezone: options.timezone,
    serviceSecondsPerStop: options.serviceMinutesPerStop * 60,
  } as const;
  if (actor.role !== "DRIVER") return { ...base, tour: null, tours: [] };
  const tours = await getDriverTours(db, actor.id, date);
  if (tours.length === 0) return { ...base, tour: null, tours: [] };

  const customerIds = [...new Set(tours.flatMap((tour) => tour.stops.map((s) => s.customerId)))];
  const photoCustomerIds = options.photos
    ? options.photos.onlyStopId
      ? customerIds.filter((id) =>
          tours.some((tour) =>
            tour.stops.some((s) => s.id === options.photos?.onlyStopId && s.customerId === id),
          ),
        )
      : customerIds
    : [];

  const [customers, rows, photoRows, settingsRow, paymentRows] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        customerNumber: true,
        name: true,
        street: true,
        postalCode: true,
        city: true,
        lat: true,
        lng: true,
        parkingSpots: parkingSpotsForDriver,
        notes: true,
        deliveryHoursInfo: true,
        hasKey: true,
        keyNumber: true,
        abbreviation: true,
      },
    }),
    db.tour.findMany({
      where: { id: { in: tours.map((tour) => tour.id) } },
      select: {
        id: true,
        depotSnapshot: true,
        geometry: true,
        loadingStartedAt: true,
        departedAt: true,
      },
    }),
    photoCustomerIds.length > 0
      ? db.photo.findMany({
          where: { customerId: { in: photoCustomerIds }, isCurrent: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : Promise.resolve([]),
    db.settings.findUnique({ where: { id: 1 }, select: { departureChecklist: true } }),
    // Cash of the day (D33, NUD-196): what each stop has to collect and what was recorded.
    db.stop.findMany({
      where: { id: { in: tours.flatMap((tour) => tour.stops.map((stop) => stop.id)) } },
      select: {
        id: true,
        collectedCents: true,
        orders: {
          select: {
            order: { select: { status: true, paymentTerm: true, amountCents: true } },
          },
        },
      },
    }),
  ]);
  const paymentById = new Map(paymentRows.map((row) => [row.id, row]));
  const byId = new Map(customers.map((c) => [c.id, c]));
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const checklist = parseDepartureChecklist(settingsRow?.departureChecklist);

  // Newest current photo per customer and kind.
  const photoByCustomer = new Map<string, Partial<Record<PhotoKind, PayloadPhoto>>>();
  for (const photo of photoRows) {
    const entry = photoByCustomer.get(photo.customerId) ?? {};
    if (!entry[photo.kind as PhotoKind] && options.photos) {
      entry[photo.kind as PhotoKind] = {
        id: photo.id,
        url: await options.photos.storage.getReadUrl(photo.storageKey, {
          expiresInSeconds: DRIVER_PHOTO_URL_TTL_SECONDS,
        }),
        width: photo.width,
        height: photo.height,
      };
    }
    photoByCustomer.set(photo.customerId, entry);
  }

  const payloadTours = tours.map((tour) => {
    const row = rowById.get(tour.id);
    const depot = depotSchema.safeParse(row?.depotSnapshot);
    const geometry = geometrySchema.safeParse(row?.geometry);
    const stops: PayloadStop[] = tour.stops.map((stop) => {
      const customer = byId.get(stop.customerId);
      const point = customer ? routingPoint(customer) : null;
      const notes = localizedTextSchema.safeParse(customer?.notes);
      const photos = photoByCustomer.get(stop.customerId);
      return {
        id: stop.id,
        sequence: stop.sequence,
        trip: stop.trip,
        vehicleName: stop.vehicleName,
        status: stop.status,
        problemReason: stop.problemReason,
        // NUD-177 (QA 2026-10-29 F5): the note travels with the stop so the driver can read his own
        // text again; the model picks the locale, exactly like `notes`.
        problemNote: localizedTextSchema.safeParse(stop.problemNote).data ?? null,
        completedAt: stop.completedAt,
        etaAt: stop.etaAt,
        legDurationS: stop.legDurationS,
        change: stop.change,
        changedInRevision: stop.changedInRevision,
        customerId: stop.customerId,
        customerNumber: customer?.customerNumber ?? "",
        customerName: customer?.name ?? "",
        street: customer?.street ?? "",
        postalCode: customer?.postalCode ?? "",
        city: customer?.city ?? "",
        // Navigation and the map use the same point as the optimisation: Parkplatz, else address.
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        addressLat: customer?.lat ?? null,
        addressLng: customer?.lng ?? null,
        parkingSpots: activeParkingSpots(customer?.parkingSpots ?? []).map((spot) => ({
          label: spot.label,
          note: spot.note,
          lat: spot.lat,
          lng: spot.lng,
        })),
        notes: notes.success ? notes.data : null,
        deliveryHoursInfo: customer?.deliveryHoursInfo?.trim() || null,
        hasKey: customer?.hasKey ?? null,
        keyNumber: customer?.keyNumber ?? null,
        abbreviation: customer?.abbreviation ?? null,
        cashDueCents: cashDueCents(
          (paymentById.get(stop.id)?.orders ?? [])
            .map((link) => link.order)
            .filter((order) => order.status === "CONFIRMED")
            .map((order) => ({ paymentTerm: order.paymentTerm, amountCents: order.amountCents })),
        ),
        collectedCents: paymentById.get(stop.id)?.collectedCents ?? null,
        photos: { STORE: photos?.STORE ?? null, PARKING: photos?.PARKING ?? null },
        items: stop.items.map((item) => {
          const name = localizedTextSchema.safeParse(item.name);
          return {
            productId: item.productId,
            sku: item.sku,
            name: name.success ? name.data : null,
            unit: item.unit,
            quantity: item.quantity,
            previousQuantity: item.previousQuantity,
          };
        }),
      };
    });
    return {
      id: tour.id,
      status: tour.status,
      revision: tour.revision,
      updated: tour.updated,
      tourNumber: tour.tourNumber,
      tourCount: tour.tourCount,
      removedCustomers: tour.removedCustomers,
      stops,
      depot: depot.success ? depot.data : null,
      geometry:
        geometry.success && geometry.data.coordinates.length > 1 ? geometry.data.coordinates : null,
      loadingStartedAt: row?.loadingStartedAt?.toISOString() ?? null,
      departedAt: row?.departedAt?.toISOString() ?? null,
      checklist,
    };
  });

  return {
    ...base,
    // The active tour (the last one: the newest open tour, or the newest completed one) stays in
    // `tour` for the screens that show a single tour; `tours` carries all of them (NUD-163).
    tour: payloadTours.at(-1) ?? null,
    tours: payloadTours,
  };
}
