import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// Needs a seeded database (`pnpm db:seed`), DATABASE_URL and SEED_ADMIN_PASSWORD in the environment.
// Geocoding uses the Fake geocoder (no ORS_API_KEY), tiles are stubbed.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function loginAdmin(page: Page) {
  await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
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

// Next keeps visited routes (the customer list with rows of other specs' customers, which may carry
// the same flags) hidden in the DOM: flags on the detail page are counted among visible elements only.
const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function fillCustomer(page: Page, tag: string, name: string) {
  await page.getByTestId("customer-number").fill(`${tag}-1`);
  await page.getByTestId("customer-name").fill(name);
  await page.getByTestId("customer-street").fill("Teststraße 12");
  await page.getByTestId("customer-postal").fill("1010");
  await page.getByTestId("customer-city").fill("Wien");
}

test("customer: create (address point looked up by itself), find it, duplicate number, edit re-geocodes, Parkplatz flag, archive", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const tag = `e2ec${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const name = `Osteria Güte ${tag}`;
  try {
    await loginAdmin(page);

    // List -> "New customer": the form suggests a free number.
    await page.goto("/de/admin/customers");
    await page.getByTestId("new-customer").click();
    await expect(page).toHaveURL(/\/de\/admin\/customers\/new$/);
    await expect(page.getByRole("heading", { name: "Neuer Kunde" })).toBeVisible();
    await expect(page.getByTestId("customer-number")).not.toHaveValue("");
    // There is no confirmation step any more (NUD-141, D22).
    await expect(page.getByTestId("pin-confirm")).toHaveCount(0);

    await fillCustomer(page, tag, name);
    await page.getByTestId("customer-hours").fill("Mo-Fr 6-10 Uhr");
    await page.getByTestId("customer-notes").fill("Hintereingang im Hof");

    // Find on map -> candidates -> choose -> the address point appears (optional: saving alone
    // looks the address up by itself).
    await page.getByTestId("customer-find").click();
    await expect(page.getByTestId("candidate")).toHaveCount(1);
    await page.getByTestId("candidate").first().click();
    await expect(page.getByTestId("pin-picker").locator(".leaflet-marker-icon")).toHaveCount(1);
    await expect(page.getByTestId("pin-lat")).not.toHaveValue("");
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/customer-form.png", fullPage: true });
    await page.getByTestId("customer-save").click();

    // Detail page.
    await expect(page).toHaveURL(/\/de\/admin\/customers\/[^/]+$/);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(page.getByTestId("detail-pin")).toContainText(/\d+\.\d+, \d+\.\d+/);
    await expect(page.getByTestId("detail-notes")).toHaveText("Hintereingang im Hof");
    // No Parkplatz yet: flagged, but nothing is blocked.
    await expect(visible(page, "flag-parking-missing")).toBeVisible();
    await expect(visible(page, "flag-photos-missing")).toBeVisible();
    await expect(page.getByTestId("photo-slots")).toBeVisible();
    await expect(page.getByTestId("orders-empty")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/customer-detail.png", fullPage: true });
    const detailUrl = page.url();

    // Findable through the list search; the row carries the "Ohne Parkplatz" flag.
    await page.goto("/de/admin/customers");
    await page.getByTestId("customer-search").fill(`osteria gute ${tag}`);
    const rows = page.getByTestId("customer-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("flag-parking-missing")).toBeVisible();
    await rows.first().getByTestId("customer-link").click();
    await expect(page).toHaveURL(detailUrl);

    // Duplicate customer number: localized message, stays on the form, nothing created.
    await page.goto("/de/admin/customers/new");
    await fillCustomer(page, tag, `Doppelt ${tag}`);
    await page.getByTestId("customer-save").click();
    await expect(page.getByTestId("number-taken")).toHaveText(
      "Diese Kundennummer ist bereits vergeben.",
    );
    await expect(page).toHaveURL(/\/customers\/new$/);

    // Editing the street without touching the point: the new address is geocoded on save.
    await page.goto(`${detailUrl}/edit`);
    const latBefore = await page.getByTestId("pin-lat").inputValue();
    await page.getByTestId("customer-street").fill("Andere Gasse 5");
    await page.getByTestId("customer-save").click();
    await expect(page).toHaveURL(detailUrl);
    await expect(page.getByTestId("detail-address")).toContainText("Andere Gasse 5");
    await expect(page.getByTestId("detail-pin")).not.toContainText(latBefore);

    // Moving the point by hand after an address change keeps the hand-set coordinates.
    await page.goto(`${detailUrl}/edit`);
    await page.getByTestId("customer-street").fill("Dritte Gasse 9");
    await page.getByTestId("pin-lat").fill("48.2111");
    await page.getByTestId("customer-save").click();
    await expect(page).toHaveURL(detailUrl);
    await expect(page.getByTestId("detail-pin")).toContainText("48.2111");

    // A Parkplatz removes the flag.
    await page.getByTestId("parking-add").click();
    const dialog = page.getByTestId("parking-dialog");
    await dialog.getByTestId("pin-lat").fill("48.21");
    await dialog.getByTestId("pin-lng").fill("16.37");
    await dialog.getByTestId("parking-save").click();
    await expect(dialog).toBeHidden();
    await expect(visible(page, "flag-parking-missing")).toHaveCount(0);

    // Archive (with confirmation) and reactivate; the row is never deleted.
    await page.getByTestId("customer-archive").click();
    await page.getByTestId("customer-archive-confirm").click();
    await expect(visible(page, "flag-archived")).toBeVisible();
    await page.goto("/de/admin/customers");
    await page.getByTestId("customer-search").fill(tag);
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.goto(detailUrl);
    await page.getByTestId("customer-restore").click();
    await expect(visible(page, "flag-archived")).toHaveCount(0);
  } finally {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(
      `DELETE FROM "ParkingSpot" WHERE "customerId" IN (SELECT "id" FROM "Customer" WHERE "customerNumber" LIKE $1)`,
      [`${tag}%`],
    );
    await client.query(`DELETE FROM "Customer" WHERE "customerNumber" LIKE $1`, [`${tag}%`]);
    await client.end();
  }
});

test("a customer name without a space does not widen the page", async ({ page }) => {
  // The headline used to keep one long word on one line. A name such as an imported customer number
  // then made the page scroll sideways on a phone, by a few pixels or not at all depending on which
  // digits it held (customer-photos.spec.ts failed that way now and then).
  const number = `e2ew${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const id = `c${number}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","updatedAt")
       VALUES ($1,$2,$3,'Teststraße 1','1010','Wien',now())`,
      [id, number, `Import${"08".repeat(20)}`],
    );
    await loginAdmin(page);
    await page.goto(`/de/admin/customers/${id}`);
    // Visible, not only present: the page streams in, and a headline that is still hidden has no width.
    const title = page.getByTestId("section-title").filter({ hasText: "Import0808" });
    await expect(title).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  } finally {
    await client.query(`DELETE FROM "Customer" WHERE "id" = $1`, [id]);
    await client.end();
  }
});

test("customer pages are not available to anonymous visitors", async ({ page }) => {
  await page.goto("/de/admin/customers/new");
  await expect(page).toHaveURL(/\/de\/login/);
  await page.goto("/de/admin/customers/some-id");
  await expect(page).toHaveURL(/\/de\/login/);
});
