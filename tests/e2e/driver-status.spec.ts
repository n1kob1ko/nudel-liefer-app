import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-053. Needs DATABASE_URL. The spec inserts its own driver, products, customers and a released
// tour for TODAY in the factory time zone (no photos: the placeholders are used). Phone viewport.
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `stat${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const LOCALES = ["de", "en", "sr-Latn", "cs", "zh-Hans"] as const;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let db: Client;
let userId: string;
let tourId: string;
const stopIds: string[] = [];
const names = [1, 2, 3].map((n) => `Trattoria ${n} ${tag}`);

const text = (de: string, hans: string) =>
  JSON.stringify({
    de,
    "zh-Hans": hans,
    en: `${de} (en)`,
    "sr-Latn": `${de} (sr)`,
    cs: `${de} (cs)`,
    meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
  });

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const hash = await bcrypt.hash(PIN, 10);
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Status Driver',now())`,
    [userId, username, hash],
  );
  const kg = `prod-kg-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","weightKgPerUnit","updatedAt") VALUES ($1,$2,$3::jsonb,'KG',1,now())`,
    [kg, `KG-${tag}`, text("Spaghetti lose", "意大利面")],
  );
  const settings = (await db.query(`SELECT "timezone" FROM "Settings"`)).rows[0] as {
    timezone: string;
  };
  const tz = settings?.timezone ?? "Europe/Vienna";
  const today = (await db.query(`SELECT (now() AT TIME ZONE $1)::date AS d`, [tz])).rows[0]
    .d as Date;
  tourId = `tour-${tag}`;
  await db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","releasedAt","updatedAt")
     VALUES ($1,$2,$3,'RELEASED',$4::jsonb,1,now(),now())`,
    [
      tourId,
      today,
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
        new Date(today.getTime() + (8 + i) * 3600_000),
        JSON.stringify([{ productId: kg, quantity: 13 + i }]),
      ],
    );
  }
});

test.afterAll(async () => {
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

/** Fresh state before each test: every stop pending, tour released, driver language set. */
async function resetState(locale = "de") {
  await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]);
  await db.query(
    `UPDATE "Stop" SET "status"='PENDING', "problemReason"=NULL, "problemNote"=NULL, "completedAt"=NULL, "clientMutationId"=NULL WHERE "tourId"=$1`,
    [tourId],
  );
  await db.query(`UPDATE "Tour" SET "status"='RELEASED', "completedAt"=NULL WHERE "id"=$1`, [
    tourId,
  ]);
  await db.query(`UPDATE "User" SET "locale"=$2::"Locale" WHERE "id"=$1`, [userId, locale]);
}

const stopRow = async (i: number) =>
  (await db.query(`SELECT * FROM "Stop" WHERE "id"=$1`, [stopIds[i]])).rows[0];
const tourStatus = async () =>
  (await db.query(`SELECT "status" FROM "Tour" WHERE "id"=$1`, [tourId])).rows[0].status as string;
const mutationCount = async () =>
  Number(
    (await db.query(`SELECT count(*) FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]))
      .rows[0].count,
  );

