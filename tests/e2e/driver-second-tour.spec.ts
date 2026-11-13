import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

import {
  followLinkOffline,
  gotoSettled,
  installNetworkEmulation,
  setOnline,
} from "./helpers/network";
import { png } from "./helpers/png";

// NUD-118. A driver finishes tour 1 and the office releases a follow-up tour the same day. Needs
// DATABASE_URL, S3_* and a PRODUCTION build (the service worker only exists there). Own driver,
// product, customers and TWO tours for TODAY in the factory time zone (the tour API only answers
// for today); everything is removed afterwards. Phone viewport. The network is cut with the helper
// of NUD-081 (`setOnline`).
test.use({ viewport: { width: 375, height: 812 } });

const PIN = "482916";
const tag = `sec${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
const username = `drv-${tag}`;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let db: Client;
let userId: string;
const tour1 = `tour1-${tag}`;
const tour2 = `tour2-${tag}`;
// Tour 1: customers 0 and 1. Follow-up: customers 1 and 2 (customer 1 is delivered twice).
const stop1 = [`s1a-${tag}`, `s1b-${tag}`];
const stop2 = [`s2a-${tag}`, `s2b-${tag}`];
const names = [0, 1, 2].map((n) => `Trattoria ${n + 1} ${tag}`);
const photoKeys: string[] = [];

const text = (de: string) =>
  JSON.stringify({ de, meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" } });

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const hash = await bcrypt.hash(PIN, 10);
  userId = `id-${tag}`;
  await db.query(
    `INSERT INTO "User" ("id","role","username","passwordHash","locale","localeChosen","displayName","updatedAt")
     VALUES ($1,'DRIVER',$2,$3,'de',true,'Second Tour Driver',now())`,
    [userId, username, hash],
  );
  const pack = `prod-pack-${tag}`;
  await db.query(
    `INSERT INTO "Product" ("id","sku","name","unit","weightKgPerUnit","updatedAt") VALUES ($1,$2,$3::jsonb,'PACK',3,now())`,
    [pack, `PK-${tag}`, text("Penne")],
  );
  const settings = (await db.query(`SELECT "timezone" FROM "Settings"`)).rows[0] as {
    timezone: string;
  };
  const tz = settings?.timezone ?? "Europe/Vienna";
  const today = (await db.query(`SELECT (now() AT TIME ZONE $1)::date AS d`, [tz])).rows[0]
    .d as Date;
  const depot = JSON.stringify({ name: "Depot", address: "Graben 1", lat: 48.2082, lng: 16.3738 });
  // The follow-up is created later than tour 1 (that is what "Tour 2" means) and not released yet.
  await db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","releasedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,'RELEASED',$4::jsonb,1,now(),now() - interval '2 hours',now())`,
    [tour1, today, userId, depot],
  );
  await db.query(
    `INSERT INTO "Tour" ("id","date","driverId","status","depotSnapshot","releaseRevision","createdAt","updatedAt")
     VALUES ($1,$2,$3,'OPTIMIZED',$4::jsonb,0,now() - interval '1 hour',now())`,
    [tour2, today, userId, depot],
  );

  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
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
    const key = `customers/${tag}-${i}s.png`;
    photoKeys.push(key);
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        ContentType: "image/png",
        Body: png(800, 600, [60 + i * 60, 120, 60]),
      }),
    );
    await db.query(
      `INSERT INTO "Photo" ("id","customerId","kind","storageKey","width","height","bytes","uploadedById","isCurrent")
       VALUES ($1,$2,'STORE'::"PhotoKind",$3,800,600,100,$4,true)`,
      [`photo-${i}-${tag}`, customerId, key, userId],
    );
  }
  const insertStop = (id: string, tourId: string, customer: number, sequence: number) =>
    db.query(
      `INSERT INTO "Stop" ("id","tourId","customerId","sequence","status","etaAt","legDurationS","items")
       VALUES ($1,$2,$3,$4,'PENDING',$5,600,$6::jsonb)`,
      [
        id,
        tourId,
        `cust-${customer}-${tag}`,
        sequence,
        new Date(today.getTime() + (8 + sequence) * 3600_000),
        JSON.stringify([{ productId: pack, quantity: 3 + customer }]),
      ],
    );
  await insertStop(stop1[0]!, tour1, 0, 1);
  await insertStop(stop1[1]!, tour1, 1, 2);
  await insertStop(stop2[0]!, tour2, 1, 1);
  await insertStop(stop2[1]!, tour2, 2, 2);
});

