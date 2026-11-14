/**
 * Keeps one reader of the order inbox per server process (NUD-210). A second request while the
 * reader is busy does not start another one; it only notes that there is more to read, so photos
 * that arrive in the moment the reader finishes are not left waiting. Several processes are fine
 * too: every photo is claimed in the database (`claimInboxPhotos`).
 */
export function createInboxReader(drain: () => Promise<unknown>) {
  let running = false;
  let again = false;
  return async function read(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await drain();
      } while (again);
    } catch (error) {
      // The photos stay NEW (or their claim runs out) and the next request reads them.
      console.error(
        "[order-inbox] reading stopped:",
        error instanceof Error ? error.message : "unknown error",
      );
    } finally {
      running = false;
    }
  };
}
