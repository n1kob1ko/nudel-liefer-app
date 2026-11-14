import { expect, type Locator, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { expireSettingsCache } from "./helpers/settings";
import { ensureVehicle } from "./helpers/vehicle";

// NUD-042. Needs a seeded database (product NUDELN-BEUTEL, demo drivers), DATABASE_URL and
// SEED_ADMIN_PASSWORD in the environment. Desktop only (the planning screen is an admin desktop
// screen). The fixture confirms the depot pin for its duration and restores the old value
// afterwards, so do not run it at the same time as `settings.spec.ts` (that spec expects an
// unconfirmed depot).
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function stubTiles(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
}

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await tid(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return true;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
      .slice(0, 6)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    throw new Error(`overflow: ${wide.join(" | ")}`);
  });

async function fixture() {
  const tag = `e2et${Date.now() % 1e8}`;
  const year = 2100 + Math.floor(Math.random() * 7000);
  const day = `${year}-06-02`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const admin = (await client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
    .rows[0] as { id: string };
  const spag = (await client.query(`SELECT "id" FROM "Product" WHERE "sku"='NUDELN-BEUTEL'`))
    .rows[0].id as string;
  const depot = (
    await client.query(`SELECT "depotLat","depotLng","depotPinConfirmed" FROM "Settings"`)
  ).rows[0] as { depotLat: number; depotLng: number; depotPinConfirmed: boolean };
  const driver = (
    await client.query(`SELECT "id","displayName" FROM "User" WHERE "username"='fahrer-de'`)
  ).rows[0] as { id: string; displayName: string };
  await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=true`);
  await expireSettingsCache();

  // Customers on a line east of the depot: the nearest-neighbour order is A, B, C.
  const customer = async (suffix: string, offset: number, confirmed = true) => {
    const id = `id-${tag}-${suffix}`;
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,$6,now())`,
      [
        id,
        `${tag}-${suffix}`,
        `Trattoria ${suffix} ${tag}`,
        depot.depotLat,
        depot.depotLng + offset,
        confirmed,
      ],
    );
    return { id, name: `Trattoria ${suffix} ${tag}`, number: `${tag}-${suffix}` };
  };
  const a = await customer("A", 0.01);
  const b = await customer("B", 0.02);
  const c = await customer("C", 0.03);
  const noPin = await customer("D", 0.04, false);
  await client.query(`UPDATE "Customer" SET "lat"=NULL, "lng"=NULL WHERE "id"=$1`, [noPin.id]);
  let n = 0;
  const order = async (customerId: string, quantity: string) => {
    const id = `ord-${tag}-${n++}`;
    await client.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
      [id, customerId, day, admin.id],
    );
    await client.query(
      `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,$4)`,
      [`oi-${id}`, id, spag, quantity],
    );
  };
  for (const [cu, q] of [
    [a, "2"],
    [b, "3"],
    [c, "4"],
    [noPin, "1"],
  ] as const) {
    await order(cu.id, q);
  }
  // Customer A has a shop photo (row only; the planning screen just needs the flag).
  await client.query(
    `INSERT INTO "Photo" ("id","customerId","kind","storageKey","width","height","bytes","uploadedById")
     VALUES ($1,$2,'STORE','customers/none.jpg',10,10,10,$3)`,
    [`ph-${tag}`, a.id, admin.id],
  );
  return {
    client,
    tag,
    day,
    a,
    b,
    c,
    noPin,
    driver,
    cleanup: async () => {
      await client.query(
        `DELETE FROM "StopOrder" WHERE "stopId" IN (SELECT s."id" FROM "Stop" s JOIN "Tour" t ON t."id"=s."tourId" WHERE t."date"=$1)`,
        [day],
      );
      await client.query(
        `DELETE FROM "Stop" WHERE "tourId" IN (SELECT "id" FROM "Tour" WHERE "date"=$1)`,
        [day],
      );
      await client.query(`DELETE FROM "Tour" WHERE "date"=$1`, [day]);
      await client.query(`DELETE FROM "Photo" WHERE "customerId" LIKE $1`, [`id-${tag}-%`]);
      await client.query(
        `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "customerId" LIKE $1)`,
        [`id-${tag}-%`],
      );
      await client.query(`DELETE FROM "Order" WHERE "customerId" LIKE $1`, [`id-${tag}-%`]);
      await client.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`id-${tag}-%`]);
      await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=$1`, [depot.depotPinConfirmed]);
      await expireSettingsCache();
      await client.end();
    },
  };
}

const names = (rows: Locator) => rows.locator('[data-testid="stop-name"]').allTextContents();

/** x position of the numbered map marker with the given text. */
async function markerX(page: Page, sequence: number) {
  const box = await page
    .locator('[data-testid="stop-marker"]:visible', { hasText: new RegExp(`^${sequence}$`) })
    .boundingBox();
  if (!box) throw new Error(`marker ${sequence} not found`);
  return box.x;
}

test.describe.configure({ mode: "serial" });

test("tour planning: generate, reorder (drag and buttons), lock, driver, release", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
  test.setTimeout(240_000);
  const f = await fixture();
  try {
    await stubTiles(page);
    await loginAdmin(page);
    await page.goto(`/de/admin/tours?date=${f.day}`);
    await expect(tid(page, "section-title")).toHaveText("Touren");
    await expect(tid(page, "tour-date")).toHaveValue(f.day);

    // No tour yet: warning for the customer without any location, with a link; generate button.
    await expect(tid(page, "empty-state")).toBeVisible();
    const warning = tid(page, "tour-warning");
    await expect(warning).toHaveCount(1);
    await expect(warning.locator("a")).toHaveAttribute("href", `/de/admin/customers/${f.noPin.id}`);
    await tid(page, "tour-generate").click();

    // Generated: 3 stops in nearest-neighbour order, ETAs, item counts, photo flags, approximate badge.
    const rows = page.locator('[data-testid="stop-row"]:visible');
    await expect(rows).toHaveCount(3);
    expect(await names(rows)).toEqual([f.a.name, f.b.name, f.c.name]);
    await expect(tid(page, "tour-status")).toHaveText("Optimiert");
    await expect(tid(page, "tour-approximate")).toBeVisible(); // no ORS key -> local heuristic
    await expect(tid(page, "tour-warning")).toHaveCount(1); // the customer without a location is still reported
    await expect(rows.nth(0).locator('[data-testid="stop-missing-store"]')).toHaveCount(0);
    await expect(rows.nth(0).locator('[data-testid="stop-missing-parking"]')).toHaveCount(1);
    await expect(rows.nth(1).locator('[data-testid="stop-missing-store"]')).toHaveCount(1);
    await expect(rows.nth(0).locator('[data-testid="stop-items"]')).toHaveText("1 Produkt");
    const etasBefore = await rows.locator('[data-testid="stop-eta"]').allTextContents();
    expect(etasBefore.every((e) => /^\d\d:\d\d$/.test(e))).toBe(true);
    expect(etasBefore[0] < etasBefore[1] && etasBefore[1] < etasBefore[2]).toBe(true);
    // Map: three numbered markers, depot marker; A (nearest) is the westernmost = marker 1.
    await expect(page.locator('[data-testid="stop-marker"]:visible')).toHaveCount(3);
    await expect(tid(page, "depot-marker")).toHaveCount(1);
    expect(await markerX(page, 1)).toBeLessThan(await markerX(page, 3));
    await page.screenshot({ path: "test-results/nud-042-planning-1280.png", fullPage: true });
    expect(await noHorizontalScroll(page)).toBe(true);

    // Release needs a driver.
    await expect(tid(page, "tour-release")).toBeDisabled();
    await expect(tid(page, "release-hint")).toBeVisible();

    // Drag the last stop (C) to the first place: list, numbers, ETAs and map numbering follow.
    await rows.nth(2).locator('[data-testid="stop-handle"]').dragTo(rows.nth(0));
    await expect.poll(async () => names(rows)).toEqual([f.c.name, f.a.name, f.b.name]);
    await expect(tid(page, "tour-status")).toBeVisible();
    await expect
      .poll(async () => (await rows.locator('[data-testid="stop-eta"]').allTextContents())[0])
      .not.toBe("Berechnet …");
    const etasDragged = await rows.locator('[data-testid="stop-eta"]').allTextContents();
    expect(etasDragged[0]).not.toBe(etasBefore[0]);
    expect(await rows.locator('[data-testid="stop-number"]').allTextContents()).toEqual([
      "1",
      "2",
      "3",
    ]);
    // C is the easternmost customer and now carries marker 1.
    await expect.poll(async () => (await markerX(page, 1)) > (await markerX(page, 3))).toBe(true);
    const stored = await f.client.query(
      `SELECT c."name", s."sequence" FROM "Stop" s JOIN "Customer" c ON c."id"=s."customerId"
       JOIN "Tour" t ON t."id"=s."tourId" WHERE t."date"=$1 ORDER BY s."sequence"`,
      [f.day],
    );
    expect(stored.rows.map((r) => r.name)).toEqual([f.c.name, f.a.name, f.b.name]);

    // Keyboard / touch alternative: move the first stop down with the button.
    await rows.nth(0).locator('[data-testid="stop-down"]').click();
    await expect.poll(async () => names(rows)).toEqual([f.a.name, f.c.name, f.b.name]);
    await expect(rows.nth(0).locator('[data-testid="stop-up"]')).toBeDisabled();
    await expect(rows.nth(2).locator('[data-testid="stop-down"]')).toBeDisabled();

    // Lock keeps the manual order when the tour is refreshed from the orders.
    await tid(page, "tour-lock").click();
    await expect(tid(page, "tour-locked-badge")).toBeVisible();
    await tid(page, "tour-reoptimize").click();
    await expect(tid(page, "tour-reoptimize")).toBeEnabled();
    await page.reload();
    await expect(rows).toHaveCount(3);
    expect(await names(rows)).toEqual([f.a.name, f.c.name, f.b.name]);
    await tid(page, "tour-lock").click();
    await expect(tid(page, "tour-locked-badge")).toHaveCount(0);
    // Re-optimize replaces the manual order with the optimized one.
    await tid(page, "tour-reoptimize").click();
    await expect.poll(async () => names(rows)).toEqual([f.a.name, f.b.name, f.c.name]);

    // Assign the driver, confirm the release dialog (stop count, total time, driver).
    await tid(page, "tour-driver").selectOption(f.driver.id);
    // Driver alone is not enough (NUD-146): the release also needs a vehicle.
    await expect(tid(page, "tour-release")).toBeDisabled();
    await expect(tid(page, "release-hint")).toContainText("Fahrzeug");
    await tid(page, "tour-vehicle").selectOption(await ensureVehicle(f.client));
    await expect(tid(page, "tour-release")).toBeEnabled();
    await tid(page, "tour-release").click();
    const dialog = tid(page, "release-dialog");
    await expect(dialog).toBeVisible();
    await expect(tid(page, "release-stops")).toHaveText("3 Stopps");
    await expect(tid(page, "release-duration")).toHaveText(/Min\.$/);
    await expect(tid(page, "release-driver")).toHaveText(f.driver.displayName);
    await expect(tid(page, "release-vehicle")).toHaveText("E2E Transporter");
    await expect(tid(page, "release-load")).toHaveText("27 kg von 5.000 kg");
    await expect(tid(page, "release-overload")).toHaveCount(0);
    await page.screenshot({ path: "test-results/nud-042-release-dialog-1280.png" });
    await tid(page, "release-confirm").click();
    await expect(tid(page, "tour-status")).toHaveText("Freigegeben");
    await expect(tid(page, "tour-released-at")).toBeVisible();
    await expect(tid(page, "tour-release")).toHaveCount(0);
    await expect(tid(page, "stop-up")).toHaveCount(0);
    await expect(tid(page, "tour-readonly")).toBeVisible();
    const tour = (
      await f.client.query(`SELECT "status","releasedAt","driverId" FROM "Tour" WHERE "date"=$1`, [
        f.day,
      ])
    ).rows[0];
    expect(tour.status).toBe("RELEASED");
    expect(tour.releasedAt).not.toBeNull();
    expect(tour.driverId).toBe(f.driver.id);
    expect(await noHorizontalScroll(page)).toBe(true);

    // The "in tour" badge of the order overview links to the day plan of that day (NUD-212).
    await page.goto(`/de/admin/orders?from=${f.day}&to=${f.day}`);
    const link = page.locator('[data-testid="order-in-tour-link"]:visible').first();
    await expect(link).toHaveAttribute("href", `/de/admin/planning?date=${f.day}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/de/admin/planning\\?date=${f.day}`));
    // The old tour page stays reachable by its address.
    await page.goto(`/de/admin/tours?date=${f.day}`);
    await expect(tid(page, "tour-status")).toHaveText("Freigegeben");

    // NUD-092: the history lists generate, lock, driver assignment and release (newest first).
    // The redesign collapses the Verlauf above 5 entries (re-design.md §8.4); this spec generates
    // more, so open it before asserting visibility. Attributes/order are read either way.
    const auditToggle = tid(page, "audit-toggle");
    if ((await auditToggle.count()) > 0) await auditToggle.first().click();
    const actionsShown = await tid(page, "audit-entry").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-action")),
    );
    expect(actionsShown[0]).toBe("tour.release");
    for (const action of [
      "tour.generate",
      "tour.lock",
      "tour.assign_driver",
      "tour.assign_vehicle",
      "tour.reorder",
    ]) {
      expect(actionsShown).toContain(action);
    }
    await expect(
      tid(page, "audit-entry").filter({ hasText: f.driver.displayName }).first(),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="audit-entry"][data-action="tour.release"]:visible [data-testid="audit-meta"]',
      ),
    ).toContainText("(Büro)");
    await tid(page, "audit-timeline").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/nud-092-tour-history-1280.png", fullPage: true });
    expect(await noHorizontalScroll(page)).toBe(true);
  } finally {
    await f.cleanup();
  }
});

test("tour planning: anonymous visitors are sent to the login", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
  await page.goto("/de/admin/tours");
  await expect(page).toHaveURL(/\/de\/login/);
});
