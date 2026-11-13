import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";

// NUD-031. Needs a seeded database (the three catalog products), DATABASE_URL, SEED_ADMIN_PASSWORD and a
// real S3-compatible storage configured via S3_* (MinIO or the s3rver emulator): the browser PUTs
// the screenshot to the presigned URL and reads it back through a signed URL.
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

/** Builds a chat-like PNG in the page and returns it as a File inside a DataTransfer. */
const IMAGE_IN_PAGE = `
  async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 700;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#dcf8c6";
    ctx.fillRect(0, 0, 1000, 700);
    ctx.fillStyle = "#000";
    ctx.font = "48px sans-serif";
    ctx.fillText("Bitte 10 Sackerl Nudeln", 60, 200);
    ctx.fillText("und 3 Kiste Nudeln", 60, 300);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "whatsapp.png", { type: "image/png" }));
    return dt;
  }
`;

async function pasteImage(page: Page) {
  await page.evaluate(`(async () => {
    const make = ${IMAGE_IN_PAGE};
    const dt = await make();
    document.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  })()`);
}

async function dropImage(page: Page) {
  await page.evaluate(`(async () => {
    const make = ${IMAGE_IN_PAGE};
    const dt = await make();
    document
      .querySelector('[data-testid="image-uploader"]')
      .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
}

async function fixture(projectName: string) {
  const tag = `e2es${projectName.slice(0, 1)}${Date.now() % 1e8}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const id = `id-${tag}`;
  const name = `Ristorante ${tag}`;
  await client.query(
    `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","pinConfirmed","updatedAt")
     VALUES ($1,$2,$3,'Hauptstraße 1','1010','Wien',true,now())`,
    [id, tag, name],
  );
  return {
    client,
    tag,
    id,
    name,
    cleanup: async () => {
      const shots = (
        await client.query<{ id: string }>(
          `SELECT "screenshotId" AS id FROM "Order" WHERE "customerId"=$1 AND "screenshotId" IS NOT NULL`,
          [id],
        )
      ).rows.map((r) => r.id);
      await client.query(
        `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "customerId"=$1)`,
        [id],
      );
      await client.query(`DELETE FROM "Order" WHERE "customerId"=$1`, [id]);
      if (shots.length)
        await client.query(`DELETE FROM "Screenshot" WHERE "id" = ANY($1)`, [shots]);
      await client.query(`DELETE FROM "Customer" WHERE "id"=$1`, [id]);
      await client.end();
    },
  };
}

async function expectDecoded(img: ReturnType<Page["locator"]>) {
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBeGreaterThan(0);
}

test("screenshot order: paste (Ctrl+V), split view, zoom/pan, save, view from the detail", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.S3_BUCKET, "needs S3_* (MinIO / s3rver) for real uploads");
  test.setTimeout(180_000);
  const f = await fixture(testInfo.project.name);
  try {
    let fileChoosers = 0;
    page.on("filechooser", () => fileChoosers++);
    await loginAdmin(page);
    await page.goto("/de/admin/orders/new");
    await expect(page.getByTestId("order-entry")).toHaveAttribute("data-split", "false");
    await expect(page.getByTestId("screenshot-pane")).toHaveCount(0);

    // Paste an image from the clipboard: attached without a file dialog.
    const pane = page.getByTestId("screenshot-pane");
    // The paste listener is attached on hydration; an early synthetic paste would be lost, so
    // retry (a second paste while an upload is running is ignored by the uploader).
    await expect(async () => {
      await pasteImage(page);
      await expect(pane).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    expect(fileChoosers).toBe(0);
    await expect(page.getByTestId("order-entry")).toHaveAttribute("data-split", "true");
    const image = pane.getByTestId("zoom-image");
    await expectDecoded(image);
    expect(await image.getAttribute("src")).toMatch(/X-Amz-Signature=/);

    // Split view from 1024 px: image left, form right; stacked (image above) below that.
    const paneBox = (await pane.boundingBox())!;
    const formBox = (await page.getByTestId("order-form").boundingBox())!;
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) {
      expect(paneBox.x + paneBox.width).toBeLessThanOrEqual(formBox.x + 1);
      expect(Math.abs(paneBox.y - formBox.y)).toBeLessThan(40);
    } else {
      expect(paneBox.y + paneBox.height).toBeLessThanOrEqual(formBox.y + 1);
    }
    await expect(noHorizontalScroll(page)).resolves.toBe(true);

    // Zoom with the wheel (the page must not scroll) and pan by dragging.
    const frame = pane.getByTestId("zoom-frame");
    const frameBox = (await frame.boundingBox())!;
    await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, -400);
    await expect
      .poll(async () => Number(await image.getAttribute("data-scale")))
      .toBeGreaterThan(1);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    const transformBefore = await image.evaluate((el) => (el as HTMLElement).style.transform);
    await page.mouse.down();
    await page.mouse.move(
      frameBox.x + frameBox.width / 2 + 60,
      frameBox.y + frameBox.height / 2 + 30,
      {
        steps: 5,
      },
    );
    await page.mouse.up();
    expect(await image.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(
      transformBefore,
    );
    await pane.getByRole("button", { name: "Zurücksetzen" }).click();
    await expect(image).toHaveAttribute("data-scale", "1");
    await page.screenshot({ path: testInfo.outputPath("split-view.png") });

    // Fill the order while the screenshot stays visible.
    await page.locator("#order-customer").click();
    await page.getByPlaceholder("Nach Name oder Nummer suchen").fill(f.tag);
    await page.getByRole("option", { name: new RegExp(f.tag) }).click();
    await page.getByTestId("order-date").fill("2099-05-04");
    const lines = page.getByTestId("order-line");
    const pickProduct = async (index: number, search: string) => {
      const combo = lines.nth(index).getByRole("combobox");
      await combo.click();
      // The previous picker may still be fading out; the newest popover is the open one.
      await page.getByPlaceholder("Nach Name oder Artikelnummer suchen").last().fill(search);
      await page.keyboard.press("Enter");
      await expect(combo).toContainText(search.toUpperCase());
      await expect(page.getByPlaceholder("Nach Name oder Artikelnummer suchen")).toHaveCount(0);
    };
    await pickProduct(0, "BEUTEL");
    await lines.nth(0).getByTestId("line-quantity").fill("10");
    await lines.nth(0).getByTestId("line-quantity").press("Enter");
    await pickProduct(1, "KARTON");
    await lines.nth(1).getByTestId("line-quantity").fill("3");
    await expect(pane).toBeVisible();
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("split-view-filled.png") });

    await page.getByTestId("order-save").click();
    await expect(page).toHaveURL(/\/admin\/orders(\?.*)?$/);

    const stored = await f.client.query<{
      id: string;
      source: string;
      screenshotId: string;
      storageKey: string;
      uploadedById: string;
      createdById: string;
    }>(
      `SELECT o."id", o."source"::text AS source, o."screenshotId", s."storageKey", s."uploadedById", o."createdById"
       FROM "Order" o JOIN "Screenshot" s ON s."id"=o."screenshotId" WHERE o."customerId"=$1`,
      [f.id],
    );
    expect(stored.rows).toHaveLength(1);
    const order = stored.rows[0];
    expect(order.source).toBe("SCREENSHOT");
    expect(order.storageKey).toMatch(/^screenshots\/[0-9a-f-]{36}\.jpg$/);
    expect(order.uploadedById).toBe(order.createdById);

    // Overview shows the source; the date links to the read-only detail.
    const row = page.locator('[data-testid="order-row"]', { hasText: f.name });
    await expect(row).toContainText("Screenshot");
    await row.getByTestId("order-open").click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${order.id}$`));
    await expect(page.getByTestId("detail-customer")).toHaveText(f.name);
    await expect(page.getByTestId("detail-source")).toHaveText("Screenshot");
    await expect(page.getByTestId("detail-item")).toHaveCount(2);
    await expect(page.getByTestId("detail-items")).toContainText("10 Sackerl Nudeln");

    // Thumbnail -> fullscreen.
    const thumb = page.getByTestId("detail-screenshot").getByRole("button", {
      name: /Bild vergrößern/,
    });
    await expectDecoded(thumb.locator("img"));
    await expect(noHorizontalScroll(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath("order-detail.png") });
    await thumb.click();
    // (Next keeps the previous route hidden, so scope to the dialog.)
    const full = page.getByRole("dialog").getByTestId("zoom-image");
    await expectDecoded(full);
    expect(await full.getAttribute("src")).toMatch(/X-Amz-Signature=/);
    await page.screenshot({ path: testInfo.outputPath("order-detail-fullscreen.png") });
    await page.keyboard.press("Escape");
    await expect(full).toHaveCount(0);

    // Starting the next order shows a clean form again (no screenshot left over).
    await page.getByRole("link", { name: "Zurück zu den Bestellungen" }).click();
    await page.getByTestId("new-order").click();
    await expect(page).toHaveURL(/\/admin\/orders\/new$/);
    await expect(page.getByTestId("order-entry")).toHaveAttribute("data-split", "false");
    await expect(page.getByTestId("screenshot-pane")).toHaveCount(0);
    await expect(page.locator("#order-customer")).not.toContainText(f.name);
  } finally {
    await f.cleanup();
  }
});

test("screenshot order: file picker and drag-and-drop attach, remove brings the uploader back", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.S3_BUCKET, "needs S3_* (MinIO / s3rver) for real uploads");
  test.setTimeout(180_000);
  const f = await fixture(testInfo.project.name);
  try {
    await loginAdmin(page);
    await page.goto("/de/admin/orders/new");

    const png = await page.evaluate(`(async () => {
      const dt = await (${IMAGE_IN_PAGE})();
      const buf = new Uint8Array(await dt.files[0].arrayBuffer());
      return Array.from(buf);
    })()`);
    const pane = page.getByTestId("screenshot-pane");
    // The change listener is attached on hydration, like the paste listener above: a file chosen
    // before that is lost, so the choice is repeated until the uploader took it.
    await expect(async () => {
      await page.getByTestId("image-uploader-input").setInputFiles({
        name: "chat.png",
        mimeType: "image/png",
        buffer: Buffer.from(png as number[]),
      });
      await expect(pane).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await expectDecoded(pane.getByTestId("zoom-image"));

    await pane.getByTestId("screenshot-remove").click();
    await expect(pane).toHaveCount(0);
    await expect(page.getByTestId("image-uploader")).toBeVisible();

    await dropImage(page);
    await expectDecoded(pane.getByTestId("zoom-image"));

    // Removing the screenshot before saving gives a plain MANUAL order again.
    await pane.getByTestId("screenshot-remove").click();
    await page.locator("#order-customer").click();
    await page.getByPlaceholder("Nach Name oder Nummer suchen").fill(f.tag);
    await page.getByRole("option", { name: new RegExp(f.tag) }).click();
    await page.getByTestId("order-date").fill("2099-05-05");
    const combo = page.getByTestId("order-line").nth(0).getByRole("combobox");
    await combo.click();
    await page.getByPlaceholder("Nach Name oder Artikelnummer suchen").fill("BEUTEL");
    await page.keyboard.press("Enter");
    await page.getByTestId("line-quantity").fill("1");
    await page.getByTestId("order-save").click();
    await expect(page).toHaveURL(/\/admin\/orders(\?.*)?$/);
    const rows = await f.client.query(
      `SELECT "source"::text AS source, "screenshotId" FROM "Order" WHERE "customerId"=$1`,
      [f.id],
    );
    expect(rows.rows).toEqual([{ source: "MANUAL", screenshotId: null }]);
    await page.getByTestId("order-open").first().click();
    await expect(page.getByTestId("detail-no-screenshot")).toBeVisible();
    await expect(page.getByTestId("detail-source")).toHaveText("Manuell");
  } finally {
    await f.cleanup();
  }
});

test("order detail: anonymous visitors are redirected, unknown ids show not-found", async ({
  page,
}) => {
  await page.goto("/de/admin/orders/some-id");
  await expect(page).toHaveURL(/\/login/);
  await loginAdmin(page);
  await page.goto("/de/admin/orders/does-not-exist");
  await expect(page.getByTestId("order-detail")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
});
