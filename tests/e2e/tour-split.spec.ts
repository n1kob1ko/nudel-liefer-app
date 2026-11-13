import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { createDriverFixture, loginDriver } from "./helpers/driver-fixture";
import { requireDatabaseUrl, requireFreeDay, requireUsableDatabase } from "./helpers/preconditions";
import { expireSettingsCache } from "./helpers/settings";
import { ensureVehicle } from "./helpers/vehicle";

// NUD-147. Needs a seeded database (product NUDELN-KARTON, an admin), DATABASE_URL and
// SEED_ADMIN_PASSWORD. The planning scenario is a desktop scenario (admin screens); the driver
// scenario runs in both projects. Routing is the local heuristic (no ORS key in CI).
//
// NUD-162: on a database that is not migrated/seeded, or that already has a tour on the planning
// day, the spec used to fail on "0 tour tabs" without saying why. The precondition checks below
// name the database, what is missing and the command that fixes it (`pnpm e2e:db:reset` on
// E2E_DATABASE_URL, docs/e2e-database.md).
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

/** Leaves only the given vehicles ticked in the "Touren planen" dialog. */
async function selectVehicles(page: Page, keep: string[]) {
  const boxes = page.locator('[data-testid="plan-day-vehicle"]:visible');
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    const id = await box.getAttribute("data-vehicle-id");
    await box.setChecked(keep.includes(id ?? ""));
  }
}

test.describe("Touren planen", () => {
  test.describe.configure({ mode: "serial" });

  test("two vehicles share the day, one vehicle reloads at the depot", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "admin planning screen is a desktop screen");
    test.setTimeout(240_000);
    const tag = `e2es${Date.now() % 1e8}`;
    const day = `${2100 + Math.floor(Math.random() * 7000)}-06-03`;
    const client = new Client({ connectionString: requireDatabaseUrl() });
    await client.connect();
    try {
      // NUD-162: a database that is behind prisma/migrations, not seeded, or that already has a
      // tour on the planning day makes the planning step produce no tabs — say so instead.
      await requireUsableDatabase(client, { admin: true, skus: ["NUDELN-KARTON"] });
      await requireFreeDay(client, day);
    } catch (error) {
      await client.end();
      throw error;
    }
    const admin = (await client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
      .rows[0] as { id: string };
    const karton = (
      await client.query(`SELECT "id","weightKgPerUnit" FROM "Product" WHERE "sku"='NUDELN-KARTON'`)
    ).rows[0] as { id: string; weightKgPerUnit: string };
    const kgPerCarton = Number(karton.weightKgPerUnit);
    const depot = (
      await client.query(`SELECT "depotLat","depotLng","depotPinConfirmed" FROM "Settings"`)
    ).rows[0] as { depotLat: number; depotLng: number; depotPinConfirmed: boolean };
    await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=true`);
    await expireSettingsCache();
    // Four customers with two Kiste each; the vehicles carry 2.5 customers' worth.
    const capacity = Math.round(kgPerCarton * 2 * 2.5);
    const vanA = await ensureVehicle(client, "E2E Split A", capacity);
    const vanB = await ensureVehicle(client, "E2E Split B", capacity);
    const offsets: Array<[number, number]> = [
      [0.04, 0],
      [0, 0.04],
      [-0.04, 0],
      [0, -0.04],
    ];
    try {
      for (const [index, [dLat, dLng]] of offsets.entries()) {
        const customerId = `id-${tag}-${index}`;
        await client.query(
          `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
           VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
          [
            customerId,
            `${tag}-${index}`,
            `Osteria ${index + 1} ${tag}`,
            depot.depotLat + dLat,
            depot.depotLng + dLng,
          ],
        );
        const orderId = `ord-${tag}-${index}`;
        await client.query(
          `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
           VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
          [orderId, customerId, day, admin.id],
        );
        await client.query(
          `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,2)`,
          [`oi-${orderId}`, orderId, karton.id],
        );
      }

      await loginAdmin(page);
      await page.goto(`/de/admin/tours?date=${day}`);

      // 1. Two vehicles: two tours, neither over its capacity.
      await tid(page, "tour-plan-day").click();
      await expect(tid(page, "plan-day-dialog")).toBeVisible();
      await selectVehicles(page, [vanA, vanB]);
      await page.screenshot({ path: testInfo.outputPath("nud-147-plan-dialog-1280.png") });
      await tid(page, "plan-day-confirm").click();
      await expect(
        page.locator('[data-testid="tour-tab"]:visible'),
        // NUD-162: this used to be the bare "0 tour tabs" failure on a dirty database.
        "planning produced no tour tabs; the preconditions at the start of this spec name the database and the fix (docs/e2e-database.md)",
      ).toHaveCount(2);
      await expect(tid(page, "tour-load")).toHaveAttribute("data-state", "ok");
      await expect(tid(page, "reload-stop")).toHaveCount(0);
      const tours = (
        await client.query(
          `SELECT t."id", t."vehicleId", count(s."id")::int AS stops, max(s."trip")::int AS trips
           FROM "Tour" t LEFT JOIN "Stop" s ON s."tourId"=t."id" WHERE t."date"=$1 GROUP BY t."id" ORDER BY t."createdAt"`,
          [day],
        )
      ).rows as Array<{ id: string; vehicleId: string; stops: number; trips: number }>;
      expect(tours).toHaveLength(2);
      expect(tours.map((x) => x.vehicleId).sort()).toEqual([vanA, vanB].sort());
      expect(tours.map((x) => x.stops)).toEqual([2, 2]);
      expect(tours.every((x) => x.trips === 1)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("nud-147-two-tours-1280.png"),
        fullPage: true,
      });
      expect(await noHorizontalScroll(page)).toBe(true);

      // 2. One vehicle: one tour with a reload stop, every trip within the capacity.
      await tid(page, "tour-plan-day").click();
      await selectVehicles(page, [vanA]);
      await tid(page, "plan-day-confirm").click();
      await expect(
        tid(page, "reload-stop"),
        "the second planning run produced no reload stop; the preconditions at the start of this spec name the database and the fix (docs/e2e-database.md)",
      ).toHaveCount(1);
      await expect(tid(page, "reload-stop")).toContainText("Nachladen im Depot");
      await expect(tid(page, "reload-stop")).toContainText(
        `Fahrt 2: ${2 * 2 * kgPerCarton} kg laden`,
      );
      await expect(tid(page, "tour-load-trip")).toHaveCount(2);
      await expect(tid(page, "tour-load")).toHaveAttribute("data-state", "ok");
      await expect(tid(page, "tour-load-over")).toHaveCount(0);
      await expect(page.locator('[data-testid="stop-row"]:visible')).toHaveCount(4);
      await page.screenshot({
        path: testInfo.outputPath("nud-147-reload-1280.png"),
        fullPage: true,
      });
      expect(await noHorizontalScroll(page)).toBe(true);

      // The surplus second tour is kept as an empty tour.
      const after = (
        await client.query(
          `SELECT count(*)::int AS tours, count(*) FILTER (WHERE "vehicleId" IS NULL)::int AS empty FROM "Tour" WHERE "date"=$1`,
          [day],
        )
      ).rows[0] as { tours: number; empty: number };
      expect(after).toEqual({ tours: 2, empty: 1 });

      // 3. The tour is released although 80 kg > 50 kg: the capacity applies per trip.
      await expect(tid(page, "tour-release")).toBeEnabled();
      await tid(page, "tour-release").click();
      await expect(tid(page, "release-overload")).toHaveCount(0);
      await tid(page, "release-confirm").click();
      await expect(tid(page, "tour-status")).toHaveText("Freigegeben");

      // 4. The load sheet has one block per trip.
      const tourId = (await tid(page, "tour-planner").getAttribute("data-tour-id"))!;
      await page.goto(`/de/admin/tours/${tourId}/print`);
      await expect(page.locator('[data-testid="load-sheet-trip"]')).toHaveCount(2);
      await expect(page.locator('[data-testid="load-sheet-reload"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="load-sheet-trip"]').first()).toContainText(
        "Fahrt 1 von 2",
      );
      await page.screenshot({
        path: testInfo.outputPath("nud-147-load-sheet-1280.png"),
        fullPage: true,
      });

      // 5. The history says what happened.
      await page.goto(`/de/admin/tours?date=${day}&tour=${tourId}`);
      await expect(
        page.locator('[data-testid="audit-entry"][data-action="tour.plan_day"]').first(),
      ).toContainText("Touren geplant");
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
      await client.query(`UPDATE "Vehicle" SET "active"=false WHERE "id" = ANY($1)`, [
        [vanA, vanB],
      ]);
      await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=$1`, [depot.depotPinConfirmed]);
      await expireSettingsCache();
      await client.end();
    }
  });
});

