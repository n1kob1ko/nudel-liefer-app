import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-054. Needs DATABASE_URL and SEED_ADMIN_PASSWORD (seeded admin). The spec inserts its own
// driver, customers and a released tour for TODAY in the factory time zone, opens the admin
// dashboard and the tour page, lets the driver (second browser context, phone viewport) mark stops
// in the real driver UI and checks that the admin screens catch up by themselves (30 s polling,
// default interval, no manual reload). Run it alone: it owns "today's tour" of the database.
test.use({ viewport: { width: 1280, height: 800 } });

const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
const PIN = "482916";
const tag = `prog${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
/**
 * Poll interval the server under test runs with: the default 30 s, or `LIVE_POLL_INTERVAL_MS` when
 * the server was started with a shorter one (faster local runs). A change must show up within one
 * interval (+ 2 s for the request and rendering).
 */
const POLL_MS = Number(process.env.LIVE_POLL_INTERVAL_MS ?? 30_000);
const POLL_LIMIT_MS = POLL_MS + 2_000;

let db: Client;
let userId: string;
let tourId: string;
let today: string;
const stopIds: string[] = [];
const names = [1, 2, 3].map((n) => `Trattoria ${n} ${tag}`);

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const hash = await bcrypt.hash(PIN, 10);
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Progress Driver',now())`,
    [userId, username, hash],
  );
  const kg = `prod-kg-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","weightKgPerUnit","updatedAt") VALUES ($1,$2,$3::jsonb,'KG',1,now())`,
    [
      kg,
      `KG-${tag}`,
      JSON.stringify({
        de: "Spaghetti lose",
        "zh-Hans": "意大利面",
        en: "Spaghetti lose (en)",
        "sr-Latn": "Spaghetti lose (sr)",
        cs: "Spaghetti lose (cs)",
        meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
      }),
    ],
  );
  const settings = (await db.query(`SELECT "timezone" FROM "Settings"`)).rows[0] as {
    timezone: string;
  };
  const tz = settings?.timezone ?? "Europe/Vienna";
  const row = (
    await db.query(
      `SELECT (now() AT TIME ZONE $1)::date AS d, to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS s`,
      [tz],
    )
  ).rows[0] as { d: Date; s: string };
  today = row.s;
  tourId = `tour-${tag}`;
  await db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","releasedAt","updatedAt")
     VALUES ($1,$2,$3,'RELEASED',$4::jsonb,1,now(),now())`,
    [
      tourId,
      row.d,
      userId,
      JSON.stringify({ name: "Depot", address: "Graben 1", lat: 48.2082, lng: 16.3738 }),
    ],
  );
  for (let i = 0; i < 3; i++) {
    const customerId = `cust-${i}-${tag}`;
    await db.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
      [
        customerId,
        `${tag}-${i}`,
        names[i],
        Number((48.2 + i / 100).toFixed(2)),
        Number((16.37 + i / 100).toFixed(2)),
      ],
    );
    const stopId = `stop-${i}-${tag}`;
    stopIds.push(stopId);
    await db.query(
      `INSERT INTO "Stop" ("id","tourId","customerId","sequence","status","etaAt","legDurationS","items")
       VALUES ($1,$2,$3,$4,'PENDING',$5,600,$6::jsonb)`,
      [
        stopId,
        tourId,
        customerId,
        i + 1,
        new Date(row.d.getTime() + (8 + i) * 3600_000),
        JSON.stringify([{ productId: kg, quantity: 1250 + i * 100 }]),
      ],
    );
  }
});

test.afterAll(async () => {
  await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]);
  await db.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
  await db.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
  await db.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`cust-%-${tag}`]);
  await db.query(`DELETE FROM "Product" WHERE "id" LIKE $1`, [`prod-%-${tag}`]);
  await db
    .query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${username}%`])
    .catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
  await db.end();
});

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const stopStatus = async (i: number) =>
  (await db.query(`SELECT "status" FROM "Stop" WHERE "id"=$1`, [stopIds[i]])).rows[0]
    .status as string;
