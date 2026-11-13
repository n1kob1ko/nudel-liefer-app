import { devices, expect, type Locator, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

import { requireDatabaseUrl, requireFreeDay, requireUsableDatabase } from "./helpers/preconditions";
import { expireSettingsCache } from "./helpers/settings";
import { ensureVehicle } from "./helpers/vehicle";

// NUD-099: an order confirmed after the tour of its day is COMPLETED.
//   complete the tour (driver on a phone) -> the office adds a late order -> the overview, the
//   dashboard and the planning page tell it -> "Folgetour erstellen" -> second tour for the same
//   day (tabs) -> assign + release -> the driver sees the follow-up tour with only the late
//   quantities -> delivers -> both tours are COMPLETED.
//
// It needs a seeded database (the catalog products NUDELN-BEUTEL / NUDELN-KARTON), DATABASE_URL and SEED_ADMIN_PASSWORD.
// The driver only sees TODAY's tour, so the spec owns "today" of the database: it refuses to run
// when another tour exists for today and removes everything it created. Like tour-rerelease.spec
// it confirms the depot pin for its duration (do not run it together with settings.spec.ts or
// tours.spec.ts) and, because the settings are cached by the app, it is best run before other
// specs on the same server or alone. Desktop project only (the driver gets its own phone context).
//
// NUD-162: give it a database of its own (`E2E_DATABASE_URL` + `pnpm e2e:db:reset`,
// docs/e2e-database.md); the precondition messages below name the database and the fix.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
const PIN = "482916";
const PREFIX = "LATE-";

const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const stubTiles = (page: Page) =>
  page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function pickProduct(page: Page, line: Locator, search: string) {
  const combo = line.getByRole("combobox");
  await combo.click();
  await page.getByPlaceholder("Nach Name oder Artikelnummer suchen").fill(search);
  await page.keyboard.press("Enter");
  await expect(combo).toContainText(search.toUpperCase());
  await expect(page.getByPlaceholder("Nach Name oder Artikelnummer suchen")).toHaveCount(0);
}

let db: Client;
let today: string;
let depotWasConfirmed = false;

async function removeSpecData() {
  const ids = (
    await db.query(`SELECT "id" FROM "Customer" WHERE "customerNumber" LIKE $1`, [`${PREFIX}%`])
  ).rows.map((r) => r.id as string);
  if (ids.length > 0) {
    const tourIds = (
      await db.query(`SELECT DISTINCT "tourId" FROM "Stop" WHERE "customerId" = ANY($1)`, [ids])
    ).rows.map((r) => r.tourId as string);
    const stops = `(SELECT "id" FROM "Stop" WHERE "tourId" = ANY($1))`;
    await db.query(`DELETE FROM "StopMutation" WHERE "stopId" IN ${stops}`, [tourIds]);
    await db.query(`DELETE FROM "StopOrder" WHERE "stopId" IN ${stops}`, [tourIds]);
    await db.query(`DELETE FROM "Stop" WHERE "tourId" = ANY($1)`, [tourIds]);
    await db.query(`DELETE FROM "Tour" WHERE "id" = ANY($1)`, [tourIds]);
    await db.query(
      `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "customerId" = ANY($1))`,
      [ids],
    );
    await db.query(`DELETE FROM "Order" WHERE "customerId" = ANY($1)`, [ids]);
    await db.query(`DELETE FROM "Customer" WHERE "id" = ANY($1)`, [ids]);
  }
  await db.query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%late-drv%`]).catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "username" LIKE 'late-drv%'`);
}

