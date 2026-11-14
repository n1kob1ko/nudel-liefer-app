import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

import { png } from "./helpers/png";

// NUD-210: the order inbox. Needs a seeded database (the catalog products), DATABASE_URL,
// SEED_ADMIN_PASSWORD and a real S3-compatible storage (S3_*), like `order-screenshot.spec.ts`.
//
// The suite runs WITHOUT a model key (no ANTHROPIC_API_KEY in CI): photos are uploaded and wait
// unread, and the office types each order next to its photo. That is the path this spec walks; the
// reading itself is covered by `order-inbox.integration.test.ts` with a scripted extractor.
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

const inboxIds = async (client: Client) =>
  (
    await client.query<{ id: string }>(
      `SELECT "id" FROM "Screenshot" WHERE "inboxStatus" IS NOT NULL ORDER BY "createdAt", "id"`,
    )
  ).rows.map((row) => row.id);

async function fixture(projectName: string) {
  const tag = `e2ei${projectName.slice(0, 1)}${Date.now() % 1e8}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const id = `id-${tag}`;
  await client.query(
    `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","pinConfirmed","updatedAt")
     VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',true,now())`,
    [id, tag, `Trattoria ${tag}`],
  );
  // Photos of an earlier, broken run (or of a developer's own database) are left alone: the spec
  // only ever touches the photos it uploaded itself.
  const before = new Set(await inboxIds(client));
  const own = async () => (await inboxIds(client)).filter((photo) => !before.has(photo));
  return {
    client,
    tag,
    id,
    own,
    cleanup: async () => {
      const photos = await own();
      await client.query(
        `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "customerId"=$1)`,
        [id],
      );
      await client.query(`DELETE FROM "Order" WHERE "customerId"=$1`, [id]);
      if (photos.length)
        await client.query(`DELETE FROM "Screenshot" WHERE "id" = ANY($1)`, [photos]);
      await client.query(`DELETE FROM "Customer" WHERE "id"=$1`, [id]);
      await client.end();
    },
  };
}

test("order inbox: upload several photos, check one next to its photo, discard and undo", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.S3_BUCKET, "needs S3_* (MinIO / s3rver) for real uploads");
  test.skip(
    Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    "walks the path without a model; with a key the photos would be sent to it",
  );
  test.setTimeout(240_000);
  const f = await fixture(testInfo.project.name);
  try {
    await loginAdmin(page);
    await page.goto("/de/admin/orders");
    await page.getByTestId("order-inbox-link").click();
    await expect(page).toHaveURL(/\/admin\/orders\/inbox$/);
    await expect(page.getByRole("heading", { level: 1, name: "Foto-Eingang" })).toBeVisible();

    // The change listener is attached on hydration; files chosen before that are lost. React puts
    // its props on the node when it takes it over, so wait for that instead of choosing twice
    // (a second choice would upload the photos a second time).
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="inbox-file-input"]');
      return Boolean(input) && Object.keys(input!).some((key) => key.startsWith("__reactProps"));
    });
    await page.getByTestId("inbox-file-input").setInputFiles([
      { name: "bestellung-a.png", mimeType: "image/png", buffer: png(600, 900, [220, 248, 198]) },
      { name: "bestellung-b.png", mimeType: "image/png", buffer: png(700, 800, [255, 199, 44]) },
    ]);
    await expect.poll(async () => (await f.own()).length, { timeout: 90_000 }).toBe(2);
    const [first, second] = await f.own();
    const rowOf = (id: string) =>
      page.getByTestId("inbox-row").filter({ has: page.locator(`a[href*="inbox=${id}"]`) });

    // Without a model the photos wait unread; the page says so once, and each can be checked.
    await expect(rowOf(first)).toBeVisible({ timeout: 30_000 });
    await expect(rowOf(second)).toBeVisible();
    await expect(rowOf(first)).toHaveAttribute("data-status", "NEW");
    await expect(rowOf(first)).toContainText("Nicht gelesen");
    await expect(page.getByTestId("inbox-no-ai")).toBeVisible();
    await expect(page.getByTestId("inbox-uploading")).toHaveCount(0);
    await expect(page.getByTestId("inbox-upload-failed")).toHaveCount(0);
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("inbox.png") });

    // Check the first photo: it stands next to the form, the order is typed from it.
    await rowOf(first).getByTestId("inbox-row-review").click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/new\\?inbox=${first}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Foto prüfen" })).toBeVisible();
    await expect(page.getByTestId("inbox-not-read")).toBeVisible();
    const image = page.getByTestId("screenshot-pane").getByTestId("zoom-image");
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBeGreaterThan(0);
    // One photo, one job: no second message to read here.
    await expect(page.getByTestId("ai-extract")).toHaveCount(0);

    await page.locator("#order-customer").click();
    await page.getByPlaceholder("Nach Name oder Nummer suchen").fill(f.tag);
    await page.getByRole("option", { name: new RegExp(f.tag) }).click();
    const combo = page.getByTestId("order-line").nth(0).getByRole("combobox");
    await combo.click();
    await page.getByPlaceholder("Nach Name oder Artikelnummer suchen").last().fill("BEUTEL");
    await page.keyboard.press("Enter");
    await expect(combo).toContainText("BEUTEL");
    await page.getByTestId("line-quantity").fill("10");
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("review.png") });

    // Another photo waits, so saving goes straight on to it.
    await expect(page.getByTestId("order-save")).toHaveText("Bestätigen und weiter");
    await page.getByTestId("order-save").click();
    await expect(page).toHaveURL(/\/admin\/orders\/new\?inbox=/);
    await expect(page).not.toHaveURL(new RegExp(`inbox=${first}$`));

    const stored = await f.client.query<{ screenshotId: string; status: string; inbox: string }>(
      `SELECT o."screenshotId", o."status"::text AS status, s."inboxStatus"::text AS inbox
       FROM "Order" o JOIN "Screenshot" s ON s."id"=o."screenshotId" WHERE o."customerId"=$1`,
      [f.id],
    );
    expect(stored.rows).toEqual([{ screenshotId: first, status: "CONFIRMED", inbox: "DONE" }]);

    // The checked photo left the inbox; its old address leads back to what is still waiting.
    await page.goto(`/de/admin/orders/new?inbox=${first}`);
    await expect(page).toHaveURL(/\/admin\/orders\/inbox$/);
    await expect(rowOf(second)).toBeVisible();
    await expect(rowOf(first)).toHaveCount(0);

    // Discard the other one: gone at once, and "Rückgängig" brings it back.
    await rowOf(second).getByTestId("inbox-row-discard").click();
    await expect(rowOf(second)).toHaveCount(0);
    await expect
      .poll(async () =>
        (
          await f.client.query<{ s: string }>(
            `SELECT "inboxStatus"::text AS s FROM "Screenshot" WHERE "id"=$1`,
            [second],
          )
        ).rows.map((row) => row.s),
      )
      .toEqual(["DISCARDED"]);
    await page.getByRole("button", { name: "Rückgängig" }).click();
    await expect(rowOf(second)).toBeVisible();
    await expect(rowOf(second)).toHaveAttribute("data-status", "NEW");

    // The orders page shows that a photo waits.
    await page.getByRole("link", { name: "Zurück zu den Bestellungen" }).click();
    await expect(page.getByTestId("order-inbox-count")).toBeVisible();
  } finally {
    await f.cleanup();
  }
});