async function login(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/driver$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function expectTouchTarget(page: Page, id: string) {
  const box = await visible(page, id).boundingBox();
  expect(box, id).not.toBeNull();
  expect(box!.height, id).toBeGreaterThanOrEqual(48);
}

test.describe.configure({ mode: "serial" });

for (const locale of LOCALES) {
  test(`deliver, report a problem, undo and finish the tour at 375 px in ${locale}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await resetState(locale);
    await login(page);
    const stopUrl = (i: number) => new RegExp(`/${locale}/driver/stops/${stopIds[i]}$`);

    // Stop 1: the two big buttons.
    await page.goto(`/${locale}/driver/stops/${stopIds[0]}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(visible(page, "btn-delivered")).toBeVisible();
    await expect(visible(page, "btn-problem")).toBeVisible();
    await expectTouchTarget(page, "btn-delivered");
    await expectTouchTarget(page, "btn-problem");
    expect(await noHorizontalScroll(page)).toBe(true);
    await visible(page, "btn-delivered").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`status-buttons-${locale}.png`) });

    // Problem sheet: seven reasons with icons, touch targets, optional text.
    await visible(page, "btn-problem").click();
    const sheet = page.getByTestId("problem-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("problem-reasons").getByRole("button")).toHaveCount(7);
    await expect(sheet.getByTestId("problem-reasons").locator("button svg")).toHaveCount(7);
    for (const reason of [
      "CLOSED",
      "NOBODY_THERE",
      "NO_PARKING",
      "WRONG_QUANTITY",
      "REFUSED",
      "ADDRESS_NOT_FOUND",
      "OTHER",
    ]) {
      const box = await sheet.getByTestId(`reason-${reason}`).boundingBox();
      expect(box!.height, reason).toBeGreaterThanOrEqual(48);
    }
    await expect(sheet.getByTestId("problem-submit")).toBeDisabled();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`status-sheet-${locale}.png`) });
    await sheet.getByTestId("problem-cancel").click();
    await expect(sheet).toHaveCount(0);
    expect((await stopRow(0)).status).toBe("PENDING");

    // Double tap on "Delivered": exactly one state change. The screen stays on the stop (NUD-176):
    // its result card offers Undo and the way to the next stop.
    await visible(page, "btn-delivered").dblclick();
    await expect(visible(page, "stop-result")).toHaveAttribute("data-status", "DELIVERED");
    await expect(page).toHaveURL(stopUrl(0));
    await expect(visible(page, "strip-undo")).toBeVisible();
    await expect.poll(async () => (await stopRow(0)).status).toBe("DELIVERED");
    expect(await mutationCount()).toBe(1);
    expect(await tourStatus()).toBe("IN_PROGRESS");
    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(names[0]);
    const toastUndo = toast.locator("[data-button]");
    // Rounded: sonner scales a toast by a hair while it animates in (47.999996 px measured).
    expect(Math.round((await toastUndo.boundingBox())!.height)).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: testInfo.outputPath(`status-toast-${locale}.png`) });
    await expectTouchTarget(page, "next-stop-action");
    await visible(page, "next-stop-action").click();
    await expect(page).toHaveURL(stopUrl(1));

    // Stop 2: problem with reason and free text, stored in the driver's locale.
    await visible(page, "btn-problem").click();
    await page.getByTestId("reason-NO_PARKING").click();
    await page.getByTestId("problem-note").fill(`Baustelle ${locale}`);
    await page.getByTestId("problem-submit").click();
    await expect(visible(page, "stop-result")).toHaveAttribute("data-status", "PROBLEM");
    await expect(visible(page, "next-stop-action")).toHaveAttribute(
      "href",
      new RegExp(`/driver/stops/${stopIds[2]}$`),
    );
    await expect(page).toHaveURL(stopUrl(1));
    await expect.poll(async () => (await stopRow(1)).status).toBe("PROBLEM");
    const problem = await stopRow(1);
    expect(problem.problemReason).toBe("NO_PARKING");
    expect(problem.problemNote[locale]).toBe(`Baustelle ${locale}`);
    expect(problem.problemNote.meta.source).toBe(locale);
    expect(problem.completedAt).not.toBeNull();

    // Undo from the toast: stop 2 is open again and shown.
    const undo = page.locator("[data-sonner-toast]").first().locator("[data-button]");
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(page).toHaveURL(stopUrl(1));
    await expect.poll(async () => (await stopRow(1)).status).toBe("PENDING");
    expect((await stopRow(1)).problemReason).toBeNull();
    expect((await stopRow(1)).problemNote).toBeNull();
    await expect(visible(page, "btn-delivered")).toBeVisible();
    expect(await tourStatus()).toBe("IN_PROGRESS");

    // The result card of a completed stop offers Undo inside the window.
    await page.goto(`/${locale}/driver/stops/${stopIds[0]}`);
    await expect(visible(page, "stop-result")).toHaveAttribute("data-status", "DELIVERED");
    await expect(visible(page, "undo")).toBeVisible();
    await expectTouchTarget(page, "undo");
    await page.screenshot({ path: testInfo.outputPath(`status-result-${locale}.png`) });

    // Finish: stop 3 (next pending behind it: none -> the earlier open stop 2), then stop 2, whose
    // result card leads back to the tour because nothing is open any more.
    await page.goto(`/${locale}/driver/stops/${stopIds[2]}`);
    await visible(page, "btn-delivered").click();
    await visible(page, "next-stop-action").click();
    await expect(page).toHaveURL(stopUrl(1));
    await visible(page, "btn-delivered").click();
    await expect(visible(page, "next-stop-action")).toHaveCount(0);
    await visible(page, "back-to-tour-action").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/driver$`));
    await expect(visible(page, "all-done")).toBeVisible();
    await expect(visible(page, "finished-summary")).toContainText("3");
    // The screen follows the tap at once; the server catches up a moment later (outbox, NUD-082).
    await expect.poll(tourStatus).toBe("COMPLETED");
    expect(
      (await db.query(`SELECT "completedAt" FROM "Tour" WHERE "id"=$1`, [tourId])).rows[0]
        .completedAt,
    ).not.toBeNull();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`tour-finished-${locale}.png`),
      fullPage: true,
    });

    // A completed tour cannot be reopened: no undo on the last stop.
    await expect
      .poll(
        async () =>
          (
            await db.query(
              `SELECT count(*) FROM "Stop" WHERE "tourId"=$1 AND "status"<>'PENDING'`,
              [tourId],
            )
          ).rows[0].count,
      )
      .toBe("3");
    await page.goto(`/${locale}/driver/stops/${stopIds[1]}`);
    await expect(visible(page, "stop-result")).toBeVisible();
    await expect(visible(page, "undo")).toHaveCount(0);
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  });
}

test("a stale screen shows the real state and a notice instead of booking twice", async ({
  page,
}) => {
  await resetState("de");
  await login(page);
  await page.goto(`/de/driver/stops/${stopIds[0]}`);
  await expect(visible(page, "btn-delivered")).toBeVisible();
  // The same stop is completed elsewhere (second device) while this screen is still open.
  await db.query(`UPDATE "Stop" SET "status"='DELIVERED', "completedAt"=now() WHERE "id"=$1`, [
    stopIds[0],
  ]);
  await visible(page, "btn-delivered").click();
  // The tap is queued and sent; the server refuses it (already closed) and the driver is told.
  const notice = page.getByTestId("sync-notice").first();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-error", "already_completed");
  await expect(notice).toContainText(names[0]);
  expect(await mutationCount()).toBe(0);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  await page.getByTestId("sync-notice-dismiss").first().click();
  await expect(page.getByTestId("sync-notice")).toHaveCount(0);
});

test("a failed request keeps the queued tap and retries it with the same id", async ({ page }) => {
  await resetState("de");
  await login(page);
  await page.goto(`/de/driver/stops/${stopIds[0]}`);
  await expect(visible(page, "btn-delivered")).toBeVisible();
  const ids: string[] = [];
  let failed = false;
  await page.route("**/api/driver/sync", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      entries: Array<{ clientMutationId: string }>;
    };
    ids.push(...body.entries.map((e) => e.clientMutationId));
    if (!failed) {
      failed = true;
      return route.abort("connectionfailed");
    }
    return route.continue();
  });
  await visible(page, "btn-delivered").click();
  // The screen shows the stop as done, the badge says one tap is waiting, the server knows nothing yet.
  await expect(visible(page, "stop-result")).toHaveAttribute("data-status", "DELIVERED");
  await expect(visible(page, "stop-pending-sync")).toBeVisible();
  await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");
  expect((await stopRow(0)).status).toBe("PENDING");
  // The retry (exponential backoff, first wait 2 s) sends the very same tap.
  await expect.poll(async () => (await stopRow(0)).status, { timeout: 30_000 }).toBe("DELIVERED");
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(new Set(ids).size).toBe(1);
  expect(await mutationCount()).toBe(1);
});