test.beforeAll(async () => {
  db = new Client({ connectionString: requireDatabaseUrl() });
  await db.connect();
  // NUD-162: a database that is behind prisma/migrations or not seeded otherwise fails deep in the
  // flow with an unhelpful error (the catalog products would be undefined).
  await requireUsableDatabase(db, { admin: true, skus: ["NUDELN-BEUTEL", "NUDELN-KARTON"] });
  const settings = (await db.query(`SELECT "timezone","depotPinConfirmed" FROM "Settings"`))
    .rows[0] as { timezone: string; depotPinConfirmed: boolean };
  depotWasConfirmed = settings.depotPinConfirmed;
  today = (
    await db.query(`SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS s`, [settings.timezone])
  ).rows[0].s as string;
  await removeSpecData(); // leftovers of a crashed run
  await requireFreeDay(db, today, { today: true });
  await db.query(`UPDATE "Settings" SET "depotPinConfirmed"=true`);
  await expireSettingsCache();
});

test.afterAll(async () => {
  await removeSpecData();
  await db.query(`UPDATE "Settings" SET "depotPinConfirmed"=$1`, [depotWasConfirmed]);
  await expireSettingsCache();
  await db.end();
});

test.describe.configure({ mode: "serial" });

test("late order after a completed tour: banner, follow-up tour, release, driver delivers", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning is a desktop flow");
  test.setTimeout(300_000);
  const tag = `${Date.now() % 1e8}`;
  const username = `late-drv-${tag}`;
  const errors: string[] = [];
  const watch = (page: Page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${page.url()} ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(e.message));
  };

  // ------------------------------------------------------------------ fixture
  const depot = (await db.query(`SELECT "depotLat","depotLng" FROM "Settings"`)).rows[0] as {
    depotLat: number;
    depotLng: number;
  };
  const admin = (await db.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
    .rows[0] as {
    id: string;
  };
  const products = Object.fromEntries(
    (
      await db.query(
        `SELECT "sku","id" FROM "Product" WHERE "sku" IN ('NUDELN-BEUTEL','NUDELN-KARTON')`,
      )
    ).rows.map((r) => [r.sku as string, r.id as string]),
  );
  const driverId = `late-user-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Late Driver',now())`,
    [driverId, username, await bcrypt.hash(PIN, 10)],
  );
  const customers: Record<string, { id: string; number: string; name: string }> = {};
  for (const [key, offset] of [
    ["A", 0.01],
    ["B", 0.02],
    ["C", 0.03],
  ] as const) {
    const id = `late-cust-${key}-${tag}`;
    customers[key] = { id, number: `${PREFIX}${key}-${tag}`, name: `Trattoria ${key} ${tag}` };
    await db.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
      [id, customers[key].number, customers[key].name, depot.depotLat, depot.depotLng + offset],
    );
  }
  const addOrder = async (customerId: string, sku: string, quantity: string) => {
    const id = `late-ord-${customerId}-${Math.random().toString(36).slice(2, 8)}`;
    await db.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
      [id, customerId, today, admin.id],
    );
    await db.query(
      `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,$4)`,
      [`${id}-i`, id, products[sku], quantity],
    );
    return id;
  };
  await addOrder(customers.A.id, "NUDELN-BEUTEL", "2");
  await addOrder(customers.B.id, "NUDELN-KARTON", "4");

  // ------------------------------------------------------------------ admin: first tour
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await adminCtx.newPage();
  watch(adminPage);
  await stubTiles(adminPage);
  await adminPage.goto("/de/login");
  await adminPage.getByLabel("E-Mail").fill("admin@example.com");
  await adminPage.getByLabel("Passwort").fill(adminPassword);
  await visible(adminPage, "login-submit").click();
  await expect(adminPage).toHaveURL(/\/admin$/);

  await adminPage.goto(`/de/admin/tours?date=${today}`);
  await visible(adminPage, "tour-generate").click();
  await expect(adminPage.locator('[data-testid="stop-row"]:visible')).toHaveCount(2);
  await visible(adminPage, "tour-driver").selectOption(driverId);
  await visible(adminPage, "tour-vehicle").selectOption(await ensureVehicle(db));
  await visible(adminPage, "tour-release").click();
  await visible(adminPage, "release-confirm").click();
  await expect(visible(adminPage, "tour-status")).toHaveText("Freigegeben");

  // ------------------------------------------------------------------ driver completes it
  const driverCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const driver = await driverCtx.newPage();
  watch(driver);
  await stubTiles(driver);
  await driver.goto("/de/driver/login");
  const form = driver.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await driver.getByTestId("login-submit").click();
  await expect(driver).toHaveURL(/\/de\/driver$/);
  // A delivered stop offers the way to the next open one; the last one leads back to the tour.
  await visible(driver, "details").click();
  for (let i = 0; i < 2; i++) {
    await expect(driver).toHaveURL(/\/de\/driver\/stops\/[^/]+$/);
    const here = driver.url();
    await visible(driver, "btn-delivered").click();
    // No automatic jump (NUD-176): the result card leads to the next stop or back to the tour.
    await visible(driver, i === 0 ? "next-stop-action" : "back-to-tour-action").click();
    if (i === 0) await expect(driver).not.toHaveURL(here);
  }
  await expect(driver).toHaveURL(/\/de\/driver$/);
  await expect(visible(driver, "all-done")).toBeVisible();
  const firstTour = (
    await db.query(`SELECT "id","status"::text AS status FROM "Tour" WHERE "date"=$1`, [today])
  ).rows as { id: string; status: string }[];
  expect(firstTour).toHaveLength(1);
  expect(firstTour[0].status).toBe("COMPLETED");

  // No late order yet: nothing is reported.
  await adminPage.goto(`/de/admin/tours?date=${today}`);
  await expect(visible(adminPage, "tour-status")).toHaveText("Abgeschlossen");
  await expect(visible(adminPage, "late-orders-banner")).toHaveCount(0);
  // NUD-135: the tour tabs are shown for a single tour too.
  await expect(visible(adminPage, "tour-tab")).toHaveCount(1);

  // ------------------------------------------------------------------ the late order (order form)
  await adminPage.goto("/de/admin/orders/new");
  await adminPage.locator("#order-customer").click();
  await adminPage.getByPlaceholder("Nach Name oder Nummer suchen").fill(customers.A.number);
  await adminPage.getByRole("option", { name: new RegExp(customers.A.number) }).click();
  await adminPage.getByTestId("order-date").fill(today);
  const lines = adminPage.getByTestId("order-line");
  await pickProduct(adminPage, lines.nth(0), "BEUTEL");
  await lines.nth(0).getByTestId("line-quantity").fill("3");
  await adminPage.getByTestId("order-save").click();
  await expect(adminPage).toHaveURL(/\/admin\/orders(\?.*)?$/);
  // A second late order (a customer that was not on the tour), entered directly.
  const lateC = await addOrder(customers.C.id, "NUDELN-KARTON", "5");

  // The overview tells it: notice with the day, badge on the rows.
  await adminPage.goto(`/de/admin/orders?from=${today}&to=${today}`);
  await expect(visible(adminPage, "late-orders-notice")).toBeVisible();
  await expect(visible(adminPage, "late-orders-day")).toHaveAttribute("data-date", today);
  await expect(visible(adminPage, "late-orders-day")).toContainText("2 Bestellungen");
  const lateRows = adminPage.locator('[data-testid="order-row"]:visible', {
    has: adminPage.locator('[data-testid="order-late"]'),
  });
  await expect(lateRows).toHaveCount(2);
  await expect(lateRows.filter({ hasText: customers.A.name })).toHaveCount(1);
  await expect(
    adminPage.locator('[data-testid="order-row"]:visible', {
      has: adminPage.locator('[data-testid="order-in-tour"]'),
    }),
  ).toHaveCount(2); // the two orders on the completed tour are not late
  expect(await noHorizontalScroll(adminPage)).toBe(true);
  await adminPage.screenshot({ path: testInfo.outputPath("nud-099-orders-1280.png") });

  // The dashboard card of today too.
  await adminPage.goto("/de/admin");
  await expect(visible(adminPage, "today-late-orders")).toContainText("2 Bestellungen für heute");

  // ------------------------------------------------------------------ planning page: banner
  await adminPage.goto(`/de/admin/tours?date=${today}`);
  const banner = visible(adminPage, "late-orders-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Nachbestellung nach Abschluss der Tour");
  await expect(banner).toContainText(customers.A.name);
  await expect(banner).toContainText(customers.C.name);
  await expect(visible(adminPage, "tour-status")).toHaveText("Abgeschlossen");
  expect(await noHorizontalScroll(adminPage)).toBe(true);
  await adminPage.screenshot({ path: testInfo.outputPath("nud-099-banner-1280.png") });

  // ------------------------------------------------------------------ follow-up tour
  await visible(adminPage, "create-follow-up").click();
  await expect(adminPage).toHaveURL(/\/admin\/tours\?.*tour=/);
  await expect(visible(adminPage, "tour-tab")).toHaveCount(2);
  const tabs = adminPage.locator('[data-testid="tour-tab"]:visible');
  await expect(tabs.nth(0)).toContainText("Tour 1");
  await expect(tabs.nth(0)).toContainText("Abgeschlossen");
  await expect(tabs.nth(1)).toContainText("Tour 2");
  await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(visible(adminPage, "tour-status")).toHaveText("Optimiert");
  const rows = adminPage.locator('[data-testid="stop-row"]:visible');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: customers.A.name })).toHaveCount(1);
  await expect(rows.filter({ hasText: customers.C.name })).toHaveCount(1);
  await expect(rows.filter({ hasText: customers.B.name })).toHaveCount(0);
  await expect(visible(adminPage, "late-orders-banner")).toHaveCount(0);
  expect(await noHorizontalScroll(adminPage)).toBe(true);
  await adminPage.screenshot({ path: testInfo.outputPath("nud-099-followup-1280.png") });

  // The completed tour is still there and unchanged on its tab.
  await tabs.nth(0).click();
  await expect(visible(adminPage, "tour-status")).toHaveText("Abgeschlossen");
  await expect(adminPage.locator('[data-testid="stop-row"]:visible')).toHaveCount(2);
  await expect(visible(adminPage, "tour-outdated")).toHaveCount(0);
  await expect(visible(adminPage, "tour-changed-banner")).toHaveCount(0);

  // Release the follow-up tour to the same driver.
  await adminPage.locator('[data-testid="tour-tab"]:visible').nth(1).click();
  await expect(visible(adminPage, "tour-status")).toHaveText("Optimiert");
  await visible(adminPage, "tour-driver").selectOption(driverId);
  await visible(adminPage, "tour-vehicle").selectOption(await ensureVehicle(db));
  await visible(adminPage, "tour-release").click();
  await visible(adminPage, "release-confirm").click();
  await expect(visible(adminPage, "tour-status")).toHaveText("Freigegeben");
  await adminPage.screenshot({ path: testInfo.outputPath("nud-099-released-1280.png") });

  // ------------------------------------------------------------------ the driver
  await driver.goto("/de/driver");
  await expect(visible(driver, "today-tour")).toBeVisible();
  await expect(visible(driver, "all-done")).toHaveCount(0);
  await expect(visible(driver, "progress-count")).toContainText("0");
  await driver.screenshot({ path: testInfo.outputPath("nud-099-driver-followup.png") });
  const seen: string[] = [];
  await visible(driver, "details").click();
  for (let i = 0; i < 2; i++) {
    await expect(driver).toHaveURL(/\/de\/driver\/stops\/[^/]+$/);
    const name = (await visible(driver, "stop-name").innerText()).trim();
    seen.push(name);
    const items = driver.locator('[data-testid="stop-item"]:visible');
    await expect(items).toHaveCount(1);
    const quantity = (await items.getByTestId("item-quantity").innerText()).trim();
    // Customer A ordered 2 on the first tour and 3 later: the follow-up stop shows only the 3.
    expect(quantity).toMatch(name === customers.A.name ? /^3(?![.,]?\d)/ : /^5(?![.,]?\d)/);
    const here = driver.url();
    await visible(driver, "btn-delivered").click();
    // No automatic jump (NUD-176): the result card leads to the next stop or back to the tour.
    await visible(driver, i === 0 ? "next-stop-action" : "back-to-tour-action").click();
    if (i === 0) await expect(driver).not.toHaveURL(here);
  }
  await expect(driver).toHaveURL(/\/de\/driver$/);
  expect(seen.map((n) => n.replace(/^\d+\s*/, "")).sort()).toEqual(
    [customers.A.name, customers.C.name].sort(),
  );
  await expect(visible(driver, "all-done")).toBeVisible();

  // ------------------------------------------------------------------ database truth
  const tours = (
    await db.query(
      `SELECT "id","status"::text AS status FROM "Tour" WHERE "date"=$1 ORDER BY "createdAt"`,
      [today],
    )
  ).rows as { id: string; status: string }[];
  expect(tours.map((r) => r.status)).toEqual(["COMPLETED", "COMPLETED"]);
  expect(tours[0].id).toBe(firstTour[0].id);
  const linked = (
    await db.query(
      `SELECT s."tourId", count(*)::int AS n FROM "StopOrder" so JOIN "Stop" s ON s."id"=so."stopId"
       WHERE s."tourId" = ANY($1) GROUP BY s."tourId"`,
      [tours.map((r) => r.id)],
    )
  ).rows as { tourId: string; n: number }[];
  expect(Object.fromEntries(linked.map((r) => [r.tourId, r.n]))).toEqual({
    [tours[0].id]: 2,
    [tours[1].id]: 2,
  });
  expect(lateC).toBeTruthy();
  const audit = (
    await db.query(`SELECT "action" FROM "AuditLog" WHERE "entityId"=$1`, [tours[1].id])
  ).rows.map((r) => r.action as string);
  expect(audit).toContain("tour.followup");

  // Everything is finished: the dashboard shows the follow-up tour, no late order any more.
  await adminPage.goto("/de/admin");
  await expect(visible(adminPage, "today-late-orders")).toHaveCount(0);
  await adminPage.goto(`/de/admin/tours?date=${today}`);
  await expect(visible(adminPage, "late-orders-banner")).toHaveCount(0);
  await expect(adminPage.locator('[data-testid="tour-tab"]:visible')).toHaveCount(2);

  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  await driverCtx.close();
  await adminCtx.close();
  await removeSpecData();
});

