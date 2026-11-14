import { z } from "zod";

import {
  assembleDraft,
  type ExtractionAnswer,
  extractionAnswerSchema,
  matchCustomer,
  type OrderDraft,
} from "@/domain/order-extraction";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { isScreenshotKey, MAX_UPLOAD_BYTES } from "@/lib/uploads";

import { extractOrderDraft, loadCatalog, type OrderDraftFailure } from "./order-extraction";
import type { OrderExtractor } from "./order-extractor";
import type { Storage } from "./storage";

/**
 * The order inbox (NUD-210): the office uploads many photos of orders at once (about a hundred a
 * day), the app reads each one in the background and proposes the customer, and the office only
 * checks and confirms. A photo of the inbox is a `Screenshot` row with an `inboxStatus`; it becomes
 * an order only when the office saves the order form (`createOrder` attaches the row), so nothing
 * here ever writes an order (D26: the office confirms every quantity).
 *
 * Reading does not depend on an open browser tab: `drainInbox` runs on the server after the
 * upload, a few photos at a time. Every step claims its photo with a guarded update, so two
 * readers (or a reader and the office) never work on the same photo, and a claim that was left
 * behind by a restart is taken over after `INBOX_STALE_READ_MS`.
 */

/** Photos read at the same time. Small on purpose: the provider's rate limit is per minute. */
export const INBOX_READ_CONCURRENCY = 4;
/** A reader that did not finish within this time is considered gone (request timeout is 60 s). */
export const INBOX_STALE_READ_MS = 3 * 60_000;
/** How long "Rückgängig" can bring a discarded photo back; afterwards photo and row are deleted. */
export const INBOX_DISCARD_GRACE_MS = 10 * 60_000;
/** Keys accepted by one `addInboxPhotos` call (the browser registers each photo as it arrives). */
export const MAX_INBOX_ADD = 20;
/** Open photos shown at once; a day's hundred photos fit, anything beyond waits its turn. */
export const INBOX_LIST_LIMIT = 300;

const OPEN_STATUSES = ["NEW", "READING", "READY", "FAILED"] as const;
export type InboxOpenStatus = (typeof OPEN_STATUSES)[number];

export type InboxDb = Pick<PrismaClient, "screenshot" | "customer" | "product">;

const idSchema = z.string().trim().min(1).max(64);
const keysSchema = z
  .array(z.string().max(200).refine(isScreenshotKey))
  .min(1)
  .max(MAX_INBOX_ADD);

export type InboxAddResult =
  | { ok: true; added: number; skipped: number }
  | { ok: false; error: "invalid" };

/**
 * Puts uploaded photos into the inbox. Each key must be one the upload endpoint issued, its object
 * must exist and it must not belong to a photo already; a key that fails one of these is skipped,
 * the others are still taken (one broken upload must not lose the other nineteen).
 */
export async function addInboxPhotos(
  db: InboxDb,
  actorId: string,
  rawKeys: unknown,
  storage: Pick<Storage, "head">,
): Promise<InboxAddResult> {
  const parsed = keysSchema.safeParse(rawKeys);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const keys = [...new Set(parsed.data)];
  const known = await db.screenshot.findMany({
    where: { storageKey: { in: keys } },
    select: { storageKey: true },
  });
  const taken = new Set(known.map((row) => row.storageKey));
  let added = 0;
  for (const key of keys) {
    if (taken.has(key)) continue;
    const stored = await storage.head(key).catch(() => null);
    if (!stored || stored.bytes <= 0 || stored.bytes > MAX_UPLOAD_BYTES) continue;
    await db.screenshot.create({
      data: { storageKey: key, uploadedById: actorId, inboxStatus: "NEW" },
      select: { id: true },
    });
    added += 1;
  }
  return { ok: true, added, skipped: keys.length - added };
}

/** One line the model read and the catalog knows. */
export type InboxLine = { productId: string; quantity: string };

export type InboxItemView = {
  id: string;
  status: InboxOpenStatus;
  /** Signed, short-lived URL of the photo. */
  url: string;
  /** The proposed customer, if there is one and it can still take orders. */
  customer: { id: string; name: string; city: string } | null;
  /** The name the model read on the photo. */
  customerHint: string | null;
  lines: InboxLine[];
  /** Lines the model saw but the catalog does not know; the office sorts them out in the form. */
  unmatched: number;
  error: OrderDraftFailure | null;
};

export type InboxView = {
  items: InboxItemView[];
  /** Photos that are still to be read (NEW or READING). */
  waiting: number;
  /** Photos that are ready to be checked. */
  ready: number;
};

