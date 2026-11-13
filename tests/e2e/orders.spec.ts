import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// Needs a seeded database (`pnpm db:seed`: the three catalog products), DATABASE_URL and
// SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return true;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
      .slice(0, 6)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    throw new Error(`overflow: ${wide.join(" | ")}`);
  });

type Fixture = {
  client: Client;
  tag: string;
  confirmed: { id: string; number: string; name: string };
  unconfirmed: { id: string; number: string; name: string };
  archived: { id: string; number: string; name: string };
  cleanup: () => Promise<void>;
};

async function fixture(projectName: string): Promise<Fixture> {
  const tag = `e2eo${projectName.slice(0, 1)}${Date.now() % 1e8}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const insert = async (suffix: string, pinConfirmed: boolean, active: boolean) => {
    const number = `${tag}-${suffix}`;
    const name = `Trattoria ${suffix} ${tag}`;
    const id = `id-${tag}-${suffix}`;
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","pinConfirmed","active","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',$4,$5,now())`,
      [id, number, name, pinConfirmed, active],
    );
    return { id, number, name };
  };
  const confirmed = await insert("A", true, true);
  const unconfirmed = await insert("B", false, true);
  const archived = await insert("C", true, false);
  return {
    client,
    tag,
    confirmed,
    unconfirmed,
    archived,
    cleanup: async () => {
      await client.query(
        `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "customerId" LIKE $1)`,
        [`id-${tag}-%`],
      );
      await client.query(`DELETE FROM "Order" WHERE "customerId" LIKE $1`, [`id-${tag}-%`]);
      await client.query(`DELETE FROM "Customer" WHERE "id" LIKE $1`, [`id-${tag}-%`]);
      await client.end();
    },
  };
}

async function pickCustomer(page: Page, search: string, optionName: string | RegExp) {
  await page.locator("#order-customer").click();
  await page.getByPlaceholder("Nach Name oder Nummer suchen").fill(search);
  await page.getByRole("option", { name: optionName }).click();
}

