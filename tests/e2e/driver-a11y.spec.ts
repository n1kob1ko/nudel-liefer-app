import fs from "node:fs";

import { expect, type Page, test as base } from "@playwright/test";

import { axeAudit, layoutAudit } from "./helpers/driver-audit";
import {
  createDriverFixture,
  type DriverFixture,
  type Locale,
  LOCALES,
  loginDriver,
  stubImages,
} from "./helpers/driver-fixture";
import { gotoSettled, installNetworkEmulation, setOnline } from "./helpers/network";

// NUD-095. Needs DATABASE_URL, S3_* (signed photo URLs; the images are answered by the test) and a
// PRODUCTION build (service worker, offline shell). `ENABLE_ERROR_TEST_PAGES=true` for the error
// page. Runs axe-core and the layout rules of backlog 4.3 over every driver screen at 375 px, in
// light and dark colour scheme, in all four locales, and once at an emulated 130 % font size.
const test = base.extend<{ fx: DriverFixture }>({
  // Every test gets its own driver, customers and tour (tests run in parallel workers).
  fx: async ({}, provide) => {
    const fx = await createDriverFixture("a11y");
    await provide(fx);
    await fx.cleanup();
  },
});
test.use({ viewport: { width: 375, height: 667 } });

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

/**
 * Chrome's "font size" setting changes the root font size, which scales everything sized in rem
 * (all of the Tailwind UI); this is what the emulation does. It is NOT Android's per-app
 * "font scale" and not a real device.
 */
async function fontScale(page: Page, percent: number) {
  await page.addInitScript((p) => {
    const apply = () => {
      const style = document.createElement("style");
      style.textContent = `html{font-size:${p}% !important}`;
      document.documentElement.append(style);
    };
    if (document.documentElement) apply();
    else document.addEventListener("DOMContentLoaded", apply);
  }, percent);
}

type Variant = { scheme: "light" | "dark"; scale: number };

async function walk(
  page: Page,
  fx: DriverFixture,
  locale: Locale,
  variant: Variant,
  info: Parameters<typeof axeAudit>[2],
) {
  const tag = `${locale}-${variant.scheme}-${variant.scale}`;
  const axe: Awaited<ReturnType<typeof axeAudit>> = [];
  const layout: Awaited<ReturnType<typeof layoutAudit>> = [];
  const check = async (screen: string) => {
    await page.waitForLoadState("networkidle").catch(() => {});
    axe.push(...(await axeAudit(page, `${screen}-${tag}`, info)));
    layout.push(...(await layoutAudit(page, `${screen}-${tag}`)));
    await page.screenshot({ path: info.outputPath(`${screen}-${tag}.png`) });
  };

  // 1. Login (nobody logged in).
  await stubImages(page);
  await page.goto(`/${locale}/driver/login`);
  await expect(page.getByTestId("driver-login-form")).toBeVisible();
  await check("login");

  // 2. First-start language picker.
  await fx.reset({ localeChosen: false, locale });
  await page.locator('input[name="username"]').fill(fx.username);
  await page.locator('input[name="pin"]').fill("482916");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("language-picker")).toBeVisible();
  await check("picker");
  await page.getByTestId(`pick-${locale}`).click();
  await expect(page.getByTestId("today-tour")).toBeVisible();

  // 3. Today: list, next stop.
  await expect(page.getByTestId("next-stop")).toBeVisible();
  await check("today");
  await page.getByTestId("view-map").click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await check("today-map");
  await page.getByTestId("view-list").click();

  // 4. Stop detail with photos, without photos.
  await page.goto(`/${locale}/driver/stops/${fx.stopIds[0]}`);
  await expect(page.getByTestId("photo-store").locator("img")).toBeVisible();
  await check("stop-photos");
  await page.getByTestId("btn-problem").scrollIntoViewIfNeeded();
  await page.getByTestId("btn-problem").click();
  await expect(page.getByTestId("problem-sheet")).toBeVisible();
  await page.getByTestId("reason-CLOSED").click();
  await page.waitForTimeout(400); // sheet animation
  await check("problem-sheet");
  await page.getByTestId("problem-cancel").click();
  await expect(page.getByTestId("problem-sheet")).toHaveCount(0);
  await page.goto(`/${locale}/driver/stops/${fx.stopIds[2]}`);
  await expect(page.getByTestId("photo-missing").first()).toBeVisible();
  await check("stop-no-photos");

  // 5. A delivered stop (result card) and the toast, then the finished screen.
  await page.getByTestId("btn-delivered").click();
  await expect(page.locator("[data-sonner-toast]")).toBeVisible();
  await check("after-delivered-toast");
  await fx.finishTour();
  await page.goto(`/${locale}/driver/stops/${fx.stopIds[0]}`);
  await expect(page.getByTestId("stop-result")).toBeVisible();
  await check("stop-result");
  await page.goto(`/${locale}/driver`);
  await expect(page.getByTestId("all-done")).toBeVisible();
  await check("finished");

  return { axe, layout };
}

