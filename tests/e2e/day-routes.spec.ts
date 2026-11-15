import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { expireSettingsCache } from "./helpers/settings";
import { ensureVehicle } from "./helpers/vehicle";

// NUD-212: the route of a delivery day is its standing tour in fixed order plus the extras of that
// day, sent to the driver from the day plan ("An Fahrer senden"). Needs a seeded database
// (product NUDELN-BEUTEL, demo driver fahrer-de), DATABASE_URL and SEED_ADMIN_PASSWORD. The
// fixture confirms the depot pin for its duration and restores the old value afterwards.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await tid(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function fixture() {
  const tag = `e2edr${Date.now() % 1e8}`;
  const year = 2100 + Math.floor(Math.random() * 7000);
  const day = `${year}-06-03`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const admin = (await client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
    .rows[0] as { id: string };
  const product = (await client.query(`SELECT "id" FROM "Product" WHERE "sku"='NUDELN-BEUTEL'`))
    .rows[0].id as string;
  const depot = (
    await client.query(`SELECT "depotLat","depotLng","depotPinConfirmed" FROM "Settings"`)
  ).rows[0] as { depotLat: number; depotLng: number; depotPinConfirmed: boolean };
  const driver = (await client.query(`SELECT "id" FROM "User" WHERE "username"='fahrer-de'`))
    .rows[0].id as string;
  const vehicle = await ensureVehicle(client);
  await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=true`);
  await expireSettingsCache();

  // A and B are the standing customers (east of the depot); X lies between them but belongs to no
  // standing tour: it rides along as an extra of the day.
  const customer = async (suffix: string, offset: number) => {
    const id = `id-${tag}-${suffix}`;
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,true,now())`,
      [id, `${tag}-${suffix}`, `Wok ${suffix} ${tag}`, depot.depotLat, depot.depotLng + offset],
    );
    return { id, name: `Wok ${suffix} ${tag}` };
  };
  const a = await customer("A", 0.01);
  const x = await customer("X", 0.02);
  const b = await customer("B", 0.03);
  const route = `st-${tag}`;
  await client.query(
    `INSERT INTO "StandingTour" ("id","name","sortOrder","driverId","vehicleId","active","updatedAt")
     VALUES ($1,$2,0,$3,$4,true,now())`,
    [route, `Route ${tag}`, driver, vehicle],
  );
  for (const [i, c] of [a, b].entries()) {
    await client.query(
      `INSERT INTO "StandingTourCustomer" ("standingTourId","customerId","sortOrder") VALUES ($1,$2,$3)`,
      [route, c.id, i],
    );
  }
  let n = 0;
  for (const [c, quantity] of [
    [a, 2],
    [x, 1],
    [b, 3],
  ] as const) {
    const id = `ord-${tag}-${n++}`;
    await client.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
      [id, c.id, day, admin.id],
    );
    await client.query(
      `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,$4)`,
      [`oi-${id}`, id, product, quantity],
    );
  }
  return {
    client,
    day,
    route,
    a,
    x,
    b,
    product,
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
      await client.query(`DELETE FROM "StandingTourCustomer" WHERE "standingTourId"=$1`, [route]);
      await client.query(`DELETE FROM "StandingTour" WHERE "id"=$1`, [route]);
      await client.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`id-${tag}-%`]);
      await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=$1`, [depot.depotPinConfirmed]);
      await expireSettingsCache();
      await client.end();
    },
  };
}

test.describe.configure({ mode: "serial" });

test("day plan: the route with its extra goes to the driver, a change is sent again", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough: the phone check is below");
  test.setTimeout(180_000);
  const f = await fixture();
  try {
    await loginAdmin(page);
    // No "Touren" tab any more: the day plan is where routes are sent.
    await expect(page.locator('[data-testid="nav-tours"]')).toHaveCount(0);
    await page.goto(`/de/admin/planning?date=${f.day}`);
    // One tab per route (Kundentreffen 14.11.): open this route's tab.
    await tid(page, `route-tab-${f.route}`).click();
    const card = tid(page, `standing-route-${f.route}`);
    await expect(card).toBeVisible();
    await expect(tid(page, `route-state-${f.route}`)).toHaveText("Nicht gesendet");
    // The extra sits between A and B, where the detour is smallest, with its stop number.
    await expect(tid(page, `extra-${f.x.id}`)).toHaveText("Zusatz");
    await expect(tid(page, `stop-number-${f.a.id}`)).toHaveText("1");
    await expect(tid(page, `stop-number-${f.x.id}`)).toHaveText("2");
    await expect(tid(page, `stop-number-${f.b.id}`)).toHaveText("3");

    await tid(page, "planning-send").click();
    await expect(tid(page, `route-state-${f.route}`)).toHaveText("Beim Fahrer");
    const tour = async () =>
      (
        await f.client.query(
          `SELECT t."id", t."status", t."releaseRevision",
                  array_agg(s."customerId" ORDER BY s."sequence") AS customers
             FROM "Tour" t JOIN "Stop" s ON s."tourId"=t."id"
            WHERE t."date"=$1 AND t."standingTourId"=$2 GROUP BY t."id"`,
          [f.day, f.route],
        )
      ).rows[0] as { id: string; status: string; releaseRevision: number; customers: string[] };
    expect(await tour()).toMatchObject({
      status: "RELEASED",
      releaseRevision: 1,
      customers: [f.a.id, f.x.id, f.b.id],
    });
    await expect(tid(page, `load-sheet-${f.route}`)).toBeVisible();
    await expect(tid(page, "planning-send")).toHaveText("Änderungen senden");

    // A changed quantity waits for "Änderungen senden" (saving and sending in one click).
    await page
      .getByRole("textbox", { name: new RegExp(`^${f.b.name} – `) })
      .first()
      .fill("5");
    await tid(page, "planning-send").click();
    await expect.poll(async () => (await tour()).releaseRevision).toBe(2);
    await expect(tid(page, `route-state-${f.route}`)).toHaveText("Beim Fahrer");
  } finally {
    await f.cleanup();
  }
});

test("day plan: the driver list opens above an open map", async ({ page }) => {
  const f = await fixture();
  try {
    await loginAdmin(page);
    await page.goto(`/de/admin/planning?date=${f.day}`);
    // One tab per route (Kundentreffen 14.11.): open this route's tab.
    await tid(page, `route-tab-${f.route}`).click();
    await tid(page, `route-map-${f.route}`).click();
    await expect(page.locator(".leaflet-container").first()).toBeVisible();
    // A real map tile is an opaque picture; stand one in that covers the whole map.
    await page.evaluate(() => {
      const tile = document.createElement("div");
      tile.setAttribute("data-testid", "fake-tile");
      tile.style.cssText =
        "position:absolute;left:-2000px;top:-2000px;width:5000px;height:5000px;background:#123;";
      document.querySelector(".leaflet-tile-pane")!.appendChild(tile);
    });
    // Every option that lies on the map and is shown must be the topmost thing there. Both lists
    // are opened with their field at the top of the screen, so they fall onto the map.
    const optionsOnMap = async (field: string) => {
      await tid(page, field).evaluate((el) =>
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80),
      );
      await tid(page, field).click();
      await expect(page.getByRole("option").first()).toBeVisible();
      const result = await page.evaluate(() => {
        const map = document.querySelector(".leaflet-container")!.getBoundingClientRect();
        const list = document.querySelector('[role="listbox"]')!.getBoundingClientRect();
        return [...document.querySelectorAll('[role="option"]')].flatMap((option) => {
          const r = option.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const onMap = x > map.left && x < map.right && y > map.top && y < map.bottom;
          const shown = y > list.top && y < list.bottom && y < window.innerHeight;
          if (!onMap || !shown) return [];
          return [Boolean(document.elementFromPoint(x, y)?.closest('[role="option"]'))];
        });
      });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      return result;
    };
    const checked = [
      ...(await optionsOnMap(`driver-${f.route}`)),
      ...(await optionsOnMap(`vehicle-${f.route}`)),
    ];
    const onTop = checked.length > 0 && checked.every(Boolean);
    expect(onTop).toBe(true);
  } finally {
    await f.cleanup();
  }
});

test("day plan on a phone: no sideways scrolling", async ({ page }) => {
  const f = await fixture();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAdmin(page);
    await page.goto(`/de/admin/planning?date=${f.day}`);
    // One tab per route (Kundentreffen 14.11.): open this route's tab.
    await tid(page, `route-tab-${f.route}`).click();
    await expect(tid(page, `standing-route-${f.route}`)).toBeVisible();
    await expect(tid(page, "planning-send")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await f.cleanup();
  }
});
