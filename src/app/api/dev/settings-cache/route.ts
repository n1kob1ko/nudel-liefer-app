import { resetSettingsCacheForTests } from "@/server/settings-cache-reset";

/**
 * Hidden test hook: `POST` expires the server's cached settings after a browser test wrote the
 * settings row straight to the database (`tests/e2e/helpers/settings.ts`). A 404 unless
 * `ENABLE_ERROR_TEST_PAGES=true`, like the hidden error pages; it changes no data.
 */
export function POST() {
  return new Response(null, {
    status: resetSettingsCacheForTests() ? 204 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