const itemSelect = {
  id: true,
  storageKey: true,
  inboxStatus: true,
  extraction: true,
  readError: true,
  customerHint: true,
  suggestedCustomer: { select: { id: true, name: true, city: true, active: true } },
} satisfies Prisma.ScreenshotSelect;

/** Open photos only: a photo with an order is done, whatever its status says. */
const openWhere = {
  inboxStatus: { in: [...OPEN_STATUSES] },
  orders: { none: {} },
} satisfies Prisma.ScreenshotWhereInput;

function parseAnswer(value: unknown): ExtractionAnswer | null {
  const parsed = extractionAnswerSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseFailure(value: string | null): OrderDraftFailure | null {
  return value === "not_configured" ||
    value === "screenshot_unavailable" ||
    value === "extraction_failed" ||
    value === "invalid"
    ? value
    : null;
}

/** The inbox list, oldest photo first (the order the office received them in). */
export async function listInbox(
  db: InboxDb,
  storage: Pick<Storage, "getReadUrl">,
): Promise<InboxView> {
  const [rows, catalog] = await Promise.all([
    db.screenshot.findMany({
      where: openWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: INBOX_LIST_LIMIT,
      select: itemSelect,
    }),
    loadCatalog(db),
  ]);
  const items = await Promise.all(
    rows.map(async (row): Promise<InboxItemView> => {
      const answer = row.inboxStatus === "READY" ? parseAnswer(row.extraction) : null;
      const draft = answer ? assembleDraft(answer, catalog) : null;
      const customer = row.suggestedCustomer?.active ? row.suggestedCustomer : null;
      return {
        id: row.id,
        status: row.inboxStatus as InboxOpenStatus,
        url: await storage.getReadUrl(row.storageKey),
        customer: customer ? { id: customer.id, name: customer.name, city: customer.city } : null,
        customerHint: row.customerHint,
        lines: draft?.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })) ?? [],
        unmatched: draft?.unmatched.length ?? 0,
        error: row.inboxStatus === "FAILED" ? (parseFailure(row.readError) ?? "extraction_failed") : null,
      };
    }),
  );
  return {
    items,
    waiting: items.filter((item) => item.status === "NEW" || item.status === "READING").length,
    ready: items.filter((item) => item.status === "READY").length,
  };
}

/** How many photos wait in the inbox (the number on the orders page). */
export async function countInbox(db: Pick<PrismaClient, "screenshot">): Promise<number> {
  return db.screenshot.count({ where: openWhere });
}

/** What the order form needs to check one photo of the inbox. */
export type InboxPrefill = {
  id: string;
  screenshot: { storageKey: string; url: string };
  /** `null` when the photo was not read (no key, a failure): the office types the order. */
  draft: OrderDraft | null;
  extraction: ExtractionAnswer | null;
  customerId: string | null;
  customerHint: string | null;
  /** The photo to check after this one, oldest first; `null` when this is the last one. */
  nextId: string | null;
  /** Open photos besides this one. */
  remaining: number;
};

/**
 * The photo to check next, oldest first: one that is read, otherwise one whose reading failed (the
 * office types it), otherwise - only without a model (`includeUnread`) - one that was never read.
 * Photos that are being read are not waited for; they are ready by the time the office gets there.
 */
