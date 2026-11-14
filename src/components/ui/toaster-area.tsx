"use client";

import { usePathname } from "@/i18n/navigation";

import { Toaster } from "./sonner";

/**
 * NUD-176 (QA 2026-10-29, F1 + F2): ONE toast host for both apps, placed where the app needs it.
 *
 * The driver app has a sticky 56 px header with the date, the sync pill and the stop counter, and a
 * sticky action bar at the bottom. With the default `top-right` position sonner's 32 px offset sat
 * inside the header, so every confirmation covered the very information the driver needs — and the
 * "Rückgängig" button of a completed stop was in the DOM but not clickable (the report could not
 * reach it, and neither could the e2e click).
 *
 * The driver first got `bottom-center` above its action bar. On the start page, though, the card of
 * the next stop scrolls into that band: after a quick "Geliefert" the toast lay right over the next
 * card's buttons for 10 s, with "Rückgängig" where "Geliefert" had been (multi-day run 2026-11-16).
 * A second quick tap undid the stop just delivered. The driver's toasts therefore sit at the top,
 * just below the sticky header (56 px + 8 px), where the summary is and no action button lives.
 * The office got `top-right`, which covered the page's own buttons in the title row ("Neue
 * Bestellung", the date arrows of Touren); it uses `bottom-right` now, where no page puts an action.
 * The area is derived from the path instead of being passed in, because the host is mounted once in
 * the root layout (a second host would render every toast twice).
 */
/** Below the sticky 56 px driver header, which itself starts below the notch. */
const DRIVER_TOP_OFFSET = "calc(env(safe-area-inset-top, 0px) + 64px)";

/**
 * NUD-212: the day plan has a sticky bar with "Mengen speichern" and "An Fahrer senden" at the
 * bottom (above the menu bar on a phone). A toast at the default place lay on the send button for
 * seconds after every send, so a second "Änderungen senden" hit the toast (day simulation
 * 2026-11-18). There the toasts start above the bar.
 */
const PLAN_BAR_OFFSET = { bottom: "104px" };
const PLAN_BAR_MOBILE_OFFSET = { bottom: "216px" };

export function ToasterArea() {
  const pathname = usePathname();
  const isDriver = pathname?.startsWith("/driver") ?? false;
  return isDriver ? (
    <Toaster
      position="top-center"
      offset={{ top: DRIVER_TOP_OFFSET }}
      mobileOffset={{ top: DRIVER_TOP_OFFSET }}
    />
  ) : pathname?.startsWith("/admin/planning") ? (
    <Toaster
      position="bottom-right"
      offset={PLAN_BAR_OFFSET}
      mobileOffset={PLAN_BAR_MOBILE_OFFSET}
    />
  ) : (
    <Toaster position="bottom-right" />
  );
}
