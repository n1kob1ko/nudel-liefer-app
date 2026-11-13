import { expect, test } from "@playwright/test";

test("root redirects to a locale and offers the two ways in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(de|en|sr-Latn|cs|zh-Hans)$/);
  await expect(page.getByTestId("title")).toBeVisible();
  await expect(page.getByTestId("home-office")).toBeVisible();
  await expect(page.getByTestId("home-driver")).toBeVisible();
});

test("the start page leads a visitor without a session to the matching login", async ({ page }) => {
  await page.goto("/de");
  await page.getByTestId("home-driver").click();
  await expect(page).toHaveURL(/\/de\/driver\/login/);
  await page.goto("/de");
  await page.getByTestId("home-office").click();
  await expect(page).toHaveURL(/\/de\/login/);
});

for (const locale of ["de", "en", "sr-Latn", "cs", "zh-Hans"]) {
  test(`${locale} renders with the exact lang`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByTestId("title")).not.toBeEmpty();
  });
}
