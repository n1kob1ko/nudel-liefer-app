import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-080. Needs DATABASE_URL (own driver user) and a PRODUCTION build (`pnpm build && pnpm start`):
// the service worker is only built by `pnpm build` (scripts/build-pwa.ts) and only registered in
// production. Phone viewport.
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `pwa${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const zhUsername = `drz-${tag}`;
const LOCALES = ["de", "en", "sr-Latn", "cs", "zh-Hans"] as const;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

let db: Client;
let userId: string;
let zhUserId: string;

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'PWA Driver',now())`,
    [userId, username, await bcrypt.hash(PIN, 10)],
  );
  // Installed while in Czech; used by the start URL tests (NUD-106).
  zhUserId = `idz-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'cs',true,'PWA Driver ZH',now())`,
    [zhUserId, zhUsername, await bcrypt.hash(PIN, 10)],
  );
});

test.afterAll(async () => {
  await db
    .query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1 OR "key" LIKE $2`, [
      `%${username}%`,
      `%${zhUsername}%`,
    ])
    .catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" IN ($1,$2)`, [userId, zhUserId]);
  await db.end();
});

async function login(page: Page) {
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
}

async function loginZh(page: Page) {
  // The tests switch the language; start every test from the installed state (cs).
  await db.query(`UPDATE "User" SET "locale"='cs' WHERE "id"=$1`, [zhUserId]);
  await page.goto("/cs/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(zhUsername);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/cs\/driver$/);
}

const swControlled = (page: Page) =>
  page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 30_000,
  });

const pngSize = (body: Buffer) => ({ w: body.readUInt32BE(16), h: body.readUInt32BE(20) });

