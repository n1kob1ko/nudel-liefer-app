/**
 * The app caches the settings row on the server (`getSettings`, "use cache") and only its own save
 * action expires that copy. A spec that writes `"Settings"` straight to the database (a confirmed
 * depot, the departure checklist) must therefore tell the server to read the row again, or the
 * pages keep showing whatever the server read first and the result depends on which spec ran
 * before. Call this after every such write, the restore in the cleanup included.
 *
 * The hook is `POST /api/dev/settings-cache`; it exists only on a server started with
 * `ENABLE_ERROR_TEST_PAGES=true` (the server `playwright.config.ts` starts has it).
 */
export async function expireSettingsCache(): Promise<void> {
  const url = `http://localhost:${Number(process.env.PORT ?? 3000)}/api/dev/settings-cache`;
  const response = await fetch(url, { method: "POST" });
  if (response.status !== 204) {
    throw new Error(
      `Precondition failed: ${url} answered ${response.status} instead of 204. The server under ` +
        `test must run with ENABLE_ERROR_TEST_PAGES=true so that settings written by a spec reach ` +
        `the pages (a server that was already listening on the port is reused as it is: stop it ` +
        `or start it with the variable).`,
    );
  }
}
