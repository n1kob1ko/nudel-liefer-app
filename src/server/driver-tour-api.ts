import { authErrorStatus, requireRole } from "./auth/guards";
import { getDb } from "./db";
import { getDriverTourResponse } from "./driver-tour-payload";
import { getSettings } from "./settings";
import { getStorage } from "./storage";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * `GET /api/driver/tour/today` (NUD-081): the signed-in driver's tour of today as the shared driver
 * data model (stops, items, texts in all locales, signed photo URLs valid for 12 h), the one
 * source for the offline copy in the browser. DRIVER only: `requireRole("DRIVER")` comes first, the
 * driver id is the session user (no parameters), anonymous -> 401, admin or other roles -> 403.
 * The answer is personal data: never cached by browsers, proxies or the service worker.
 */
export async function driverTourTodayResponse(now: Date = new Date()): Promise<Response> {
  let actor;
  try {
    actor = await requireRole("DRIVER");
  } catch (error) {
    const status = authErrorStatus(error);
    if (!status) throw error;
    return Response.json(
      { error: status === 401 ? "unauthenticated" : "forbidden" },
      { status, headers: NO_STORE },
    );
  }
  const settings = await getSettings();
  const body = await getDriverTourResponse(getDb(), actor, {
    now,
    timezone: settings?.timezone ?? "Europe/Vienna",
    serviceMinutesPerStop: settings?.serviceMinutesPerStop ?? 10,
    problemPhone: settings?.problemPhone,
    photos: { storage: getStorage() },
  });
  return Response.json(body, { headers: NO_STORE });
}
