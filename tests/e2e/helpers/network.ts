import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";

/**
 * `navigator.onLine` and the online / offline events do not follow `context.setOffline()` in every
 * Chromium build (headless Linux without a network manager reports `false` permanently). The app
 * relies on them for its offline bar, so the tests drive them explicitly: the flag lives in
 * localStorage so that it survives navigations (also those answered by the service worker).
 */
export async function installNetworkEmulation(context: BrowserContext) {
  await context.addInitScript(() => {
    const isOnline = () => {
      try {
        return localStorage.getItem("e2e-offline") !== "1";
      } catch {
        return true;
      }
    };
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: isOnline });
  });
}

/** True for the error Playwright throws when the document went away underneath an evaluation. */
function isNavigationAway(error: unknown): boolean {
  return /Execution context was destroyed|Execution context is not available|Cannot find context|Target (page|context|closed)|has been closed/i.test(
    String(error),
  );
}

/**
 * Runs `fn` in the page, surviving the navigation the app performs when the network changes.
 *
 * Both the offline shell (`offline-driver-app.tsx`) and the driver error page (`driver-error.tsx`)
 * call `window.location.reload()` as soon as the connection is back — the right behaviour, but it
 * destroys the execution context in the middle of an `evaluate`. When that happens the work is
 * retried on the replacement document.
 */
async function evaluateAcrossNavigations(
  page: Page,
  fn: (online: boolean) => void,
  online: boolean,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(fn, online);
      return;
    } catch (error) {
      if (!isNavigationAway(error)) throw error;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
  throw new Error("setOnline: the page kept navigating away");
}

/** Resolves true when the browser fires the event itself, false when it stays silent. */
async function watchForEvent(page: Page, name: "online" | "offline"): Promise<boolean> {
  return (
    page
      .evaluate(
        (eventName) =>
          new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 1500);
            window.addEventListener(
              eventName,
              () => {
                clearTimeout(timer);
                resolve(true);
              },
              { once: true },
            );
          }),
        name,
      )
      // The document went away while waiting, which only happens because the event arrived.
      .catch(() => true)
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cuts / restores the network for all requests (pages and service worker) and tells the page.
 *
 * Three things matter here.
 *
 * 1. The flag goes first, because the event makes the app reload and the reloaded document has to
 *    read the new value already — otherwise it still believes it is offline.
 * 2. The event: Chromium fires a real one for `setOffline()`, but not on every platform, so a
 *    synthetic event is only dispatched when the real one never arrives. Dispatching it
 *    unconditionally fires the app's reload twice, and the two navigations cancel each other out so
 *    no `load` ever completes.
 * 3. Coming back online makes the offline shell (`offline-driver-app.tsx`) and the driver error page
 *    (`driver-error.tsx`) reload themselves. That navigation is waited for, otherwise the caller's
 *    next `page.goto` is interrupted by it. Only the online direction reloads.
 */
export async function setOnline(context: BrowserContext, page: Page, online: boolean) {
  await evaluateAcrossNavigations(
    page,
    (on) => localStorage.setItem("e2e-offline", on ? "0" : "1"),
    online,
  );

  const sawRealEvent = watchForEvent(page, online ? "online" : "offline");
  // Registered before the network changes so the reload it causes cannot be missed.
  const navigated = online
    ? page
        .waitForEvent("framenavigated", { timeout: 5_000 })
        .then(() => true)
        .catch(() => false)
    : Promise.resolve(false);

  await context.setOffline(!online);

  if (await sawRealEvent) {
    if (online && (await Promise.race([navigated, sleep(750)]))) {
      await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
    }
    return;
  }

  await evaluateAcrossNavigations(
    page,
    (on) => window.dispatchEvent(new Event(on ? "online" : "offline")),
    online,
  );
}

/**
 * `page.goto` for a connection that is cut: the navigation may be aborted by one the app started
 * itself (Next falls back to a browser navigation when an RSC fetch fails offline, the offline shell
 * reloads), and the page then ends up on the other URL. Retries until the page really is on `url`.
 */
export async function gotoSettled(page: Page, url: string) {
  const wanted = new URL(url, page.url() === "about:blank" ? "http://localhost" : page.url());
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(url).catch(() => {});
    await page.waitForLoadState("load").catch(() => {});
    if (new URL(page.url()).pathname === wanted.pathname) {
      // Give a late competing navigation the chance to show itself before the caller continues.
      await page.waitForTimeout(300);
      if (new URL(page.url()).pathname === wanted.pathname) return;
    }
  }
}

/**
 * Follows a link of the driver app while the connection is cut and waits until the page is on `url`.
 *
 * Offline, Next falls back to a browser navigation (the RSC fetch fails). At that moment Chromium's
 * network emulation sometimes fires a short `online` / `offline` pair (measured 2026-11-13: about
 * one navigation in four). The offline shell reloads on `online`, which is right on a real phone
 * but here aborts the navigation the click started, so the page stays where it was. The click is
 * repeated until the page arrives; the taps made before are in the outbox and survive the reload.
 */
export async function followLinkOffline(page: Page, link: Locator, url: RegExp) {
  await expect(async () => {
    if (!url.test(page.url())) await link.click({ timeout: 3_000 });
    await expect(page).toHaveURL(url, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await page.waitForLoadState("load").catch(() => {});
}
