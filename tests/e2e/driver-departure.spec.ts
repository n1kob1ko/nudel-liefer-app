import { expect, type Page, test as base } from "@playwright/test";

import {
  createDriverFixture,
  type DriverFixture,
  loginDriver,
  stubImages,
} from "./helpers/driver-fixture";
import { gotoSettled, installNetworkEmulation, setOnline } from "./helpers/network";
import { expireSettingsCache } from "./helpers/settings";

// NUD-151. Needs DATABASE_URL, S3_* and a PRODUCTION build (service worker for the offline test).
// Own driver, customers and a released tour for TODAY (shared driver fixture): the optional
// departure checklist of the driver home. The fixed items the office maintains in the settings are
// written straight to the settings row for the test and restored afterwards.
const test = base.extend<{ fx: DriverFixture }>({
  fx: async ({}, provide) => {
    const fx = await createDriverFixture("dep");
    await provide(fx);
    await fx.cleanup();
  },
});

const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const tourTimes = async (fx: DriverFixture) =>
  (
    await fx.db.query(`SELECT "loadingStartedAt","departedAt" FROM "Tour" WHERE "id"=$1`, [
      fx.tourId,
    ])
  ).rows[0] as { loadingStartedAt: Date | null; departedAt: Date | null };
const audits = async (fx: DriverFixture) =>
  (
    await fx.db.query(
      `SELECT "action","diff" FROM "AuditLog" WHERE "entity"='Tour' AND "entityId"=$1 AND "action" IN ('tour.loading_started','tour.departed') ORDER BY "createdAt","id"`,
      [fx.tourId],
    )
  ).rows as Array<{ action: string; diff: { skipped?: boolean; via: string } }>;

const resetDeparture = async (fx: DriverFixture) => {
  await fx.reset();
  await fx.db.query(`UPDATE "Tour" SET "loadingStartedAt"=NULL, "departedAt"=NULL WHERE "id"=$1`, [
    fx.tourId,
  ]);
};

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

let savedChecklist: unknown = [];
test.beforeEach(async ({ fx }) => {
  const row = (await fx.db.query(`SELECT "departureChecklist" FROM "Settings" WHERE "id"=1`))
    .rows[0] as { departureChecklist: unknown } | undefined;
  savedChecklist = row?.departureChecklist ?? [];
  await fx.db.query(`UPDATE "Settings" SET "departureChecklist"=$1::jsonb WHERE "id"=1`, [
    JSON.stringify([
      {
        id: "e2e-ls",
        text: {
          de: "Lieferscheine",
          en: "Delivery notes",
          "zh-Hans": "送货单",
          meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
        },
      },
    ]),
  ]);
  await expireSettingsCache();
});
test.afterEach(async ({ fx }) => {
  await fx.db.query(`UPDATE "Settings" SET "departureChecklist"=$1::jsonb WHERE "id"=1`, [
    JSON.stringify(savedChecklist),
  ]);
  await expireSettingsCache();
});