test.afterAll(async () => {
  const stops = [...stop1, ...stop2];
  await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stops]);
  await db.query(`DELETE FROM "Stop" WHERE "id" = ANY($1)`, [stops]);
  await db.query(`DELETE FROM "Tour" WHERE "id" = ANY($1)`, [[tour1, tour2]]);
  await db.query(`DELETE FROM "Photo" WHERE "id" LIKE $1`, [`photo-%-${tag}`]);
  await db.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`cust-%-${tag}`]);
  await db.query(`DELETE FROM "Product" WHERE "id" LIKE $1`, [`prod-%-${tag}`]);
  await db.query(`DELETE FROM "LoginAttempt" WHERE "key" LIKE $1`, [`%${tag}%`]).catch(() => {});
  await db.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
  await db.end();
});

async function resetState() {
  const stops = [...stop1, ...stop2];
  await db.query(`DELETE FROM "StopMutation" WHERE "stopId" = ANY($1)`, [stops]);
  await db.query(
    `UPDATE "Stop" SET "status"='PENDING', "problemReason"=NULL, "problemNote"=NULL, "completedAt"=NULL, "clientMutationId"=NULL, "adminChangedAt"=NULL WHERE "id" = ANY($1)`,
    [stops],
  );
  await db.query(`UPDATE "Tour" SET "status"='RELEASED', "completedAt"=NULL WHERE "id"=$1`, [
    tour1,
  ]);
  await db.query(
    `UPDATE "Tour" SET "status"='OPTIMIZED', "releasedAt"=NULL, "releaseRevision"=0 WHERE "id"=$1`,
    [tour2],
  );
}

/** The office releases the follow-up tour (what "Freigeben" does to the row). */
const releaseFollowUp = () =>
  db.query(
    `UPDATE "Tour" SET "status"='RELEASED', "releasedAt"=now(), "releaseRevision"=1 WHERE "id"=$1`,
    [tour2],
  );

const tourStatus = async (id: string) =>
  (await db.query(`SELECT "status" FROM "Tour" WHERE "id"=$1`, [id])).rows[0]?.status as string;

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

/** Logged in, tour and ALL photos stored, the worker controls the page. */
async function readyOffline(page: Page) {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
}

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

const storedTourId = (page: Page) =>
  eventually(() =>
    page.evaluate(
      () =>
        new Promise<string | null>((resolve, reject) => {
          const open = indexedDB.open("nudel-driver-offline");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            if (!database.objectStoreNames.contains("tours")) {
              database.close();
              resolve(null);
              return;
            }
            const all = database.transaction("tours").objectStore("tours").getAll();
            all.onsuccess = () => {
              database.close();
              resolve(
                (all.result[0] as { data: { tour: { id: string } | null } })?.data.tour?.id ?? null,
              );
            };
            all.onerror = () => reject(all.error);
          };
        }),
    ),
  );

const photoCacheIds = (page: Page) =>
  eventually(() =>
    page.evaluate(async () => {
      if (!(await caches.has("nudel-driver-photos-v1"))) return [];
      const cache = await caches.open("nudel-driver-photos-v1");
      return (await cache.keys()).map((r) => new URL(r.url).pathname.split("/").pop() ?? "").sort();
    }),
  );

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Tour 2 on the screen: label, its own stops, no "tour finished" card, nothing of tour 1 left over. */
async function expectSecondTour(page: Page) {
  const badge = page.getByTestId("tour-badge");
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveAttribute("data-tour-number", "2");
  await expect(badge).toContainText("Tour 2 von 2");
  await expect(badge).toContainText("Folgetour");
  await expect(page.getByTestId("all-done")).toHaveCount(0);
  await expect(page.getByTestId("next-stop-name")).toHaveText(names[1]!);
  await expect(page.getByTestId("progress-count")).toHaveText(/0\s*\/\s*2/);
  expect(await noHorizontalScroll(page)).toBe(true);
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await installNetworkEmulation(context);
  await resetState();
});

