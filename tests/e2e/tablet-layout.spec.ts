import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, type Page, test, type TestInfo } from "@playwright/test";
import { Client } from "pg";

import { createDriverFixture, type Locale, loginDriver } from "./helpers/driver-fixture";
import { requireDatabaseUrl, requireUsableDatabase } from "./helpers/preconditions";
import { expireSettingsCache } from "./helpers/settings";
import {
  auditTabletPage,
  controlViolations,
  type MeasuredControl,
  type PageAudit,
} from "./helpers/tablet-audit";

/**
 * NUD-153: tablet layout audit (portrait + landscape), every admin page and both login screens.
 *
 * Runs in the `tablet-portrait` / `tablet-landscape` projects of `playwright.config.ts` (768x1024 and
 * 1024x768); the other two device sizes of the ticket (iPad Air 820x1180, Android tablet 800x1280)
 * are reached with `page.setViewportSize`, so one project per orientation covers all sizes.
 *
 * Per page it asserts:
 *  1. no horizontal page overflow (`documentElement.scrollWidth <= innerWidth + 1`),
 *  2. no visible element outside the viewport, except inside a horizontal scroll/clip container
 *     (table containers — the products table needs one at 768 px, NUD-153 interim audit) and the
 *     Leaflet panes, whose tiles are clipped by the map box on purpose,
 *  3. the touch targets of the surfaces a tablet user touches without a mouse (off-canvas
 *     navigation, login forms, driver app) reach 48 px. The admin content area keeps the kit's
 *     desktop sizes (40 px buttons, 44 px fields, 32 px row icon buttons); the measured inventory is
 *     written to `test-results/tablet/audit/*.json` and listed in the ticket, not asserted.
 * It also writes one screenshot per page/viewport into `test-results/tablet/` (git-ignored).
 *
 * Both office locales (`de` and `zh-Hans`) are swept — CJK line height is the risk the ticket names
 * — and the driver area is covered through `helpers/driver-fixture.ts`.
 *
 * Needs a seeded database (product NUDELN-KARTON, an active admin, the demo driver `fahrer-de`),
 * `DATABASE_URL` and `SEED_ADMIN_PASSWORD`. It removes every row it creates; see
 * `docs/e2e-database.md` for a database of its own.
 */
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-local-only";

const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Screenshots and the measured inventory: git-ignored, one folder per project/size/locale. */
const SHOT_ROOT = join("test-results", "tablet");

/** The three tablet sizes of the ticket, both orientations; the project picks the orientation. */
const TABLET_SIZES = [
  { id: "ipad", portrait: { width: 768, height: 1024 }, landscape: { width: 1024, height: 768 } },
  {
    id: "ipad-air",
    portrait: { width: 820, height: 1180 },
    landscape: { width: 1180, height: 820 },
  },
  {
    id: "android",
    portrait: { width: 800, height: 1280 },
    landscape: { width: 1280, height: 800 },
  },
] as const;

type TabletSizeId = (typeof TABLET_SIZES)[number]["id"];

/**
 * Which pages are swept. `de` runs over every size; `zh-Hans` once per project — enough to catch a
 * CJK line height / wrap problem without doubling the runtime.
 */
const ADMIN_SWEEPS: ReadonlyArray<{ size: TabletSizeId; locale: Locale }> = [
  { size: "ipad", locale: "de" },
  { size: "ipad-air", locale: "de" },
  { size: "android", locale: "de" },
  { size: "ipad", locale: "zh-Hans" },
];

const DRIVER_SWEEPS: ReadonlyArray<{ size: TabletSizeId; locale: Locale }> = [
  { size: "ipad", locale: "de" },
  { size: "ipad", locale: "zh-Hans" },
];

/** The page title every admin page renders (`PageHeader`), except the dashboard and the load sheet. */
const TITLE = '[data-testid="section-title"]';

const isTabletProject = (project: string) => project.startsWith("tablet-");

/** The orientation a project stands for; the audit's own viewport always matches it. */
const viewportFor = (size: TabletSizeId, project: string) => {
  const device = TABLET_SIZES.find((entry) => entry.id === size);
  if (!device) throw new Error(`Unreachable: no tablet size ${size}`);
  return project === "tablet-landscape" ? device.landscape : device.portrait;
};

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

/**
 * Waits until the streamed page has replaced its Suspense fallback and CSS transitions are done, so
 * a measurement is never taken on a half-rendered layout (a skeleton is exactly what makes a short
 * page look "fine" while the real table is still on its way).
 */