for (const scheme of ["light", "dark"] as const) {
  for (const locale of LOCALES) {
    test.describe(`${scheme} ${locale}`, () => {
      test.use({ colorScheme: scheme });
      test(`all driver screens: axe + layout rules (${scheme}, ${locale})`, async ({
        page,
        fx,
      }, info) => {
        test.setTimeout(120_000);
        const { axe, layout } = await walk(page, fx, locale, { scheme, scale: 100 }, info);
        for (const f of layout) console.log(`LAYOUT ${f.screen} ${f.kind} ${f.detail}`);
        expect.soft(axe, "serious / critical axe findings").toEqual([]);
        expect
          .soft(
            layout.filter((f) => f.kind !== "text"),
            "layout rules",
          )
          .toEqual([]);
        expect
          .soft(
            layout.filter((f) => f.kind === "text"),
            "text below 16 px",
          )
          .toEqual([]);
      });
    });
  }
}

for (const locale of ["de", "cs"] as const) {
  test.describe(`130 % font ${locale}`, () => {
    test(`all driver screens at 130 % root font size (${locale})`, async ({ page, fx }, info) => {
      test.setTimeout(120_000);
      await fontScale(page, 130);
      const { axe, layout } = await walk(page, fx, locale, { scheme: "light", scale: 130 }, info);
      for (const f of layout) console.log(`LAYOUT ${f.screen} ${f.kind} ${f.detail}`);
      expect.soft(axe, "serious / critical axe findings").toEqual([]);
      expect
        .soft(
          layout.filter((f) => f.kind !== "text"),
          "layout rules",
        )
        .toEqual([]);
    });
  });
}