const stubTiles = (page: Page) =>
  page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await visible(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function loginDriver(page: Page) {
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/driver$/);
}

test.describe.configure({ mode: "serial" });

test("a stop the driver completes shows up on the dashboard and the tour page within 30 s", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];

  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dash = await adminCtx.newPage();
  const tours = await adminCtx.newPage();
  for (const p of [dash, tours]) {
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    p.on("pageerror", (e) => errors.push(e.message));
    await stubTiles(p);
  }
  await loginAdmin(dash);
  await tours.goto(`/de/admin/tours?date=${today}`);
  await dash.goto("/de/admin");

  // Start: nothing done, first stop is next, no problems.
  const card = visible(dash, "today-card");
  await expect(card).toBeVisible();
  await expect(visible(dash, "today-progress")).toContainText("0 von 3");
  await expect(visible(dash, "today-next-name")).toHaveText(names[0]);
  await expect(visible(dash, "today-problem-count")).toContainText("Keine Probleme");
  await expect(dash.locator('[data-testid="live-refresh"]')).toHaveAttribute(
    "data-interval-ms",
    String(POLL_MS),
  );
  expect(await noHorizontalScroll(dash)).toBe(true);
  await dash.screenshot({ path: testInfo.outputPath("progress-dashboard-start.png") });
  await expect(visible(tours, "tour-progress-text")).toContainText("0 von 3");
  await expect(visible(tours, "stop-status")).toHaveCount(3);
  await expect(tours.locator('[data-testid="stop-marker"]')).toHaveCount(3);
  await tours.screenshot({ path: testInfo.outputPath("progress-tour-start.png") });

  // The driver delivers stop 1 in the real driver UI (own context, phone viewport).
  const driverCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  });
  const driver = await driverCtx.newPage();
  await stubTiles(driver);
  await loginDriver(driver);
  await driver.goto(`/de/driver/stops/${stopIds[0]}`);
  await visible(driver, "btn-delivered").click();
  // The driver's screen stays on the stop and shows its result (NUD-176).
  await expect(visible(driver, "stop-result")).toHaveAttribute("data-status", "DELIVERED");
  await expect.poll(() => stopStatus(0)).toBe("DELIVERED");
  const deliveredAt = Date.now();

  // Without any reload by the test, both admin pages catch up within the polling limit.
  await expect(visible(dash, "today-progress")).toContainText("1 von 3", {
    timeout: POLL_LIMIT_MS,
  });
  await expect(visible(tours, "tour-progress-text")).toContainText("1 von 3", {
    timeout: POLL_LIMIT_MS,
  });
  const elapsed = Date.now() - deliveredAt;
  expect(elapsed, "admin view caught up within one poll interval").toBeLessThanOrEqual(
    POLL_LIMIT_MS,
  );
  testInfo.annotations.push({ type: "poll-latency-ms", description: String(elapsed) });

  await expect(visible(dash, "today-next-name")).toHaveText(names[1]);
  await expect(dash.getByTestId("today-status")).toHaveText("Unterwegs");
  const row1 = tours.locator(`[data-stop-id="${stopIds[0]}"]`);
  await expect(row1.getByTestId("stop-status")).toHaveAttribute("data-status", "DELIVERED");
  await expect(row1.getByTestId("stop-completed-at")).toContainText(/Erledigt um \d{2}:\d{2}/);
  await expect(
    tours.locator(`[data-stop-id="${stopIds[1]}"]`).getByTestId("stop-next"),
  ).toBeVisible();
  await expect(tours.getByTestId("tour-status")).toHaveText("Unterwegs");

  // Map: coloured markers plus a non-colour cue (check mark badge on delivered).
  const markers = tours.locator('[data-testid="stop-marker"]');
  await expect(markers.nth(0)).toHaveAttribute("data-status", "DELIVERED");
  await expect(markers.nth(1)).toHaveAttribute("data-status", "PENDING");
  await expect(tours.locator(".nudel-stop-badge")).toHaveText(["✓"]);

  // Driver reports a problem on stop 2 and delivers stop 3 straight away: one more wait.
  await driver.goto(`/de/driver/stops/${stopIds[1]}`);
  await visible(driver, "btn-problem").click();
  await driver.getByTestId("reason-NO_PARKING").click();
  await driver.getByTestId("problem-note").fill("Baustelle vor dem Eingang");
  await driver.getByTestId("problem-submit").click();
  await expect.poll(() => stopStatus(1)).toBe("PROBLEM");
  await driver.goto(`/de/driver/stops/${stopIds[2]}`);
  await visible(driver, "btn-delivered").click();
  await expect.poll(() => stopStatus(2)).toBe("DELIVERED");
  const finishedAt = Date.now();

  await expect(visible(dash, "today-all-done")).toBeVisible({ timeout: POLL_LIMIT_MS });
  await expect(visible(tours, "tour-progress-text")).toContainText("3 von 3", {
    timeout: POLL_LIMIT_MS,
  });
  expect(Date.now() - finishedAt).toBeLessThanOrEqual(POLL_LIMIT_MS);
  await expect(visible(dash, "today-problem-count")).toContainText("1 Problem");
  await expect(visible(dash, "today-problem")).toContainText(names[1]);
  await expect(visible(dash, "today-problem")).toContainText("Kein Parkplatz");
  await expect(dash.getByTestId("today-status")).toHaveText("Abgeschlossen");
  await expect(tours.getByTestId("tour-status")).toHaveText("Abgeschlossen");

  const row2 = tours.locator(`[data-stop-id="${stopIds[1]}"]`);
  await expect(row2.getByTestId("stop-status")).toHaveAttribute("data-status", "PROBLEM");
  await expect(row2.getByTestId("stop-problem-reason")).toContainText("Kein Parkplatz");
  await expect(row2.getByTestId("stop-problem-note")).toContainText("Baustelle vor dem Eingang");
  await expect(row2.getByTestId("stop-completed-at")).toBeVisible();
  await expect(markers.nth(1)).toHaveAttribute("data-status", "PROBLEM");
  await expect(markers.nth(2)).toHaveAttribute("data-status", "DELIVERED");
  await expect(tours.locator(".nudel-stop-badge")).toHaveText(["✓", "!", "✓"]);

  expect(await noHorizontalScroll(dash)).toBe(true);
  expect(await noHorizontalScroll(tours)).toBe(true);
  await dash.screenshot({ path: testInfo.outputPath("progress-dashboard-done.png") });
  await tours.screenshot({ path: testInfo.outputPath("progress-tour-done.png"), fullPage: true });

  // English and Chinese UI of the same data: all strings exist, the original (German) driver text stays.
  for (const locale of ["en", "zh-Hans"]) {
    await tours.goto(`/${locale}/admin/tours?date=${today}`);
    await expect(
      tours.locator(`[data-stop-id="${stopIds[1]}"]:visible`).getByTestId("stop-problem-note"),
    ).toContainText("Baustelle vor dem Eingang");
    await expect(visible(tours, "tour-progress-text")).toContainText("3");
    await tours.screenshot({ path: testInfo.outputPath(`progress-tour-${locale}.png`) });
    await dash.goto(`/${locale}/admin`);
    await expect(visible(dash, "today-card")).toBeVisible();
  }
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);

  await driverCtx.close();
  await adminCtx.close();
});

test("a driver cannot open the admin dashboard or tour page", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await loginDriver(page);
  for (const path of ["/de/admin", `/de/admin/tours?date=${today}`]) {
    await page.goto(path);
    await expect(page.getByTestId("today-card")).toHaveCount(0);
    await expect(page.getByTestId("tour-planner")).toHaveCount(0);
    expect(new URL(page.url()).pathname).not.toMatch(/^\/de\/admin/);
  }
  await ctx.close();
});