test.describe("driver", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("opens the checklist, ticks lines and leaves: both times are written", async ({
    page,
    fx,
  }) => {
    test.setTimeout(120_000);
    await resetDeparture(fx);
    // One needed key (stop 2) so that the key line appears.
    await fx.db.query(`UPDATE "Customer" SET "hasKey"=true, "keyNumber"='12' WHERE "id"=$1`, [
      `cust-1-${fx.tag}`,
    ]);
    await loginDriver(page, fx);

    const card = page.locator('[data-testid="departure-card"]:visible');
    await expect(card).toBeVisible();
    await expect(card).toContainText("Abfahrt vorbereiten");
    expect(await noHorizontalScroll(page)).toBe(true);
    for (const id of ["departure-open", "departure-skip"]) {
      const box = (await card.getByTestId(id).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(48);
    }

    await card.getByTestId("departure-open").click();
    const sheet = page.getByTestId("departure-sheet");
    await expect(sheet).toBeVisible();
    // Totals over the tour (fixture: Spaghetti 13 + 27 kg, Penne 4 + 1 Sackerl), key and fixed item.
    const products = sheet.getByTestId("departure-product");
    await expect(products).toHaveCount(2);
    await expect(products.first()).toContainText("40");
    await expect(products.first()).toContainText("Spaghetti lose");
    await expect(products.last()).toContainText("5");
    await expect(products.last()).toContainText("Sackerl");
    await expect(products.last()).toContainText("Penne");
    await expect(sheet.getByTestId("departure-key")).toContainText("12");
    await expect(sheet.getByTestId("departure-key")).toContainText(fx.names[1]!);
    await expect(sheet.getByTestId("departure-fixed-item")).toContainText("Lieferscheine");
    await expect(sheet.getByTestId("departure-progress")).toHaveAttribute("data-total", "4");
    expect(await noHorizontalScroll(page)).toBe(true);

    // Opening recorded the loading start (and only that).
    await expect.poll(async () => (await tourTimes(fx)).loadingStartedAt).not.toBeNull();
    expect((await tourTimes(fx)).departedAt).toBeNull();

    // One tap per line; every line is a 48 px target.
    const rows = sheet.getByRole("checkbox");
    await expect(rows).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      expect((await rows.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await rows.nth(i).click();
      await expect(rows.nth(i)).toHaveAttribute("aria-checked", "true");
    }
    await expect(sheet.getByTestId("departure-progress")).toHaveAttribute("data-done", "4");
    const go = sheet.getByTestId("departure-go");
    expect((await go.boundingBox())!.height).toBeGreaterThanOrEqual(48);

    await go.click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('[data-testid="departure-card"]:visible')).toHaveCount(0);
    await expect.poll(async () => (await tourTimes(fx)).departedAt).not.toBeNull();
    const times = await tourTimes(fx);
    expect(times.departedAt!.getTime()).toBeGreaterThanOrEqual(times.loadingStartedAt!.getTime());
    await expect
      .poll(async () => (await audits(fx)).map((a) => a.action).slice(-2))
      .toEqual(["tour.loading_started", "tour.departed"]);
    expect((await audits(fx)).at(-1)!.diff).toMatchObject({ skipped: false });

    // Gone after a reload as well; the list and the next stop are untouched.
    await page.reload();
    await expect(page.locator('[data-testid="next-stop"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="departure-card"]:visible')).toHaveCount(0);
  });

  test("skipping records the departure only", async ({ page, fx }) => {
    test.setTimeout(120_000);
    await resetDeparture(fx);
    await loginDriver(page, fx);
    await page
      .locator('[data-testid="departure-card"]:visible')
      .getByTestId("departure-skip")
      .click();
    await expect(page.locator('[data-testid="departure-card"]:visible')).toHaveCount(0);
    await expect.poll(async () => (await tourTimes(fx)).departedAt).not.toBeNull();
    expect((await tourTimes(fx)).loadingStartedAt).toBeNull();
    expect((await audits(fx)).at(-1)!.diff).toMatchObject({ skipped: true });
  });

  test("works offline: queued, shown at once, written when the connection is back", async ({
    page,
    context,
    fx,
  }) => {
    test.setTimeout(180_000);
    await resetDeparture(fx);
    await installNetworkEmulation(context);
    await stubImages(page);
    await loginDriver(page, fx);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });

    await setOnline(context, page, false);
    await gotoSettled(page, "/de/driver");
    const card = page.locator('[data-testid="departure-card"]:visible');
    await expect(card).toBeVisible();
    await card.getByTestId("departure-open").click();
    const sheet = page.getByTestId("departure-sheet");
    await expect(sheet.getByTestId("departure-product").first()).toBeVisible();
    await sheet.getByRole("checkbox").first().click();
    await sheet.getByTestId("departure-go").click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('[data-testid="departure-card"]:visible')).toHaveCount(0);
    // Nothing reached the server yet.
    expect(await tourTimes(fx)).toEqual({ loadingStartedAt: null, departedAt: null });

    await setOnline(context, page, true);
    await expect
      .poll(async () => (await tourTimes(fx)).departedAt, { timeout: 30_000 })
      .not.toBeNull();
    const times = await tourTimes(fx);
    expect(times.loadingStartedAt).not.toBeNull();
    // The times are those of the taps, in the right order, and the log says they were synced.
    expect(times.loadingStartedAt!.getTime()).toBeLessThanOrEqual(times.departedAt!.getTime());
    expect((await audits(fx)).slice(-2).map((a) => a.diff.via)).toEqual(["sync", "sync"]);
  });
});

test.describe("office settings", () => {
  test("the fixed checklist items can be added and removed in the form", async ({
    page,
    fx,
  }, info) => {
    test.skip(info.project.name === "mobile", "admin screens are desktop only");
    test.setTimeout(120_000);
    await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("") }),
    );
    await page.goto("/de/login");
    await page.getByLabel("E-Mail").fill("admin@example.com");
    await page.getByLabel("Passwort").fill(adminPassword);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/de\/admin$/);
    await page.goto("/de/admin/settings");

    const editor = page.getByTestId("checklist-editor");
    await expect(editor).toBeVisible();
    // The item written for the test is shown with its German text.
    await expect(editor.getByTestId("checklist-item")).toHaveValue("Lieferscheine");
    await editor.getByTestId("checklist-add").click();
    await expect(editor.getByTestId("checklist-item")).toHaveCount(2);
    await editor.getByTestId("checklist-item").last().fill("Rechnungsblock");
    await editor.getByTestId("checklist-remove").first().click();
    await expect(editor.getByTestId("checklist-item")).toHaveCount(1);
    await expect(editor.getByTestId("checklist-item")).toHaveValue("Rechnungsblock");
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(fx.tag).toBeTruthy();
  });
});
