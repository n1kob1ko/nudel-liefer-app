import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

import {
  followLinkOffline,
  gotoSettled,
  installNetworkEmulation,
  setOnline,
} from "./helpers/network";

// NUD-082. Needs DATABASE_URL and a PRODUCTION build (`pnpm build && pnpm start`, the service
// worker only exists there; the build needs the S3_* variables like every spec that loads the
// tour). Own driver, product, customers and a released tour for TODAY in the factory time zone, no
// photos. Phone viewport. The network is cut with the helper of NUD-081 (`setOnline`).
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `outb${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const COUNT = 5;

let db: Client;
let userId: string;
let tourId: string;
const stopIds: string[] = [];
const names = Array.from({ length: COUNT }, (_, i) => `Trattoria ${i + 1} ${tag}`);

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const hash = await bcrypt.hash(PIN, 10);
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Outbox Driver',now())`,
    [userId, username, hash],
  );
  const kg = `prod-kg-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","weightKgPerUnit","updatedAt") VALUES ($1,$2,$3::jsonb,'KG',1,now())`,
    [
      kg,
      `KG-${tag}`,
      JSON.stringify({
        de: "Spaghetti lose",
        "zh-Hans": "意大利面",
        en: "Spaghetti lose (en)",
        "sr-Latn": "Spaghetti lose (sr)",
        cs: "Spaghetti lose (cs)",
        meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
      }),
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
     VALUES ($1,$2,$3,'RELEASED',$4::jsonb,1,now(),now())`,
    [
      tourId,
      today,
      userId,
      JSON.stringify({ name: "Depot", address: "Graben 1", lat: 48.2082, lng: 16.3738 }),
    ],
  );
  for (let i = 0; i < COUNT; i++) {
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
        JSON.stringify([{ productId: kg, quantity: 5 + i }]),
      ],
    );
  }
});

test.afterAll(async () => {
  await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]);
  await db.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
  await db.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
  await db.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`cust-%-${tag}`]);
  await db.query(`DELETE FROM "Product" WHERE "id" LIKE $1`, [`prod-%-${tag}`]);
  await db.query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${tag}%`]).catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
  await db.end();
});

async function resetState() {
  await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stopIds]);
  await db.query(
    `UPDATE "Stop" SET "status"='PENDING', "problemReason"=NULL, "problemNote"=NULL, "completedAt"=NULL, "clientMutationId"=NULL, "adminChangedAt"=NULL WHERE "tourId"=$1`,
    [tourId],
  );
  await db.query(`UPDATE "Tour" SET "status"='RELEASED', "completedAt"=NULL WHERE "id"=$1`, [
    tourId,
  ]);
}

const stopRow = async (i: number) =>
  (await db.query(`SELECT * FROM "Stop" WHERE "id"=$1`, [stopIds[i]])).rows[0];
const statuses = async () =>
  (
    await db.query(`SELECT "status" FROM "Stop" WHERE "tourId"=$1 ORDER BY "sequence"`, [tourId])
  ).rows.map((r) => r.status as string);
const mutationRows = async () =>
  (
    await db.query(
      `SELECT "id","stopId","kind" FROM "StopMutation" WHERE "stopId" = ANY($1) ORDER BY "createdAt"`,
      [stopIds],
    )
  ).rows as Array<{ id: string; stopId: string; kind: string }>;

async function login(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(PIN);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
}

/** Logged in, tour stored, the worker controls the page. */
async function readyOffline(page: Page) {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
}

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const stopUrl = (i: number) => new RegExp(`/de/driver/stops/${stopIds[i]}$`);
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Retries while a navigation destroys the page's execution context. */
async function eventually<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

const outboxRows = (page: Page) =>
  eventually(() =>
    page.evaluate(
      () =>
        new Promise<Array<{ clientMutationId: string; type: string; stopId: string }>>(
          (resolve, reject) => {
            const open = indexedDB.open("nudel-driver-offline");
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const database = open.result;
              if (!database.objectStoreNames.contains("outbox")) {
                database.close();
                resolve([]);
                return;
              }
              const all = database.transaction("outbox").objectStore("outbox").getAll();
              all.onsuccess = () => {
                database.close();
                resolve(all.result);
              };
              all.onerror = () => reject(all.error);
            };
          },
        ),
    ),
  );

