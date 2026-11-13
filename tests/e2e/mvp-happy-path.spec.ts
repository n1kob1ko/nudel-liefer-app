import { devices, expect, type Locator, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { demoSeedMissingMessage } from "../../scripts/lib/e2e-database";
import { requireDatabaseUrl, requireFreeDay, requireUsableDatabase } from "./helpers/preconditions";
import { ensureVehicle } from "./helpers/vehicle";

// NUD-060, the M1 end-to-end happy path:
//   admin creates a customer + an order for TODAY -> generates the tour -> releases it to a driver
//   -> the driver (own phone context, one of the four UI languages) opens the tour, opens the stop,
//   sees the right quantities and marks it delivered -> the admin sees the status.
//
// Preconditions (checked up front with a clear message): `pnpm db:seed --demo` (or `--demo
// --no-photos`) has run, i.e. the depot pin is already confirmed and the demo drivers + products
// exist. The spec never edits the settings (no dependence on the cached Settings row). It uses
// the Fake geocoder (no ORS_API_KEY), stubbed map tiles, DATABASE_URL and SEED_ADMIN_PASSWORD.
//
// It owns "today's tour" of the database: run it on its own, not together with the specs that
// also create a tour for today (admin-progress, driver-*). It removes everything it created.
// NUD-162: give it a database of its own (`E2E_DATABASE_URL` + `pnpm e2e:db:reset`,
// docs/e2e-database.md); it needs one without a tour for today.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
const driverPin = process.env.SEED_DRIVER_PIN ?? "123456";

const DRIVER_LOCALES = [
  { locale: "zh-Hans", username: "driver-hans" },
  { locale: "en", username: "driver-en" },
  { locale: "sr-Latn", username: "driver-sr" },
  { locale: "cs", username: "driver-cs" },
  { locale: "de", username: "fahrer-de" },
] as const;

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
  // The picker closes with an animation; a second open picker would make the placeholder ambiguous.
  await expect(page.getByPlaceholder("Nach Name oder Artikelnummer suchen")).toHaveCount(0);
}

let db: Client;
let today: string;

/** Everything the spec creates carries this customer-number prefix. */
const PREFIX = "MVP-";