test.describe("manifest, icons and worker are public", () => {
  for (const locale of LOCALES) {
    test(`manifest of ${locale} is valid and reachable without a session`, async ({
      playwright,
      baseURL,
    }) => {
      const anon = await playwright.request.newContext({ baseURL });
      const res = await anon.get(`/${locale}/manifest.webmanifest`, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/manifest+json");
      const m = await res.json();
      // Locale-neutral on purpose (NUD-106): the server redirects to the driver's current language.
      expect(m.start_url).toBe("/driver?source=pwa");
      expect(m.id).toBe("/driver");
      expect(m.scope).toBe("/");
      expect(m.display).toBe("standalone");
      expect(m.lang).toBe(locale);
      expect(m.name).toBeTruthy();
      expect(m.short_name).toBeTruthy();
      expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(new URL(m.start_url, baseURL).pathname.startsWith(m.scope)).toBe(true);
      const sizes = m.icons.map(
        (i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`,
      );
      expect(sizes).toEqual(
        expect.arrayContaining([
          "192x192/any",
          "512x512/any",
          "192x192/maskable",
          "512x512/maskable",
        ]),
      );
      for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
        const r = await anon.get(icon.src, { maxRedirects: 0 });
        expect(r.status(), icon.src).toBe(200);
        expect(r.headers()["content-type"]).toBe("image/png");
        const [w] = icon.sizes.split("x").map(Number);
        expect(pngSize(await r.body())).toEqual({ w, h: w });
      }
      await anon.dispose();
    });
  }

  test("the manifest is localized per locale; service worker and offline page need no session", async ({
    playwright,
    baseURL,
  }) => {
    const anon = await playwright.request.newContext({ baseURL });
    // Redesign RD2: the product name "Routenplanner" is the same in every language, so the
    // localized part of the manifest is its description (and `lang`).
    const descriptions = new Set<string>();
    for (const locale of ["de", "zh-Hans"]) {
      const manifest = await (await anon.get(`/${locale}/manifest.webmanifest`)).json();
      expect(manifest.name).toBe("Routenplanner");
      expect(manifest.lang).toBe(locale);
      descriptions.add(manifest.description);
    }
    expect(descriptions.size).toBe(2);
    const unknown = await anon.get(`/xx/manifest.webmanifest`, { maxRedirects: 0 });
    expect(unknown.status()).toBe(404);
    const sw = await anon.get("/sw.js", { maxRedirects: 0 });
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toContain("javascript");
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    const offline = await anon.get("/offline.html", { maxRedirects: 0 });
    expect(offline.status()).toBe(200);
    await anon.dispose();
  });
});

test("login page links the locale manifest and icons", async ({ page }) => {
  await page.goto("/cs/driver/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/cs/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /apple-touch-icon\.png/,
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#/);
});

test("service worker registers, controls the page and the app is installable", async ({
  page,
  context,
}) => {
  await page.goto("/de/driver/login");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await swControlled(page);
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { scope: r?.scope, active: r?.active?.state, script: r?.active?.scriptURL };
  });
  expect(reg.active).toBe("activated");
  expect(reg.script).toMatch(/\/sw\.js$/);

  // Chromium's own installability check (the criteria Lighthouse uses; Lighthouse itself is not run).
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors).toEqual([]);
  const { url } = (await cdp.send("Page.getAppManifest")) as { url: string; errors: unknown[] };
  expect(url).toMatch(/\/de\/manifest\.webmanifest$/);
});

test("the worker caches only the app shell, never pages or API data", async ({ page }) => {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await swControlled(page);
  // Visit authenticated pages while the worker controls the page.
  await page.goto("/de/driver");
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  await page.goto("/zh-Hans/driver");
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  await page.request.get("/api/health").catch(() => {});

  const urls = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys())
        out.push(
          new URL(req.url).pathname +
            new URL(req.url).search.replace(/[?&]__WB_REVISION__=[\w-]+/, ""),
        );
    }
    return out;
  });
  expect(urls.length).toBeGreaterThan(10);
  expect(urls).toContain("/offline.html");
  expect(urls).toContain("/offline.js"); // NUD-110: the script of the offline page is a file of its own
  // NUD-175: the blocking theme bootstrap of every page must be cached, or an offline reload asks
  // the network for it (QA 2026-10-29, F8).
  expect(urls).toContain("/theme.js");
  for (const u of urls) {
    // NUD-081 adds the public offline shell pages (no personal data) to the precache.
    expect(u, u).toMatch(
      /^(\/_next\/static\/|\/icons\/|\/theme\.js$|\/offline\.(html|js)$|\/(de|en|sr-Latn|cs|zh-Hans)\/driver\/offline-shell$)/,
    );
    expect(u).not.toContain("_rsc");
  }
  // Responses of cached entries are never HTML pages other than the generic offline page.
  const htmlEntries = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        if (res?.headers.get("content-type")?.includes("text/html"))
          out.push(new URL(req.url).pathname);
      }
    }
    return out;
  });
  expect(htmlEntries.sort()).toEqual(
    [
      "/offline.html",
      ...["de", "en", "sr-Latn", "cs", "zh-Hans"].map((l) => `/${l}/driver/offline-shell`),
    ].sort(),
  );
});

test("offline: pages without cached data show the generic offline page in the URL's language", async ({
  page,
  context,
}) => {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await swControlled(page);
  await context.setOffline(true);
  try {
    // Pages that cannot be shown from the offline copy (NUD-081 handles /driver and stops).
    await page.goto("/de/driver/login").catch(() => {});
    await expect(page.locator("h1:visible")).toHaveText("Keine Verbindung");
    await expect(page.locator("body")).not.toContainText("PWA Driver");
    await page.goto("/zh-Hans/driver/login").catch(() => {});
    await expect(page.locator("h1:visible")).toHaveText("没有网络连接");
    await page.screenshot({ path: "test-results/nud080-offline-zh-Hans.png" });
    // The tour list itself is rendered by the offline shell; this driver has no tour today, so it
    // says so and contains no personal data.
    await page.goto("/de/driver").catch(() => {});
    await expect(page.getByTestId("offline-empty")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("PWA Driver");
  } finally {
    await context.setOffline(false);
  }
});

test.describe("start URL of the installed app (NUD-106)", () => {
  test("redirect rules: session locale beats the cookie, no cache, login keeps the cookie locale", async ({
    playwright,
    baseURL,
    page,
    context,
  }) => {
    const anon = await playwright.request.newContext({ baseURL });
    const res = await anon.get("/driver?source=pwa", {
      maxRedirects: 0,
      headers: { "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toMatch(/\/zh-Hans\/driver\?source=pwa$/);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const withCookie = await anon.get("/driver?source=pwa", {
      maxRedirects: 0,
      headers: { Cookie: "NEXT_LOCALE=sr-Latn", "Accept-Language": "de" },
    });
    expect(withCookie.headers()["location"]).toMatch(/\/sr-Latn\/driver\?source=pwa$/);
    await anon.dispose();

    // Not logged in: the launch lands on the driver login in the cookie language.
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "sr-Latn", url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.goto("/driver?source=pwa");
    await expect(page).toHaveURL(/\/sr-Latn\/driver\/login/);
    await expect(page.getByTestId("driver-login-form")).toBeVisible();
  });

  test("a driver installed in cs who switched to German launches into /de/driver", async ({
    page,
  }) => {
    await loginZh(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await swControlled(page);
    // The switcher stores the locale on the user (session token) and in the cookie.
    await page.locator(`[data-testid="language-switcher"]:visible`).selectOption("de");
    await expect(page).toHaveURL(/\/de\/driver$/);

    // "Launch the installed app": a fresh load of the manifest start_url.
    const manifest = await (await page.request.get("/cs/manifest.webmanifest")).json();
    await page.goto(manifest.start_url);
    await expect(page).toHaveURL(/\/de\/driver(\?source=pwa)?$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByTestId("driver-shell")).toBeVisible();

    // And back: switching to Chinese changes the next launch again.
    await page.locator(`[data-testid="language-switcher"]:visible`).selectOption("zh-Hans");
    await expect(page).toHaveURL(/\/zh-Hans\/driver$/);
    await page.goto(manifest.start_url);
    await expect(page).toHaveURL(/\/zh-Hans\/driver(\?source=pwa)?$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");

    // The worker did not store the redirect or the page.
    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys())
          out.push(new URL(req.url).pathname + new URL(req.url).search);
      return out.filter((u) => /^\/(driver|(de|zh-[\w-]+)\/driver\/?(\?.*)?$)/.test(u));
    });
    expect(cached).toEqual([]);
  });

  test("offline launch shows the offline shell in the last-used language", async ({
    page,
    context,
  }) => {
    await loginZh(page);
    await page.locator(`[data-testid="language-switcher"]:visible`).selectOption("de");
    await expect(page).toHaveURL(/\/de\/driver$/);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await swControlled(page);
    await context.setOffline(true);
    try {
      await page.goto("/driver?source=pwa").catch(() => {});
      await expect(page).toHaveURL(/\/de\/driver(\?source=pwa)?$/);
      await expect(page.getByTestId("offline-empty")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
      await expect(page.locator("body")).not.toContainText("PWA Driver");
    } finally {
      await context.setOffline(false);
    }
    // Back online switch to Serbian; the next offline launch follows. The offline shell reloads
    // itself when the connection returns, which can abort this navigation: retry it.
    await expect(async () => {
      await page.goto("/de/driver");
    }).toPass({ timeout: 20_000 });
    await page.locator(`[data-testid="language-switcher"]:visible`).selectOption("sr-Latn");
    await expect(page).toHaveURL(/\/sr-Latn\/driver$/);
    await context.setOffline(true);
    try {
      await page.goto("/driver?source=pwa").catch(() => {});
      await expect(page).toHaveURL(/\/sr-Latn\/driver(\?source=pwa)?$/);
      await expect(page.getByTestId("offline-empty")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "sr-Latn");
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe("install hint on iOS", () => {
  test.use({ userAgent: IPHONE_UA });

  for (const locale of LOCALES) {
    test(`shows the Share -> Add to Home Screen overlay (${locale})`, async ({ page }) => {
      await login(page);
      await page.goto(`/${locale}/driver`);
      const hint = page.getByTestId("install-hint");
      await expect(hint).toBeVisible();
      await expect(hint).toHaveAttribute("data-kind", "ios");
      await expect(page.getByTestId("install-button")).toHaveCount(0);
      await page.getByTestId("install-how").click();
      const overlay = page.getByTestId("install-overlay");
      await expect(overlay).toBeVisible();
      await expect(overlay.getByTestId("install-illustration")).toBeVisible();
      await expect(overlay.getByRole("listitem")).toHaveCount(3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: `test-results/nud080-ios-overlay-${locale}.png` });
      await page.getByTestId("install-overlay-done").click();
      await expect(overlay).toHaveCount(0);
      await expect(hint).toHaveCount(0);
    });
  }

  test("dismissal is remembered across reloads; hint buttons are >= 48 px", async ({ page }) => {
    await login(page);
    await page.goto("/de/driver");
    await expect(page.getByTestId("install-hint")).toBeVisible();
    for (const id of ["install-how", "install-dismiss"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
    await page.screenshot({ path: "test-results/nud080-ios-hint-de.png" });
    await page.getByTestId("install-dismiss").click();
    await expect(page.getByTestId("install-hint")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("driver-shell")).toBeVisible();
    await expect(page.getByTestId("install-hint")).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("nudel.driver.installHint.dismissed")),
    ).toBe("1");
  });

  test("works when localStorage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("blocked");
        },
      });
    });
    await login(page);
    await page.goto("/de/driver");
    await expect(page.getByTestId("install-hint")).toBeVisible();
    await page.getByTestId("install-dismiss").click();
    await expect(page.getByTestId("install-hint")).toHaveCount(0);
  });
});

test("Android: install button follows beforeinstallprompt", async ({ page }) => {
  await login(page);
  await page.goto("/de/driver");
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  await expect(page.getByTestId("install-hint")).toHaveCount(0); // nothing to offer yet
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        (window as unknown as { __prompted: number }).__prompted =
          ((window as unknown as { __prompted?: number }).__prompted ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
  });
  const hint = page.getByTestId("install-hint");
  await expect(hint).toHaveAttribute("data-kind", "android");
  await page.screenshot({ path: "test-results/nud080-android-hint-de.png" });
  await page.getByTestId("install-button").click();
  await expect(hint).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(
    1,
  );
});