test("manual order entry: three lines via keyboard, saved and visible in the list", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const f = await fixture(testInfo.project.name);
  try {
    await loginAdmin(page);
    await page.goto("/de/admin/orders/new");
    await expect(page.getByTestId("section-title")).toHaveText("Neue Bestellung");

    // The window starts at the next delivery day (NUD-012 default); the planned day stays empty
    // (= automatic, NUD-148).
    const dateValue = await page.getByTestId("order-window-from").inputValue();
    await expect(page.getByTestId("order-date")).toHaveValue("");
    expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateValue > new Date().toISOString().slice(0, 10)).toBe(true);

    // Archived customers are never offered; active ones (also with unconfirmed pin) are.
    await page.locator("#order-customer").click();
    await page.getByPlaceholder("Nach Name oder Nummer suchen").fill(f.tag);
    await expect(page.getByRole("option", { name: new RegExp(f.unconfirmed.number) })).toHaveCount(
      1,
    );
    await expect(page.getByRole("option", { name: new RegExp(f.archived.number) })).toHaveCount(0);
    await page.getByRole("option", { name: new RegExp(f.confirmed.number) }).click();
    await expect(page.getByTestId("order-warnings")).toHaveCount(0);
    await page.getByTestId("order-date").fill("2099-03-02");

    // Line 1: product via picker, quantity with decimal comma, Enter adds the next line.
    const lines = page.getByTestId("order-line");
    const pickProduct = async (index: number, search: string) => {
      const combo = lines.nth(index).getByRole("combobox");
      await combo.click();
      await page.getByPlaceholder("Nach Name oder Artikelnummer suchen").fill(search);
      await page.keyboard.press("Enter");
      await expect(combo).toContainText(search.toUpperCase());
      // The picker closes with an animation; a second open one would make the placeholder ambiguous.
      await expect(page.getByPlaceholder("Nach Name oder Artikelnummer suchen")).toHaveCount(0);
    };
    await pickProduct(0, "BEUTEL");
    await expect(lines.nth(0).getByTestId("line-unit")).toHaveText("Sackerl");
    await lines.nth(0).getByTestId("line-quantity").fill("3");
    await lines.nth(0).getByTestId("line-quantity").press("Enter");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(1).getByRole("combobox")).toBeFocused();

    // Line 2: Enter on an invalid quantity (0, or a decimal such as 2,5) does not add a line.
    await pickProduct(1, "KARTON");
    await lines.nth(1).getByTestId("line-quantity").fill("0");
    await lines.nth(1).getByTestId("line-quantity").press("Enter");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(1).getByTestId("error-line")).toBeVisible();
    await lines.nth(1).getByTestId("line-quantity").fill("2,5");
    await lines.nth(1).getByTestId("line-quantity").press("Enter");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(1).getByTestId("error-line")).toBeVisible();
    await lines.nth(1).getByTestId("line-quantity").fill("4");
    await lines.nth(1).getByTestId("line-quantity").press("Enter");
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(1).getByTestId("error-line")).toHaveCount(0);

    await pickProduct(2, "WANTAN");
    await lines.nth(2).getByTestId("line-quantity").fill("10");
    await page.getByTestId("order-note").fill("Anruf am Vormittag");
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("order-form.png") });

    await page.getByTestId("order-save").click();
    await expect(page).toHaveURL(/\/admin\/orders(\?.*)?$/);

    // Visible in the (placeholder) overview with all three lines.
    const row = page.locator('[data-testid="order-row"]', { hasText: f.confirmed.name });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("order-item")).toHaveCount(3);
    // Unit labels (glossary §3, `driver.units`): "3 Sackerl Nudeln", "10 × Wantan-Teig" (no unit word).
    await expect(row).toContainText("3 Sackerl Nudeln");
    await expect(row).toContainText("4 Kiste Nudeln");
    await expect(row).toContainText("10 × Wantan-Teig");
    await expect(row.getByTestId("order-status")).toHaveText("Bestätigt");
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("order-list.png") });

    // The detail page (title row with its action buttons) fits at phone width too (NUD-129).
    await row.getByTestId("order-open").click();
    await expect(page).toHaveURL(/\/admin\/orders\/[^/?]+$/);
    await expect(page.getByTestId("order-duplicate")).toBeVisible();
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("order-detail.png") });

    const stored = await f.client.query<{
      status: string;
      source: string;
      internalNote: string;
      date: string;
      qty: string[];
    }>(
      `SELECT o."status"::text AS status, o."source"::text AS source, o."internalNote",
              to_char(o."deliveryDate",'YYYY-MM-DD') AS date,
              array_agg(i."quantity"::text ORDER BY i."quantity") AS qty
       FROM "Order" o JOIN "OrderItem" i ON i."orderId"=o."id"
       WHERE o."customerId"=$1 GROUP BY o."id"`,
      [f.confirmed.id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      status: "CONFIRMED",
      source: "MANUAL",
      internalNote: "Anruf am Vormittag",
      date: "2099-03-02",
      qty: ["3", "4", "10"].sort((a, b) => Number(a) - Number(b)),
    });
  } finally {
    await f.cleanup();
  }
});

