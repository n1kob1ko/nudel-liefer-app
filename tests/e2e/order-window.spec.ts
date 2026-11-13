import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// NUD-148: requested delivery window instead of a delivery date. Needs the seeded catalog,
// DATABASE_URL and SEED_ADMIN_PASSWORD. The window lies in 2099; "Tuesday" is computed.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

test("order with a delivery window: planned day is chosen, times and a moved day are kept", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "admin screen, desktop only");
  test.setTimeout(150_000);
  const tag = `e2ew${Date.now() % 1e8}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const customerId = `id-${tag}`;
  await client.query(
    `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","active","updatedAt")
     VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',true,now())`,
    [customerId, tag, `Trattoria ${tag}`],
  );
  let tuesday = new Date("2099-08-01T00:00:00Z");
  while (tuesday.getUTCDay() !== 2) tuesday = addDays(tuesday, 1);
  const thursday = addDays(tuesday, 2);
  const saturday = addDays(tuesday, 4);
  try {
    await loginAdmin(page);
    await page.goto("/de/admin/orders/new");
    await page.locator("#order-customer").click();
    await page.getByPlaceholder("Nach Name oder Nummer suchen").fill(tag);
    await page
      .getByRole("option", { name: new RegExp(tag) })
      .first()
      .click();

    await page.getByTestId("order-window-from").fill(iso(tuesday));
    await page.getByTestId("order-window-to").fill(iso(thursday));
    await page.getByTestId("order-window-from-time").fill("08:00");
    await page.getByTestId("order-window-to-time").fill("11:00");
    await expect(page.getByTestId("order-date")).toHaveValue("");

    const combo = page.getByTestId("order-line").first().getByRole("combobox");
    await combo.click();
    await page.getByPlaceholder("Nach Name oder Artikelnummer suchen").fill("BEUTEL");
    await page.keyboard.press("Enter");
    await expect(page.getByPlaceholder("Nach Name oder Artikelnummer suchen")).toHaveCount(0);
    await page.getByTestId("line-quantity").first().fill("2");
    await page.screenshot({ path: testInfo.outputPath("order-window-form.png") });
    await page.getByTestId("order-save").click();
    await expect(page).toHaveURL(/\/admin\/orders(\?.*)?$/);

    const stored = await client.query<{
      day: string;
      from: string;
      to: string;
      ft: string;
      tt: string;
    }>(
      `SELECT to_char("deliveryDate",'YYYY-MM-DD') AS day, to_char("windowFrom",'YYYY-MM-DD') AS "from",
              to_char("windowTo",'YYYY-MM-DD') AS "to", "windowFromTime" AS ft, "windowToTime" AS tt
       FROM "Order" WHERE "customerId"=$1`,
      [customerId],
    );
    expect(stored.rows).toEqual([
      { day: iso(tuesday), from: iso(tuesday), to: iso(thursday), ft: "08:00", tt: "11:00" },
    ]);

    // The list shows the window next to the customer.
    const row = page.locator('[data-testid="order-row"]', { hasText: tag });
    await expect(row.getByTestId("order-window-text")).toContainText("08:00–11:00");

    // Detail shows window and planned day; moving the day outside the window warns but saves.
    const id = (await client.query(`SELECT "id" FROM "Order" WHERE "customerId"=$1`, [customerId]))
      .rows[0].id as string;
    await page.goto(`/de/admin/orders/${id}`);
    await expect(page.getByTestId("detail-window")).toContainText("08:00–11:00");
    await page.goto(`/de/admin/orders/${id}/edit`);
    await expect(page.getByTestId("order-window-from-time")).toHaveValue("08:00");
    // The change handler is attached on hydration: a day filled before that never reaches the
    // form (CI run of 2026-11-13). So the day is set again until the warning shows; it is emptied
    // first, because React ignores a change event that carries the value the field already has.
    await expect(async () => {
      await page.getByTestId("order-date").fill("");
      await page.getByTestId("order-date").fill(iso(saturday));
      await expect(page.getByTestId("warning-outside-window")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByTestId("order-save").click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${id}$`));
    await expect(page.getByTestId("detail-date")).toBeVisible();
    const moved = await client.query(
      `SELECT to_char("deliveryDate",'YYYY-MM-DD') AS day FROM "Order" WHERE "id"=$1`,
      [id],
    );
    expect(moved.rows[0].day).toBe(iso(saturday));
  } finally {
    await client.query(
      `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "customerId"=$1)`,
      [customerId],
    );
    await client.query(`DELETE FROM "Order" WHERE "customerId"=$1`, [customerId]);
    await client.query(`DELETE FROM "Customer" WHERE "id"=$1`, [customerId]);
    await client.end();
  }
});