test("correction on a delivered stop: the increase goes onto a follow-up tour, the decrease is only reported", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning is a desktop flow");
  test.setTimeout(300_000);
  await removeSpecData(); // leftovers of the test before
  const tag = `${Date.now() % 1e8}`;
  const username = `late-drv-c-${tag}`;
  const errors: string[] = [];
  const watch = (page: Page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${page.url()} ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(e.message));
  };

  // ------------------------------------------------------------------ fixture
  const depot = (await db.query(`SELECT "depotLat","depotLng" FROM "Settings"`)).rows[0] as {
    depotLat: number;
    depotLng: number;
  };
  const admin = (await db.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
    .rows[0] as { id: string };
  const bag = (await db.query(`SELECT "id" FROM "Product" WHERE "sku"='NUDELN-BEUTEL'`)).rows[0]
    .id as string;
  const driverId = `late-user-c-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Late Correction Driver',now())`,
    [driverId, username, await bcrypt.hash(PIN, 10)],
  );
  const customer = async (key: string, offset: number) => {
    const id = `late-cust-${key}-${tag}`;
    await db.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
      [
        id,
        `${PREFIX}${key}-${tag}`,
        `Trattoria ${key} ${tag}`,
        depot.depotLat,
        depot.depotLng + offset,
      ],
    );
    return { id, name: `Trattoria ${key} ${tag}` };
  };
  const more = await customer("M", 0.05); // ordered more after the delivery
  const less = await customer("N", 0.06); // ordered less after the delivery
  const order = async (customerId: string, quantity: string) => {
    const id = `late-ord-${customerId}-c`;
    await db.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
      [id, customerId, today, admin.id],
    );
    await db.query(
      `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,$4)`,
      [`${id}-i`, id, bag, quantity],
    );
    return id;
  };
  const orderMore = await order(more.id, "2");
  const orderLess = await order(less.id, "4");

  // ------------------------------------------------------------------ tour built, released, delivered
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await adminCtx.newPage();
  watch(adminPage);
  await stubTiles(adminPage);
  await adminPage.goto("/de/login");
  await adminPage.getByLabel("E-Mail").fill("admin@example.com");
  await adminPage.getByLabel("Passwort").fill(adminPassword);
  await visible(adminPage, "login-submit").click();
  await expect(adminPage).toHaveURL(/\/admin$/);

  await adminPage.goto(`/de/admin/tours?date=${today}`);
  await visible(adminPage, "tour-generate").click();
  await expect(adminPage.locator('[data-testid="stop-row"]:visible')).toHaveCount(2);
  await visible(adminPage, "tour-driver").selectOption(driverId);
  await visible(adminPage, "tour-vehicle").selectOption(await ensureVehicle(db));
  await visible(adminPage, "tour-release").click();
  await visible(adminPage, "release-confirm").click();
  await expect(visible(adminPage, "tour-status")).toHaveText("Freigegeben");

  const driverCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const driver = await driverCtx.newPage();
  watch(driver);
  await stubTiles(driver);
  await driver.goto("/de/driver/login");
  const loginForm = driver.getByTestId("driver-login-form");
  await loginForm.locator('input[name="username"]').fill(username);
  await loginForm.locator('input[name="pin"]').fill(PIN);
  await driver.getByTestId("login-submit").click();
  await expect(driver).toHaveURL(/\/de\/driver$/);
  await visible(driver, "details").click();
  for (let i = 0; i < 2; i++) {
    await expect(driver).toHaveURL(/\/de\/driver\/stops\/[^/]+$/);
    const here = driver.url();
    await visible(driver, "btn-delivered").click();
    // No automatic jump (NUD-176): the result card leads to the next stop or back to the tour.
    await visible(driver, i === 0 ? "next-stop-action" : "back-to-tour-action").click();
    if (i === 0) await expect(driver).not.toHaveURL(here);
  }
  await expect(visible(driver, "all-done")).toBeVisible();
  const firstTour = (await db.query(`SELECT "id" FROM "Tour" WHERE "date"=$1`, [today]))
    .rows[0] as { id: string };

  // ------------------------------------------------------------------ the orders are changed afterwards
  // NUD-117: 2 -> 5 (increase 3, deliverable) and 4 -> 1 (decrease, only reported).
  await db.query(`UPDATE "OrderItem" SET "quantity"=5 WHERE "orderId"=$1`, [orderMore]);
  await db.query(`UPDATE "OrderItem" SET "quantity"=1 WHERE "orderId"=$1`, [orderLess]);

  // ------------------------------------------------------------------ planning page: conflicts + correction
  await adminPage.goto(`/de/admin/tours?date=${today}`);
  const conflicts = visible(adminPage, "delivered-conflicts");
  await expect(conflicts).toBeVisible();
  await expect(conflicts).toContainText("Bestellungen nach der Lieferung geändert");
  await expect(conflicts).toContainText(more.name);
  await expect(conflicts).toContainText(less.name);
  const offer = visible(adminPage, "correction-offer");
  await expect(offer).toBeVisible();
  // Only the increase is offered, with exactly the difference (3, not 5 and not 2 + 5).
  await expect(offer).toContainText(more.name);
  await expect(offer).not.toContainText(less.name);
  await expect(offer.locator('[data-testid="diff-item"]')).toHaveCount(1);
  await expect(offer.locator('[data-testid="diff-item"]')).toContainText("3");
  const button = visible(adminPage, "create-correction");
  await expect(button).toBeEnabled();
  expect(await noHorizontalScroll(adminPage)).toBe(true);
  await adminPage.screenshot({ path: testInfo.outputPath("nud-117-correction-1280.png") });

  // ------------------------------------------------------------------ one click
  await button.click();
  await expect(adminPage).toHaveURL(/\/admin\/tours\?.*tour=/);
  await expect(visible(adminPage, "tour-tab")).toHaveCount(2);
  const tabs = adminPage.locator('[data-testid="tour-tab"]:visible');
  await expect(tabs.nth(1)).toContainText("Tour 2");
  await expect(visible(adminPage, "tour-status")).toHaveText("Optimiert");
  const rows = adminPage.locator('[data-testid="stop-row"]:visible');
  await expect(rows).toHaveCount(1);
  await expect(rows.filter({ hasText: more.name })).toHaveCount(1);
  // The difference is booked: the conflict is still reported, but nothing is offered twice.
  await expect(visible(adminPage, "delivered-conflicts")).toBeVisible();
  await expect(visible(adminPage, "create-correction")).toHaveCount(0);
  expect(await noHorizontalScroll(adminPage)).toBe(true);
  await adminPage.screenshot({ path: testInfo.outputPath("nud-117-followup-1280.png") });

  // Database truth: one new confirmed order with the difference, the completed tour untouched.
  const tours = (
    await db.query(
      `SELECT "id","status"::text AS status FROM "Tour" WHERE "date"=$1 ORDER BY "createdAt"`,
      [today],
    )
  ).rows as { id: string; status: string }[];
  expect(tours.map((t) => t.status)).toEqual(["COMPLETED", "OPTIMIZED"]);
  const followUp = tours[1]!.id;
  expect(tours[0]!.id).toBe(firstTour.id);
  const stops = (
    await db.query(
      `SELECT s."customerId", s."items"::text AS items,
              (SELECT count(*)::int FROM "StopOrder" so WHERE so."stopId"=s."id") AS links
       FROM "Stop" s WHERE s."tourId"=$1`,
      [followUp],
    )
  ).rows as { customerId: string; items: string; links: number }[];
  expect(stops).toHaveLength(1);
  expect(stops[0]!.customerId).toBe(more.id);
  expect(JSON.parse(stops[0]!.items)).toMatchObject([{ productId: bag, quantity: 3 }]);
  expect(stops[0]!.links).toBe(1);
  const originalStops = (
    await db.query(`SELECT "id","items"::text AS items FROM "Stop" WHERE "tourId"=$1`, [
      firstTour.id,
    ])
  ).rows as { id: string; items: string }[];
  expect(originalStops).toHaveLength(2);
  expect(originalStops.find((s) => JSON.parse(s.items)[0].quantity === 2)).toBeTruthy();
  const correctionOrder = (
    await db.query(
      `SELECT o."id", o."status"::text AS status, i."quantity" AS quantity
       FROM "Order" o JOIN "OrderItem" i ON i."orderId"=o."id"
       WHERE o."customerId"=$1 AND o."id"<>$2`,
      [more.id, orderMore],
    )
  ).rows as { id: string; status: string; quantity: number }[];
  expect(correctionOrder).toHaveLength(1);
  expect(correctionOrder[0]).toMatchObject({ status: "CONFIRMED", quantity: 3 });
  const audit = (
    await db.query(`SELECT "diff"::text AS diff FROM "AuditLog" WHERE "entityId"=$1`, [
      correctionOrder[0]!.id,
    ])
  ).rows as { diff: string }[];
  expect(audit).toHaveLength(1);
  expect(JSON.parse(audit[0]!.diff)).toMatchObject({
    correction: { reason: "delivered_stop_increase" },
  });

  // ------------------------------------------------------------------ release, the driver delivers the difference
  await visible(adminPage, "tour-driver").selectOption(driverId);
  await visible(adminPage, "tour-vehicle").selectOption(await ensureVehicle(db));
  await visible(adminPage, "tour-release").click();
  await visible(adminPage, "release-confirm").click();
  await expect(visible(adminPage, "tour-status")).toHaveText("Freigegeben");

  await driver.goto("/de/driver");
  await expect(visible(driver, "all-done")).toHaveCount(0);
  await visible(driver, "details").click();
  await expect(driver).toHaveURL(/\/de\/driver\/stops\/[^/]+$/);
  await expect(visible(driver, "stop-name")).toContainText(more.name);
  const items = driver.locator('[data-testid="stop-item"]:visible');
  await expect(items).toHaveCount(1);
  expect((await items.getByTestId("item-quantity").innerText()).trim()).toMatch(/^3(?![.,]?\d)/);
  await driver.screenshot({ path: testInfo.outputPath("nud-117-driver.png") });
  await visible(driver, "btn-delivered").click();
  await visible(driver, "back-to-tour-action").click();
  await expect(driver).toHaveURL(/\/de\/driver$/);
  await expect(visible(driver, "all-done")).toBeVisible();

  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  await driverCtx.close();
  await adminCtx.close();
  await removeSpecData();
});

