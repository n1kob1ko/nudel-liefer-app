import { z } from "zod";

import { addressChanged, samePin, suggestNextCustomerNumber } from "@/domain/customer";
import { ABBREVIATION_MAX } from "@/domain/customer-abbreviation";
import { KEY_NUMBER_MAX } from "@/domain/customer-key";
import { calendarDayIn } from "@/domain/settings";
import type { PrismaClient } from "@/generated/prisma/client";
import { roundCoord } from "@/lib/coords";
import { localizedTextSchema } from "@/lib/localized-text";

import { recordAudit } from "./audit";
import { setCustomerAbbreviation } from "./customer-abbreviation";
import { geocodeAddress } from "./customer-geocode";
import { setCustomerKey } from "./customer-key";
import { notesJson, prepareNotes } from "./customer-notes";
import { type Geocoder, MAX_ADDRESS_LENGTH } from "./geocoder";
import type { TourHook } from "./orders";
import {
  cascadeCustomerInactive,
  generateRecurringOrders,
  resumeCustomerRules,
} from "./recurring-orders";
import type { Translator } from "./translator/types";

type CustomerDb = Pick<
  PrismaClient,
  | "customer"
  | "order"
  | "photo"
  | "$transaction"
  | "auditLog"
  | "recurringOrder"
  | "tour"
  | "settings"
  | "product"
>;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

/**
 * Customer form input (create and update). `lat`/`lng` (the Adresspunkt) come as a pair or both
 * `null`; there is no confirmation step any more (D22, NUD-141).
 */
export const customerInputSchema = z
  .object({
    customerNumber: text(32),
    name: text(160),
    street: text(160),
    postalCode: text(16),
    city: text(100),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase())
      .default("AT"),
    lat: z.number().min(-90).max(90).transform(roundCoord).nullable().default(null),
    lng: z.number().min(-180).max(180).transform(roundCoord).nullable().default(null),
    deliveryHoursInfo: optionalText(300),
    /** German note for the driver (source); translations are made on save, edited on the detail page. */
    notes: optionalText(2000),
    /** Office-only master data (NUD-136); empty text is stored as `null`. */
    companyName: optionalText(160),
    vatId: optionalText(32),
    billingStreet: optionalText(160),
    billingPostalCode: optionalText(16),
    billingCity: optionalText(100),
    /**
     * Customer key (NUD-142): `undefined` leaves the stored key alone (the form only sends it when
     * the office changed it, so a driver's newer entry is not overwritten by an old page); `null` =
     * unknown. The number only counts while `hasKey` is true. Written through `setCustomerKey`.
     */
    hasKey: z.boolean().nullable().optional(),
    keyNumber: z.string().trim().max(KEY_NUMBER_MAX).optional(),
    /**
     * Legacy Abkürzung (NUD-164): `undefined` leaves the stored value alone (the form only sends it
     * when the office changed it); blank clears it. Written through `setCustomerAbbreviation`.
     */
    abbreviation: z.string().trim().max(ABBREVIATION_MAX).optional(),
    /** "In den Kühlschrank" (owner 2026-11-14); `undefined` leaves the stored value alone. */
    intoFridge: z.boolean().optional(),
    alwaysInvoice: z.boolean().optional(),
  })
  .refine((v) => (v.lat === null) === (v.lng === null), { message: "pin" })
  .refine((v) => `${v.street}, ${v.postalCode} ${v.city}`.length <= MAX_ADDRESS_LENGTH, {
    message: "address",
  });

export type CustomerInput = z.input<typeof customerInputSchema>;

/** The office-only master data columns, written as they come from the form (NUD-136). */
export function officeFields(v: z.output<typeof customerInputSchema>) {
  return {
    companyName: v.companyName,
    vatId: v.vatId,
    billingStreet: v.billingStreet,
    billingPostalCode: v.billingPostalCode,
    billingCity: v.billingCity,
    ...(v.intoFridge === undefined ? {} : { intoFridge: v.intoFridge }),
    ...(v.alwaysInvoice === undefined ? {} : { alwaysInvoice: v.alwaysInvoice }),
  };
}
export type CustomerSaveResult =
  { ok: true; id: string } | { ok: false; error: "invalid" | "number_taken" | "not_found" };