async function settle(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="loading-skeleton"]')).toHaveCount(0);
  await page
    .evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    )
    .catch(() => {});
  // Map containers size themselves one frame after mount; without this the tiles measure 0x0.
  await page.waitForTimeout(120);
}

/** One page of the walk. `path` is locale-aware; `settle` proves its content is on screen. */
type PageCase = { id: string; path: (locale: string) => string; settle: string };

type AuditFixture = {
  day: string;
  emptyDay: string;
  customerId: string;
  orderId: string;
  productId: string;
  /** Id of the tour the walk generates for `day` (exists before the page walk starts). */
  tourId: string;
  client: Client;
  cleanup: () => Promise<void>;
};

/**
 * Own rows for the detail/edit pages (a customer and an order) and a tour generated through the UI,
 * so the audit visits the real planner instead of a hand-written row. Every test gets its own day,
 * which keeps the sweeps parallel-safe. Everything is deleted again in `cleanup`.
 */
async function createAuditFixture(): Promise<AuditFixture> {
  const tag = `tbl${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
  const year = 2100 + Math.floor(Math.random() * 7000);
  const day = `${year}-09-10`;
  const emptyDay = `${year}-09-11`;
  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  await requireUsableDatabase(client, { admin: true, skus: ["NUDELN-KARTON"] });

  const settings = (
    await client.query(`SELECT "depotLat","depotLng","depotPinConfirmed" FROM "Settings"`)
  ).rows[0] as { depotLat: number; depotLng: number; depotPinConfirmed: boolean };
  const admin = (await client.query(`SELECT "id" FROM "User" WHERE "role"='ADMIN' LIMIT 1`))
    .rows[0] as { id: string };
  const karton = (await client.query(`SELECT "id" FROM "Product" WHERE "sku"='NUDELN-KARTON'`))
    .rows[0].id as string;
  await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=true`);
  await expireSettingsCache();

  const customerIds: string[] = [];
  let orderId = "";
  for (const [index, suffix] of ["A", "B", "C"].entries()) {
    const customerId = `id-${tag}-${suffix}`;
    customerIds.push(customerId);
    await client.query(
      `INSERT INTO "Customer" ("id","customerNumber","name","street","postalCode","city","lat","lng","pinConfirmed","updatedAt")
       VALUES ($1,$2,$3,'Mariahilfer Straße 88/1/4','1070','Wien',$4,$5,true,now())`,
      [
        customerId,
        `${tag}-${suffix}`,
        `Ristorante ${suffix} ${tag}`,
        settings.depotLat,
        settings.depotLng + 0.01 * (index + 1),
      ],
    );
    const id = `ord-${tag}-${suffix}`;
    if (suffix === "A") orderId = id;
    await client.query(
      `INSERT INTO "Order" ("id","customerId","deliveryDate","windowFrom","windowTo","status","source","createdById","updatedAt")
       VALUES ($1,$2,$3,$3,$3,'CONFIRMED','MANUAL',$4,now())`,
      [id, customerId, day, admin.id],
    );
    await client.query(
      `INSERT INTO "OrderItem" ("id","orderId","productId","quantity") VALUES ($1,$2,$3,2)`,
      [`oi-${id}`, id, karton],
    );
  }

  const cleanup = async () => {
    for (const tourDay of [day, emptyDay]) {
      const stopIds = `(SELECT s."id" FROM "Stop" s JOIN "Tour" t ON t."id"=s."tourId" WHERE t."date"=$1)`;
      await client.query(`DELETE FROM "StopOrder" WHERE "stopId" IN ${stopIds}`, [tourDay]);
      await client.query(`DELETE FROM "StopMutation" WHERE "stopId" IN ${stopIds}`, [tourDay]);
      await client.query(
        `DELETE FROM "Stop" WHERE "tourId" IN (SELECT "id" FROM "Tour" WHERE "date"=$1)`,
        [tourDay],
      );
      await client.query(`DELETE FROM "Tour" WHERE "date"=$1`, [tourDay]);
    }
    await client.query(
      `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "customerId" = ANY($1))`,
      [customerIds],
    );
    await client.query(`DELETE FROM "Order" WHERE "customerId" = ANY($1)`, [customerIds]);
    await client.query(`DELETE FROM "Customer" WHERE "id" = ANY($1)`, [customerIds]);
    await client.query(`UPDATE "Settings" SET "depotPinConfirmed"=$1`, [
      settings.depotPinConfirmed,
    ]);
    await expireSettingsCache();
    await client.end();
  };

  return {
    day,
    emptyDay,
    customerId: customerIds[0],
    orderId,
    productId: karton,
    tourId: "",
    client,
    cleanup,
  };
}