test("all four languages render the late-order banner and the tabs without errors", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning is a desktop flow");
  test.setTimeout(240_000);
  await removeSpecData(); // the previous tests' tours and orders
  const tag = `${Date.now() % 1e8}`;
  const depot = (await db.query(`SELECT "depotLat","depotLng" FROM "Settings"`)).rows[0] as {
    depotLat: number;
    depotLng: number;
  };
  const admin = (await db.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
    .rows[0] as {
    id: string;
  };
  const spag = (await db.query(`SELECT "id" FROM "Product" WHERE "sku"='NUDELN-BEUTEL'`)).rows[0]
    .id as string;
  const id = `late-cust-L-${tag}`;
  await db.query(
    `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
     VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
    [id, `${PREFIX}L-${tag}`, `Trattoria L ${tag}`, depot.depotLat, depot.depotLng + 0.04],
  );
  // A completed tour (built through the UI, completed in the database) plus a late order.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${page.url()} ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await stubTiles(page);
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await visible(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
  const order = async (key: string) => {
    const oid = `late-ord-L-${key}-${tag}`;
    await db.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
      [oid, id, today, admin.id],
    );
    await db.query(
      `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,'2')`,
      [`${oid}-i`, oid, spag],
    );
  };
  await order("1");
  await page.goto(`/de/admin/tours?date=${today}`);
  await visible(page, "tour-generate").click();
  await expect(page.locator('[data-testid="stop-row"]:visible')).toHaveCount(1);
  await db.query(
    `UPDATE "Stop" SET "status"='DELIVERED',"completedAt"=now() WHERE "customerId"=$1`,
    [id],
  );
  await db.query(`UPDATE "Tour" SET "status"='COMPLETED',"completedAt"=now() WHERE "date"=$1`, [
    today,
  ]);
  await order("2");

  for (const locale of ["de", "en", "zh-Hans"]) {
    await page.goto(`/${locale}/admin/tours?date=${today}`);
    await expect(visible(page, "late-orders-banner")).toBeVisible();
    await expect(visible(page, "create-follow-up")).toBeEnabled();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.goto(`/${locale}/admin/orders?from=${today}&to=${today}`);
    await expect(visible(page, "late-orders-notice")).toBeVisible();
    await expect(visible(page, "order-late")).toHaveCount(1);
    await page.goto(`/${locale}/admin`);
    await expect(visible(page, "today-late-orders")).toBeVisible();
    if (locale === "zh-Hans") {
      await page.goto(`/${locale}/admin/tours?date=${today}`);
      await expect(visible(page, "late-orders-banner")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("nud-099-banner-zh-Hans-1280.png") });
    }
  }
  // Create the follow-up in English: the tabs render in every office language.
  await page.goto(`/en/admin/tours?date=${today}`);
  await visible(page, "create-follow-up").click();
  await expect(visible(page, "tour-tab")).toHaveCount(2);
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  await ctx.close();
});