const idSchema = z.string().trim().min(1).max(64);

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** Notes shown in the (German) textarea. */
export function notesText(notes: unknown): string {
  const parsed = localizedTextSchema.safeParse(notes);
  return parsed.success ? (parsed.data.de ?? "") : "";
}

/**
 * Test seams: the translator used for the notes (default: the configured one, NUD-070) and the
 * geocoder that looks up the Adresspunkt when the address is new or changed (NUD-141; without one
 * the point is not looked up).
 */
export type NotesOptions = {
  translator?: Translator;
  now?: Date;
  geocoder?: Geocoder;
  /** The office user saving the form; needed to record a key change (NUD-142). */
  actorId?: string;
};

/** Writes the key fields of the form (audited), when the form carried them and the actor is known. */
async function saveKey(
  db: CustomerDb,
  customerId: string,
  v: z.output<typeof customerInputSchema>,
  options: NotesOptions,
): Promise<void> {
  if (!options.actorId || v.hasKey === undefined) return;
  await setCustomerKey(db, {
    actorId: options.actorId,
    customerId,
    hasKey: v.hasKey,
    keyNumber: v.keyNumber,
    via: "office",
  });
}

/** Writes the Abkürzung of the form (audited), when the form carried it and the actor is known. */
async function saveAbbreviation(
  db: CustomerDb,
  customerId: string,
  v: z.output<typeof customerInputSchema>,
  options: NotesOptions,
): Promise<void> {
  if (!options.actorId || v.abbreviation === undefined) return;
  await setCustomerAbbreviation(db, {
    actorId: options.actorId,
    customerId,
    abbreviation: v.abbreviation,
    via: "office",
  });
}

async function lookUpAddressPoint(
  geocoder: Geocoder | undefined,
  address: { street: string; postalCode: string; city: string; country: string },
) {
  return geocoder ? geocodeAddress(geocoder, address) : null;
}

