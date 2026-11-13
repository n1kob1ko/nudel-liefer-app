import { expect, type Locator, type Page, test as base } from "@playwright/test";

import {
  createDriverFixture,
  type DriverFixture,
  loginDriver,
  stubImages,
} from "./helpers/driver-fixture";

// NUD-095. One-hand reachability (primary actions in the bottom half of the screen, measured with
// bounding boxes), visible keyboard focus in reading order, reduced motion. Needs DATABASE_URL, S3_*
// and `ENABLE_ERROR_TEST_PAGES=true` for the error page.
const test = base.extend<{ fx: DriverFixture }>({
  fx: async ({}, provide) => {
    const fx = await createDriverFixture("use");
    await provide(fx);
    await fx.cleanup();
  },
});

const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "412x915", width: 412, height: 915 },
] as const;

const centerY = async (locator: Locator) => {
  // `boundingBox()` does not wait. Right after `goto` the streamed part of a page can still be
  // hidden (the login form sits in a Suspense boundary), and a hidden element has no box: the
  // measurement raced the reveal and failed about one run in eight.
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "element has a box").not.toBeNull();
  return box!.y + box!.height / 2;
};

/** Centre of the box that spans a group of elements (equal-weight choices such as the languages). */
const groupCenterY = async (locators: Locator[]) => {
  const boxes = await Promise.all(locators.map((l) => l.boundingBox()));
  const top = Math.min(...boxes.map((b) => b!.y));
  const bottom = Math.max(...boxes.map((b) => b!.y + b!.height));
  return (top + bottom) / 2;
};

