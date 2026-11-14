"use server";

import { after } from "next/server";

import { formatCalendarDate } from "@/domain/order";

import { requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getOrderExtractor, isOrderExtractorAvailable } from "./order-extractor";
import {
  addInboxPhotos,
  discardInboxPhoto,
  drainInbox,
  type InboxAddResult,
  type InboxChangeResult,
  type InboxView,
  listInbox,
  nextInboxPhoto,
  purgeDiscardedInboxPhotos,
  restoreInboxPhoto,
  retryInboxPhoto,
} from "./order-inbox";
import { createInboxReader } from "./order-inbox-reader";
import { todayIn } from "./orders";
import { getFactoryTimezone } from "./settings";
import { getStorage } from "./storage";

/**
 * Admin-only server actions of the order inbox (NUD-210). Reading never happens inside a request:
 * the actions answer at once and `after()` lets the server read the waiting photos, so the office
 * can close the page or start checking while the rest is still being read.
 */

const readInbox = createInboxReader(async () => {
  const timezone = await getFactoryTimezone();
  await drainInbox(getDb(), {
    storage: getStorage(),
    extractor: getOrderExtractor(),
    today: formatCalendarDate(todayIn(timezone)),
    timezone,
  });
});

/** Starts the reader after the response. Without a model key the photos simply wait unread. */
function scheduleReading() {
  if (!isOrderExtractorAvailable()) return;
  try {
    after(readInbox);
  } catch {
    // Outside a request scope: the next look at the inbox starts the reader.
    console.warn("[order-inbox] could not schedule the reading; the next request does");
  }
}

/** Removes what was discarded long enough ago. Never delays or fails the action that asked. */
function scheduleCleanup() {
  try {
    after(async () => {
      await purgeDiscardedInboxPhotos(getDb(), getStorage()).catch(() => undefined);
    });
  } catch {
    // The next action cleans up.
  }
}

/** Puts freshly uploaded photos (their storage keys) into the inbox and starts the reading. */
export async function addInboxPhotosAction(keys: unknown): Promise<InboxAddResult> {
  const actor = await requireRole("ADMIN");
  const result = await addInboxPhotos(getDb(), actor.id, keys, getStorage());
  if (result.ok && result.added > 0) scheduleReading();
  scheduleCleanup();
  return result;
}

/**
 * The inbox as it stands now. The page asks again while photos are being read; a photo that waits
 * (after a restart, say) starts the reader again.
 */
export async function inboxAction(): Promise<{ view: InboxView; firstId: string | null }> {
  await requireRole("ADMIN");
  const [view, firstId] = await Promise.all([
    listInbox(getDb(), getStorage()),
    nextInboxPhoto(getDb(), null, !isOrderExtractorAvailable()),
  ]);
  if (view.waiting > 0) scheduleReading();
  return { view, firstId };
}

/** Throws a photo away; `restoreInboxPhotoAction` brings it back for a few minutes. */
export async function discardInboxPhotoAction(id: unknown): Promise<InboxChangeResult> {
  await requireRole("ADMIN");
  const result = await discardInboxPhoto(getDb(), id);
  scheduleCleanup();
  return result;
}

/** "Rückgängig" of a discard. */
export async function restoreInboxPhotoAction(id: unknown): Promise<InboxChangeResult> {
  await requireRole("ADMIN");
  return restoreInboxPhoto(getDb(), id);
}

/** Reads a photo again whose reading failed. */
export async function retryInboxPhotoAction(id: unknown): Promise<InboxChangeResult> {
  await requireRole("ADMIN");
  const result = await retryInboxPhoto(getDb(), id);
  if (result.ok) scheduleReading();
  return result;
}
