import { z } from "zod";

import { neighbourStops } from "@/domain/driver-stop";
import type { PhotoKind } from "@/domain/photos";
import { calendarDayIn } from "@/domain/settings";

import {
  type AppLocale,
  type LocalizedText,
  localizedTextSchema,
  pick,
  pickWithSource,
} from "./localized-text";

/**
 * The one data model of the driver screens (NUD-081). `GET /api/driver/tour/today` returns a
 * `DriverTourResponse`; the browser keeps exactly this JSON in IndexedDB. The "today" list and the
 * stop detail are derived from it by the pure functions below, in the server pages (online) and in
 * the offline shell alike, so both render the same screens from the same data.
 *
 * Texts that depend on the language travel as `LocalizedText` (all four locales) and are picked
 * with the viewer's locale at render time; customer names and addresses are never translated.
 */

export const DRIVER_TOUR_SCHEMA_VERSION = 1;

const idSchema = z.string().min(1).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const payloadPhotoSchema = z.object({
  id: idSchema,
  /** Signed storage URL, valid for the whole working day (see `DRIVER_PHOTO_URL_TTL_SECONDS`). */
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PayloadPhoto = z.infer<typeof payloadPhotoSchema>;

/**
 * Payloads cached by a phone before NUD-137 carry hundredths as `quantityCents` /
 * `previousQuantityCents`. Read them as whole numbers so an installed app keeps working offline
 * until the next successful refresh replaces the cache.
 */
function upgradeLegacyItem(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, unknown>;
  if (typeof item.quantityCents !== "number" || "quantity" in item) return value;
  const { quantityCents, previousQuantityCents, ...rest } = item;
  return {
    ...rest,
    quantity: Math.round((quantityCents as number) / 100),
    previousQuantity:
      typeof previousQuantityCents === "number" ? Math.round(previousQuantityCents / 100) : null,
  };
}

export const payloadItemSchema = z.preprocess(
  upgradeLegacyItem,
  z.object({
    productId: idSchema,
    sku: z.string(),
    /** `null` when the product has no (valid) name; the SKU is shown instead. */
    name: localizedTextSchema.nullable(),
    unit: z.string(),
    quantity: z.number().int(),
    previousQuantity: z.number().int().nullable(),
  }),
);

export const payloadParkingSpotSchema = z.object({
  label: z.string().nullable(),
  note: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
});
export type PayloadParkingSpot = z.infer<typeof payloadParkingSpotSchema>;

export const payloadStopSchema = z.object({
  id: idSchema,
  sequence: z.number().int(),
  /** Trip of the tour (NUD-147); caches written before it read as trip 1. */
  trip: z.number().int().min(1).default(1),
  /** Vehicle switch (NUD-158): the vehicle of this stop's trip; null = the tour's. Old caches: null. */
  vehicleName: z.string().nullable().default(null),
  status: z.enum(["PENDING", "DELIVERED", "PROBLEM"]),
  problemReason: z.string().nullable(),
  /** NUD-177: the driver's own note to the problem (LocalizedText); old caches read as 
ull. */
  problemNote: localizedTextSchema.nullable().default(null),
  completedAt: z.string().nullable(),
  etaAt: z.string().nullable(),
  legDurationS: z.number().nullable(),
  change: z.enum(["ADDED", "CHANGED"]).nullable(),
  changedInRevision: z.number().int().nullable(),
  customerId: idSchema,
  customerNumber: z.string(),
  customerName: z.string(),
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
  /** Routing point of the stop: default Parkplatz, else the address point (D22). */
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /**
   * The geocoded Lieferadresse (NUD-126): the final destination of the combined navigation
   * (Parkplatz first, address second, D30). Caches written before NUD-126 lack the fields and
   * read as "unknown / no spots" until the next refresh replaces the copy.
   */
  addressLat: z.number().nullable().default(null),
  addressLng: z.number().nullable().default(null),
  /** Active Parkplätze in display order; the first one is the default (`lat`/`lng`). */
  parkingSpots: z.array(payloadParkingSpotSchema).max(20).default([]),
  notes: localizedTextSchema.nullable(),
  deliveryHoursInfo: z.string().nullable(),
  /**
   * The customer's key (NUD-142): `hasKey` null = unknown. Caches written before NUD-142 lack both
   * fields; they read as "unknown" until the next refresh replaces the copy.
   */
  hasKey: z.boolean().nullable().default(null),
  keyNumber: z.string().nullable().default(null),
  /** The customer's legacy Abkürzung (NUD-164); caches written before it read as none. */
  abbreviation: z.string().nullable().default(null),
  /**
   * Cash to collect at this stop (D33, NUD-196): the amounts of its ON_DELIVERY orders, in euro
   * cents. `0` = nothing to collect (monthly bill). Caches written before NUD-196 read as 0.
   */
  cashDueCents: z.number().int().min(0).default(0),
  /** What the driver recorded as collected (euro cents); `null` = not recorded yet. */
  collectedCents: z.number().int().min(0).nullable().default(null),
  photos: z.object({
    STORE: payloadPhotoSchema.nullable(),
    PARKING: payloadPhotoSchema.nullable(),
  }),
  items: z.array(payloadItemSchema),
});
export type PayloadStop = z.infer<typeof payloadStopSchema>;

export const driverTourSchema = z.object({
  id: idSchema,
  status: z.enum(["RELEASED", "IN_PROGRESS", "COMPLETED"]),
  /** 1 = first release; +1 per re-release that changed something (NUD-043). */
  revision: z.number().int(),
  updated: z.boolean(),
  /** Position among the driver's released tours of the day (NUD-118); old caches read as the only tour. */
  tourNumber: z.number().int().min(1).default(1),
  tourCount: z.number().int().min(1).default(1),
  removedCustomers: z.array(
    z.object({ customerId: z.string(), customerNumber: z.string(), name: z.string() }),
  ),
  stops: z.array(payloadStopSchema),
  depot: z.object({ name: z.string(), lat: z.number(), lng: z.number() }).nullable(),
  /** GeoJSON LineString coordinates `[lng, lat][]`. */
  geometry: z.array(z.tuple([z.number(), z.number()])).nullable(),
  /**
   * Departure checklist (NUD-151): when the driver opened it / left (ISO), and the fixed items the
   * office maintains in the settings. Caches written before NUD-151 read as "not left yet, no fixed
   * items" until the next refresh replaces the copy.
   */
  loadingStartedAt: z.string().nullable().default(null),
  departedAt: z.string().nullable().default(null),
  checklist: z
    .array(z.object({ id: idSchema, text: localizedTextSchema }))
    .max(20)
    .default([]),
});
export type DriverTourData = z.infer<typeof driverTourSchema>;

export const driverTourResponseSchema = z.object({
  schemaVersion: z.literal(DRIVER_TOUR_SCHEMA_VERSION),
  /** Today in the factory time zone (`YYYY-MM-DD`): the day this answer is valid for. */
  date: dateSchema,
  /** Server time the answer was produced (ISO). */
  generatedAt: z.string(),
  timezone: z.string().min(1),
  serviceSecondsPerStop: z.number(),
  /**
   * The active tour: the newest open tour of the day, or the newest completed one when the day is
   * finished. `null`: no tour released for this driver today.
   */
  tour: driverTourSchema.nullable(),
  /**
   * Every tour the driver must see today, oldest first (NUD-163). With two open tours of the day
   * (D29 "+ Tour", D31 reloads) both are here, so the pending stops of the older one stay reachable;
   * the last element is the active `tour`. A cache written before NUD-163 has only `tour` and reads as
   * that single tour until the next refresh replaces the copy.
   */
  tours: z.array(driverTourSchema).default([]),
});
export type DriverTourResponse = z.infer<typeof driverTourResponseSchema>;

/** `YYYY-MM-DD` of `now` in the given IANA time zone. */
export function dayInTimezone(now: Date, timeZone: string): string {
  const { y, m, d } = calendarDayIn(now, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------
// Views derived from the model (what the screens render)
// ---------------------------------------------------------------------------------------------

/** One line of a stop, with the product name already picked in the driver's locale. */
export type TodayItem = {
  productId: string;
  name: string;
  /** German product name (matches the box labels); `null` when the product has none. */
  germanName: string | null;
  unit: string;
  quantity: number;
  previousQuantity: number | null;
};

export type TodayStop = {
  id: string;
  sequence: number;
  /** Trip of the tour (NUD-147); optional like the other fields of hand-built values (1 = first trip). */
  trip?: number;
  /** NUD-158: the vehicle of this stop's trip when the driver switched into it; null/absent = the tour's. */
  vehicleName?: string | null;
  status: "PENDING" | "DELIVERED" | "PROBLEM";
  problemReason: string | null;
  /** NUD-177: the driver's own note to the problem, in his language (
ull when he wrote none). */
  problemNote?: { text: string; lang: AppLocale } | null;
  completedAt: string | null;
  etaAt: string | null;
  legDurationS: number | null;
  change: "ADDED" | "CHANGED" | null;
  changedInRevision: number | null;
  customerId: string;
  /** Customer data is never translated (the driver matches it to real signage). */
  customerNumber: string;
  customerName: string;
  street: string;
  postalCode: string;
  city: string;
  lat: number | null;
  lng: number | null;
  /** Lieferadresse point and the Parkplätze (NUD-126); optional like `noteText` (hand-built values). */
  addressLat?: number | null;
  addressLng?: number | null;
  parkingSpots?: PayloadParkingSpot[];
  /**
   * Customer note for the driver, in the best language the device has (the note travels localized,
   * `LocalizedText`). `null` when the customer has none; optional so hand-built `TodayStop` values
   * (screens that never show a note) stay valid. Only the "today" list shows it as a strip.
   */
  noteText?: string | null;
  /**
   * The customer's key (NUD-142), `hasKey` null = unknown. Optional like `noteText`: `undefined`
   * (hand-built values) means "not known to this screen" and shows no key chip at all.
   */
  hasKey?: boolean | null;
  keyNumber?: string | null;
  /**
   * The customer's Abkürzung (NUD-164). Optional like `hasKey`: `undefined` (hand-built values)
   * shows no Abkürzung chip at all; `null` = none yet.
   */
  abbreviation?: string | null;
  /**
   * Cash to collect at this stop (D33, NUD-196) and what the driver recorded: euro cents. Optional
   * like `hasKey` — `undefined` (hand-built values) means "no cash feature on this screen".
   */
  cashDueCents?: number;
  collectedCents?: number | null;
  items: TodayItem[];
};

export type DriverToday = {
  tourId: string;
  date: string;
  tourStatus: DriverTourData["status"];
  revision: number;
  updated: boolean;
  /** Tour n of m of the driver's day (NUD-118); optional like the other fields of hand-built values. */
  tourNumber?: number;
  tourCount?: number;
  removedCustomers: DriverTourData["removedCustomers"];
  stops: TodayStop[];
  depot: { name: string; lat: number; lng: number } | null;
  /** GeoJSON LineString coordinates `[lng, lat][]`. */
  geometry: Array<[number, number]> | null;
  serviceSecondsPerStop: number;
  timezone: string;
  /**
   * Departure checklist (NUD-151). Optional like the other fields of hand-built values: `undefined`
   * `departedAt` means "this screen knows nothing about a checklist" and shows no card.
   */
  loadingStartedAt?: string | null;
  departedAt?: string | null;
  /** Fixed checklist items with the text already picked for the viewer's locale. */
  checklist?: Array<{ id: string; text: string }>;
};

export type StopPhoto = { id: string; url: string; width: number; height: number };

export type DriverStopDetail = {
  tourId: string;
  tourStatus: DriverToday["tourStatus"];
  /** UI locale the texts were picked for. */
  locale: AppLocale;
  /** Factory time zone (for ETA display). */
  timezone: string;
  stop: TodayStop;
  /** 1-based position in the tour and number of stops. */
  position: number;
  total: number;
  prevStopId: string | null;
  nextStopId: string | null;
  /**
   * Every stop of the tour with its status, in tour order: after a stop is closed the screen goes
   * to the next open one, which depends on the stops closed offline too (NUD-082).
   */
  tourStops: Array<{
    id: string;
    sequence: number;
    status: TodayStop["status"];
    problemReason: string | null;
    completedAt: string | null;
  }>;
  /** Customer note for the driver in the best available language (`lang` = language it is in). */
  notes: { text: string; lang: AppLocale } | null;
  deliveryHoursInfo: string | null;
  photos: Record<PhotoKind, StopPhoto | null>;
};

/** NUD-177: the problem note in the driver's language, in the same shape as the customer note. */
function pickNote(
  note: LocalizedText | null,
  locale: AppLocale,
): { text: string; lang: AppLocale } | null {
  const picked = note ? pickWithSource(note, locale) : null;
  return picked ? { text: picked.value, lang: picked.locale } : null;
}

function pickName(name: LocalizedText | null, sku: string, locale: AppLocale): string {
  return (name ? pickWithSource(name, locale)?.value : undefined) || sku;
}

function todayStop(stop: PayloadStop, locale: AppLocale): TodayStop {
  return {
    id: stop.id,
    sequence: stop.sequence,
    trip: stop.trip,
    vehicleName: stop.vehicleName,
    status: stop.status,
    problemReason: stop.problemReason,
    problemNote: pickNote(stop.problemNote, locale),
    completedAt: stop.completedAt,
    etaAt: stop.etaAt,
    legDurationS: stop.legDurationS,
    change: stop.change,
    changedInRevision: stop.changedInRevision,
    customerId: stop.customerId,
    customerNumber: stop.customerNumber,
    customerName: stop.customerName,
    street: stop.street,
    postalCode: stop.postalCode,
    city: stop.city,
    lat: stop.lat,
    lng: stop.lng,
    addressLat: stop.addressLat,
    addressLng: stop.addressLng,
    parkingSpots: stop.parkingSpots,
    noteText: stop.notes ? pick(stop.notes, locale).trim() || null : null,
    hasKey: stop.hasKey,
    keyNumber: stop.keyNumber,
    abbreviation: stop.abbreviation,
    cashDueCents: stop.cashDueCents,
    collectedCents: stop.collectedCents,
    items: stop.items.map((item) => ({
      productId: item.productId,
      name: pickName(item.name, item.sku, locale),
      germanName: item.name?.de?.trim() ? item.name.de : null,
      unit: item.unit,
      quantity: item.quantity,
      previousQuantity: item.previousQuantity,
    })),
  };
}

/**
 * Every tour the payload carries for the day, oldest first (NUD-163): `tours`, or only `tour` when the
 * copy was cached before that field existed.
 */
export function responseTours(response: DriverTourResponse): DriverTourData[] {
  if (response.tours.length > 0) return response.tours;
  return response.tour ? [response.tour] : [];
}

function tourToday(
  tour: DriverTourData,
  response: DriverTourResponse,
  locale: AppLocale,
): DriverToday {
  return {
    tourId: tour.id,
    date: response.date,
    tourStatus: tour.status,
    revision: tour.revision,
    updated: tour.updated,
    tourNumber: tour.tourNumber,
    tourCount: tour.tourCount,
    removedCustomers: tour.removedCustomers,
    stops: tour.stops.map((stop) => todayStop(stop, locale)),
    depot: tour.depot,
    geometry: tour.geometry && tour.geometry.length > 1 ? tour.geometry : null,
    serviceSecondsPerStop: response.serviceSecondsPerStop,
    timezone: response.timezone,
    loadingStartedAt: tour.loadingStartedAt,
    departedAt: tour.departedAt,
    checklist: tour.checklist
      .map((item) => ({ id: item.id, text: pick(item.text, locale).trim() }))
      .filter((item) => item.text !== ""),
  };
}

/** The list screen model ("today's tour") for `locale`, or `null` when there is no tour. */
export function toDriverToday(response: DriverTourResponse, locale: AppLocale): DriverToday | null {
  const tour = response.tour;
  if (!tour) return null;
  return tourToday(tour, response, locale);
}

/**
 * The *other* open tours of the day (NUD-163), oldest first, as list screen models: the driver home
 * screen shows them below the active tour so their pending stops stay reachable with two open tours.
 * The active tour is never included, neither is a COMPLETED one (history, only shown once the day is
 * finished). Empty for the ordinary one-tour day and for a cache written before NUD-163.
 */
export function toDriverOtherTours(response: DriverTourResponse, locale: AppLocale): DriverToday[] {
  const activeId = response.tour?.id;
  return responseTours(response)
    .filter((tour) => tour.id !== activeId && tour.status !== "COMPLETED")
    .map((tour) => tourToday(tour, response, locale));
}

/**
 * The stop detail screen model, or `null` when the stop is not part of any tour of the day. NUD-163:
 * a stop of an *other* open tour is found too, so both tours' stops open identically. `photoUrl` maps
 * a photo to the URL the `<img>` loads: the signed storage URL online, the same-origin cache URL
 * (served by the service worker from Cache Storage) offline.
 */
export function toDriverStopDetail(
  response: DriverTourResponse,
  stopId: string,
  locale: AppLocale,
  photoUrl: (photo: PayloadPhoto) => string = (photo) => photo.url,
): DriverStopDetail | null {
  const tour = responseTours(response).find((candidate) =>
    candidate.stops.some((s) => s.id === stopId),
  );
  const stop = tour?.stops.find((s) => s.id === stopId);
  if (!tour || !stop) return null;
  const nav = neighbourStops(tour.stops, stopId);
  if (!nav) return null;
  const notes = stop.notes ? pickWithSource(stop.notes, locale) : null;
  const photo = (p: PayloadPhoto | null): StopPhoto | null =>
    p ? { id: p.id, url: photoUrl(p), width: p.width, height: p.height } : null;
  return {
    tourId: tour.id,
    tourStatus: tour.status,
    locale,
    timezone: response.timezone,
    stop: todayStop(stop, locale),
    position: nav.position,
    total: nav.total,
    prevStopId: nav.prev?.id ?? null,
    nextStopId: nav.next?.id ?? null,
    tourStops: tour.stops.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      status: s.status,
      problemReason: s.problemReason,
      problemNote: pickNote(s.problemNote, locale),
      completedAt: s.completedAt,
    })),
    notes: notes ? { text: notes.value, lang: notes.locale } : null,
    deliveryHoursInfo: stop.deliveryHoursInfo?.trim() || null,
    photos: { STORE: photo(stop.photos.STORE), PARKING: photo(stop.photos.PARKING) },
  };
}

/**
 * Every photo of the day's tours (each once), the photos to prefetch for offline use. NUD-163: the
 * photos of every open tour, so the stops of the older tour work offline as well.
 */
export function tourPhotos(response: DriverTourResponse): PayloadPhoto[] {
  const byId = new Map<string, PayloadPhoto>();
  for (const tour of responseTours(response)) {
    for (const stop of tour.stops) {
      for (const photo of [stop.photos.STORE, stop.photos.PARKING]) {
        if (photo) byId.set(photo.id, photo);
      }
    }
  }
  return [...byId.values()];
}
