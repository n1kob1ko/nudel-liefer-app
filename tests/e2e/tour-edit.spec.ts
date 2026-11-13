import { expect, type Locator, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { expireSettingsCache } from "./helpers/settings";
import { ensureVehicle } from "./helpers/vehicle";

// NUD-135 (Bearbeiten). Fixture copied from tours.spec.ts. Original header: NUD-042. Needs a seeded database (product NUDELN-BEUTEL, demo drivers), DATABASE_URL and
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
  const driver2 = (
    await client.query(
      `SELECT "id","displayName" FROM "User" WHERE "role"='DRIVER' AND "active" AND "id"<>$1 ORDER BY "username" LIMIT 1`,
      [driver.id],
    )
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
    driver,
    driver2,
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

test.describe.configure({ mode: "serial" });

test("tour edit: + Tour, Bearbeiten (driver, order, move), released tour, completed tour", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
  test.setTimeout(240_000);
  const f = await fixture();
  try {
    await stubTiles(page);
    await loginAdmin(page);
    await page.goto(`/de/admin/tours?date=${f.day}`);
    await tid(page, "tour-generate").click();
    const rows = page.locator('[data-testid="stop-row"]:visible');
    await expect(rows).toHaveCount(3);
    expect(await names(rows)).toEqual([f.a.name, f.b.name, f.c.name]);

    // The tabs are there for a single tour, plus "+ Tour".
    const tabs = page.locator('[data-testid="tour-tab"]:visible');
    await expect(tabs).toHaveCount(1);
    await expect(tabs.nth(0)).toContainText("Tour 1");
    await tid(page, "tour-add").click();
    await expect(page).toHaveURL(/tour=/);
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
    await expect(tabs.nth(1)).toContainText("0 Stopps");
    await expect(rows).toHaveCount(0);
    await tabs.nth(0).click();
    await expect(rows).toHaveCount(3);

    // Bearbeiten: driver, order (A to the end) and B moves to Tour 2.
    await tid(page, "tour-edit").click();
    const dialog = tid(page, "edit-dialog");
    await expect(dialog).toBeVisible();
    await expect(tid(page, "edit-released-note")).toHaveCount(0);
    await tid(page, "edit-driver").selectOption(f.driver.id);
    const vehicleId = await ensureVehicle(f.client);
    await tid(page, "edit-vehicle").selectOption(vehicleId);
    const editRows = dialog.locator('[data-testid="edit-stop"]');
    await expect(editRows).toHaveCount(3);
    await editRows.nth(0).locator('[data-testid="edit-stop-down"]').click();
    await editRows.nth(1).locator('[data-testid="edit-stop-down"]').click();
    await expect
      .poll(() => dialog.locator('[data-testid="edit-stop-name"]').allTextContents())
      .toEqual([f.b.name, f.c.name, f.a.name]);
    await dialog
      .locator('[data-testid="edit-stop"]', { hasText: f.b.name })
      .locator('[data-testid="edit-stop-tour"]')
      .selectOption({ label: "Nach Tour 2 verschieben" });
    await page.screenshot({ path: testInfo.outputPath("nud-135-edit-1280.png") });
    expect(await noHorizontalScroll(page)).toBe(true);
    await tid(page, "edit-save").click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => names(rows)).toEqual([f.c.name, f.a.name]);
    await expect(tabs.nth(0)).toContainText(`Tour 1 · ${f.driver.displayName}`);
    await expect(tabs.nth(0)).toContainText("2 Stopps");
    await expect(tabs.nth(1)).toContainText("1 Stopp");
    await expect(tid(page, "tour-driver")).toHaveValue(f.driver.id);
    await expect(tid(page, "tour-vehicle")).toHaveValue(vehicleId);
    await tabs.nth(1).click();
    await expect.poll(async () => names(rows)).toEqual([f.b.name]);
    await expect(rows.nth(0).locator('[data-testid="stop-eta"]')).toHaveText(/^\d\d:\d\d$/);
    await tabs.nth(0).click();
    await expect.poll(async () => names(rows)).toEqual([f.c.name, f.a.name]);

    // Release tour 1, then edit the released tour: the revision goes up (driver sees the update).
    await tid(page, "tour-release").click();
    await tid(page, "release-confirm").click();
    await expect(tid(page, "tour-status")).toHaveText("Freigegeben");
    await tid(page, "tour-edit").click();
    await expect(tid(page, "edit-released-note")).toBeVisible();
    // A released tour keeps its vehicle: "no vehicle" is not selectable any more.
    await expect(tid(page, "edit-vehicle")).toHaveValue(vehicleId);
    await expect(tid(page, "edit-vehicle").locator('option[value=""]')).toBeDisabled();
    await tid(page, "edit-driver").selectOption(f.driver2.id);
    await dialog
      .locator('[data-testid="edit-stop"]', { hasText: f.c.name })
      .locator('[data-testid="edit-stop-down"]')
      .click();
    await page.screenshot({ path: testInfo.outputPath("nud-135-edit-released-1280.png") });
    await tid(page, "edit-save").click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => names(rows)).toEqual([f.a.name, f.c.name]);
    await expect(tabs.nth(0)).toContainText(`Tour 1 · ${f.driver2.displayName}`);
    const stored = (
      await f.client.query(
        `SELECT "status"::text AS status,"releaseRevision","reReleasedAt","driverId" FROM "Tour" WHERE "date"=$1 ORDER BY "createdAt"`,
        [f.day],
      )
    ).rows;
    expect(stored[0].status).toBe("RELEASED");
    expect(stored[0].releaseRevision).toBe(2);
    expect(stored[0].reReleasedAt).not.toBeNull();
    expect(stored[0].driverId).toBe(f.driver2.id);
    expect(stored[1].releaseRevision).toBe(0);
    expect(await noHorizontalScroll(page)).toBe(true);

    // A completed stop is locked in the form; a completed tour has no Bearbeiten.
    await f.client.query(
      `UPDATE "Stop" SET "status"='DELIVERED', "completedAt"=now() WHERE "id"=(
         SELECT s."id" FROM "Stop" s JOIN "Tour" t ON t."id"=s."tourId" JOIN "Customer" c ON c."id"=s."customerId"
         WHERE t."date"=$1 AND c."id"=$2)`,
      [f.day, f.a.id],
    );
    await page.reload();
    await tid(page, "tour-edit").click();
    await expect(dialog.locator('[data-testid="edit-stop-locked"]')).toHaveCount(1);
    await expect(
      dialog
        .locator('[data-testid="edit-stop"]', { hasText: f.a.name })
        .locator('[data-testid="edit-stop-up"]'),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await f.client.query(
      `UPDATE "Tour" SET "status"='COMPLETED' WHERE "date"=$1 AND "releaseRevision">0`,
      [f.day],
    );
    await page.reload();
    await expect(tid(page, "tour-status")).toHaveText("Abgeschlossen");
    await expect(tid(page, "tour-edit")).toHaveCount(0);
  } finally {
    await f.cleanup();
  }
});

test("tour edit: anonymous visitors cannot reach the planning page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
  await page.goto("/de/admin/tours");
  await expect(page).toHaveURL(/\/de\/login/);
});