export async function nextInboxPhoto(
  db: Pick<PrismaClient, "screenshot">,
  exceptId: string | null,
  includeUnread: boolean,
): Promise<string | null> {
  const statuses = includeUnread
    ? (["READY", "FAILED", "NEW"] as const)
    : (["READY", "FAILED"] as const);
  for (const inboxStatus of statuses) {
    const row = await db.screenshot.findFirst({
      where: { ...openWhere, inboxStatus, ...(exceptId ? { id: { not: exceptId } } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (row) return row.id;
  }
  return null;
}

/**
 * One open photo for the order form, or `null` when it is gone (saved, discarded, unknown id),
 * with the photo to check after it (`nextInboxPhoto`).
 */
export async function getInboxPrefill(
  db: InboxDb,
  rawId: unknown,
  storage: Pick<Storage, "getReadUrl">,
  options: { includeUnread?: boolean } = {},
): Promise<InboxPrefill | null> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return null;
  const row = await db.screenshot.findFirst({
    where: { ...openWhere, id: id.data },
    select: itemSelect,
  });
  if (!row) return null;
  const [catalog, nextId, remaining] = await Promise.all([
    loadCatalog(db),
    nextInboxPhoto(db, row.id, options.includeUnread ?? false),
    db.screenshot.count({ where: { ...openWhere, id: { not: row.id } } }),
  ]);
  const answer = row.inboxStatus === "READY" ? parseAnswer(row.extraction) : null;
  return {
    id: row.id,
    screenshot: { storageKey: row.storageKey, url: await storage.getReadUrl(row.storageKey) },
    draft: answer ? assembleDraft(answer, catalog) : null,
    extraction: answer,
    customerId: row.suggestedCustomer?.active ? row.suggestedCustomer.id : null,
    customerHint: row.customerHint,
    nextId,
    remaining,
  };
}

/**
 * The customer proposed for a name read from a photo. First what the office decided before: the
 * customer of the latest order that was saved from a photo with the same name (a chat is called
 * "Chen 🍜", not "Wok Palace GmbH", so the first confirmation teaches the second photo). Then the
 * customer list by name (`matchCustomer`). `null` when neither is sure.
 */
export async function suggestCustomer(
  db: Pick<PrismaClient, "screenshot" | "customer">,
  hint: string | null | undefined,
): Promise<string | null> {
  const name = (hint ?? "").trim();
  if (name === "") return null;
  const learned = await db.screenshot.findFirst({
    where: {
      customerHint: { equals: name, mode: "insensitive" },
      inboxStatus: "DONE",
      orders: { some: { customer: { active: true } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      orders: {
        where: { customer: { active: true } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { customerId: true },
      },
    },
  });
  const known = learned?.orders[0]?.customerId;
  if (known) return known;
  const customers = await db.customer.findMany({
    where: { active: true },
    select: { id: true, name: true, companyName: true, abbreviation: true },
  });
  return matchCustomer(name, customers);
}

/**
 * Claims up to `limit` photos for reading, oldest first: new ones and those whose reader vanished.
 * The guarded update makes the claim exclusive; a photo somebody else took in between is skipped.
 */
export async function claimInboxPhotos(
  db: Pick<PrismaClient, "screenshot">,
  limit: number,
  now: Date = new Date(),
): Promise<Array<{ id: string; storageKey: string }>> {
  const stale = new Date(now.getTime() - INBOX_STALE_READ_MS);
  const candidates = await db.screenshot.findMany({
    where: {
      orders: { none: {} },
      OR: [{ inboxStatus: "NEW" }, { inboxStatus: "READING", readStartedAt: { lt: stale } }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, storageKey: true, inboxStatus: true, readStartedAt: true },
  });
  const claimed: Array<{ id: string; storageKey: string }> = [];
  for (const row of candidates) {
    const { count } = await db.screenshot.updateMany({
      where: { id: row.id, inboxStatus: row.inboxStatus, readStartedAt: row.readStartedAt },
      data: { inboxStatus: "READING", readStartedAt: now, readError: null },
    });
    if (count === 1) claimed.push({ id: row.id, storageKey: row.storageKey });
  }
  return claimed;
}

export type InboxReadDeps = {
  storage: Pick<Storage, "head" | "getReadUrl">;
  extractor: OrderExtractor;
  /** Today in the factory time zone, `YYYY-MM-DD`. */
  today: string;
  timezone: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

/**
 * Reads one claimed photo and stores what the model answered (never the photo, never an order).
 * The result is written only while the photo is still claimed: a photo the office discarded or
 * saved in the meantime keeps its state. Never throws; a failure is a state the office can see.
 */
export async function readInboxPhoto(
  db: InboxDb,
  photo: { id: string; storageKey: string },
  deps: InboxReadDeps,
): Promise<"ready" | "failed" | "gone"> {
  let outcome;
  try {
    outcome = await extractOrderDraft(db, { screenshotKey: photo.storageKey }, deps);
  } catch (error) {
    console.warn(
      `[order-inbox] photo ${photo.id} not read:`,
      error instanceof Error ? error.name : "unknown error",
    );
    outcome = { ok: false as const, error: "extraction_failed" as const };
  }
  const claimed = { id: photo.id, inboxStatus: "READING" as const };
  if (!outcome.ok) {
    const { count } = await db.screenshot.updateMany({
      where: claimed,
      data: { inboxStatus: "FAILED", readError: outcome.error, readStartedAt: null },
    });
    return count === 1 ? "failed" : "gone";
  }
  const hint = outcome.extraction.customer?.trim() || null;
  const suggestedCustomerId = await suggestCustomer(db, hint).catch(() => null);
  const { count } = await db.screenshot.updateMany({
    where: claimed,
    data: {
      inboxStatus: "READY",
      extraction: outcome.extraction as unknown as Prisma.InputJsonValue,
      customerHint: hint,
      suggestedCustomerId,
      readError: null,
      readStartedAt: null,
    },
  });
  return count === 1 ? "ready" : "gone";
}

export type InboxDrainReport = { read: number; failed: number };

/**
 * Reads everything that waits, `INBOX_READ_CONCURRENCY` photos at a time, until nothing is left.
 * Safe to run more than once at the same time (the claims are exclusive), which is what happens
 * when two people upload, or when the page asks again after a restart.
 */
export async function drainInbox(
  db: InboxDb,
  deps: InboxReadDeps,
  options: { concurrency?: number; maxPhotos?: number } = {},
): Promise<InboxDrainReport> {
  const concurrency = options.concurrency ?? INBOX_READ_CONCURRENCY;
  const maxPhotos = options.maxPhotos ?? 1000;
  const report: InboxDrainReport = { read: 0, failed: 0 };
  let handled = 0;
  while (handled < maxPhotos) {
    const batch = await claimInboxPhotos(
      db,
      Math.min(concurrency, maxPhotos - handled),
      deps.now?.() ?? new Date(),
    );
    if (batch.length === 0) break;
    handled += batch.length;
    const results = await Promise.all(batch.map((photo) => readInboxPhoto(db, photo, deps)));
    for (const result of results) {
      if (result === "ready") report.read += 1;
      else if (result === "failed") report.failed += 1;
    }
  }
  return report;
}

export type InboxChangeResult = { ok: true } | { ok: false; error: "invalid" | "not_found" };

/**
 * The office throws a photo away. It disappears from the inbox at once and can be brought back
 * for `INBOX_DISCARD_GRACE_MS`; after that `purgeDiscardedInboxPhotos` deletes the photo itself.
 */
export async function discardInboxPhoto(
  db: Pick<PrismaClient, "screenshot">,
  rawId: unknown,
  now: Date = new Date(),
): Promise<InboxChangeResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "invalid" };
  const { count } = await db.screenshot.updateMany({
    where: { ...openWhere, id: id.data },
    data: { inboxStatus: "DISCARDED", discardedAt: now, readStartedAt: null },
  });
  return count === 1 ? { ok: true } : { ok: false, error: "not_found" };
}

/** "Rückgängig": the photo is back where it was (read, failed, or waiting to be read). */
export async function restoreInboxPhoto(
  db: Pick<PrismaClient, "screenshot">,
  rawId: unknown,
): Promise<InboxChangeResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "invalid" };
  const row = await db.screenshot.findFirst({
    where: { id: id.data, inboxStatus: "DISCARDED" },
    select: { extraction: true, readError: true },
  });
  if (!row) return { ok: false, error: "not_found" };
  const status = parseAnswer(row.extraction) ? "READY" : row.readError ? "FAILED" : "NEW";
  const { count } = await db.screenshot.updateMany({
    where: { id: id.data, inboxStatus: "DISCARDED" },
    data: { inboxStatus: status, discardedAt: null },
  });
  return count === 1 ? { ok: true } : { ok: false, error: "not_found" };
}

/** "Nochmal lesen" for a photo whose reading failed: it waits again and the reader takes it. */
export async function retryInboxPhoto(
  db: Pick<PrismaClient, "screenshot">,
  rawId: unknown,
): Promise<InboxChangeResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "invalid" };
  const { count } = await db.screenshot.updateMany({
    where: { id: id.data, inboxStatus: "FAILED", orders: { none: {} } },
    data: { inboxStatus: "NEW", readError: null, readStartedAt: null },
  });
  return count === 1 ? { ok: true } : { ok: false, error: "not_found" };
}

/**
 * Deletes discarded photos for good once "Rückgängig" is over: the stored photo first, then the
 * row (the order of `screenshot-retention.ts`: a row without a photo is harmless, a photo without
 * a row would stay forever). A failure on one photo never stops the others.
 */
export async function purgeDiscardedInboxPhotos(
  db: Pick<PrismaClient, "screenshot">,
  storage: Pick<Storage, "delete">,
  now: Date = new Date(),
): Promise<{ deleted: number; failed: number }> {
  const cutoff = new Date(now.getTime() - INBOX_DISCARD_GRACE_MS);
  const rows = await db.screenshot.findMany({
    where: { inboxStatus: "DISCARDED", discardedAt: { lt: cutoff }, orders: { none: {} } },
    take: 200,
    select: { id: true, storageKey: true },
  });
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await storage.delete(row.storageKey);
      const { count } = await db.screenshot.deleteMany({
        where: { id: row.id, inboxStatus: "DISCARDED", orders: { none: {} } },
      });
      deleted += count;
    } catch (error) {
      failed += 1;
      console.error(
        `[order-inbox] discarded photo ${row.id} not removed:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  return { deleted, failed };
}
