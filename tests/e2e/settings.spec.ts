import { expect, type Page, test } from "@playwright/test";

// Needs a seeded database (`pnpm db:seed`) and SEED_ADMIN_PASSWORD in the environment.
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

// 1x1 transparent PNG: the tests never depend on a live tile server.
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
  await expect(page).toHaveURL(/\/de\/admin$/);
}

// The desktop and mobile projects share one database and may run at the same time, so the test
// writes the same fixed values and only asserts what it just saved.
test("settings: depot pin by keyboard, confirmation, weekdays, persistence", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  await page.goto("/de/admin/settings");
  await expect(page.getByTestId("section-title")).toHaveText("Einstellungen");
  await expect(page.getByTestId("depot-status")).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Nudelfabrik Testdepot");
  await page.getByLabel("Adresse", { exact: true }).fill("Graben 1, 1010 Wien");

  // Keyboard alternative to the map: typed coordinates move the pin.
  await page.getByTestId("pin-lat").fill("48,2102");
  await page.getByTestId("pin-lng").fill("16.3702");
  await expect(page.getByTestId("pin-picker").locator(".leaflet-marker-icon")).toHaveCount(1);
  await page.getByTestId("pin-lat").fill("95");
  await expect(page.getByRole("alert").filter({ hasText: "Ungültige Koordinaten" })).toBeVisible();
  await page.getByTestId("pin-lat").fill("48.2102");

  // Saving without confirming the pin is refused with a clear message.
  // The control is a Switch (NUD-192); the hidden `depot-confirm` checkbox mirrors its state.
  const confirm = page.getByTestId("depot-confirm");
  const confirmSwitch = page.getByRole("switch", {
    name: "Ich habe geprüft, dass der Standort am richtigen Ort liegt.",
  });
  await expect(confirm).not.toBeChecked();
  await expect(confirmSwitch).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-error")).toHaveText(
    "Bitte bestätigen, dass der Standort am richtigen Ort liegt.",
  );

  await confirmSwitch.click();
  await expect(confirm).toBeChecked();
  await page.getByLabel("Standard-Abfahrtszeit").fill("06:30");
  await page.getByLabel("Minuten pro Stopp").fill("15");
  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    await page.getByTestId(`weekday-${day}`).setChecked(day <= 4);
  }
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("depot-status")).toHaveText("Standort bestätigt");

  // Persisted: reload shows the saved values.
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Nudelfabrik Testdepot");
  await expect(page.getByTestId("pin-lat")).toHaveValue("48.2102");
  await expect(page.getByTestId("pin-lng")).toHaveValue("16.3702");
  await expect(page.getByLabel("Standard-Abfahrtszeit")).toHaveValue("06:30");
  await expect(page.getByLabel("Minuten pro Stopp")).toHaveValue("15");
  await expect(page.getByTestId("depot-confirm")).toBeChecked();
  await expect(page.getByTestId("weekday-4")).toBeChecked();
  await expect(page.getByTestId("weekday-5")).not.toBeChecked();
  await expect(page.getByTestId("weekday-6")).not.toBeChecked();

  // Moving the pin withdraws the confirmation.
  await page.getByTestId("pin-lng").fill("16.3710");
  await expect(page.getByTestId("depot-confirm")).not.toBeChecked();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/settings.png", fullPage: true });
});

test("settings page is not available to anonymous visitors", async ({ page }) => {
  await page.goto("/de/admin/settings");
  await expect(page).toHaveURL(/\/de\/login/);
});