/** Generates the tour of the fixture day through the planning page and returns its id. */
async function planTour(page: Page, fixture: AuditFixture, locale: string): Promise<string> {
  await page.goto(`/${locale}/admin/tours?date=${fixture.day}`);
  await expect(visible(page, "tour-generate")).toBeEnabled();
  await visible(page, "tour-generate").click();
  await expect(page.locator('[data-testid="stop-row"]:visible')).toHaveCount(3);
  const rows = await fixture.client.query(`SELECT "id" FROM "Tour" WHERE "date"=$1`, [fixture.day]);
  const id = (rows.rows[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error(`No tour row for ${fixture.day} after "Tour planen"`);
  return id;
}

/** The admin routes of NUD-153, in the order the ticket lists them (the drawer is appended). */
function adminPages(fixture: AuditFixture): PageCase[] {
  const { customerId, orderId, productId, tourId, day, emptyDay } = fixture;
  return [
    { id: "dashboard", path: (l) => `/${l}/admin`, settle: '[data-testid="admin-title"]' },
    { id: "orders-list", path: (l) => `/${l}/admin/orders`, settle: TITLE },
    { id: "orders-new", path: (l) => `/${l}/admin/orders/new`, settle: TITLE },
    { id: "order-detail", path: (l) => `/${l}/admin/orders/${orderId}`, settle: TITLE },
    { id: "order-edit", path: (l) => `/${l}/admin/orders/${orderId}/edit`, settle: TITLE },
    { id: "tours-list", path: (l) => `/${l}/admin/tours?date=${emptyDay}`, settle: TITLE },
    {
      id: "tour-detail",
      path: (l) => `/${l}/admin/tours?date=${day}&tour=${tourId}`,
      settle: TITLE,
    },
    { id: "customers-list", path: (l) => `/${l}/admin/customers`, settle: TITLE },
    { id: "customers-new", path: (l) => `/${l}/admin/customers/new`, settle: TITLE },
    { id: "customer-detail", path: (l) => `/${l}/admin/customers/${customerId}`, settle: TITLE },
    { id: "customer-edit", path: (l) => `/${l}/admin/customers/${customerId}/edit`, settle: TITLE },
    { id: "customers-import", path: (l) => `/${l}/admin/customers/import`, settle: TITLE },
    { id: "customers-parking", path: (l) => `/${l}/admin/customers/parking`, settle: TITLE },
    { id: "products", path: (l) => `/${l}/admin/products`, settle: TITLE },
    { id: "products-new", path: (l) => `/${l}/admin/products/new`, settle: TITLE },
    { id: "product-edit", path: (l) => `/${l}/admin/products/${productId}/edit`, settle: TITLE },
    { id: "vehicles", path: (l) => `/${l}/admin/vehicles`, settle: TITLE },
    { id: "drivers", path: (l) => `/${l}/admin/drivers`, settle: TITLE },
    { id: "utilization", path: (l) => `/${l}/admin/utilization`, settle: TITLE },
    { id: "settings", path: (l) => `/${l}/admin/settings`, settle: TITLE },
    {
      id: "print-view",
      // The load sheet has a language of its own (`?locale=`), independent of the admin UI (NUD-134).
      path: (l) => `/${l}/admin/tours/${tourId}/print?locale=${l === "de" ? "de" : "zh-Hans"}`,
      settle: '[data-testid="load-sheet-title"]',
    },
  ];
}

const screenshotPath = (info: TestInfo, size: TabletSizeId, locale: string, id: string) =>
  join(SHOT_ROOT, info.project.name, `${size}-${locale}`, `${id}.png`);

function writeArtifact(info: TestInfo, name: string, data: unknown) {
  const file = join(SHOT_ROOT, "audit", `${info.project.name}-${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

type PageResult = PageAudit & { screenshot: string };

type WalkContext = { info: TestInfo; size: TabletSizeId; locale: Locale };

/**
 * Visits one page, measures it, screenshots it. It never asserts: the walk collects, the test decides
 * once every page has been seen. `path: null` measures the page that is already open (map view).
 */
async function visit(
  page: Page,
  target: { id: string; path: ((locale: string) => string) | null; settle: string },
  { info, size, locale }: WalkContext,
  group: "admin" | "login" | "driver" = "admin",
): Promise<PageResult> {
  if (target.path) await page.goto(target.path(locale));
  await settle(page, target.settle);
  const audit = await auditTabletPage(page, { id: target.id, group });
  const screenshot = screenshotPath(info, size, locale, target.id);
  mkdirSync(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, scale: "css" });
  return { ...audit, screenshot };
}

/** Every console error / page error of the run; reported with the findings, never asserted. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/**
 * Logs and persists what was measured, so the ticket's list comes out of the run instead of a
 * hand-written summary: `test-results/tablet/audit/<project>-<sweep>.json`.
 */
function report(results: PageResult[], controls: MeasuredControl[], info: TestInfo, name: string) {
  const tag = `${info.project.name} ${name}`;
  for (const result of results) {
    for (const finding of result.findings) {
      console.log(`TABLET ${tag} ${result.id} ${finding.kind}: ${finding.detail}`);
    }
  }
  const tooSmall = controlViolations(controls);
  for (const control of tooSmall) {
    console.log(
      `TOUCH ${tag} ${control.group} ${control.label} ${control.width}x${control.height}`,
    );
  }
  // A horizontal scroll container is allowed, but the ticket wants the ones that are used named.
  for (const result of results) {
    for (const scroller of result.internalScroll) {
      console.log(
        `SCROLL ${tag} ${result.id} ${scroller.label} ${scroller.scrollWidth}px in ${scroller.clientWidth}px`,
      );
    }
  }
  // What stays at the desktop size on purpose — the list the ticket quotes.
  const unique = new Map<string, MeasuredControl>();
  for (const control of controls) {
    if (control.group !== "main" && control.group !== "header") continue;
    if (control.width >= 48 && control.height >= 48) continue;
    unique.set(`${control.group} ${control.label}`, control);
  }
  writeArtifact(info, name, {
    project: info.project.name,
    viewport: results[0]?.viewport ?? null,
    pages: results.map((page) => ({
      id: page.id,
      path: page.path,
      screenshot: page.screenshot,
      findings: page.findings,
      internalScroll: page.internalScroll,
      controls: page.controls,
    })),
    desktopSizedControls: [...unique.values()].sort((a, b) => a.height - b.height),
    touchTargetViolations: tooSmall,
  });
  return {
    findings: results.flatMap((result) => result.findings.map((f) => ({ ...f, page: result.id }))),
    tooSmall,
  };
}

/** Fails only at the end, so one run lists every problem instead of stopping at the first page. */
function expectClean(
  findings: Array<{ page: string; kind: string; detail: string }>,
  tooSmall: MeasuredControl[],
) {
  expect(
    findings.map((f) => `${f.page} ${f.kind}: ${f.detail}`),
    "horizontal overflow / elements outside the viewport",
  ).toEqual([]);
  expect(
    tooSmall.map((c) => `${c.group} ${c.label} ${c.width}x${c.height} < 48 px`),
    "touch targets of the tablet surfaces (navigation, login, driver app)",
  ).toEqual([]);
}

async function loginAdmin(page: Page) {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail").fill("admin@example.com");
  await page.getByLabel("Passwort").fill(adminPassword);
  await visible(page, "login-submit").click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe("tablet layout audit", () => {
  /**
   * The audit is only worth something if it can fail: a page with a deliberately over-wide element
   * must produce exactly the two findings the assertions above rely on. Without this, a silently
   * broken `page.evaluate` would turn the whole sweep into a green rubber stamp.
   */
  test("the overflow detector itself", async ({ page }, info) => {
    test.skip(!isTabletProject(info.project.name), "the tablet-* projects own this spec");
    test.setTimeout(60_000);
    await page.setViewportSize(viewportFor("ipad", info.project.name));
    await loginAdmin(page);
    await page.goto("/de/admin");
    await settle(page, '[data-testid="admin-title"]');

    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "overflow-probe";
      probe.setAttribute("data-testid", "overflow-probe");
      probe.style.cssText = "width:200vw;height:24px";
      document.getElementById("main")?.append(probe);
    });
    const probe = await auditTabletPage(page, { id: "probe", group: "admin" });
    expect(
      probe.findings.map((f) => f.kind),
      "an over-wide element must be found",
    ).toEqual(["hscroll", "overflow"]);
    expect(probe.findings[1]?.detail).toContain("overflow-probe");

    await page.evaluate(() => document.getElementById("overflow-probe")?.remove());
    const clean = await auditTabletPage(page, { id: "probe-removed", group: "admin" });
    expect(clean.findings, "the same page without the element is clean").toEqual([]);
  });

  for (const sweep of ADMIN_SWEEPS) {
    test(`admin pages · ${sweep.size} · ${sweep.locale}`, async ({ page }, info) => {
      test.skip(!isTabletProject(info.project.name), "the tablet-* projects own this spec");
      test.setTimeout(300_000);
      const ctx: WalkContext = { info, size: sweep.size, locale: sweep.locale };
      await page.setViewportSize(viewportFor(sweep.size, info.project.name));
      // Map tiles are the only third-party request; failed they would only add console noise.
      await page.route(/\/\d+\/\d+\/\d+\.png/, (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
      );
      const errors = collectErrors(page);
      const fixture = await createAuditFixture();
      try {
        const results: PageResult[] = [];
        const controls: MeasuredControl[] = [];
        const push = (result: PageResult) => {
          results.push(result);
          controls.push(...result.controls);
        };

        // 1. Both login screens, nobody signed in (the office login is the tablet at the counter).
        push(
          await visit(
            page,
            {
              id: "login-admin",
              path: (l) => `/${l}/login`,
              settle: '[data-testid="login-title"]',
            },
            ctx,
            "login",
          ),
        );
        push(
          await visit(
            page,
            {
              id: "login-driver",
              path: (l) => `/${l}/driver/login`,
              settle: '[data-testid="login-title"]',
            },
            ctx,
            "login",
          ),
        );

        // 2. The planning page needs a tour before it shows its real layout.
        await loginAdmin(page);
        fixture.tourId = await planTour(page, fixture, "de");

        // 3. Every admin page.
        for (const target of adminPages(fixture)) {
          push(await visit(page, target, ctx));
        }

        // 4. The off-canvas drawer: the whole navigation of ≤1024 px, opened for real. At ≥1025 px
        //    (iPad Air / Android landscape) the rail is on screen instead — chrome like the top bar.
        await page.goto(`/${sweep.locale}/admin`);
        await settle(page, '[data-testid="admin-title"]');
        if (await visible(page, "open-menu").isVisible()) {
          await visible(page, "open-menu").click();
          await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
          await page.waitForTimeout(300); // slide-in
          const drawer = await auditTabletPage(page, { id: "drawer", group: "admin" });
          const drawerShot = screenshotPath(info, sweep.size, sweep.locale, "drawer");
          await page.screenshot({ path: drawerShot, scale: "css" });
          push({ ...drawer, screenshot: drawerShot });
          await page.keyboard.press("Escape");
        } else {
          console.log(
            `DRAWER ${info.project.name} ${sweep.size}-${sweep.locale}: no drawer at ` +
              `${viewportFor(sweep.size, info.project.name).width} px (rail from 1025 px)`,
          );
        }

        const { findings, tooSmall } = report(
          results,
          controls,
          info,
          `${sweep.size}-${sweep.locale}`,
        );
        // Pages that logged an error but no layout problem are still worth knowing about.
        if (errors.length) {
          console.log(`ERRORS ${info.project.name} ${sweep.locale}: ${errors.join(" | ")}`);
        }
        expectClean(findings, tooSmall);
      } finally {
        await fixture.cleanup();
      }
    });
  }

  for (const sweep of DRIVER_SWEEPS) {
    test(`driver area · ${sweep.size} · ${sweep.locale}`, async ({ page }, info) => {
      test.skip(!isTabletProject(info.project.name), "the tablet-* projects own this spec");
      test.setTimeout(180_000);
      const ctx: WalkContext = { info, size: sweep.size, locale: sweep.locale };
      await page.setViewportSize(viewportFor(sweep.size, info.project.name));
      const fixture = await createDriverFixture("tbl");
      try {
        await fixture.reset({ localeChosen: true, locale: sweep.locale });
        await loginDriver(page, fixture, sweep.locale);

        const results: PageResult[] = [];
        const controls: MeasuredControl[] = [];
        const push = (result: PageResult) => {
          results.push(result);
          controls.push(...result.controls);
        };

        push(
          await visit(
            page,
            { id: "today", path: (l) => `/${l}/driver`, settle: '[data-testid="today-tour"]' },
            ctx,
            "driver",
          ),
        );
        // The map view of today's tour (a real tablet use case: the tablet sits in the van).
        await visible(page, "view-map").click();
        push(
          await visit(
            page,
            { id: "today-map", path: null, settle: '[data-testid="map-view"]' },
            ctx,
            "driver",
          ),
        );
        push(
          await visit(
            page,
            {
              id: "stop-detail",
              path: (l) => `/${l}/driver/stops/${fixture.stopIds[0]}`,
              settle: '[data-testid="stop-detail"]',
            },
            ctx,
            "driver",
          ),
        );

        const { findings, tooSmall } = report(
          results,
          controls,
          info,
          `${sweep.size}-${sweep.locale}-driver`,
        );
        expectClean(findings, tooSmall);
      } finally {
        await fixture.cleanup();
      }
    });
  }
});