test.describe("offline shell, generic offline page, error page, install overlay", () => {
  for (const locale of LOCALES) {
    for (const scheme of ["light", "dark"] as const) {
      test.describe(`${scheme} ${locale}`, () => {
        test.use({ colorScheme: scheme });
        test(`offline shell, offline page, error page (${scheme}, ${locale})`, async ({
          page,
          context,
          fx,
        }, info) => {
          test.setTimeout(120_000);
          await installNetworkEmulation(context);
          await fx.reset({ locale });
          await loginDriver(page, fx, locale);
          await page.evaluate(() => navigator.serviceWorker.ready);
          await page.goto(`/${locale}/driver`);
          await page.waitForFunction(
            () => navigator.serviceWorker?.controller !== null,
            undefined,
            {
              timeout: 30_000,
            },
          );
          await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
          const axe = [];
          const layout = [];
          // Offline list and stop from the service worker's shell.
          await setOnline(context, page, false);
          await gotoSettled(page, `/${locale}/driver`);
          await expect(page.getByTestId("offline-bar")).toBeVisible();
          await expect(page.getByTestId("stop-list")).toBeVisible();
          axe.push(...(await axeAudit(page, `offline-list-${locale}-${scheme}`, info)));
          layout.push(...(await layoutAudit(page, `offline-list-${locale}-${scheme}`)));
          await gotoSettled(page, `/${locale}/driver/stops/${fx.stopIds[0]}`);
          await expect(page.getByTestId("stop-detail")).toBeVisible();
          axe.push(...(await axeAudit(page, `offline-stop-${locale}-${scheme}`, info)));
          layout.push(...(await layoutAudit(page, `offline-stop-${locale}-${scheme}`)));
          await page.screenshot({ path: info.outputPath(`offline-stop-${locale}-${scheme}.png`) });
          await setOnline(context, page, true);
          // The generic precached page (login URLs, unknown driver URLs while offline).
          await page.route(`**/${locale}/driver/generic-offline-page`, (route) =>
            route.fulfill({
              status: 200,
              contentType: "text/html",
              body: fs.readFileSync("public/offline.html"),
            }),
          );
          await page.goto(`/${locale}/driver/generic-offline-page`);
          axe.push(...(await axeAudit(page, `offline-html-${locale}-${scheme}`, info)));
          layout.push(...(await layoutAudit(page, `offline-html-${locale}-${scheme}`)));
          // Friendly error page, online.
          await page.goto(`/${locale}/driver/dev-error`);
          await expect(page.getByTestId("driver-error")).toBeVisible();
          axe.push(...(await axeAudit(page, `error-${locale}-${scheme}`, info)));
          layout.push(...(await layoutAudit(page, `error-${locale}-${scheme}`)));
          await page.screenshot({ path: info.outputPath(`error-${locale}-${scheme}.png`) });
          // ... and its calm offline variant.
          await setOnline(context, page, false);
          await expect(page.getByTestId("driver-error")).toHaveAttribute(
            "data-connection",
            "offline",
          );
          axe.push(...(await axeAudit(page, `error-offline-${locale}-${scheme}`, info)));
          layout.push(...(await layoutAudit(page, `error-offline-${locale}-${scheme}`)));
          await setOnline(context, page, true);
          for (const f of layout) console.log(`LAYOUT ${f.screen} ${f.kind} ${f.detail}`);
          expect.soft(axe, "serious / critical axe findings").toEqual([]);
          expect
            .soft(
              layout.filter((f) => f.kind !== "text"),
              "layout rules",
            )
            .toEqual([]);
          expect
            .soft(
              layout.filter((f) => f.kind === "text"),
              "text below 16 px",
            )
            .toEqual([]);
        });
      });
    }
  }

  test.describe("install overlay (iOS hint)", () => {
    test.use({ userAgent: IPHONE_UA });
    for (const locale of LOCALES) {
      for (const scheme of ["light", "dark"] as const) {
        test(`install hint and overlay (${scheme}, ${locale})`, async ({ page, fx }, info) => {
          await page.emulateMedia({ colorScheme: scheme });
          await fx.reset({ locale });
          await loginDriver(page, fx, locale);
          await page.goto(`/${locale}/driver`);
          const axe = [];
          const layout = [];
          await expect(page.getByTestId("install-hint")).toBeVisible();
          // The hint belongs to the frame of the page and is there first; the tour streams in after
          // it. The audit is about the whole screen, so it waits for the tour as well.
          await expect(page.locator('[data-testid="today-tour"]:visible')).toBeVisible();
          axe.push(...(await axeAudit(page, `install-hint-${locale}-${scheme}`, info)));
          layout.push(...(await layoutAudit(page, `install-hint-${locale}-${scheme}`)));
          await page.getByTestId("install-how").click();
          await expect(page.getByTestId("install-overlay")).toBeVisible();
          await page.waitForTimeout(400);
          axe.push(...(await axeAudit(page, `install-overlay-${locale}-${scheme}`, info)));
          layout.push(...(await layoutAudit(page, `install-overlay-${locale}-${scheme}`)));
          await page.screenshot({
            path: info.outputPath(`install-overlay-${locale}-${scheme}.png`),
          });
          for (const f of layout) console.log(`LAYOUT ${f.screen} ${f.kind} ${f.detail}`);
          expect.soft(axe, "serious / critical axe findings").toEqual([]);
          expect
            .soft(
              layout.filter((f) => f.kind !== "text"),
              "layout rules",
            )
            .toEqual([]);
          expect
            .soft(
              layout.filter((f) => f.kind === "text"),
              "text below 16 px",
            )
            .toEqual([]);
        });
      }
    }
  });
});