test("manual order entry: warnings, validation and merged duplicate products", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const f = await fixture(testInfo.project.name);
  try {
    const admin = (await f.client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
      .rows[0] as { id: string };
    await f.client.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,'2099-04-01','2099-04-01','2099-04-01','CONFIRMED','MANUAL',$3,now())`,
      [`ord-${f.tag}`, f.confirmed.id, admin.id],
    );
    await loginAdmin(page);
    await page.goto("/de/admin/orders/new");

    // No pin warning any more (NUD-141): a customer without confirmation is orderable as usual.
    await pickCustomer(page, f.unconfirmed.number, new RegExp(f.unconfirmed.number));
    await expect(page.getByTestId("warning-pin")).toHaveCount(0);
    await expect(page.getByTestId("warning-combined")).toHaveCount(0);
    await expect(noHorizontalScroll(page)).resolves.toBe(true);

    // Customer with a confirmed order on that day: will be combined into one stop.
    await pickCustomer(page, f.confirmed.number, new RegExp(f.confirmed.number));
    await expect(page.getByTestId("warning-pin")).toHaveCount(0);
    await page.getByTestId("order-date").fill("2099-04-01");
    await expect(page.getByTestId("warning-combined")).toContainText("1 bestätigte Bestellung");
    await expect(page.getByTestId("warning-combined")).toContainText("zu einem Stopp");
    await page.getByTestId("order-date").fill("2099-04-02");
    await expect(page.getByTestId("warning-combined")).toHaveCount(0);

    // Validation: no lines, then a product without quantity, then a bad quantity.
    await page.getByTestId("order-save").click();
    await expect(page).toHaveURL(/\/admin\/orders\/new$/);
    await expect(page.getByTestId("error-lines")).toBeVisible();
    const lines = page.getByTestId("order-line");
    const pickProduct = async (index: number, search: string) => {
      const combo = lines.nth(index).getByRole("combobox");
      await combo.click();
      await page.getByPlaceholder("Nach Name oder Artikelnummer suchen").fill(search);
      await page.keyboard.press("Enter");
      await expect(combo).toContainText(search.toUpperCase());
      // The picker closes with an animation; a second open one would make the placeholder ambiguous.
      await expect(page.getByPlaceholder("Nach Name oder Artikelnummer suchen")).toHaveCount(0);
    };
    await pickProduct(0, "BEUTEL");
    await page.getByTestId("order-save").click();
    await expect(lines.nth(0).getByTestId("error-line")).toBeVisible();
    await lines.nth(0).getByTestId("line-quantity").fill("abc");
    await page.getByTestId("order-save").click();
    await expect(lines.nth(0).getByTestId("error-line")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/orders\/new$/);

    // The same product twice is merged on save (quantities added); save as draft.
    await lines.nth(0).getByTestId("line-quantity").fill("2");
    await lines.nth(0).getByTestId("line-quantity").press("Enter");
    await pickProduct(1, "BEUTEL");
    await lines.nth(1).getByTestId("line-quantity").fill("2");
    await expect(page.getByTestId("duplicate-notice")).toBeVisible();
    await page.getByTestId("order-save-draft").click();
    await expect(page).toHaveURL(/\/admin\/orders(\?.*)?$/);

    const row = page.locator('[data-testid="order-row"]', { hasText: f.confirmed.name }).last();
    await expect(row.getByTestId("order-status")).toHaveText("Entwurf");
    await expect(row.getByTestId("order-item")).toHaveCount(1);
    await expect(row).toContainText("4 Sackerl Nudeln");
    const items = await f.client.query<{ status: string; quantity: string }>(
      `SELECT o."status"::text AS status, i."quantity"::text AS quantity
       FROM "Order" o JOIN "OrderItem" i ON i."orderId"=o."id"
       WHERE o."customerId"=$1 AND o."deliveryDate"='2099-04-02'`,
      [f.confirmed.id],
    );
    expect(items.rows).toEqual([{ status: "DRAFT", quantity: "4" }]);
  } finally {
    await f.cleanup();
  }
});

test("order pages require an admin", async ({ page }) => {
  await page.goto("/de/admin/orders/new");
  await expect(page).toHaveURL(/\/de\/login/);
  await page.goto("/de/admin/orders");
  await expect(page).toHaveURL(/\/de\/login/);
});

test("order form warns while entering and editing when the day's tour is completed (NUD-116)", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const f = await fixture(testInfo.project.name);
  const doneDay = "2098-05-04";
  const openDay = "2098-05-05";
  const tourIds = [`tour-${f.tag}-1`, `tour-${f.tag}-2`, `tour-${f.tag}-3`];
  try {
    const admin = (await f.client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
      .rows[0] as { id: string };
    const tour = (id: string, date: string, status: string) =>
      f.client.query(
        `INSERT INTO "Tour" ("id","date","status","depotSnapshot","updatedAt") VALUES ($1,$2,$3::"TourStatus",'{}',now())`,
        [id, date, status],
      );
    await tour(tourIds[0], doneDay, "COMPLETED");
    await tour(tourIds[1], openDay, "COMPLETED"); // all completed ...
    await tour(tourIds[2], openDay, "RELEASED"); // ... except an open follow-up tour
    await f.client.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
      [`ord-${f.tag}`, f.confirmed.id, doneDay, admin.id],
    );
    await loginAdmin(page);
    await page.goto("/de/admin/orders/new");
    const warning = page.getByTestId("warning-tour-completed");
    await pickCustomer(page, f.confirmed.number, new RegExp(f.confirmed.number));
    await page.getByTestId("order-date").fill(doneDay);
    await expect(warning).toContainText("schon abgeschlossen");
    await expect(warning).toContainText("Folgetour");
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.getByTestId("order-date").fill(openDay); // open follow-up tour
    await expect(warning).toHaveCount(0);
    await page.getByTestId("order-date").fill("2098-05-06"); // no tour at all
    await expect(warning).toHaveCount(0);

    // Editing an order on the completed day shows it as well.
    await page.goto(`/de/admin/orders/ord-${f.tag}/edit`);
    await expect(warning).toContainText("schon abgeschlossen");
  } finally {
    await f.client.query(`DELETE FROM "Tour" WHERE "id" = ANY($1)`, [tourIds]);
    await f.cleanup();
  }
});