/** The batch requests the server actually answered (attempts that fail offline are not counted). */
function watchSync(page: Page) {
  const bodies: Array<{ entries: Array<{ clientMutationId: string; type: string }> }> = [];
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "POST" && request.url().endsWith("/api/driver/sync")) {
      bodies.push(JSON.parse(request.postData() ?? "{}"));
    }
  });
  return bodies;
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await installNetworkEmulation(context);
  await resetState();
});

test("the sync API is DRIVER-only and accepts nothing without a session", async ({
  playwright,
  baseURL,
}) => {
  const anon = await playwright.request.newContext({ baseURL });
  const res = await anon.post("/api/driver/sync", {
    data: { entries: [] },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  await anon.dispose();
});

test("offline: three stops marked delivered are sent after reconnecting, exactly once each (375 px)", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await readyOffline(page);
  const syncBodies = watchSync(page);

  await setOnline(context, page, false);
  {
    await gotoSettled(page, `/de/driver/stops/${stopIds[0]}`);
    await expect(page.getByTestId("offline-bar")).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await expect(page).toHaveURL(stopUrl(i));
      await expect(visible(page, "btn-delivered")).toBeEnabled();
      if (i === 0) {
        await expect(visible(page, "status-offline-notice")).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath("outbox-offline-stop.png") });
      }
      await visible(page, "btn-delivered").click();
      // The stop shows its result at once (no automatic jump, NUD-176); the badge counts what waits
      // on the phone, and the result card leads on to the next stop, offline too.
      await expect(visible(page, "stop-result")).toHaveAttribute("data-status", "DELIVERED");
      await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", String(i + 1));
      await followLinkOffline(page, visible(page, "next-stop-action"), stopUrl(i + 1));
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("outbox-offline-badge.png") });

    // Nothing reached the server, but the tour screen already counts the three stops.
    expect(await statuses()).toEqual(Array(COUNT).fill("PENDING"));
    expect(await mutationRows()).toEqual([]);
    await expect(async () => {
      await gotoSettled(page, "/de/driver");
      await expect(visible(page, "progress-count")).toHaveText(/3\s*\/\s*5/, { timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "3");
    expect(await outboxRows(page)).toHaveLength(3);
    expect(syncBodies.flatMap((b) => b.entries)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("outbox-offline-list.png"),
      fullPage: true,
    });

    // A stop that waits to be sent says so on its result card.
    await gotoSettled(page, `/de/driver/stops/${stopIds[0]}`);
    await expect(visible(page, "stop-result")).toHaveAttribute("data-status", "DELIVERED");
    await expect(visible(page, "stop-pending-sync")).toBeVisible();
  }

  const reconnected = new Date();
  await setOnline(context, page, true);
  await expect
    .poll(statuses, { timeout: 40_000 })
    .toEqual(["DELIVERED", "DELIVERED", "DELIVERED", "PENDING", "PENDING"]);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await outboxRows(page)).length).toBe(0);

  // Exactly three updates, no duplicates; the time of each stop is the time of the tap.
  const rows = await mutationRows();
  expect(rows.map((r) => r.stopId).sort()).toEqual(stopIds.slice(0, 3).sort());
  expect(rows.every((r) => r.kind === "COMPLETE")).toBe(true);
  for (let i = 0; i < 3; i++) {
    const row = await stopRow(i);
    expect(row.clientMutationId).not.toBeNull();
    expect(new Date(row.completedAt).getTime()).toBeLessThan(reconnected.getTime());
  }
  expect(
    (await db.query(`SELECT "status" FROM "Tour" WHERE "id"=$1`, [tourId])).rows[0].status,
  ).toBe("IN_PROGRESS");

  // The live pages show the server's state and a second sync changes nothing.
  await page.goto("/de/driver");
  await expect(visible(page, "progress-count")).toHaveText(/3\s*\/\s*5/);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("outbox-synced-list.png"), fullPage: true });
  await page.reload();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  expect(await mutationRows()).toHaveLength(3);
  expect(await statuses()).toEqual(["DELIVERED", "DELIVERED", "DELIVERED", "PENDING", "PENDING"]);
  expect(errors).toEqual([]);
});

