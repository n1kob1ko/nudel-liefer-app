import { revalidateTag } from "next/cache";

import { SETTINGS_TAG } from "./settings";

/**
 * Test hook: makes the server forget its cached settings (`getSettings`, "use cache").
 *
 * The browser tests write the settings row straight to the database (a confirmed depot, the
 * departure checklist). The app itself only changes the row through `saveSettingsAction`, which
 * expires the cache; a direct write does not, so the server kept answering with whatever it had
 * read first and the outcome of a run depended on the order of the specs.
 *
 * Only active with `ENABLE_ERROR_TEST_PAGES=true` (the e2e run; the production env check rejects
 * the variable). Returns whether the cache was expired.
 */
export function resetSettingsCacheForTests(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.ENABLE_ERROR_TEST_PAGES !== "true") return false;
  revalidateTag(SETTINGS_TAG, { expire: 0 });
  return true;
}
