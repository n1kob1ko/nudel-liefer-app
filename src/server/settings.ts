import { randomUUID } from "node:crypto";

import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { CHECKLIST_ITEM_MAX, CHECKLIST_ITEMS_MAX } from "@/domain/departure-checklist";
import { problemPhoneSchema } from "@/domain/problem-phone";
import {
  type Depot,
  type DepotSettings,
  nextDeliveryDate,
  type PlanningSettings,
  requireDepot,
} from "@/domain/settings";
import { MAX_DEFAULT_LOADING_MINUTES } from "@/domain/work-time";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { roundCoord } from "@/lib/coords";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { type LocalizedText, localizedTextSchema } from "@/lib/localized-text";

import { getDb } from "./db";
import { MAX_ADDRESS_LENGTH } from "./geocoder";
import { localize } from "./translator/localize";
import type { Translator } from "./translator/types";

/** Cache tag of the settings singleton; the save action expires it. */
export const SETTINGS_TAG = "settings";

/** A fixed item of the driver's departure checklist (NUD-151); German is the source language. */
export type ChecklistItem = { id: string; text: LocalizedText };

export type AppSettings = DepotSettings &
  PlanningSettings & {
    departureTime: string;
    serviceMinutesPerStop: number;
    recurringLeadDays: number;
    departureChecklist: ChecklistItem[];
    /** Loading time assumed when the driver skipped the departure checklist (NUD-152). */
    defaultLoadingMinutes: number;
    /** Number the driver calls from "Problem" (owner 2026-11-14). */
    problemPhone: string;
  };

const SETTINGS_ID = 1;

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const settingsInputSchema = z.object({
  depotName: z.string().trim().min(1).max(120),
  depotAddress: z.string().trim().min(1).max(MAX_ADDRESS_LENGTH),
  depotLat: z.number().min(-90).max(90).transform(roundCoord),
  depotLng: z.number().min(-180).max(180).transform(roundCoord),
  /** The admin must tick "pin checked" (D9); anything else is rejected. */
  depotPinConfirmed: z.literal(true),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimezone),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  serviceMinutesPerStop: z.number().int().min(0).max(180),
  /**
   * Loading time assumed when the driver skipped the departure checklist (NUD-152, D28);
   * omitted = unchanged.
   */
  defaultLoadingMinutes: z.number().int().min(0).max(MAX_DEFAULT_LOADING_MINUTES).optional(),
  /** Number the driver calls from "Problem" (owner 2026-11-14); omitted = unchanged. */
  problemPhone: problemPhoneSchema.optional(),
  /** Days ahead the daily job generates recurring orders (NUD-149); omitted = unchanged. */
  recurringLeadDays: z.number().int().min(1).max(60).optional(),
  deliveryWeekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  /**
   * Fixed departure checklist items in German (NUD-151); omitted = unchanged. An `id` of an existing
   * item keeps its translations while the text is the same; items without an id are new.
   */
  departureChecklist: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40).optional(),
        text: z.string().trim().min(1).max(CHECKLIST_ITEM_MAX),
      }),
    )
    .max(CHECKLIST_ITEMS_MAX)
    .optional(),
});

export type SettingsInput = z.input<typeof settingsInputSchema>;
export type SaveSettingsResult = { ok: true } | { ok: false; error: "invalid" };

type SettingsDb = Pick<PrismaClient, "settings">;

const storedChecklistSchema = z
  .array(z.object({ id: z.string().min(1).max(40), text: localizedTextSchema }))
  .max(CHECKLIST_ITEMS_MAX * 4);

/** The stored fixed checklist items; unusable JSON reads as "none" (never throws). */
export function parseDepartureChecklist(raw: unknown): ChecklistItem[] {
  const parsed = storedChecklistSchema.safeParse(raw);
  return parsed.success ? parsed.data.slice(0, CHECKLIST_ITEMS_MAX) : [];
}

/**
 * The value to store for the items typed in the settings form: texts that did not change keep their
 * stored `LocalizedText` (so hand-edited translations survive), new or changed texts are localized
 * from German (machine translation, never blocks saving, `localize`).
 */
export async function prepareDepartureChecklist(
  stored: unknown,
  typed: ReadonlyArray<{ id?: string; text: string }>,
  options: { translator?: Translator; now?: Date } = {},
): Promise<ChecklistItem[]> {
  const current = new Map(parseDepartureChecklist(stored).map((item) => [item.id, item]));
  const used = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const entry of typed) {
    const text = entry.text.trim();
    if (text === "") continue;
    const known = entry.id && !used.has(entry.id) ? current.get(entry.id) : undefined;
    const id = known ? known.id : `c${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    used.add(id);
    items.push({
      id,
      text: known && known.text.de === text ? known.text : await localize(text, "de", options),
    });
  }
  return items;
}

/** Reads the singleton row; `null` before the first save on a database without seed data. */
export async function readSettings(db: SettingsDb): Promise<AppSettings | null> {
  const row = await db.settings.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return null;
  return {
    depotName: row.depotName,
    depotAddress: row.depotAddress,
    depotLat: row.depotLat,
    depotLng: row.depotLng,
    depotPinConfirmed: row.depotPinConfirmed,
    timezone: row.timezone,
    departureTime: row.departureTime,
    serviceMinutesPerStop: row.serviceMinutesPerStop,
    recurringLeadDays: row.recurringLeadDays,
    deliveryWeekdays: row.deliveryWeekdays,
    departureChecklist: parseDepartureChecklist(row.departureChecklist),
    defaultLoadingMinutes: row.defaultLoadingMinutes,
    problemPhone: row.problemPhone,
  };
}

/** Validates and stores the settings (upsert of the singleton). The caller checked the role. */
export async function saveSettings(
  db: SettingsDb,
  input: unknown,
  options: { translator?: Translator } = {},
): Promise<SaveSettingsResult> {
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { departureChecklist: typed, ...rest } = parsed.data;
  const data = {
    ...rest,
    ...(typed !== undefined
      ? {
          departureChecklist: (await prepareDepartureChecklist(
            (await db.settings.findUnique({ where: { id: SETTINGS_ID } }))?.departureChecklist,
            typed,
            options,
          )) as unknown as Prisma.InputJsonValue,
        }
      : {}),
  };
  await db.settings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
  return { ok: true };
}

/**
 * Settings for pages and services, cached server-side and expired by `updateTag(SETTINGS_TAG)`
 * in the save action. Use `readSettings(getDb())` where an uncached read is required.
 */
export async function getSettings(): Promise<AppSettings | null> {
  "use cache";
  cacheTag(SETTINGS_TAG);
  cacheLife("hours");
  return readSettings(getDb());
}

/** Factory time zone from the settings (falls back to the default before the first save). */
export async function getFactoryTimezone(): Promise<string> {
  return (await getSettings())?.timezone ?? DEFAULT_TIMEZONE;
}

/**
 * Tour-building guard (NUD-041): the confirmed depot or a thrown `DepotNotSetError`
 * (`code === "DEPOT_NOT_SET"`) that the caller turns into a clear message.
 */
export async function requireDepotConfigured(): Promise<Depot> {
  return requireDepot(await getSettings());
}

/** Default delivery date for order entry (NUD-030), derived from the delivery weekdays. */
export async function getDefaultDeliveryDate(now: Date = new Date()): Promise<Date> {
  const settings = await getSettings();
  return nextDeliveryDate(now, {
    timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
    deliveryWeekdays: settings?.deliveryWeekdays ?? [1, 2, 3, 4, 5],
  });
}