test("warm cache with queued taps: tour 1 finished offline, the follow-up replaces it after reconnecting, no logout (375 px)", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await readyOffline(page);
  expect(await storedTourId(page)).toBe(tour1);
  expect(await photoCacheIds(page)).toEqual([`photo-0-${tag}`, `photo-1-${tag}`]);
  // A single tour so far: no label.
  await expect(page.getByTestId("tour-badge")).toHaveCount(0);

  await setOnline(context, page, false);
  {
    await gotoSettled(page, `/de/driver/stops/${stop1[0]}`);
    await expect(page.getByTestId("offline-bar")).toBeVisible();
    for (let i = 0; i < 2; i++) {
      await expect(visible(page, "btn-delivered")).toBeEnabled();
      await visible(page, "btn-delivered").click();
      await expect(page.getByTestId("pending-badge")).toHaveAttribute("data-count", String(i + 1));
      // No automatic jump (NUD-176): the result card leads on to the second stop.
      if (i === 0) {
        await followLinkOffline(
          page,
          visible(page, "next-stop-action"),
          new RegExp(`/de/driver/stops/${stop1[1]}$`),
        );
      }
    }
    // Both taps wait on the phone; the cached tour 1 is "finished" on the screen.
    await expect(async () => {
      await gotoSettled(page, "/de/driver");
      await expect(visible(page, "all-done")).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    expect(await tourStatus(tour1)).toBe("RELEASED");
  }

  // While the driver is offline the office releases the follow-up tour.
  await releaseFollowUp();

  await setOnline(context, page, true);
  // The queued taps reach the server exactly once (tour 1 completes) ...
  await expect.poll(() => tourStatus(tour1), { timeout: 40_000 }).toBe("COMPLETED");
  await expect(page.getByTestId("pending-badge")).toHaveCount(0, { timeout: 30_000 });
  // ... and the same session now shows the follow-up: label, its stops, no "tour finished".
  await expectSecondTour(page);
  await expect(page).toHaveURL(/\/de\/driver$/);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("second-tour-online.png") });

  // The offline copy follows: tour 2 in IndexedDB, the photos of tour 2 (customer 0's is gone).
  await expect.poll(() => storedTourId(page), { timeout: 30_000 }).toBe(tour2);
  await expect
    .poll(() => photoCacheIds(page), { timeout: 30_000 })
    .toEqual([`photo-1-${tag}`, `photo-2-${tag}`]);

  // And it works offline: the cold offline shell lists tour 2, not the finished one.
  await setOnline(context, page, false);
  try {
    await gotoSettled(page, "/de/driver");
    await expect(page.getByTestId("offline-bar")).toBeVisible();
    await expectSecondTour(page);
    await page.screenshot({ path: testInfo.outputPath("second-tour-offline.png") });
  } finally {
    await setOnline(context, page, true);
  }
  expect(errors).toEqual([]);
});

test("the finished screen does not hide a follow-up released while the app stays open (no focus, no reload)", async ({
  page,
}) => {
  // Fake timers from the start (time keeps flowing): the app's own 5-minute interval is then fast-forwardable.
  await page.clock.install();
  await readyOffline(page);
  // Tour 1 is done on the server; the open page shows "all done".
  await db.query(
    `UPDATE "Stop" SET "status"='DELIVERED', "completedAt"=now() WHERE "id" = ANY($1)`,
    [stop1],
  );
  await db.query(`UPDATE "Tour" SET "status"='COMPLETED', "completedAt"=now() WHERE "id"=$1`, [
    tour1,
  ]);
  await page.reload();
  await expect(visible(page, "all-done")).toBeVisible();
  await expect(page.getByTestId("tour-badge")).toHaveCount(0);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  expect(await storedTourId(page)).toBe(tour1);

  await releaseFollowUp();
  // Only the 5-minute timer of the app runs: no visibility change, no "online" event.
  await page.clock.fastForward(5 * 60_000 + 1_000);
  await expectSecondTour(page);
  expect(await storedTourId(page)).toBe(tour2);
});

test("the tour 2 label is also there when the app is opened fresh and the follow-up is already released", async ({
  page,
}) => {
  await db.query(
    `UPDATE "Stop" SET "status"='DELIVERED', "completedAt"=now() WHERE "id" = ANY($1)`,
    [stop1],
  );
  await db.query(`UPDATE "Tour" SET "status"='COMPLETED', "completedAt"=now() WHERE "id"=$1`, [
    tour1,
  ]);
  await releaseFollowUp();
  await login(page);
  await expectSecondTour(page);
});