test("undo while offline removes the queued tap instead of sending two", async ({
  page,
  context,
}, testInfo) => {
  await readyOffline(page);
  const syncBodies = watchSync(page);
  await setOnline(context, page, false);
  await gotoSettled(page, `/de/driver/stops/${stopIds[3]}`);
  await expect(page).toHaveURL(stopUrl(3));
  await visible(page, "btn-delivered").click();
  await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");
  expect(await outboxRows(page)).toHaveLength(1);

  // The screen stays on the stop (NUD-176): the result card offers Undo for a tap that has not
  // been sent.
  await expect(visible(page, "stop-result")).toBeVisible();
  await expect(page).toHaveURL(stopUrl(3));
  await expect(visible(page, "stop-pending-sync")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("outbox-undo-offer.png") });
  await visible(page, "undo").click();
  await expect(page).toHaveURL(stopUrl(3));
  await expect(visible(page, "btn-delivered")).toBeVisible();
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  expect(await outboxRows(page)).toEqual([]);

  await setOnline(context, page, true);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000); // time for a (wrong) flush to happen
  expect(syncBodies.flatMap((b) => b.entries)).toEqual([]);
  expect(await statuses()).toEqual(Array(COUNT).fill("PENDING"));
  expect(await mutationRows()).toEqual([]);
});

test("undo of a confirmed stop while offline is queued and applied after reconnecting", async ({
  page,
  context,
}) => {
  await readyOffline(page);
  await page.goto(`/de/driver/stops/${stopIds[4]}`);
  await visible(page, "btn-delivered").click();
  await expect.poll(async () => (await stopRow(4)).status).toBe("DELIVERED");
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  // The offline copy follows the confirmed state before the connection drops.
  await expect.poll(async () => (await outboxRows(page)).length).toBe(0);
  await page.waitForTimeout(1_000);

  await setOnline(context, page, false);
  await gotoSettled(page, `/de/driver/stops/${stopIds[4]}`);
  await expect(visible(page, "stop-result")).toHaveAttribute("data-status", "DELIVERED");
  await visible(page, "undo").click();
  await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");
  await expect(visible(page, "btn-delivered")).toBeVisible();
  expect((await outboxRows(page)).map((r) => r.type)).toEqual(["undo"]);

  await setOnline(context, page, true);
  await expect.poll(async () => (await stopRow(4)).status, { timeout: 40_000 }).toBe("PENDING");
  expect((await mutationRows()).map((r) => r.kind)).toEqual(["COMPLETE", "UNDO"]);
  await expect(page.getByTestId("pending-badge")).toHaveCount(0, { timeout: 30_000 });
});

test("conflict: the office changed the stop after the offline tap, the server state wins and the driver is told", async ({
  page,
  context,
}, testInfo) => {
  await readyOffline(page);
  await setOnline(context, page, false);
  await gotoSettled(page, `/de/driver/stops/${stopIds[4]}`);
  await expect(page).toHaveURL(stopUrl(4));
  await visible(page, "btn-delivered").click();
  await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", "1");

  // The office re-releases the tour with a new quantity for this stop while the driver is offline.
  await page.waitForTimeout(1_200);
  await db.query(
    `UPDATE "Stop" SET "items"=jsonb_set("items",'{0,quantity}','999'), "adminChangedAt"=now(), "changeKind"='CHANGED', "changedInRevision"=2 WHERE "id"=$1`,
    [stopIds[4]],
  );
  await db.query(`UPDATE "Tour" SET "releaseRevision"=2, "reReleasedAt"=now() WHERE "id"=$1`, [
    tourId,
  ]);

  await setOnline(context, page, true);
  const notice = page.getByTestId("sync-notice");
  await expect(notice).toBeVisible({ timeout: 40_000 });
  await expect(notice).toHaveAttribute("data-error", "changed_by_office");
  await expect(notice).toContainText(names[4]!);
  await expect(notice).toContainText("Das Büro hat diesen Stopp geändert");
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("outbox-conflict-notice.png") });

  // The stop is untouched on the server and open again on the screen, with the office's quantity.
  expect((await stopRow(4)).status).toBe("PENDING");
  expect(await mutationRows()).toEqual([]);
  await page.goto(`/de/driver/stops/${stopIds[4]}`);
  await expect(visible(page, "btn-delivered")).toBeVisible();
  await expect(visible(page, "stop-items")).toContainText(/999/);
  // The notice stays until it is acknowledged, also across a reload.
  await expect(page.getByTestId("sync-notice")).toBeVisible();
  await page.getByTestId("sync-notice-dismiss").click();
  await expect(page.getByTestId("sync-notice")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sync-notice")).toHaveCount(0);
  expect(await outboxRows(page)).toEqual([]);
});
