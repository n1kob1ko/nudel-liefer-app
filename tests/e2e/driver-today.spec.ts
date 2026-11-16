import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

// NUD-051. Needs DATABASE_URL (the spec inserts its own driver, products, customers and a released
// tour for TODAY in the factory time zone, so it is independent of the seed). Phone viewport.
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `today${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const otherUsername = `drv2-${tag}`;
const LOCALES = ["de", "en", "sr-Latn", "cs", "zh-Hans"] as const;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let db: Client;
let userId: string;
let otherUserId: string;
let tourId: string;
const stopIds: string[] = [];
const names = [1, 2, 3, 4].map((n) => `Trattoria ${n} ${tag}`);

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
  otherUserId = `id2-${tag}`;
  for (const [id, name] of [
    [userId, username],
    [otherUserId, otherUsername],
  ]) {
    await db.query(
      `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
       VALUES ($1,'DRIVER',$2,$3,'de',true,'Today Driver',now())`,
      [id, name, hash],
    );
  }
  const kg = `prod-kg-${tag}`;
  const pack = `prod-pack-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","weightKgPerUnit","updatedAt") VALUES ($1,$2,$3::jsonb,'KG',1,now()), ($4,$5,$6::jsonb,'PACK',3,now())`,
    [
      kg,
      `KG-${tag}`,
      text("Spaghetti lose", "意大利面"),
      pack,
      `PK-${tag}`,
      text("Penne", "笔管面"),
    ],
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
     VALUES ($1,$2,$3,'IN_PROGRESS',$4::jsonb,1,now(),now())`,
    [
      tourId,
      today,
      userId,
      JSON.stringify({ name: "Depot", address: "Graben 1", lat: 48.2082, lng: 16.3738 }),
    ],
  );
  const items = [
    [
      { productId: kg, quantity: 13 },
      { productId: pack, quantity: 4 },
    ],
    [{ productId: kg, quantity: 27 }],
    [
      { productId: kg, quantity: 5 },
      { productId: pack, quantity: 3 },
    ],
    [{ productId: pack, quantity: 1 }],
  ];
  for (let i = 0; i < 4; i++) {
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
      `INSERT INTO "Stop" ("id","tourId","customerId","sequence","status","etaAt","legDurationS","items","completedAt")
       VALUES ($1,$2,$3,$4,$5::"StopStatus",$6,600,$7::jsonb,$8)`,
      [
        stopId,
        tourId,
        customerId,
        i + 1,
        i === 0 ? "DELIVERED" : "PENDING",
        new Date(today.getTime() + (8 + i) * 3600_000),
        JSON.stringify(items[i]),
        i === 0 ? new Date() : null,
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
    .query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1 OR "key" LIKE $2`, [
      `%${username}%`,
      `%${otherUsername}%`,
    ])
    .catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" IN ($1,$2)`, [userId, otherUserId]);
  await db.end();
});

async function login(page: Page, name = username) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(name);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe.configure({ mode: "serial" });