async function removeSpecData() {
  const ids = (
    await db.query(`SELECT "id" FROM "Customer" WHERE "customerNumber" LIKE $1`, [`${PREFIX}%`])
  ).rows.map((r) => r.id as string);
  if (ids.length === 0) return;
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

test.beforeAll(async () => {
  db = new Client({ connectionString: requireDatabaseUrl() });
  await db.connect();
  // NUD-162: name the database and the command when the seed is missing or the schema is behind.
  const database = await requireUsableDatabase(db, {
    admin: true,
    skus: ["NUDELN-BEUTEL", "NUDELN-KARTON"],
  });
  const settings = (
    await db.query(`SELECT "timezone","depotPinConfirmed" FROM "Settings" WHERE "id"=1`)
  ).rows[0] as { timezone: string; depotPinConfirmed: boolean } | undefined;
  if (!settings?.depotPinConfirmed) {
    throw new Error(demoSeedMissingMessage({ database, reason: "the depot pin is not confirmed" }));
  }
  const demoDrivers = await db.query<{ username: string }>(
    `SELECT "username" FROM "User" WHERE "username" = ANY($1) AND "active"`,
    [DRIVER_LOCALES.map((entry) => entry.username)],
  );
  const present = new Set(demoDrivers.rows.map((row) => row.username));
  const missingDrivers = DRIVER_LOCALES.map((entry) => entry.username).filter(
    (u) => !present.has(u),
  );
  if (missingDrivers.length > 0) {
    throw new Error(
      demoSeedMissingMessage({
        database,
        reason: `the demo drivers are missing (${missingDrivers.join(", ")})`,
      }),
    );
  }
  today = (
    await db.query(`SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS s`, [settings.timezone])
  ).rows[0].s as string;
  await removeSpecData(); // leftovers of a crashed run
  await requireFreeDay(db, today, { today: true });
});

test.afterAll(async () => {
  await removeSpecData();
  await db.end();
});

test.describe.configure({ mode: "serial" });

for (const { locale, username } of DRIVER_LOCALES) {
  test(`MVP happy path: office to delivered, driver in ${locale}`, async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "the admin part is a desktop flow; the driver gets its own phone context",
    );
    test.setTimeout(240_000);
    const tag = `${Date.now() % 1e8}`;
    const number = `${PREFIX}${tag}`;
    const name = `Trattoria Happy Path ${tag}`;
    const errors: string[] = [];
    const watch = (page: Page) => {
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`${page.url()} ${m.text()}`);
      });
      page.on("pageerror", (e) => errors.push(e.message));
    };

    const driverRow = (
      await db.query(
        `SELECT "id","displayName","locale"::text AS locale FROM "User" WHERE "username"=$1 AND "active"`,
        [username],
      )
    ).rows[0] as { id: string; displayName: string; locale: string } | undefined;
    expect(driverRow, `demo driver ${username} exists (pnpm db:seed)`).toBeDefined();
    expect(driverRow!.locale).toBe(locale);
    const products = (
      await db.query(
        `SELECT "sku","name" FROM "Product" WHERE "sku" IN ('NUDELN-BEUTEL','NUDELN-KARTON')`,
      )
    ).rows as { sku: string; name: Record<string, string> }[];
    expect(products).toHaveLength(2);
    expect(products.every((p) => p.name[locale])).toBe(true);

    // ---------------------------------------------------------------- admin: customer + order
    const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const admin = await adminCtx.newPage();
    watch(admin);
    await stubTiles(admin);
    await admin.goto("/de/login");
    await admin.getByLabel("E-Mail").fill("admin@example.com");
    await admin.getByLabel("Passwort").fill(adminPassword);
    await visible(admin, "login-submit").click();
    await expect(admin).toHaveURL(/\/admin$/);

    await admin.goto("/de/admin/customers/new");
    await admin.getByTestId("customer-number").fill(number);
    await admin.getByTestId("customer-name").fill(name);
    await admin.getByTestId("customer-street").fill("Graben 21");
    await admin.getByTestId("customer-postal").fill("1010");
    await admin.getByTestId("customer-city").fill("Wien");
    await admin.getByTestId("customer-find").click();
    await expect(admin.getByTestId("candidate")).toHaveCount(1);
    await admin.getByTestId("candidate").first().click();
    await expect(admin.getByTestId("pin-picker").locator(".leaflet-marker-icon")).toHaveCount(1);
    await expect(admin.getByTestId("pin-confirm")).toHaveCount(0);
    await admin.getByTestId("customer-save").click();
    await expect(admin).toHaveURL(/\/de\/admin\/customers\/[^/]+$/);
    await expect(admin.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(admin.getByTestId("detail-pin")).toContainText(/\d+\.\d+, \d+\.\d+/);
    await expect(admin.getByTestId("flag-parking-missing")).toBeVisible();

    await admin.goto("/de/admin/orders/new");
    await admin.locator("#order-customer").click();
    await admin.getByPlaceholder("Nach Name oder Nummer suchen").fill(number);
    await admin.getByRole("option", { name: new RegExp(number) }).click();
    await admin.getByTestId("order-date").fill(today);
    const lines = admin.getByTestId("order-line");
    await pickProduct(admin, lines.nth(0), "BEUTEL");
    await lines.nth(0).getByTestId("line-quantity").fill("3");
    await lines.nth(0).getByTestId("line-quantity").press("Enter");
    await expect(lines).toHaveCount(2);
    await pickProduct(admin, lines.nth(1), "KARTON");
    await lines.nth(1).getByTestId("line-quantity").fill("4");
    await admin.getByTestId("order-save").click();
    await expect(admin).toHaveURL(/\/admin\/orders(\?.*)?$/);
    const stored = await db.query(
      `SELECT o."status"::text AS status, to_char(o."deliveryDate",'YYYY-MM-DD') AS date,
              array_agg(p."sku" || '=' || i."quantity"::text ORDER BY p."sku") AS items
       FROM "Order" o JOIN "OrderItem" i ON i."orderId"=o."id" JOIN "Product" p ON p."id"=i."productId"
       JOIN "Customer" c ON c."id"=o."customerId" WHERE c."customerNumber"=$1 GROUP BY o."id"`,
      [number],
    );
    expect(stored.rows).toEqual([
      { status: "CONFIRMED", date: today, items: ["NUDELN-BEUTEL=3", "NUDELN-KARTON=4"] },
    ]);

    // ---------------------------------------------------------------- admin: generate + release
    await admin.goto(`/de/admin/tours?date=${today}`);
    await expect(visible(admin, "tour-date")).toHaveValue(today);
    await expect(visible(admin, "tour-warning")).toHaveCount(0);
    await visible(admin, "tour-generate").click();
    const rows = admin.locator('[data-testid="stop-row"]:visible');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("stop-name")).toHaveText(name);
    // No Parkplatz yet: routed to the address point, with a non-blocking flag.
    await expect(rows.first().getByTestId("stop-missing-parking-spot")).toContainText(
      "Parkplatz fehlt",
    );
    await expect(rows.first().getByTestId("stop-items")).toHaveText("2 Produkte");
    await expect(visible(admin, "tour-status")).toHaveText("Optimiert");
    await expect(visible(admin, "tour-release")).toBeDisabled();
    await visible(admin, "tour-driver").selectOption(driverRow!.id);
    // Release needs a driver and a vehicle (NUD-146).
    await expect(visible(admin, "tour-release")).toBeDisabled();
    await expect(visible(admin, "release-hint")).toContainText("Fahrzeug");
    await visible(admin, "tour-vehicle").selectOption(await ensureVehicle(db));
    await expect(visible(admin, "tour-release")).toBeEnabled();
    await visible(admin, "tour-release").click();
    await expect(visible(admin, "release-dialog")).toBeVisible();
    await expect(visible(admin, "release-stops")).toHaveText("1 Stopp");
    await expect(visible(admin, "release-driver")).toHaveText(driverRow!.displayName);
    await visible(admin, "release-confirm").click();
    await expect(visible(admin, "tour-status")).toHaveText("Freigegeben");
    expect(await noHorizontalScroll(admin)).toBe(true);
    await admin.screenshot({ path: testInfo.outputPath(`mvp-released-${locale}.png`) });

    // ---------------------------------------------------------------- driver on a phone
    const driverCtx = await browser.newContext({ ...devices["Pixel 7"] });
    const driver = await driverCtx.newPage();
    watch(driver);
    await stubTiles(driver);
    await driver.goto(`/${locale}/driver/login`);
    await expect(driver.locator("html")).toHaveAttribute("lang", locale);
    const form = driver.getByTestId("driver-login-form");
    await form.locator('input[name="username"]').fill(username);
    await form.locator('input[name="pin"]').fill(driverPin);
    await driver.getByTestId("login-submit").click();
    await expect(driver).toHaveURL(new RegExp(`/${locale}/driver$`));
    await expect(driver.locator("html")).toHaveAttribute("lang", locale);

    // Today's tour: one stop, the customer, the total shown as a number (3 Sackerl + 4 Kiste are different
    // products, so the list shows the number of varieties, not one summed quantity).
    await expect(visible(driver, "today-tour")).toBeVisible();
    await expect(visible(driver, "next-stop-name")).toHaveText(name);
    await expect(visible(driver, "next-stop-address")).toContainText("Graben 21");
    expect(await noHorizontalScroll(driver)).toBe(true);
    await driver.screenshot({ path: testInfo.outputPath(`mvp-driver-tour-${locale}.png`) });

    // Open the stop: both products with the exact whole-number quantities.
    await visible(driver, "details").click();
    await expect(driver).toHaveURL(new RegExp(`/${locale}/driver/stops/[^/]+$`));
    await expect(visible(driver, "stop-detail")).toContainText(name);
    const items = driver.locator('[data-testid="stop-item"]:visible');
    await expect(items).toHaveCount(2);
    // Both products are called "Nudeln" (Sackerl and Kiste), so read the quantities by position.
    const quantities = (await items.getByTestId("item-quantity").allInnerTexts()).map((t) =>
      t.trim(),
    );
    expect(quantities.some((q) => /^3(?!\d)/.test(q))).toBe(true);
    expect(quantities.some((q) => /^4(?!\d)/.test(q))).toBe(true);
    expect(await noHorizontalScroll(driver)).toBe(true);
    await driver.screenshot({ path: testInfo.outputPath(`mvp-driver-stop-${locale}.png`) });

    // Deliver: the stop shows its result (no automatic jump, NUD-176) and leads back to the tour.
    await visible(driver, "btn-delivered").click();
    await expect(visible(driver, "stop-result")).toHaveAttribute("data-status", "DELIVERED");
    await visible(driver, "back-to-tour-action").click();
    await expect(driver).toHaveURL(new RegExp(`/${locale}/driver$`));
    await expect(visible(driver, "all-done")).toBeVisible();
    await driver.screenshot({ path: testInfo.outputPath(`mvp-driver-done-${locale}.png`) });
    const dbState = (
      await db.query(
        `SELECT s."status"::text AS stop, t."status"::text AS tour FROM "Stop" s
         JOIN "Tour" t ON t."id"=s."tourId" JOIN "Customer" c ON c."id"=s."customerId"
         WHERE c."customerNumber"=$1`,
        [number],
      )
    ).rows;
    expect(dbState).toEqual([{ stop: "DELIVERED", tour: "COMPLETED" }]);

    // ---------------------------------------------------------------- admin sees the status
    await admin.goto("/de/admin");
    await expect(visible(admin, "today-progress")).toContainText("1 von 1");
    await expect(admin.getByTestId("today-status")).toHaveText("Abgeschlossen");
    await expect(visible(admin, "today-all-done")).toBeVisible();
    await admin.goto(`/de/admin/tours?date=${today}`);
    await expect(visible(admin, "tour-status")).toHaveText("Abgeschlossen");
    await expect(visible(admin, "tour-progress-text")).toContainText("1 von 1");
    const adminStop = admin.locator('[data-testid="stop-row"]:visible');
    await expect(adminStop.getByTestId("stop-status")).toHaveAttribute("data-status", "DELIVERED");
    await expect(adminStop.getByTestId("stop-completed-at")).toContainText(
      /Erledigt um \d{2}:\d{2}/,
    );
    await admin.screenshot({ path: testInfo.outputPath(`mvp-admin-done-${locale}.png`) });

    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    await driverCtx.close();
    await adminCtx.close();
    await removeSpecData();
  });
}

test("demo data: the seeded customers show their generated photos", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin screen");
  const demo = (
    await db.query(
      `SELECT c."id", (SELECT count(*) FROM "Photo" p WHERE p."customerId"=c."id" AND p."isCurrent") AS photos
       FROM "Customer" c WHERE c."customerNumber"='D-001'`,
    )
  ).rows[0] as { id: string; photos: string } | undefined;
  expect(demo, "demo customer D-001 exists (pnpm db:seed --demo)").toBeDefined();
  test.skip(Number(demo!.photos) === 0, "demo seeded with --no-photos (CI): no photos to check");
  await stubTiles(page);
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await visible(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/de/admin/customers/${demo!.id}`);
  await expect(page.getByTestId("flag-photos-missing")).toHaveCount(0);
  for (const slot of ["photo-slot-store", "photo-slot-parking"]) {
    const img = page.getByTestId(slot).locator("img");
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBe(800);
  }
});