for (const vp of VIEWPORTS) {
  test.describe(`one hand at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`primary actions sit in the bottom half (${vp.name})`, async ({ page, fx }, info) => {
      test.setTimeout(120_000);
      const half = vp.height / 2;
      const report: string[] = [];
      const expectBottom = (name: string, y: number) => {
        report.push(`${name}: ${Math.round(y)} / ${vp.height}`);
        expect.soft(y, `${name} centre must be in the bottom half`).toBeGreaterThanOrEqual(half);
      };

      // Login.
      await stubImages(page);
      await page.goto("/de/driver/login");
      expectBottom("login submit", await centerY(page.getByTestId("login-submit")));

      // Language picker: the four choices as a group.
      await fx.reset({ localeChosen: false });
      await page.locator('input[name="username"]').fill(fx.username);
      await page.locator('input[name="pin"]').fill("482916");
      await page.getByTestId("login-submit").click();
      await expect(page.getByTestId("language-picker")).toBeVisible();
      expectBottom(
        "language choices",
        await groupCenterY(
          ["de", "en", "sr-Latn", "cs", "zh-Hans"].map((l) => page.getByTestId(`pick-${l}`)),
        ),
      );
      await page.screenshot({ path: info.outputPath(`picker-${vp.name}.png`) });
      await page.getByTestId("pick-de").click();

      // Today: "start navigation" of the next stop, at scroll position 0.
      await expect(page.getByTestId("next-stop")).toBeVisible();
      expectBottom(
        "today: navigate",
        await centerY(page.getByTestId("next-stop").getByTestId("navigate")),
      );
      await page.screenshot({ path: info.outputPath(`today-${vp.name}.png`) });

      // Stop detail: navigate sits at the top (secondary to the status), "delivered" / "problem" at
      // the end of the page: scrolled to the bottom they are in the bottom half.
      await page.goto(`/de/driver/stops/${fx.stopIds[0]}`);
      await expect(page.getByTestId("btn-delivered")).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      expectBottom("stop: delivered (page end)", await centerY(page.getByTestId("btn-delivered")));
      expectBottom("stop: problem (page end)", await centerY(page.getByTestId("btn-problem")));
      await page.screenshot({ path: info.outputPath(`stop-end-${vp.name}.png`) });

      // Problem sheet: submit and cancel stay at the bottom edge without scrolling the sheet.
      await page.getByTestId("btn-problem").click();
      await expect(page.getByTestId("problem-sheet")).toBeVisible();
      await page.getByTestId("reason-CLOSED").click();
      await page.waitForTimeout(400);
      expectBottom("sheet: submit", await centerY(page.getByTestId("problem-submit")));
      expect.soft(await centerY(page.getByTestId("problem-submit"))).toBeLessThan(vp.height);
      await page.screenshot({ path: info.outputPath(`sheet-${vp.name}.png`) });
      await page.getByTestId("problem-cancel").click();

      // Error page: the retry button.
      await page.goto("/de/driver/dev-error");
      await expect(page.getByTestId("driver-error")).toBeVisible();
      expectBottom("error: retry", await centerY(page.getByTestId("driver-error-retry")));
      await page.screenshot({ path: info.outputPath(`error-${vp.name}.png`) });

      console.log(`REACH ${vp.name}\n  ${report.join("\n  ")}`);
    });
  });
}

/** Visible focus: an outline or a box-shadow ring on the focused element (or its wrapper). */
async function focusIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const look = (e: Element) => {
      const s = getComputedStyle(e);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const shadow = s.boxShadow !== "none" && /rgb/.test(s.boxShadow);
      return outline || shadow;
    };
    const r = el.getBoundingClientRect();
    return {
      name: `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}`,
      visible: look(el) || (el.parentElement ? look(el.parentElement) : false),
      // The sticky top bar counts as the top of the page, wherever the page is scrolled to.
      top: el.closest("[data-testid='driver-shell'] > header") ? 0 : r.top + window.scrollY,
    };
  });
}

test.describe("keyboard", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("tab order follows the reading order and every stop shows a focus indicator", async ({
    page,
    fx,
  }) => {
    test.setTimeout(90_000);
    await fx.reset();
    await loginDriver(page, fx);
    for (const path of ["/de/driver", `/de/driver/stops/${fx.stopIds[0]}`]) {
      await page.goto(path);
      await expect(
        page.getByTestId(path.endsWith("driver") ? "today-tour" : "stop-detail"),
      ).toBeVisible();
      const seen: { name: string; visible: boolean; top: number }[] = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        const info = await focusIndicator(page);
        if (!info) continue;
        // Back on the first control: the whole page was walked once.
        if (seen.length > 0 && info.name === seen[0].name) break;
        seen.push(info);
      }
      expect(seen.length, `${path}: something is focusable`).toBeGreaterThan(5);
      const hidden = seen.filter((s) => !s.visible);
      expect(hidden, `${path}: focused elements without a visible indicator`).toEqual([]);
      // Reading order: the page position never jumps back up by more than a row of controls.
      for (let i = 1; i < seen.length; i++) {
        // The photo cards sit in a two-column grid whose DOM order is column by column (store, then
        // parking), so the second column starts higher than the first column's last control.
        if (seen[i].name.includes("[photo-") && seen[i - 1].name.includes("[photo-")) continue;
        expect(
          seen[i].top,
          `${path}: ${seen[i].name} after ${seen[i - 1].name}`,
        ).toBeGreaterThanOrEqual(seen[i - 1].top - 1);
      }
    }
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 375, height: 667 }, reducedMotion: "reduce" });

  test("the problem sheet does not slide in", async ({ page, fx }) => {
    await fx.reset();
    await loginDriver(page, fx);
    await page.goto(`/de/driver/stops/${fx.stopIds[0]}`);
    await page.getByTestId("btn-problem").click();
    const sheet = page.getByTestId("problem-sheet");
    await expect(sheet).toBeVisible();
    const durations = await sheet.evaluate((el) => {
      const s = getComputedStyle(el);
      return { animation: s.animationDuration, transition: s.transitionDuration };
    });
    for (const value of Object.values(durations)) {
      for (const part of value.split(",")) {
        const seconds = part.trim().endsWith("ms") ? parseFloat(part) / 1000 : parseFloat(part);
        expect(seconds).toBeLessThan(0.05);
      }
    }
  });
});