test("driver: a reload at the depot sits between the trips and lists the next load", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await createDriverFixture("reload");
  try {
    // Stop 3 is the first stop of trip 2: its load (1 x Penne, a PACK) is what is reloaded.
    await fixture.db.query(`UPDATE "Stop" SET "trip"=2 WHERE "tourId"=$1 AND "sequence"=3`, [
      fixture.tourId,
    ]);
    await fixture.reset();
    await loginDriver(page, fixture);
    await page.goto("/de/driver");
    const reload = page.getByTestId("reload-stop");
    await expect(reload).toHaveCount(1);
    await expect(reload).toContainText("Nachladen im Depot");
    await expect(reload.getByTestId("reload-item")).toHaveCount(1);
    await expect(reload.getByTestId("reload-item")).toContainText("1");
    await expect(reload.getByTestId("reload-item")).toContainText("Penne");
    // Between stop 2 and stop 3 of the list.
    const order = await page
      .locator('[data-testid="stop-list"] > li')
      .evaluateAll((items) => items.map((li) => li.getAttribute("data-testid")));
    expect(order.slice(0, 4)).toEqual(["stop-row", "stop-row", "reload-stop", "stop-row"]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await reload.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("nud-147-driver-reload.png"),
    });

    // Another language: same card, translated.
    await fixture.db.query(`UPDATE "User" SET "locale"='cs' WHERE "id"=$1`, [fixture.userId]);
    await page.goto("/cs/driver");
    await expect(page.getByTestId("reload-stop")).toContainText("Doplnění nákladu v depu");
  } finally {
    await fixture.cleanup();
  }
});
