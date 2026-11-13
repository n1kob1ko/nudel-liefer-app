import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { expireSettingsCache } from "./helpers/settings";
import { ensureVehicle } from "./helpers/vehicle";

// NUD-146. Needs a seeded database (products NUDELN-BEUTEL / NUDELN-KARTON, demo drivers),
// DATABASE_URL and SEED_ADMIN_PASSWORD. Desktop only: admin screens. The load scenario confirms
// the depot pin for its duration and restores it afterwards (do not run it at the same time as
// `settings.spec.ts`).
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function loginAdmin(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await tid(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe.configure({ mode: "serial" });

test("Fahrzeuge: create, edit, validate, deactivate and reactivate", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin screens are desktop screens");
  test.setTimeout(120_000);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const name = `E2E Sprinter ${Date.now() % 1e7}`;
  try {
    await loginAdmin(page);
    await page.goto("/de/admin/vehicles");
    await expect(tid(page, "section-title")).toHaveText("Fahrzeuge");
    // The nav entry sits under Stammdaten.
    await expect(
      page.locator('[data-testid="admin-nav"]:visible a[href$="/admin/vehicles"]'),
    ).toHaveAttribute("aria-current", "page");

    // Validation: capacity must be a whole number of kg.
    await tid(page, "new-vehicle").click();
    await tid(page, "vehicle-name-input").fill(name);
    await tid(page, "vehicle-capacity-input").fill("12,5");
    await tid(page, "vehicle-save").click();
    await expect(tid(page, "vehicle-form-error")).toHaveAttribute("data-code", "capacityInvalid");
    await tid(page, "vehicle-capacity-input").fill("0");
    await tid(page, "vehicle-save").click();
    await expect(tid(page, "vehicle-form-error")).toHaveAttribute("data-code", "capacityInvalid");

    // Create.
    await tid(page, "vehicle-capacity-input").fill("800");
    await tid(page, "vehicle-plate-input").fill("W-1 E2E");
    await page.screenshot({ path: testInfo.outputPath("nud-146-vehicle-form-1280.png") });
    await tid(page, "vehicle-save").click();
    const row = page.locator('[data-testid="vehicle-row"]:visible', { hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("vehicle-capacity")).toHaveText("800 kg");
    await expect(row).toContainText("W-1 E2E");

    // The same name again is refused.
    await tid(page, "new-vehicle").click();
    await tid(page, "vehicle-name-input").fill(name.toLowerCase());
    await tid(page, "vehicle-capacity-input").fill("100");
    await tid(page, "vehicle-save").click();
    await expect(tid(page, "vehicle-form-error")).toHaveAttribute("data-code", "nameTaken");
    await page.keyboard.press("Escape");

    // Edit.
    await row.getByTestId("vehicle-edit").click();
    await expect(tid(page, "vehicle-capacity-input")).toHaveValue("800");
    await tid(page, "vehicle-capacity-input").fill("950");
    await tid(page, "vehicle-save").click();
    await expect(row.getByTestId("vehicle-capacity")).toHaveText("950 kg");
    const stored = (
      await client.query(`SELECT "capacityKg","active" FROM "Vehicle" WHERE "name"=$1`, [name])
    ).rows[0] as { capacityKg: number; active: boolean };
    expect(stored).toMatchObject({ capacityKg: 950, active: true });

    // Deactivate (soft delete, confirmed) and reactivate.
    await row.getByTestId("vehicle-status").click();
    await tid(page, "confirm-submit").click();
    await expect(row.getByTestId("status-inactive")).toBeVisible();
    expect(
      (await client.query(`SELECT "active" FROM "Vehicle" WHERE "name"=$1`, [name])).rows[0].active,
    ).toBe(false);
    await row.getByTestId("vehicle-status").click();
    await expect(row.getByTestId("status-active")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("nud-146-vehicles-1280.png"),
      fullPage: true,
    });
    expect(await noHorizontalScroll(page)).toBe(true);

    // Every change is in the audit log with the admin as actor.
    const actions = (
      await client.query(
        `SELECT a."action" FROM "AuditLog" a JOIN "Vehicle" v ON v."id"=a."entityId" WHERE v."name"=$1 ORDER BY a."createdAt"`,
        [name],
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual([
      "vehicle.create",
      "vehicle.update",
      "vehicle.deactivate",
      "vehicle.activate",
    ]);
  } finally {
    await client.query(`UPDATE "Vehicle" SET "active"=false WHERE "name"=$1`, [name]);
    await client.end();
  }
});

test("Tour load: red above the capacity, release only with the explicit override", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
  test.setTimeout(240_000);
  const tag = `e2ev${Date.now() % 1e8}`;
  const day = `${2100 + Math.floor(Math.random() * 7000)}-06-02`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const admin = (await client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
    .rows[0] as { id: string };
  const karton = (await client.query(`SELECT "id" FROM "Product" WHERE "sku"='NUDELN-KARTON'`))
    .rows[0].id as string;
  const depot = (
    await client.query(`SELECT "depotLat","depotLng","depotPinConfirmed" FROM "Settings"`)
  ).rows[0] as { depotLat: number; depotLng: number; depotPinConfirmed: boolean };
  const driver = (
    await client.query(`SELECT "id","displayName" FROM "User" WHERE "username"='fahrer-de'`)
  ).rows[0] as { id: string; displayName: string };
  await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=true`);
  await expireSettingsCache();
  const big = await ensureVehicle(client, "E2E Transporter", 5000);
  const small = await ensureVehicle(client, "E2E Kleinbus", 50);
  try {
    // Three customers with two Kiste (10 kg each) = 60 kg on the tour.
    for (const [index, suffix] of ["A", "B", "C"].entries()) {
      const customerId = `id-${tag}-${suffix}`;
      await client.query(
        `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
         VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
        [
          customerId,
          `${tag}-${suffix}`,
          `Trattoria ${suffix} ${tag}`,
          depot.depotLat,
          depot.depotLng + 0.01 * (index + 1),
        ],
      );
      const orderId = `ord-${tag}-${suffix}`;
      await client.query(
        `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
         VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
        [orderId, customerId, day, admin.id],
      );
      await client.query(
        `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,2)`,
        [`oi-${orderId}`, orderId, karton],
      );
    }

    await loginAdmin(page);
    await page.goto(`/de/admin/tours?date=${day}`);
    await tid(page, "tour-generate").click();
    await expect(page.locator('[data-testid="stop-row"]:visible')).toHaveCount(3);

    // Without a vehicle only the load is shown.
    await expect(tid(page, "tour-load")).toHaveAttribute("data-state", "none");
    await expect(tid(page, "tour-load-text")).toContainText("60 kg");

    // Roomy vehicle: fine, with the utilization.
    await tid(page, "tour-vehicle").selectOption(big);
    await expect(tid(page, "tour-load")).toHaveAttribute("data-state", "ok");
    await expect(tid(page, "tour-load-text")).toHaveText("60 kg von 5.000 kg");
    await expect(tid(page, "tour-load-percent")).toHaveText("Auslastung 1 %");
    await expect(tid(page, "tour-load-over")).toHaveCount(0);

    // Small vehicle: red, with the text.
    await tid(page, "tour-vehicle").selectOption(small);
    await expect(tid(page, "tour-load")).toHaveAttribute("data-state", "over");
    await expect(tid(page, "tour-load-over")).toHaveText("Überladen um 10 kg");
    await expect(tid(page, "tour-load-text")).toHaveText("60 kg von 50 kg");
    await tid(page, "tour-driver").selectOption(driver.id);
    await expect(tid(page, "tour-release")).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("nud-146-overload-1280.png"),
      fullPage: true,
    });
    expect(await noHorizontalScroll(page)).toBe(true);

    // The release dialog says so and only goes on with the explicit confirmation.
    await tid(page, "tour-release").click();
    await expect(tid(page, "release-vehicle")).toHaveText("E2E Kleinbus");
    await expect(tid(page, "release-load")).toHaveText("60 kg von 50 kg");
    await expect(tid(page, "release-overload")).toBeVisible();
    await expect(tid(page, "release-confirm")).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("nud-146-release-overload-1280.png") });
    await tid(page, "release-overload-confirm").check();
    await expect(tid(page, "release-confirm")).toBeEnabled();
    await tid(page, "release-confirm").click();
    await expect(tid(page, "tour-status")).toHaveText("Freigegeben");
    await expect(tid(page, "tour-load")).toHaveAttribute("data-state", "over");

    // The override is in the audit log and in the history of the tour.
    const release = (
      await client.query(
        `SELECT a."diff" FROM "AuditLog" a JOIN "Tour" t ON t."id"=a."entityId"
         WHERE t."date"=$1 AND a."action"='tour.release'`,
        [day],
      )
    ).rows[0].diff as Record<string, unknown>;
    expect(release).toMatchObject({ overloadOverride: true, loadKg: 60, capacityKg: 50 });
    await page.reload();
    await expect(
      page.locator('[data-testid="audit-entry"][data-action="tour.release"]', {
        hasText: "Freigabe trotz Überladung",
      }),
    ).toHaveCount(1);
  } finally {
    await client.query(
      `DELETE FROM "StopOrder" WHERE "stopId" IN (SELECT s."id" FROM "Stop" s JOIN "Tour" t ON t."id"=s."tourId" WHERE t."date"=$1)`,
      [day],
    );
    await client.query(
      `DELETE FROM "Stop" WHERE "tourId" IN (SELECT "id" FROM "Tour" WHERE "date"=$1)`,
      [day],
    );
    await client.query(`DELETE FROM "Tour" WHERE "date"=$1`, [day]);
    await client.query(
      `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "customerId" LIKE $1)`,
      [`id-${tag}-%`],
    );
    await client.query(`DELETE FROM "Order" WHERE "customerId" LIKE $1`, [`id-${tag}-%`]);
    await client.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`id-${tag}-%`]);
    await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=$1`, [depot.depotPinConfirmed]);
    await expireSettingsCache();
    await client.end();
  }
});