async function numberTaken(db: CustomerDb, number: string, exceptId?: string): Promise<boolean> {
  const hit = await db.customer.findFirst({
    where: {
      customerNumber: { equals: number, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return hit !== null;
}

/** Creates a customer. The caller checked the role. */
export async function createCustomer(
  db: CustomerDb,
  rawInput: unknown,
  options: NotesOptions = {},
): Promise<CustomerSaveResult> {
  const parsed = customerInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (await numberTaken(db, v.customerNumber)) return { ok: false, error: "number_taken" };
  const pin = v.lat !== null && v.lng !== null ? { lat: v.lat, lng: v.lng } : null;
  // No point given: look the address up (best effort, the customer is saved either way).
  const point = pin ?? (await lookUpAddressPoint(options.geocoder, v));
  try {
    const row = await db.customer.create({
      data: {
        customerNumber: v.customerNumber,
        name: v.name,
        street: v.street,
        postalCode: v.postalCode,
        city: v.city,
        country: v.country,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        deliveryHoursInfo: v.deliveryHoursInfo,
        ...officeFields(v),
        notes: notesJson(await prepareNotes(null, v.notes, options)),
      },
      select: { id: true },
    });
    await saveKey(db, row.id, v, options);
    await saveAbbreviation(db, row.id, v, options);
    return { ok: true, id: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "number_taken" };
    throw error;
  }
}

/**
 * Updates a customer. When the address changed and the Adresspunkt was not moved by hand, the new
 * address is geocoded automatically (best effort; on failure the old point is dropped, since it
 * belongs to the old address).
 */
export async function updateCustomer(
  db: CustomerDb,
  rawId: unknown,
  rawInput: unknown,
  options: NotesOptions = {},
): Promise<CustomerSaveResult> {
  const id = idSchema.safeParse(rawId);
  const parsed = customerInputSchema.safeParse(rawInput);
  if (!id.success || !parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const stored = await db.customer.findUnique({ where: { id: id.data } });
  if (!stored) return { ok: false, error: "not_found" };
  if (await numberTaken(db, v.customerNumber, stored.id)) {
    return { ok: false, error: "number_taken" };
  }
  const storedPin =
    stored.lat !== null && stored.lng !== null ? { lat: stored.lat, lng: stored.lng } : null;
  const pin = v.lat !== null && v.lng !== null ? { lat: v.lat, lng: v.lng } : null;
  // No point, or a changed address whose point the admin did not move: look it up again.
  const stale = pin === null || (addressChanged(stored, v) && samePin(storedPin, pin));
  const point = stale ? await lookUpAddressPoint(options.geocoder, v) : pin;
  try {
    await db.customer.update({
      where: { id: stored.id },
      data: {
        customerNumber: v.customerNumber,
        name: v.name,
        street: v.street,
        postalCode: v.postalCode,
        city: v.city,
        country: v.country,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        deliveryHoursInfo: v.deliveryHoursInfo,
        ...officeFields(v),
        notes: notesJson(await prepareNotes(stored.notes, v.notes, options)),
      },
    });
    await saveKey(db, stored.id, v, options);
    await saveAbbreviation(db, stored.id, v, options);
    return { ok: true, id: stored.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "number_taken" };
    throw error;
  }
}

export type CustomerActiveResult =
  | {
      ok: true;
      /** Future open orders cancelled and rules paused / resumed by this change (NUD-149). */
      cancelledOrders: number;
      pausedRules: number;
      resumedRules: number;
    }
  | { ok: false; error: "invalid" | "not_found" };

/**
 * Archive (`active = false`) or reactivate; customers are never deleted (backlog 4.3). Setting a
 * customer inactive pauses all his recurring rules and cancels every future order that is not yet
 * delivered (D25, NUD-149), in the same transaction and audited. Reactivating resumes the rules
 * that were paused with him; cancelled orders stay cancelled.
 */
export async function setCustomerActive(
  db: CustomerDb,
  rawId: unknown,
  rawActive: unknown,
  ctx: { actorId: string; today: Date; tours: TourHook },
): Promise<CustomerActiveResult> {
  const id = idSchema.safeParse(rawId);
  const active = z.boolean().safeParse(rawActive);
  if (!id.success || !active.success) return { ok: false, error: "invalid" };
  const outcome = await db.$transaction(async (tx) => {
    const stored = await tx.customer.findUnique({
      where: { id: id.data },
      select: { id: true, active: true },
    });
    if (!stored) return null;
    if (stored.active === active.data) {
      return { cancelledOrders: 0, pausedRules: 0, resumed: [] as string[] };
    }
    await tx.customer.update({ where: { id: stored.id }, data: { active: active.data } });
    const cascade = active.data
      ? { cancelledOrders: 0, pausedRules: 0 }
      : await cascadeCustomerInactive(tx, ctx.tours, ctx.actorId, stored.id, ctx.today);
    const resumed = active.data ? await resumeCustomerRules(tx, ctx.actorId, stored.id) : [];
    await recordAudit(tx, {
      actorId: ctx.actorId,
      entity: "Customer",
      entityId: stored.id,
      action: active.data ? "customer.activate" : "customer.deactivate",
      diff: {
        active: { from: stored.active, to: active.data },
        cancelledOrders: cascade.cancelledOrders,
        pausedRules: cascade.pausedRules,
        resumedRules: resumed.length,
      },
    });
    return { ...cascade, resumed };
  });
  if (!outcome) return { ok: false, error: "not_found" };
  if (outcome.resumed.length > 0) {
    // Rules that run again get their orders now instead of at the next daily run.
    await generateRecurringOrders(db, {
      today: ctx.today,
      tours: ctx.tours,
      ruleIds: outcome.resumed,
    });
  }
  return {
    ok: true,
    cancelledOrders: outcome.cancelledOrders,
    pausedRules: outcome.pausedRules,
    resumedRules: outcome.resumed.length,
  };
}

/** Next free customer number to prefill the "new customer" form. */
export async function nextCustomerNumber(db: CustomerDb): Promise<string> {
  const rows = await db.customer.findMany({ select: { customerNumber: true } });
  return suggestNextCustomerNumber(rows.map((r) => r.customerNumber));
}

export type CustomerDetail = {
  id: string;
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  deliveryHoursInfo: string | null;
  notes: string;
  companyName: string | null;
  vatId: string | null;
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  /** Customer key (NUD-142): `hasKey` null = unknown. */
  hasKey: boolean | null;
  keyNumber: string | null;
  /** Who last changed the key and when (office or driver); `null` while it was never set. */
  keyUpdatedBy: { name: string; role: "ADMIN" | "DRIVER" } | null;
  keyUpdatedAt: Date | null;
  /** Legacy Abkürzung (NUD-164), `null` = none; with who last changed it and when. */
  abbreviation: string | null;
  abbreviationUpdatedBy: { name: string; role: "ADMIN" | "DRIVER" } | null;
  abbreviationUpdatedAt: Date | null;
  /** Always into the customer's fridge / always an invoice (the driver sees a symbol). */
  intoFridge: boolean;
  alwaysInvoice: boolean;
  active: boolean;
  hasStorePhoto: boolean;
  hasParkingPhoto: boolean;
};

export async function getCustomerDetail(
  db: CustomerDb,
  rawId: unknown,
): Promise<CustomerDetail | null> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return null;
  const row = await db.customer.findUnique({
    where: { id: id.data },
    include: {
      photos: { where: { isCurrent: true }, select: { kind: true } },
      keyUpdatedBy: { select: { displayName: true, role: true } },
      abbreviationUpdatedBy: { select: { displayName: true, role: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    customerNumber: row.customerNumber,
    name: row.name,
    street: row.street,
    postalCode: row.postalCode,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    deliveryHoursInfo: row.deliveryHoursInfo,
    notes: notesText(row.notes),
    companyName: row.companyName,
    vatId: row.vatId,
    billingStreet: row.billingStreet,
    billingPostalCode: row.billingPostalCode,
    billingCity: row.billingCity,
    hasKey: row.hasKey,
    keyNumber: row.keyNumber,
    keyUpdatedBy: row.keyUpdatedBy
      ? { name: row.keyUpdatedBy.displayName, role: row.keyUpdatedBy.role }
      : null,
    keyUpdatedAt: row.keyUpdatedAt,
    abbreviation: row.abbreviation,
    abbreviationUpdatedBy: row.abbreviationUpdatedBy
      ? { name: row.abbreviationUpdatedBy.displayName, role: row.abbreviationUpdatedBy.role }
      : null,
    abbreviationUpdatedAt: row.abbreviationUpdatedAt,
    intoFridge: row.intoFridge,
    alwaysInvoice: row.alwaysInvoice,
    active: row.active,
    hasStorePhoto: row.photos.some((p) => p.kind === "STORE"),
    hasParkingPhoto: row.photos.some((p) => p.kind === "PARKING"),
  };
}

export type UpcomingOrder = {
  id: string;
  /** `DATE` value as UTC midnight. */
  deliveryDate: Date;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  /** Generated from a recurring rule ("aus Dauerbestellung", NUD-149). */
  fromRecurring: boolean;
  items: Array<{ id: string; productName: unknown; unit: string; quantity: number }>;
};

/**
 * Orders of this customer with a delivery date from "today" (factory time zone) on, cancelled
 * ones excluded. Real data: the list is empty until orders exist (NUD-030).
 */
export async function listUpcomingOrders(
  db: CustomerDb,
  rawId: unknown,
  timezone: string,
  now: Date = new Date(),
  limit = 20,
): Promise<UpcomingOrder[]> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return [];
  const { y, m, d } = calendarDayIn(now, timezone);
  const rows = await db.order.findMany({
    where: {
      customerId: id.data,
      status: { not: "CANCELLED" },
      deliveryDate: { gte: new Date(Date.UTC(y, m - 1, d)) },
    },
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }],
    take: limit,
    include: {
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    deliveryDate: o.deliveryDate,
    status: o.status,
    fromRecurring: o.recurringOrderId !== null,
    items: o.items.map((i) => ({
      id: i.id,
      productName: i.product.name,
      unit: i.product.unit,
      quantity: i.quantity,
    })),
  }));
}