for (const locale of LOCALES) {
  test(`today's tour at 375 px in ${locale}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page);
    await page.goto(`/${locale}/driver`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);

    // Progress: stop 1 is delivered, the next stop is the lowest PENDING one (stop 2).
    await expect(page.getByTestId("progress-count")).toHaveText(/1\s*\/\s*4/);
    const next = page.getByTestId("next-stop");
    await expect(next.getByTestId("next-stop-name")).toHaveText(names[1]);
    await expect(next.getByTestId("stop-number")).toHaveText("2");
    await expect(next.getByTestId("next-stop-address")).toContainText("Hauptstraße 1, 1010 Wien");
    await expect(next.getByTestId("summary-total")).toHaveCount(1);
    await expect(next.getByTestId("summary-total")).toContainText("27");
    await expect(page.getByTestId("remaining")).toBeVisible();
    await expect(page.getByTestId("updated-banner")).toHaveCount(0);

    // Navigate uses the pinned coordinates.
    await expect(next.getByTestId("navigate")).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=48.21,16.38&travelmode=driving",
    );

    // The list shows no quantities, weights or totals (owner 2026-11-16): only the next stop does.
    const row3 = page.locator(`[data-testid="stop-row"][data-stop-id="${stopIds[2]}"]`);
    await expect(row3).toBeVisible();
    await expect(row3.getByTestId("summary-total")).toHaveCount(0);
    await expect(row3.getByTestId("item-summary")).toHaveCount(0);

    // List: the three open stops. A delivered stop leaves the driver's list (owner 2026-11-14:
    // the driver sees no history), only the progress counts it.
    await expect(page.getByTestId("stop-row")).toHaveCount(3);
    await expect(
      page.locator(`[data-testid="stop-row"][data-stop-id="${stopIds[0]}"]`),
    ).toHaveCount(0);

    // Driver UI rules: touch targets >= 48 px, body >= 16 px, quantities >= 28 px bold.
    for (const id of ["navigate", "details", "view-list", "view-map"]) {
      const box = await page.getByTestId(id).first().boundingBox();
      expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(48);
    }
    const quantity = await next
      .getByTestId("summary-total")
      .locator("strong")
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
      });
    expect(quantity.size).toBeGreaterThanOrEqual(28);
    expect(quantity.weight).toBeGreaterThanOrEqual(700);
    const body = await page
      .getByTestId("next-stop-address")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(body).toBeGreaterThanOrEqual(16);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`today-list-${locale}.png`),
      fullPage: true,
    });

    // Map view: numbered markers for the three open stops (the delivered one is gone there too).
    await page.getByTestId("view-map").click();
    await expect(page.getByTestId("tour-map")).toBeVisible();
    await expect(page.getByTestId("stop-marker")).toHaveCount(3);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`today-map-${locale}.png`) });
    expect(errors).toEqual([]);
  });
}

test("the whole next-stop card opens the detail; 'Navigation starten' does not (NUD-143)", async ({
  page,
  context,
}) => {
  await login(page);
  await context.route("https://www.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }),
  );
  const next = page.getByTestId("next-stop");
  const home = page.url();

  // A real pointer tap at the customer name: the stretched link receives it (Playwright's own
  // click() would refuse a target that is covered by the overlay).
  const box = (await next.getByTestId("next-stop-name").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(new RegExp(`/de/driver/stops/${stopIds[1]}$`));

  // Navigation: a new tab with the maps URL, the app stays where it is.
  await page.goto(home);
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("next-stop").getByTestId("navigate").click();
  const popup = await popupPromise;
  expect(popup.url()).toContain("google.com/maps/dir");
  await popup.close();
  expect(page.url()).toBe(home);
});

test("details link opens the stop route, other drivers get 404, next stop advances", async ({
  page,
}) => {
  await login(page);
  await page.getByTestId("details").click();
  await expect(page).toHaveURL(new RegExp(`/de/driver/stops/${stopIds[1]}$`));
  await expect(page.getByTestId("stop-detail")).toContainText(names[1]);

  await page.goto("/de/driver");
  // Pick the row by stop id, not by position.
  await page.locator(`[data-testid="stop-row"][data-stop-id="${stopIds[3]}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/stops/${stopIds[3]}$`));

  // A different driver cannot open this driver's stop.
  const context = await page
    .context()
    .browser()!
    .newContext({ viewport: { width: 375, height: 812 } });
  const other = await context.newPage();
  await login(other, otherUsername);
  await expect(other.getByTestId("empty-state")).toBeVisible();
  await expect(other.getByTestId("today-tour")).toHaveCount(0);
  await other.goto(`/de/driver/stops/${stopIds[1]}`);
  await expect(other.getByTestId("stop-detail")).toHaveCount(0);
  await context.close();

  // Delivering stop 2 moves "next" to stop 3.
  await db.query(`UPDATE "Stop" SET "status"='DELIVERED',"completedAt"=now() WHERE "id"=$1`, [
    stopIds[1],
  ]);
  await page.goto("/de/driver");
  await expect(page.getByTestId("next-stop-name")).toHaveText(names[2]);
  await expect(page.getByTestId("progress-count")).toHaveText(/2\s*\/\s*4/);
  await db.query(`UPDATE "Stop" SET "status"='PENDING',"completedAt"=NULL WHERE "id"=$1`, [
    stopIds[1],
  ]);
});

test("re-released tour: banner, changed-stop highlight, acknowledged once", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto("/de/driver");
  await expect(page.getByTestId("updated-banner")).toHaveCount(0);

  // Re-release (revision 2): stop 3 changed 5 -> 8 kg, stop 4 is new, "Altkunde" was removed.
  const kgId = `prod-kg-${tag}`;
  const packId = `prod-pack-${tag}`;
  await db.query(
    `UPDATE "Stop" SET "items"=$2::jsonb,"previousItems"=$3::jsonb,"changeKind"='CHANGED',"changedInRevision"=2 WHERE "id"=$1`,
    [
      stopIds[2],
      JSON.stringify([
        { productId: kgId, quantity: 8 },
        { productId: packId, quantity: 3 },
      ]),
      JSON.stringify([
        { productId: kgId, quantity: 5 },
        { productId: packId, quantity: 3 },
      ]),
    ],
  );
  await db.query(`UPDATE "Stop" SET "changeKind"='ADDED',"changedInRevision"=2 WHERE "id"=$1`, [
    stopIds[3],
  ]);
  await db.query(
    `UPDATE "Tour" SET "releaseRevision"=2,"reReleasedAt"=now(),"lastChange"=$2::jsonb WHERE "id"=$1`,
    [
      tourId,
      JSON.stringify({
        revision: 2,
        removed: [{ customerId: "gone", customerNumber: "K0", name: "Altkunde GmbH" }],
      }),
    ],
  );
  await page.goto("/de/driver");
  const banner = page.getByTestId("updated-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Altkunde GmbH");
  const highlights = page.getByTestId("stop-change");
  await expect(highlights).toHaveCount(2);
  await expect(page.getByTestId("change-item")).toContainText("Spaghetti lose");
  await expect(page.getByTestId("change-item")).toContainText("5");
  await expect(page.getByTestId("change-item")).toContainText("8");
  expect(await noHorizontalScroll(page)).toBe(true);
  const ack = await page.getByTestId("updated-ack").boundingBox();
  expect(ack?.height ?? 0).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: testInfo.outputPath("today-updated-de.png"), fullPage: true });

  // The banner is kept across reloads until acknowledged, then gone for this revision.
  await page.reload();
  await expect(banner).toBeVisible();
  await page.getByTestId("updated-ack").click();
  await expect(banner).toHaveCount(0);
  await expect(highlights).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("today-tour")).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Quantities shown (on the stop itself) are the released ones.
  await page.goto(`/de/driver/stops/${stopIds[2]}`);
  await expect(page.locator('[data-testid="item-quantity"]:visible').first()).toContainText("8");
});
