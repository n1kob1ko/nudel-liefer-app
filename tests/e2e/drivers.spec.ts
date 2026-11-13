import { type Browser, expect, type Page, test } from "@playwright/test";

// Needs a seeded database (`pnpm db:seed`) and SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

async function adminPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/de\/admin$/);
  return page;
}

async function driverLogin(page: Page, username: string, pin: string) {
  await page.goto("/de/driver/login");
  const form = page.getByTestId("driver-login-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="pin"]').fill(pin);
  await page.getByTestId("login-submit").click();
}

test("admin manages a driver: create, PIN shown once, reset, deactivate -> logged out, delete", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const username = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  const admin = await adminPage(browser);

  await admin.goto("/de/admin/drivers");
  await expect(admin.getByTestId("section-title")).toHaveText("Fahrer");
  expect(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  // create -> PIN shown once
  await admin.getByTestId("create-driver").click();
  const form = admin.getByTestId("create-driver-form");
  await form.getByLabel("Anzeigename").fill("E2E Fahrer");
  await form.getByLabel("Benutzername").fill(username);
  // The language picker is a localized control (no hard-coded German option text).
  await form.getByTestId("locale-input").selectOption("sr-Latn");
  await admin.getByTestId("create-submit").click();
  const pinValue = admin.getByTestId("pin-value");
  await expect(pinValue).toBeVisible();
  const pin = (await pinValue.textContent())?.trim() ?? "";
  expect(pin).toMatch(/^\d{6}$/);
  await expect(admin.getByTestId("pin-username")).toHaveText(username);
  // printing while the dialog is open prints only the PIN sheet (the print rule applies only then)
  await admin.emulateMedia({ media: "print" });
  await expect(pinValue).toBeVisible();
  // ... and the sheet is on the paper: "visible" alone was true while it sat left of and above the page
  await expect(pinValue).toBeInViewport({ ratio: 1 });
  await expect(admin.getByTestId("pin-username")).toBeInViewport({ ratio: 1 });
  await expect(admin.getByTestId("section-title")).toBeHidden();
  await admin.emulateMedia({ media: "screen" });
  await admin.getByTestId("pin-done").click();
  await expect(admin.getByTestId("pin-dialog")).toBeHidden();
  // the PIN is nowhere on the page any more
  await expect(admin.locator("body")).not.toContainText(pin);
  await expect(admin.getByTestId(`driver-row-${username}`)).toContainText("Noch nie");

  // the new driver logs in with the shown PIN (phone-sized context) in his locale
  const driverCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const driver = await driverCtx.newPage();
  await driverLogin(driver, username, pin);
  // a new driver has not chosen a language yet (NUD-050): the first-start picker comes first
  await expect(driver).toHaveURL(/\/sr-Latn\/driver\/start$/);
  await driver.getByTestId("language-picker").getByTestId("pick-sr-Latn").click();
  await expect(driver).toHaveURL(/\/sr-Latn\/driver$/);
  await admin.reload();
  await expect(admin.getByTestId(`driver-row-${username}`)).not.toContainText("Noch nie");

  // reset PIN: the old PIN is invalid immediately, the new one works
  await admin.getByTestId(`driver-row-${username}`).getByTestId("reset-pin").click();
  await admin.getByTestId("confirm-submit").click();
  await expect(pinValue).toBeVisible();
  const newPin = (await pinValue.textContent())?.trim() ?? "";
  expect(newPin).toMatch(/^\d{6}$/);
  await admin.getByTestId("pin-done").click();
  if (newPin !== pin) {
    const other = await (await browser.newContext()).newPage();
    await driverLogin(other, username, pin);
    await expect(other.getByTestId("login-error")).toBeVisible();
    await expect(other).toHaveURL(/\/driver\/login/);
    await driverLogin(other, username, newPin);
    await expect(other).toHaveURL(/\/sr-Latn\/driver$/);
  }

  // deactivate: the driver's existing session is logged out on his next request
  await admin.getByTestId(`driver-row-${username}`).getByTestId("deactivate").click();
  await admin.getByTestId("confirm-submit").click();
  await expect(admin.getByTestId(`driver-row-${username}`)).toContainText("Deaktiviert");
  await driver.goto("/sr-Latn/driver");
  await expect(driver).toHaveURL(/\/sr-Latn\/driver\/login/);
  const cookies = await driverCtx.cookies();
  expect(cookies.some((c) => c.name.endsWith("authjs.session-token"))).toBe(false);
  // and stays logged out (no redirect loop), login is refused too
  await driver.goto("/sr-Latn/driver");
  await expect(driver).toHaveURL(/\/sr-Latn\/driver\/login/);
  const fresh = await (await browser.newContext()).newPage();
  await driverLogin(fresh, username, newPin);
  await expect(fresh.getByTestId("login-error")).toBeVisible();

  // reactivate: login works again
  await admin.getByTestId(`driver-row-${username}`).getByTestId("reactivate").click();
  await expect(admin.getByTestId(`driver-row-${username}`)).toContainText("Aktiv");
  await driverLogin(fresh, username, newPin);
  await expect(fresh).toHaveURL(/\/sr-Latn\/driver$/);

  // delete for good (NUD-206): the office is asked first, then the row is gone and the login refused
  await admin.getByTestId(`driver-row-${username}`).getByTestId("delete-user").click();
  await expect(admin.getByTestId("confirm-submit")).toHaveText("Endgültig löschen");
  await admin.getByTestId("confirm-submit").click();
  await expect(admin.getByTestId(`driver-row-${username}`)).toHaveCount(0);
  await admin.reload();
  await expect(admin.getByTestId(`driver-row-${username}`)).toHaveCount(0);
  const gone = await (await browser.newContext()).newPage();
  await driverLogin(gone, username, newPin);
  await expect(gone.getByTestId("login-error")).toBeVisible();
});

test("a driver cannot reach the driver management page", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await driverLogin(page, "driver-sr", "123456");
  await expect(page).toHaveURL(/\/sr-Latn\/driver$/);
  await page.goto("/sr-Latn/admin/drivers");
  await expect(page).toHaveURL(/\/sr-Latn\/driver$/);
});
