import { expect, type Page, test } from "@playwright/test";

// Needs a seeded database (`pnpm db:seed`) and SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";
// 1x1 transparent PNG used as map tile.
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const LOCALES = ["de", "en", "sr-Latn", "cs", "zh-Hans"] as const;
const SECTIONS = ["planning", "orders", "customers", "products", "drivers", "settings"] as const;
const NOT_FOUND_TITLE: Record<(typeof LOCALES)[number], string> = {
  de: "Seite nicht gefunden",
  en: "Page not found",
  "sr-Latn": "Stranica nije pronađena",
  cs: "Stránka nenalezena",
  "zh-Hans": "找不到页面",
};

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  // Login lands in the admin's stored locale (another test may have switched it).
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/de/admin");
}

async function loginDriver(page: Page) {
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill("fahrer-de");
  await form.locator('input[name="pin"]').fill("123456");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/driver$/);
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** Collects browser-side errors (next-intl reports missing messages through console.error). */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.describe("admin shell", () => {
  test("the nav highlights the active section", async ({ page, isMobile }) => {
    const menu = page.getByRole("dialog");
    const openNav = async () => {
      if (!isMobile) return;
      await page.getByTestId("open-menu").click();
      await expect(menu).toBeVisible();
    };
    const closeNav = async () => {
      if (!isMobile) return;
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    };
    const expectActive = async (section: string) => {
      await openNav();
      const current = page.locator('[data-testid="admin-nav"] [aria-current="page"]:visible');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute("data-testid", `nav-${section}`);
      await closeNav();
    };

    await loginAdmin(page);
    await expectActive("dashboard");
    for (const section of SECTIONS) {
      await openNav();
      await page.locator(`[data-testid="nav-${section}"]:visible`).click();
      await expect(page).toHaveURL(new RegExp(`/de/admin/${section}$`));
      // Following a link closes the mobile menu by itself.
      if (isMobile) await expect(menu).toBeHidden();
      await expectActive(section);
    }
  });

  for (const locale of ["de", "en", "zh-Hans"] as const) {
    test(`all placeholder pages render in ${locale} without console errors`, async ({ page }) => {
      test.setTimeout(90_000); // visits every section, including the map-heavy settings page
      const errors = collectErrors(page);
      // The settings page shows a map; never depend on a live tile server.
      await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: TILE_PNG }),
      );
      await loginAdmin(page);
      for (const section of ["", ...SECTIONS]) {
        await page.goto(`/${locale}/admin${section ? `/${section}` : ""}`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("main h1")).toBeVisible();
        await expectNoHorizontalScroll(page);
      }
      expect(errors).toEqual([]);
    });
  }

  test("user menu shows the account and logs out", async ({ page }) => {
    await loginAdmin(page);
    await page.getByTestId("user-menu").click();
    await expect(page.getByTestId("signed-in-as")).toBeVisible();
    await page.getByTestId("logout").click();
    await expect(page).toHaveURL(/\/de\/login$/);
  });

  test("the language switcher in the header changes the locale", async ({ page }) => {
    await loginAdmin(page);
    const switcher = page.locator('[data-testid="language-switcher"]:visible');
    // Office screens offer exactly three languages (D21); sr-Latn and cs are driver-only.
    await expect(switcher.locator("option")).toHaveText(["Deutsch", "English", "中文"]);
    await switcher.selectOption("en");
    await expect(page).toHaveURL(/\/en\/admin$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // The choice is stored on the user: switch back so other tests start from German.
    await page.locator('[data-testid="language-switcher"]:visible').selectOption("de");
    await expect(page).toHaveURL(/\/de\/admin$/);
  });

  test("a screenshot of the dashboard is taken", async ({ page }, testInfo) => {
    await loginAdmin(page);
    await page.screenshot({ path: testInfo.outputPath("admin-dashboard.png") });
  });
});

test.describe("driver shell", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const locale of LOCALES) {
    test(`Heute page has no horizontal scroll at 375 px in ${locale}`, async ({
      page,
    }, testInfo) => {
      const errors = collectErrors(page);
      await loginDriver(page);
      await page.goto(`/${locale}/driver`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByTestId("driver-date")).toBeVisible();
      await expect(page.getByTestId("connection-indicator")).toBeVisible();
      await expect(page.getByTestId("empty-state")).toBeVisible();
      await expectNoHorizontalScroll(page);
      // Drivers can pick all five languages (D21).
      await expect(page.getByTestId("language-switcher").locator("option")).toHaveText([
        "Deutsch",
        "English",
        "Srpski",
        "Čeština",
        "中文",
      ]);
      // Touch targets >= 48 px (backlog 4.3): language picker and logout.
      for (const id of ["language-switcher", "logout"]) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
      }
      await page.screenshot({ path: testInfo.outputPath(`driver-today-${locale}.png`) });
      expect(errors).toEqual([]);
    });
  }

  test("a driver cannot reach the admin area", async ({ page }) => {
    await loginDriver(page);
    await page.goto("/de/admin/orders");
    await expect(page).toHaveURL(/\/de\/driver$/);
  });
});

test.describe("localized 404", () => {
  for (const locale of LOCALES) {
    test(`unknown path in ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/does-not-exist`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { name: NOT_FOUND_TITLE[locale] })).toBeVisible();
    });
  }
});
