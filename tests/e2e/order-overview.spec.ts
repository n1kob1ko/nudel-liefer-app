import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// NUD-032. Needs a seeded database (the three catalog products, NUD-138), DATABASE_URL and
// SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await tid(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

// Next keeps previously visited routes hidden in the DOM; always address the visible element.
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

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

// Far-away days, in a random year per fixture, so that parallel tests (and anything else in the
// database) never see each other's orders.
function days() {
  const year = 2100 + Math.floor(Math.random() * 7000);
  return { D1: `${year}-05-04`, D2: `${year}-05-05`, D3: `${year}-05-06`, year };
}

async function fixture(projectName: string) {
  const tag = `e2ev${projectName.slice(0, 1)}${Date.now() % 1e8}`;
  const { D1, D2, D3, year } = days();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const admin = (await client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
    .rows[0] as { id: string };
  const product = async (sku: string) =>
    (await client.query(`SELECT "id" FROM "Product" WHERE "sku"=$1`, [sku])).rows[0].id as string;
  const [spag, penn] = [await product("NUDELN-BEUTEL"), await product("NUDELN-KARTON")];
  // "Today" as the app sees it: the calendar day in the factory's time zone.
  const today = (
    await client.query(
      `SELECT to_char(now() AT TIME ZONE (SELECT "timezone" FROM "Settings" LIMIT 1),'YYYY-MM-DD') AS s`,
    )
  ).rows[0].s as string;
  const customer = async (suffix: string) => {
    const id = `id-${tag}-${suffix}`;
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',true,now())`,
      [id, `${tag}-${suffix}`, `Osteria ${suffix} ${tag}`],
    );
    return { id, name: `Osteria ${suffix} ${tag}`, number: `${tag}-${suffix}` };
  };
  const a = await customer("A");
  const b = await customer("B");
  const order = async (
    key: string,
    customerId: string,
    date: string,
    status: string,
    source: string,
    items: Array<[string, string]>,
  ) => {
    const id = `ord-${tag}-${key}`;
    await client.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,$4::"OrderStatus",$5::"OrderSource",$6,now())`,
      [id, customerId, date, status, source, admin.id],
    );
    let n = 0;
    for (const [productId, quantity] of items) {
      await client.query(
        `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,$4)`,
        [`oi-${tag}-${key}-${n++}`, id, productId, quantity],
      );
    }
    return id;
  };
  // D1: A confirmed (SPAG 3 + PENN 1), B confirmed (SPAG 4), A cancelled (SPAG 99), B draft (SPAG 77)
  const a1 = await order("a1", a.id, D1, "CONFIRMED", "MANUAL", [
    [spag, "3"],
    [penn, "1"],
  ]);
  const b1 = await order("b1", b.id, D1, "CONFIRMED", "SCREENSHOT", [[spag, "4"]]);
  const a1x = await order("a1x", a.id, D1, "CANCELLED", "MANUAL", [[spag, "99"]]);
  await order("b1d", b.id, D1, "DRAFT", "MANUAL", [[spag, "77"]]);
  // D2: A confirmed (PENN 6)
  const a2 = await order("a2", a.id, D2, "CONFIRMED", "MANUAL", [[penn, "6"]]);
  // A tour on D1 that contains order a1 (stop of customer A).
  const tourId = `tour-${tag}`;
  await client.query(
    `INSERT INTO "Tour" ("id","date","status","depotSnapshot","updatedAt") VALUES ($1,$2,'DRAFT','{}',now())`,
    [tourId, D1],
  );
  await client.query(
    `INSERT INTO "Stop" ("id","tourId","customerId","sequence") VALUES ($1,$2,$3,1)`,
    [`stop-${tag}`, tourId, a.id],
  );
  await client.query(`INSERT INTO "StopOrder" ("stopId","orderId") VALUES ($1,$2)`, [
    `stop-${tag}`,
    a1,
  ]);
  return {
    client,
    tag,
    a,
    b,
    D1,
    D2,
    D3,
    year,
    today,
    ids: { a1, b1, a1x, a2 },
    tourId,
    cleanup: async () => {
      await client.query(`DELETE FROM "StopOrder" WHERE "stopId"=$1`, [`stop-${tag}`]);
      await client.query(`DELETE FROM "Stop" WHERE "tourId"=$1`, [tourId]);
      await client.query(`DELETE FROM "Tour" WHERE "id"=$1`, [tourId]);
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

test("order overview: default date, filters, totals per date, in-tour badge", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const f = await fixture(testInfo.project.name);
  const { D1, D2 } = f;
  try {
    await loginAdmin(page);

    // Default filter = today in the factory's time zone (NUD-179; one day, no other filters).
    await page.goto("/de/admin/orders");
    await expect(tid(page, "section-title")).toHaveText("Bestellungen");
    // Von/Bis only show under "Benutzerdefiniert" (re-design.md §8.3) but stay in the DOM, so the
    // default range is read from the hidden inputs and the "Heute" quick pick is on.
    await expect(tid(page, "quick-today")).toHaveAttribute("aria-checked", "true");
    const fromInput = page.locator('[data-testid="filter-from"]');
    const toInput = page.locator('[data-testid="filter-to"]');
    const from = await fromInput.inputValue();
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from).toBe(f.today);
    await expect(toInput).toHaveValue(from);
    // Status and Quelle are segmented radio groups now (re-design.md §8.3): aria-checked.
    await expect(tid(page, "filter-status-ALL")).toHaveAttribute("aria-checked", "true");

    // Date range via the URL (bookmarkable) and via the controls.
    await page.goto(`/de/admin/orders?from=${D1}&to=${D2}`);
    const rows = tid(page, "order-row");
    await expect(rows).toHaveCount(5);
    // Totals per date: confirmed only (cancelled 99 and draft 77 are not counted).
    // The sums card is collapsed by default now (re-design.md §8.3), so open it before reading them.
    const totalsToggle = tid(page, "totals-toggle");
    if ((await totalsToggle.count()) > 0) await totalsToggle.first().click();
    const day1 = page.locator(`[data-testid="totals-day"][data-date="${D1}"]:visible`);
    await expect(day1).toContainText("2 bestätigte Bestellungen");
    await expect(day1.locator("tr", { hasText: "Sackerl" })).toContainText("7 Sackerl");
    await expect(day1.locator("tr", { hasText: "Kiste" })).toContainText("1 Kiste");
    const day2 = page.locator(`[data-testid="totals-day"][data-date="${D2}"]:visible`);
    await expect(day2).toContainText("1 bestätigte Bestellung");
    await expect(day2.locator("tr", { hasText: "Kiste" })).toContainText("6 Kiste");
    await expect(tid(page, "totals-day")).toHaveCount(2);

    // Rows: line count, status, source icon, in-tour badge only for the order in the tour.
    const a1 = page.locator(`[data-order-id="${f.ids.a1}"]:visible`);
    await expect(a1.getByTestId("order-line-count")).toHaveText("2");
    await expect(a1.getByTestId("order-status")).toHaveText("Bestätigt");
    await expect(a1.getByTestId("order-in-tour")).toHaveText("In Tour");
    await expect(a1.getByTestId("order-in-tour")).toHaveAttribute("data-tour-id", f.tourId);
    await expect(tid(page, "order-in-tour")).toHaveCount(1);
    await expect(
      page.locator(`[data-order-id="${f.ids.b1}"]:visible`).getByTestId("order-source"),
    ).toHaveAttribute("data-source", "SCREENSHOT");
    await expect(
      page.locator(`[data-order-id="${f.ids.a1x}"]:visible`).getByTestId("order-status"),
    ).toHaveText("Storniert");
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("order-overview.png"), fullPage: true });

    // Status and Quelle sit behind the "Filter" button: closed until asked for.
    await expect(tid(page, "filter-status-CANCELLED")).toHaveCount(0);
    await tid(page, "filter-more").click();

    // Status filter.
    await tid(page, "filter-status-CANCELLED").click();
    await expect(page).toHaveURL(/status=CANCELLED/);
    await expect(rows).toHaveCount(1);
    await expect(page.locator(`[data-order-id="${f.ids.a1x}"]:visible`)).toBeVisible();
    // Totals ignore the status filter.
    await expect(tid(page, "totals-day")).toHaveCount(2);
    await tid(page, "filter-status-ALL").click();
    await expect(rows).toHaveCount(5);

    // Source filter.
    await tid(page, "filter-source-SCREENSHOT").click();
    await expect(rows).toHaveCount(1);
    await tid(page, "filter-source-ALL").click();

    // Customer filter (combobox).
    await page.locator("#filter-customer").click();
    await page.getByPlaceholder("Nach Name oder Nummer suchen").fill(f.b.number);
    await page.getByRole("option", { name: new RegExp(f.b.number) }).click();
    await expect(page).toHaveURL(new RegExp(`customer=${f.b.id}`));
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) await expect(row).toContainText(f.b.name);

    // Range via the date controls (revealed by "Benutzerdefiniert"): moving "to" before "from"
    // pulls "from" along.
    await tid(page, "quick-custom").click();
    await tid(page, "filter-to").fill(D1);
    await expect(page).toHaveURL(new RegExp(`to=${D1}`));
    await expect(tid(page, "filter-from")).toHaveValue(D1);

    // Reset returns to the default day.
    await tid(page, "filter-reset").click();
    await expect(fromInput).toHaveValue(from);
    await expect(tid(page, "quick-today")).toHaveAttribute("aria-checked", "true");
    // Status and Quelle are segmented radio groups now (re-design.md §8.3): aria-checked.
    await expect(tid(page, "filter-status-ALL")).toHaveAttribute("aria-checked", "true");
  } finally {
    await f.cleanup();
  }
});

test("order detail: edit a quantity, cancel, duplicate; tours are flagged outdated", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const f = await fixture(testInfo.project.name);
  const { D1, D2, D3 } = f;
  const outdated = async () =>
    (await f.client.query(`SELECT "isOutdated" FROM "Tour" WHERE "id"=$1`, [f.tourId])).rows[0]
      .isOutdated as boolean;
  try {
    await loginAdmin(page);
    expect(await outdated()).toBe(false);

    // Edit: change the quantity of line 1, the same server validation applies.
    await page.goto(`/de/admin/orders/${f.ids.a1}`);
    // NUD-178: one line with a way into the tour, plus the tour's day and the stop's state.
    await expect(tid(page, "detail-tour-link")).toHaveText("In dieser Tour ansehen");
    await expect(tid(page, "detail-tour-link")).toHaveAttribute(
      "href",
      new RegExp(`/admin/tours\\?date=${D1}&tour=${f.tourId}$`),
    );
    await expect(tid(page, "detail-tour-meta")).toContainText("Stopp Offen");
    await tid(page, "order-edit").click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${f.ids.a1}/edit$`));
    await expect(tid(page, "section-title")).toHaveText("Bestellung bearbeiten");
    // The customer of an existing order is fixed: the picker is locked and the form says why.
    await expect(page.locator("#order-customer")).toBeDisabled();
    await expect(
      page.getByText("Der Kunde kann nachträglich nicht geändert werden.", { exact: false }),
    ).toBeVisible();
    const lines = tid(page, "order-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0).getByTestId("line-quantity")).toHaveValue("3");
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("order-edit.png") });

    await lines.nth(0).getByTestId("line-quantity").fill("0");
    await tid(page, "order-save").click();
    await expect(lines.nth(0).getByTestId("error-line")).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
    expect(await outdated()).toBe(false);

    await lines.nth(0).getByTestId("line-quantity").fill("5");
    await tid(page, "order-save").click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${f.ids.a1}$`));
    await expect(tid(page, "detail-items")).toContainText("5 Sackerl Nudeln");
    const stored = await f.client.query<{ quantity: string }>(
      `SELECT "quantity"::text FROM "OrderItem" WHERE "orderId"=$1 ORDER BY "quantity"`,
      [f.ids.a1],
    );
    expect(stored.rows.map((r) => r.quantity)).toEqual(["1", "5"]);
    // NUD-092: the history timeline shows exactly one entry for the save, with before -> after.
    const entries = tid(page, "audit-entry");
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toHaveAttribute("data-action", "order.update");
    await expect(entries.first().getByTestId("audit-action")).toHaveText("Bestellung geändert");
    await expect(entries.first().getByTestId("audit-meta")).toContainText("Admin (Büro)");
    await expect(entries.first().getByTestId("audit-line")).toHaveText("Nudeln: 3 → 5 Sackerl");
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("order-history.png"), fullPage: true });
    // The tour of that day is flagged outdated.
    expect(await outdated()).toBe(true);

    // Totals reflect the edit.
    await page.goto(`/de/admin/orders?from=${D1}&to=${D1}`);
    // The sums card is collapsed by default (re-design.md §8.3): open it before reading.
    const totalsToggle = tid(page, "totals-toggle");
    await expect(totalsToggle).toBeVisible();
    await totalsToggle.click();
    await expect(
      page.locator(`[data-testid="totals-day"][data-date="${D1}"]:visible tr`, {
        hasText: "Sackerl",
      }),
    ).toContainText("9 Sackerl");

    // Duplicate order b1 to D3: a draft copy, the original stays.
    await page.goto(`/de/admin/orders/${f.ids.b1}`);
    await tid(page, "order-duplicate").click();
    await tid(page, "duplicate-date").fill(D3);
    await tid(page, "order-duplicate-confirm").click();
    await expect(tid(page, "detail-status")).toHaveText("Entwurf");
    await expect(tid(page, "detail-date")).toContainText(String(f.year));
    await expect(tid(page, "detail-items")).toContainText("4 Sackerl Nudeln");
    const copies = await f.client.query<{
      status: string;
      source: string;
      screenshotId: string | null;
    }>(
      `SELECT "status"::text AS status, "source"::text AS source, "screenshotId"
       FROM "Order" WHERE "customerId"=$1 AND "deliveryDate"=$2`,
      [f.b.id, D3],
    );
    expect(copies.rows).toEqual([{ status: "DRAFT", source: "MANUAL", screenshotId: null }]);

    // Cancel order a2 (with confirmation): stays in the list as cancelled, leaves the totals.
    await page.goto(`/de/admin/orders/${f.ids.a2}`);
    await tid(page, "order-cancel").click();
    await expect(tid(page, "cancel-tour-note")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("order-cancel-dialog.png") });
    await tid(page, "order-cancel-confirm").click();
    await expect(tid(page, "detail-status")).toHaveText("Storniert");
    await expect(tid(page, "order-edit")).toHaveCount(0);
    await expect(tid(page, "order-cancel")).toHaveCount(0);
    await expect(tid(page, "read-only-note")).toContainText("storniert");
    const status = await f.client.query(`SELECT "status"::text AS s FROM "Order" WHERE "id"=$1`, [
      f.ids.a2,
    ]);
    expect(status.rows[0].s).toBe("CANCELLED");

    await page.goto(`/de/admin/orders?from=${D2}&to=${D2}`);
    await expect(page.locator(`[data-order-id="${f.ids.a2}"]:visible`)).toContainText("Storniert");
    await expect(tid(page, "totals-day")).toHaveCount(0);
    // The sums card is collapsed by default (re-design.md §8.3): open it to see the empty note.
    await tid(page, "totals-toggle").click();
    await expect(tid(page, "totals-empty")).toBeVisible();

    // A cancelled order cannot be opened for editing.
    await page.goto(`/de/admin/orders/${f.ids.a2}/edit`);
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${f.ids.a2}$`));
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
  } finally {
    await f.cleanup();
  }
});

test("archiving a customer with upcoming orders shows a warning", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const f = await fixture(testInfo.project.name);
  try {
    await loginAdmin(page);
    await page.goto(`/de/admin/customers/${f.a.id}`);
    await tid(page, "customer-archive").click();
    await expect(tid(page, "archive-upcoming-warning")).toContainText(
      "noch 2 anstehende Bestellungen",
    );
    await page.screenshot({ path: testInfo.outputPath("archive-warning.png") });

    // No upcoming orders: no warning.
    await page.goto(`/de/admin/customers/${f.b.id}`);
    await f.client.query(`UPDATE "Order" SET "status"='CANCELLED' WHERE "customerId"=$1`, [f.b.id]);
    await page.reload();
    await tid(page, "customer-archive").click();
    await expect(tid(page, "archive-upcoming-warning")).toHaveCount(0);
  } finally {
    await f.cleanup();
  }
});

test("order overview requires an admin", async ({ page }) => {
  await page.goto("/de/admin/orders?from=2098-05-04");
  await expect(page).toHaveURL(/\/de\/login/);
  await page.goto("/de/admin/orders/some-id/edit");
  await expect(page).toHaveURL(/\/de\/login/);
});
