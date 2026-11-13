import { expect, test } from "@playwright/test";

import { createDriverFixture, type DriverFixture, loginDriver } from "./helpers/driver-fixture";

// NUD-205. Needs DATABASE_URL: the spec brings its own driver with a released tour for today and
// adds one for tomorrow. Phone viewport, like the driver's device.
test.use({ viewport: { width: 375, height: 812 } });

let fx: DriverFixture;
let tomorrowTourId: string;

test.beforeAll(async () => {
  fx = await createDriverFixture("upc");
  tomorrowTourId = `tour-next-${fx.tag}`;
  // Tomorrow as the factory sees it: the day after the fixture's tour of today.
  await fx.db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","releasedAt","updatedAt")
     SELECT $1, "date" + 1, "driverId", 'RELEASED', "depotSnapshot", 1, now(), now() FROM "Tour" WHERE "id" = $2`,
    [tomorrowTourId, fx.tourId],
  );
  await fx.db.query(
    `INSERT INTO "Stop" ("id","tourId","customerId","sequence","status","etaAt","legDurationS","items")
     SELECT $1, $2, "customerId", 1, 'PENDING', "etaAt" + interval '1 day', 600, "items" FROM "Stop" WHERE "id" = $3`,
    [`stop-next-${fx.tag}`, tomorrowTourId, fx.stopIds[0]],
  );
});

test.afterAll(async () => {
  await fx.db.query(`DELETE FROM "Stop" WHERE "tourId" = $1`, [tomorrowTourId]);
  await fx.db.query(`DELETE FROM "Tour" WHERE "id" = $1`, [tomorrowTourId]);
  await fx.cleanup();
});

test("the driver sees the tour released for tomorrow below today's tour", async ({ page }) => {
  await loginDriver(page, fx);
  // today's tour is still the home screen
  await expect(page.locator('[data-testid="stop-row"]:visible').first()).toBeVisible();

  const upcoming = page.getByTestId("upcoming-tours");
  await expect(upcoming).toBeVisible();
  const tour = upcoming.getByTestId("upcoming-tour");
  await expect(tour).toHaveCount(1);
  await expect(tour.getByTestId("upcoming-day")).toContainText("Morgen");
  await expect(tour.getByTestId("upcoming-summary")).toContainText("1 Stopp");

  // closed at first; opening it lists the stop with customer and quantities, and nothing to tick off
  await expect(tour.getByTestId("upcoming-stop")).toBeHidden();
  await tour.locator("summary").click();
  const stop = tour.getByTestId("upcoming-stop");
  await expect(stop).toBeVisible();
  await expect(stop).toContainText(fx.names[0]!);
  await expect(stop.getByTestId("upcoming-items")).toContainText("Spaghetti lose");
  await expect(stop.getByRole("button")).toHaveCount(0);
  await expect(stop.getByRole("link")).toHaveCount(0);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
