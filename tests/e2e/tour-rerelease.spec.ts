import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { expireSettingsCache } from "./helpers/settings";
import { ensureVehicle } from "./helpers/vehicle";

// NUD-043. Needs a seeded database (product NUDELN-BEUTEL, demo driver), DATABASE_URL and
// SEED_ADMIN_PASSWORD. Desktop only. Like tours.spec.ts it confirms the depot pin for its
// duration, so do not run it at the same time as settings.spec.ts or tours.spec.ts.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await tid(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function fixture() {
  const tag = `e2er${Date.now() % 1e8}`;
  const year = 2100 + Math.floor(Math.random() * 7000);
  const day = `${year}-08-04`;
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

  const customer = async (suffix: string, offset: number) => {
    const id = `id-${tag}-${suffix}`;
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
      [
        id,
        `${tag}-${suffix}`,
        `Trattoria ${suffix} ${tag}`,
        depot.depotLat,
        depot.depotLng + offset,
      ],
    );
    return { id, name: `Trattoria ${suffix} ${tag}` };
  };
  const a = await customer("A", 0.01);
  const b = await customer("B", 0.02);
  const c = await customer("C", 0.03);
  const orders: Record<string, string> = {};
  for (const [cu, key, q] of [
    [a, "a", "2"],
    [b, "b", "3"],
    [c, "c", "4"],
  ] as const) {
    const id = `ord-${tag}-${key}`;
    orders[key] = id;
    await client.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
      [id, cu.id, day, admin.id],
    );
    await client.query(
      `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,$4)`,
      [`oi-${id}`, id, spag, q],
    );
  }
  return {
    client,
    day,
    a,
    b,
    c,
    orders,
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

test.describe.configure({ mode: "serial" });

test("order quantity changed after release: banner with diff, re-release keeps delivered stops", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
  test.setTimeout(240_000);
  const f = await fixture();
  try {
    await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
    );
    await loginAdmin(page);

    // Generate, assign the driver, release.
    await page.goto(`/de/admin/tours?date=${f.day}`);
    await tid(page, "tour-generate").click();
    const rows = page.locator('[data-testid="stop-row"]:visible');
    await expect(rows).toHaveCount(3);
    await tid(page, "tour-driver").selectOption(f.driver.id);
    await tid(page, "tour-vehicle").selectOption(await ensureVehicle(f.client));
    await tid(page, "tour-release").click();
    await tid(page, "release-confirm").click();
    await expect(tid(page, "tour-status")).toHaveText("Freigegeben");
    await expect(tid(page, "tour-changed-banner")).toHaveCount(0);
    const released = (
      await f.client.query(`SELECT "releaseRevision","isOutdated" FROM "Tour" WHERE "date"=$1`, [
        f.day,
      ])
    ).rows[0];
    expect(released).toEqual({ releaseRevision: 1, isOutdated: false });

    // The driver starts: stop A is delivered.
    await f.client.query(
      `UPDATE "Stop" SET "status"='DELIVERED',"completedAt"=now() WHERE "customerId"=$1`,
      [f.a.id],
    );

    // The office changes the quantity of B after the release (3 -> 5) through the order form.
    await page.goto(`/de/admin/orders/${f.orders.b}/edit`);
    await tid(page, "order-line").first().getByTestId("line-quantity").fill("5");
    await tid(page, "order-save").click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${f.orders.b}$`));

    // Planning page: prominent banner with the diff; the tour is flagged.
    await page.goto(`/de/admin/tours?date=${f.day}`);
    const banner = tid(page, "tour-changed-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Bestellungen seit der Freigabe geändert");
    const changed = tid(page, "diff-changed");
    await expect(changed).toContainText(f.b.name);
    await expect(changed.getByTestId("diff-item")).toContainText("3 → 5");
    await expect(tid(page, "diff-added")).toHaveCount(0);
    await expect(tid(page, "diff-removed")).toHaveCount(0);
    expect(
      (await f.client.query(`SELECT "isOutdated" FROM "Tour" WHERE "date"=$1`, [f.day])).rows[0]
        .isOutdated,
    ).toBe(true);
    await page.screenshot({ path: "test-results/nud-043-banner-1280.png", fullPage: true });
    expect(await noHorizontalScroll(page)).toBe(true);

    // The banner and the diff render in every locale without missing messages.
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    for (const locale of ["en", "zh-Hans"]) {
      await page.goto(`/${locale}/admin/tours?date=${f.day}`);
      await expect(tid(page, "tour-changed-banner")).toBeVisible();
      await expect(tid(page, "diff-item")).toContainText("3 → 5");
      await expect(tid(page, "tour-rerelease")).toBeVisible();
    }
    expect(consoleErrors).toEqual([]);
    await page.goto(`/de/admin/tours?date=${f.day}`);

    // Re-release: confirm dialog shows the counts.
    await tid(page, "tour-rerelease").click();
    await expect(tid(page, "rerelease-dialog")).toBeVisible();
    await expect(tid(page, "rerelease-changed")).toHaveText("1");
    await expect(tid(page, "rerelease-added")).toHaveText("0");
    await page.screenshot({ path: "test-results/nud-043-rerelease-dialog-1280.png" });
    await tid(page, "rerelease-confirm").click();
    await expect(tid(page, "tour-changed-banner")).toHaveCount(0);
    await expect(tid(page, "tour-rereleased-at")).toContainText("Version 2");

    // The delivered stop is untouched, B is marked as changed, the status moved on.
    await expect(tid(page, "tour-status")).toHaveText("Unterwegs");
    const rowA = rows.filter({ hasText: f.a.name });
    await expect(rowA.getByTestId("stop-status")).toHaveText("Geliefert");
    await expect(rowA.getByTestId("stop-change")).toHaveCount(0);
    await expect(rows.filter({ hasText: f.b.name }).getByTestId("stop-change")).toHaveText(
      "Menge geändert",
    );
    await page.screenshot({
      path: "test-results/nud-043-after-rerelease-1280.png",
      fullPage: true,
    });
    expect(await noHorizontalScroll(page)).toBe(true);

    const stops = (
      await f.client.query(
        `SELECT s."customerId", s."status", s."changeKind", s."changedInRevision", s."items", s."completedAt" IS NOT NULL AS done
         FROM "Stop" s JOIN "Tour" t ON t."id"=s."tourId" WHERE t."date"=$1 ORDER BY s."sequence"`,
        [f.day],
      )
    ).rows;
    const byCustomer = (id: string) => stops.find((s) => s.customerId === id);
    expect(byCustomer(f.a.id)).toMatchObject({ status: "DELIVERED", changeKind: null, done: true });
    expect(byCustomer(f.b.id)).toMatchObject({
      status: "PENDING",
      changeKind: "CHANGED",
      changedInRevision: 2,
    });
    expect(byCustomer(f.b.id).items[0].quantity).toBe(5);
    expect(byCustomer(f.c.id).items[0].quantity).toBe(4);
    const tour = (
      await f.client.query(
        `SELECT "status","isOutdated","releaseRevision","reReleasedAt" IS NOT NULL AS re FROM "Tour" WHERE "date"=$1`,
        [f.day],
      )
    ).rows[0];
    expect(tour).toEqual({
      status: "IN_PROGRESS",
      isOutdated: false,
      releaseRevision: 2,
      re: true,
    });
  } finally {
    await f.cleanup();
  }
});
