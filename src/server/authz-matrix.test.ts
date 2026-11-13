// @vitest-environment node
/**
 * NUD-093 authorization matrix: every server action and every route handler, called as
 * {anonymous, driver, admin}, must give the expected answer. A second test ENUMERATES all of them
 * from the source tree (`"use server"` modules, `src/app/**\/route.ts`) and fails when one is
 * missing from the matrix (or the matrix names one that no longer exists), so a new action cannot
 * ship without a row here.
 *
 * Nothing touches a real database: `getDb()` is a stub whose only working call is
 * `user.findUnique` (what `requireRole` uses); any other database access throws "DB_REACHED". An
 * `allowed` answer therefore means "passed authorization", whatever happened afterwards.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { encode } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "./auth/actor";

type Principal = "anonymous" | "driver" | "admin";
type Outcome = "unauthenticated" | "forbidden" | "allowed";

const PEOPLE = {
  driver: { id: "u-driver", role: "DRIVER", active: true },
  admin: { id: "u-admin", role: "ADMIN", active: true },
} as const;

const state: {
  principal: Principal;
  /** Overrides the DB row of the signed-in user (deactivated user test). */
  userRow: Record<string, unknown> | null;
  dbCalls: string[];
} = { principal: "anonymous", userRow: null, dbCalls: [] };

function sessionFor(principal: Principal) {
  return principal === "anonymous" ? null : { user: { id: PEOPLE[principal].id } };
}

vi.mock("./auth/auth", async (importOriginal) => {
  // The real Auth.js handlers are exercised for the /api/auth route; everything else that asks
  // "who is logged in?" gets the principal of the current test.
  const original = await importOriginal<typeof import("./auth/auth")>();
  return {
    ...original,
    auth: async () => sessionFor(state.principal),
    signIn: async () => "http://localhost:3000/login?error=CredentialsSignin&code=credentials",
    signOut: async () => undefined,
    updateSession: async () => undefined,
  };
});

vi.mock("./db", () => {
  const reached = (path: string): never => {
    state.dbCalls.push(path);
    throw new Error(`DB_REACHED ${path}`);
  };
  const deep = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => (prop === "then" ? undefined : deep(`${path}.${String(prop)}`)),
      apply: () => reached(path),
    });
  const db = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "user") {
          return {
            findUnique: async () => {
              state.dbCalls.push("user.findUnique");
              if (state.principal === "anonymous") return null;
              return (
                state.userRow ?? {
                  ...PEOPLE[state.principal],
                  locale: "de",
                  displayName: "X",
                  localeChosen: true,
                }
              );
            },
            update: () => reached("user.update"),
          };
        }
        return deep(String(prop));
      },
    },
  );
  return { getDb: () => db, createPrismaClient: () => db };
});

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
  after: () => undefined,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "de",
}));
vi.mock("./health", () => ({
  runProductionHealthChecks: async () => ({ status: "ok", checks: {} }),
}));

const ORIGIN = "http://localhost:3000";
const SECRET = "authz-matrix-test-secret-0123456789abcdef";

const post = (path: string, body: BodyInit = "{}", contentType = "application/json") =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": contentType },
    body,
  });
const get = (path: string) => new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN } });

/** Session cookie for the real Auth.js handlers (`/api/auth/*`). */
async function sessionCookie(principal: Principal): Promise<Record<string, string>> {
  if (principal === "anonymous") return {};
  const salt = "authjs.session-token";
  const token = await encode({
    token: { sub: PEOPLE[principal].id, role: PEOPLE[principal].role, locale: "de" },
    secret: process.env.AUTH_SECRET!,
    salt,
  });
  return { cookie: `${salt}=${token}` };
}

type Row = {
  /** Where it came from, for the failure message. */
  note: string;
  expect: Record<Principal, Outcome>;
  call: () => Promise<unknown>;
};

const ADMIN_ONLY: Record<Principal, Outcome> = {
  anonymous: "unauthenticated",
  driver: "forbidden",
  admin: "allowed",
};
const DRIVER_ONLY: Record<Principal, Outcome> = {
  anonymous: "unauthenticated",
  driver: "allowed",
  admin: "forbidden",
};
const ANY_USER: Record<Principal, Outcome> = {
  anonymous: "unauthenticated",
  driver: "allowed",
  admin: "allowed",
};
const PUBLIC: Record<Principal, Outcome> = {
  anonymous: "allowed",
  driver: "allowed",
  admin: "allowed",
};
/** Bearer-secret endpoints: a session of any role is irrelevant, the secret is missing. */
const SECRET_ONLY: Record<Principal, Outcome> = {
  anonymous: "unauthenticated",
  driver: "unauthenticated",
  admin: "unauthenticated",
};

const adminAction = (note: string, call: Row["call"]): Row => ({ note, expect: ADMIN_ONLY, call });
const driverAction = (note: string, call: Row["call"]): Row => ({
  note,
  expect: DRIVER_ONLY,
  call,
});
const publicAction = (note: string, call: Row["call"]): Row => ({ note, expect: PUBLIC, call });

// Invalid / empty arguments on purpose: authorization must be decided before the input is read.
const form = () => new FormData();

const MATRIX: Record<string, Row> = {
  // ---- admin-only server actions
  "src/server/tour-actions.ts#generateTourAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).generateTourAction({}),
  ),
  "src/server/tour-actions.ts#createFollowUpTourAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).createFollowUpTourAction({}),
  ),
  "src/server/tour-actions.ts#reorderStopsAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).reorderStopsAction({}),
  ),
  "src/server/tour-actions.ts#setTourLockedAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).setTourLockedAction({}),
  ),
  "src/server/tour-actions.ts#assignDriverAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).assignDriverAction({}),
  ),
  "src/server/tour-actions.ts#releaseTourAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).releaseTourAction({}),
  ),
  "src/server/tour-actions.ts#reReleaseTourAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).reReleaseTourAction({}),
  ),
  "src/server/tour-actions.ts#planDayAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).planDayAction({}),
  ),
  "src/server/tour-actions.ts#assignVehicleAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).assignVehicleAction({}),
  ),
  "src/server/tour-actions.ts#editTourAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).editTourAction({}),
  ),
  "src/server/tour-actions.ts#createEmptyTourAction": adminAction("tour planning", async () =>
    (await import("./tour-actions")).createEmptyTourAction({}),
  ),
  "src/server/settings-actions.ts#saveSettingsAction": adminAction("settings", async () =>
    (await import("./settings-actions")).saveSettingsAction({}),
  ),
  "src/server/customer-actions.ts#createCustomerAction": adminAction("customers", async () =>
    (await import("./customer-actions")).createCustomerAction({}),
  ),
  "src/server/customer-actions.ts#updateCustomerAction": adminAction("customers", async () =>
    (await import("./customer-actions")).updateCustomerAction("x", {}),
  ),
  "src/server/customer-actions.ts#setCustomerActiveAction": adminAction("customers", async () =>
    (await import("./customer-actions")).setCustomerActiveAction("x", false),
  ),
  "src/server/recurring-actions.ts#createRecurringOrderAction": adminAction(
    "recurring orders",
    async () => (await import("./recurring-actions")).createRecurringOrderAction({}),
  ),
  "src/server/recurring-actions.ts#updateRecurringOrderAction": adminAction(
    "recurring orders",
    async () => (await import("./recurring-actions")).updateRecurringOrderAction("x", {}),
  ),
  "src/server/recurring-actions.ts#setRecurringOrderActiveAction": adminAction(
    "recurring orders",
    async () => (await import("./recurring-actions")).setRecurringOrderActiveAction("x", false),
  ),
  "src/server/customer-actions.ts#addCustomerPhotoAction": adminAction(
    "customer photos",
    async () => (await import("./customer-actions")).addCustomerPhotoAction({}),
  ),
  "src/server/parking-actions.ts#createParkingSpotAction": adminAction("parking spots", async () =>
    (await import("./parking-actions")).createParkingSpotAction({}),
  ),
  "src/server/parking-actions.ts#updateParkingSpotAction": adminAction("parking spots", async () =>
    (await import("./parking-actions")).updateParkingSpotAction({}),
  ),
  "src/server/parking-actions.ts#reorderParkingSpotsAction": adminAction(
    "parking spots",
    async () => (await import("./parking-actions")).reorderParkingSpotsAction({}),
  ),
  "src/server/parking-actions.ts#deactivateParkingSpotAction": adminAction(
    "parking spots",
    async () => (await import("./parking-actions")).deactivateParkingSpotAction({}),
  ),
  "src/server/customer-actions.ts#saveNoteTranslationsAction": adminAction(
    "translations",
    async () => (await import("./customer-actions")).saveNoteTranslationsAction({}),
  ),
  "src/server/customer-actions.ts#retranslateNoteAction": adminAction("translations", async () =>
    (await import("./customer-actions")).retranslateNoteAction("x"),
  ),
  "src/server/geocode-actions.ts#geocodeAddressAction": adminAction("geocoder", async () =>
    (await import("./geocode-actions")).geocodeAddressAction("Teststrasse 1"),
  ),
  "src/server/user-actions.ts#createDriverAction": adminAction("user management", async () =>
    (await import("./user-actions")).createDriverAction({}),
  ),
  "src/server/user-actions.ts#createAdminAction": adminAction("user management", async () =>
    (await import("./user-actions")).createAdminAction({}),
  ),
  "src/server/user-actions.ts#resetDriverPinAction": adminAction("user management", async () =>
    (await import("./user-actions")).resetDriverPinAction("x"),
  ),
  "src/server/user-actions.ts#setUserActiveAction": adminAction("user management", async () =>
    (await import("./user-actions")).setUserActiveAction("x", false),
  ),
  "src/server/user-actions.ts#setDriverLocaleAction": adminAction("user management", async () =>
    (await import("./user-actions")).setDriverLocaleAction("x", "de"),
  ),
  "src/server/customer-import-actions.ts#previewCustomerImportAction": adminAction(
    "import",
    async () => (await import("./customer-import-actions")).previewCustomerImportAction({}),
  ),
  "src/server/customer-import-actions.ts#commitCustomerImportAction": adminAction(
    "import",
    async () => (await import("./customer-import-actions")).commitCustomerImportAction({}),
  ),
  "src/server/customer-import-actions.ts#listCustomersWithoutPinAction": adminAction(
    "import",
    async () => (await import("./customer-import-actions")).listCustomersWithoutPinAction(),
  ),
  "src/server/customer-import-actions.ts#geocodeCustomersAction": adminAction("import", async () =>
    (await import("./customer-import-actions")).geocodeCustomersAction([]),
  ),
  "src/server/order-actions.ts#createOrderAction": adminAction("orders", async () =>
    (await import("./order-actions")).createOrderAction({}),
  ),
  "src/server/order-actions.ts#updateOrderAction": adminAction("orders", async () =>
    (await import("./order-actions")).updateOrderAction("x", {}),
  ),
  "src/server/order-actions.ts#cancelOrderAction": adminAction("orders", async () =>
    (await import("./order-actions")).cancelOrderAction("x"),
  ),
  "src/server/order-actions.ts#duplicateOrderAction": adminAction("orders", async () =>
    (await import("./order-actions")).duplicateOrderAction("x", "2030-01-01"),
  ),
  "src/server/order-actions.ts#confirmedOrderCountAction": adminAction("orders", async () =>
    (await import("./order-actions")).confirmedOrderCountAction("x", "2030-01-01"),
  ),
  "src/server/order-actions.ts#dayTourCompletedAction": adminAction("orders", async () =>
    (await import("./order-actions")).dayTourCompletedAction("2030-01-01"),
  ),
  "src/server/order-actions.ts#createCorrectionDeliveryAction": adminAction("orders", async () =>
    (await import("./order-actions")).createCorrectionDeliveryAction({ date: "2030-01-01" }),
  ),
  "src/server/order-actions.ts#screenshotPreviewUrlAction": adminAction("orders", async () =>
    (await import("./order-actions")).screenshotPreviewUrlAction("screenshots/x.jpg"),
  ),
  "src/server/order-actions.ts#extractOrderDraftAction": adminAction("orders", async () =>
    (await import("./order-actions")).extractOrderDraftAction({ text: "2 Kiste Nudeln" }),
  ),
  "src/server/product-actions.ts#createProductAction": adminAction("catalog", async () =>
    (await import("./product-actions")).createProductAction({}),
  ),
  "src/server/product-actions.ts#updateProductAction": adminAction("catalog", async () =>
    (await import("./product-actions")).updateProductAction("x", {}),
  ),
  "src/server/product-actions.ts#setProductActiveAction": adminAction("catalog", async () =>
    (await import("./product-actions")).setProductActiveAction("x", false),
  ),
  "src/server/product-actions.ts#moveProductAction": adminAction("catalog", async () =>
    (await import("./product-actions")).moveProductAction("x", "up"),
  ),

  "src/server/vehicle-actions.ts#createVehicleAction": adminAction("fleet", async () =>
    (await import("./vehicle-actions")).createVehicleAction({}),
  ),
  "src/server/vehicle-actions.ts#updateVehicleAction": adminAction("fleet", async () =>
    (await import("./vehicle-actions")).updateVehicleAction("x", {}),
  ),
  "src/server/vehicle-actions.ts#setVehicleActiveAction": adminAction("fleet", async () =>
    (await import("./vehicle-actions")).setVehicleActiveAction("x", false),
  ),

  "src/server/work-schedule-actions.ts#saveWorkScheduleAction": adminAction(
    "driver working time",
    async () => (await import("./work-schedule-actions")).saveWorkScheduleAction({}),
  ),

  "src/server/standing-actions.ts#saveStandingDayAction": adminAction("day plan", async () =>
    (await import("./standing-actions")).saveStandingDayAction({}),
  ),
  "src/server/standing-actions.ts#saveStandingTourAction": adminAction("standing tours", async () =>
    (await import("./standing-actions")).saveStandingTourAction({}),
  ),
  "src/server/standing-actions.ts#setStandingTourDriverAction": adminAction(
    "standing tours",
    async () => (await import("./standing-actions")).setStandingTourDriverAction("x", null),
  ),
  "src/server/standing-actions.ts#setStandingTourActiveAction": adminAction(
    "standing tours",
    async () => (await import("./standing-actions")).setStandingTourActiveAction("x", false),
  ),

  "src/server/payment-actions.ts#markMonthlyBillPaidAction": adminAction("payments", async () =>
    (await import("./payment-actions")).markMonthlyBillPaidAction({}),
  ),
  "src/server/payment-actions.ts#unmarkMonthlyBillPaidAction": adminAction("payments", async () =>
    (await import("./payment-actions")).unmarkMonthlyBillPaidAction({}),
  ),
  "src/server/payment-actions.ts#addMonthlyAdjustmentAction": adminAction("payments", async () =>
    (await import("./payment-actions")).addMonthlyAdjustmentAction({}),
  ),
  "src/server/payment-actions.ts#removeMonthlyAdjustmentAction": adminAction("payments", async () =>
    (await import("./payment-actions")).removeMonthlyAdjustmentAction({}),
  ),

  // ---- driver-only server actions
  "src/server/stop-status-actions.ts#stopStatusAction": driverAction(
    "driver stop status",
    async () => (await import("./stop-status-actions")).stopStatusAction({} as never),
  ),
  "src/server/driver-locale-actions.ts#chooseDriverLocaleAction": driverAction(
    "language picker",
    async () => (await import("./driver-locale-actions")).chooseDriverLocaleAction("de"),
  ),

  // ---- public server actions (they carry their own checks)
  "src/server/auth/actions.ts#adminLoginAction": publicAction(
    "login form: credentials + rate limit",
    async () => (await import("./auth/actions")).adminLoginAction({ error: null }, form()),
  ),
  "src/server/auth/actions.ts#driverLoginAction": publicAction(
    "login form: credentials + rate limit",
    async () => (await import("./auth/actions")).driverLoginAction({ error: null }, form()),
  ),
  "src/server/auth/actions.ts#logoutAction": publicAction(
    "ends the caller's own session",
    async () => (await import("./auth/actions")).logoutAction(form()),
  ),
  "src/server/locale-actions.ts#setLocaleAction": publicAction(
    "locale cookie; own User.locale if logged in",
    async () => (await import("./locale-actions")).setLocaleAction("de"),
  ),
  "src/server/theme-actions.ts#setThemeAction": publicAction(
    "colour-scheme cookie of the caller (the toggle is also on the login screens)",
    async () => (await import("./theme-actions")).setThemeAction("dark"),
  ),

  // ---- route handlers
  "src/app/api/uploads/route.ts#POST": {
    note: "presigned upload; purpose rules inside",
    expect: ANY_USER,
    call: async () => (await import("@/app/api/uploads/route")).POST(post("/api/uploads")),
  },
  "src/app/api/admin/customers/import/parse/route.ts#POST": {
    note: "import file parser",
    expect: ADMIN_ONLY,
    call: async () =>
      (await import("@/app/api/admin/customers/import/parse/route")).POST(
        post("/api/admin/customers/import/parse"),
      ),
  },
  "src/app/api/admin/payments/export/route.ts#GET": {
    note: "monthly bill as PDF or CSV",
    expect: ADMIN_ONLY,
    call: async () =>
      (await import("@/app/api/admin/payments/export/route")).GET(
        get("/api/admin/payments/export?month=2099-05"),
      ),
  },
  "src/app/api/driver/tour/today/route.ts#GET": {
    note: "offline copy of the driver's tour",
    expect: DRIVER_ONLY,
    call: async () => (await import("@/app/api/driver/tour/today/route")).GET(),
  },
  "src/app/api/driver/sync/route.ts#POST": {
    note: "offline mutation queue",
    expect: DRIVER_ONLY,
    call: async () => (await import("@/app/api/driver/sync/route")).POST(post("/api/driver/sync")),
  },
  "src/app/api/driver/photos/route.ts#POST": {
    note: "driver photo registration",
    expect: DRIVER_ONLY,
    call: async () =>
      (await import("@/app/api/driver/photos/route")).POST(post("/api/driver/photos")),
  },
  "src/app/api/health/route.ts#GET": {
    note: "uptime probe, no secrets in the body",
    expect: PUBLIC,
    call: async () => (await import("@/app/api/health/route")).GET(),
  },
  "src/app/api/cron/retry-translations/route.ts#GET": {
    note: "Vercel cron: Authorization Bearer CRON_SECRET",
    expect: SECRET_ONLY,
    call: async () =>
      (await import("@/app/api/cron/retry-translations/route")).GET(
        get("/api/cron/retry-translations"),
      ),
  },
  "src/app/api/cron/retention/route.ts#GET": {
    note: "Vercel cron: Authorization Bearer CRON_SECRET",
    expect: SECRET_ONLY,
    call: async () =>
      (await import("@/app/api/cron/retention/route")).GET(get("/api/cron/retention")),
  },
  "src/app/api/cron/audit-retention/route.ts#GET": {
    note: "Vercel cron (NUD-111): Authorization Bearer CRON_SECRET",
    expect: SECRET_ONLY,
    call: async () =>
      (await import("@/app/api/cron/audit-retention/route")).GET(get("/api/cron/audit-retention")),
  },
  "src/app/api/cron/data-retention/route.ts#GET": {
    note: "Vercel cron (NUD-112): Authorization Bearer CRON_SECRET",
    expect: SECRET_ONLY,
    call: async () =>
      (await import("@/app/api/cron/data-retention/route")).GET(get("/api/cron/data-retention")),
  },
  "src/app/api/cron/orphan-cleanup/route.ts#GET": {
    note: "Vercel cron: Authorization Bearer CRON_SECRET",
    expect: SECRET_ONLY,
    call: async () =>
      (await import("@/app/api/cron/orphan-cleanup/route")).GET(get("/api/cron/orphan-cleanup")),
  },
  "src/app/api/cron/recurring-orders/route.ts#GET": {
    note: "Vercel cron (NUD-149): Authorization Bearer CRON_SECRET",
    expect: SECRET_ONLY,
    call: async () =>
      (await import("@/app/api/cron/recurring-orders/route")).GET(
        get("/api/cron/recurring-orders"),
      ),
  },
  "src/app/api/monitoring/test-error/route.ts#GET": {
    note: "NUD-094 forced Sentry test error: Authorization Bearer CRON_SECRET",
    expect: SECRET_ONLY,
    call: async () =>
      (await import("@/app/api/monitoring/test-error/route")).GET(
        get("/api/monitoring/test-error"),
      ),
  },
  "src/app/api/csp-report/route.ts#POST": {
    note: "CSP violation reports sent by browsers; stores nothing, always 204",
    expect: PUBLIC,
    call: async () => (await import("@/app/api/csp-report/route")).POST(post("/api/csp-report")),
  },
  "src/app/api/dev/settings-cache/route.ts#POST": {
    note: "e2e test hook: expires the settings cache, changes no data; a 404 unless ENABLE_ERROR_TEST_PAGES=true",
    expect: PUBLIC,
    call: async () => (await import("@/app/api/dev/settings-cache/route")).POST(),
  },
  "src/app/api/session-ended/route.ts#GET": {
    note: "deletes the caller's own session cookie",
    expect: PUBLIC,
    call: async () => {
      const { GET } = await import("@/app/api/session-ended/route");
      const { NextRequest } = await import("next/server");
      return GET(new NextRequest(`${ORIGIN}/api/session-ended`));
    },
  },
  "src/app/[locale]/manifest.webmanifest/route.ts#GET": {
    note: "PWA manifest, nothing personal",
    expect: PUBLIC,
    call: async () =>
      (await import("@/app/[locale]/manifest.webmanifest/route")).GET(
        get("/de/manifest.webmanifest"),
        { params: Promise.resolve({ locale: "de" }) } as never,
      ),
  },
  "src/app/api/auth/[...nextauth]/route.ts#GET": {
    note: "Auth.js (public by design; has its own CSRF token)",
    expect: PUBLIC,
    call: async () => {
      const { GET } = await import("@/app/api/auth/[...nextauth]/route");
      const { NextRequest } = await import("next/server");
      return GET(
        new NextRequest(`${ORIGIN}/api/auth/session`, {
          headers: await sessionCookie(state.principal),
        }),
      );
    },
  },
  "src/app/api/auth/[...nextauth]/route.ts#POST": {
    note: "Auth.js (public by design; has its own CSRF token)",
    expect: PUBLIC,
    call: async () => {
      const { POST } = await import("@/app/api/auth/[...nextauth]/route");
      const { NextRequest } = await import("next/server");
      return POST(
        new NextRequest(`${ORIGIN}/api/auth/signout`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/x-www-form-urlencoded",
            ...(await sessionCookie(state.principal)),
          },
          body: "",
        }),
      );
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Enumeration of the source tree

const SRC = join(process.cwd(), "src");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "generated" || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const rel = (path: string) => relative(process.cwd(), path).split(sep).join("/");
const isTestFile = (p: string) => /\.(test|spec)\.tsx?$/.test(p);
const isSource = (p: string) => /\.tsx?$/.test(p) && !isTestFile(p) && !p.endsWith(".d.ts");

/** True when the first statement of the file is the `"use server"` directive. */
function hasFileLevelUseServer(source: string) {
  const code = source.replace(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*/, "");
  return /^\s*["']use server["']/.test(code);
}

function exportedNames(source: string): { names: string[]; unsupported: string[] } {
  const names = new Set<string>();
  const unsupported: string[] = [];
  for (const m of source.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm))
    names.add(m[1]!);
  for (const m of source.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)) names.add(m[1]!);
  for (const m of source.matchAll(/^export\s+(?:const|let|var)\s*\{([^}]*)\}/gm)) {
    for (const part of m[1]!.split(",")) {
      const name = part.split(":").pop()!.trim();
      if (name) names.add(name);
    }
  }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) {
    for (const part of m[1]!.split(",")) {
      if (/^\s*type\s/.test(part)) continue;
      const name = part
        .split(/\s+as\s+/)
        .pop()!
        .trim();
      if (name) names.add(name);
    }
  }
  if (/^export\s+default\b/m.test(source)) unsupported.push("export default");
  if (/^export\s*\*/m.test(source)) unsupported.push("export *");
  return { names: [...names], unsupported };
}

function discover() {
  const keys: string[] = [];
  const problems: string[] = [];
  for (const file of walk(SRC).filter(isSource)) {
    const source = readFileSync(file, "utf8");
    const path = rel(file);
    const fileLevel = hasFileLevelUseServer(source);
    if (!fileLevel && /["']use server["']/.test(source.replace(/\/\/[^\n]*/g, ""))) {
      // Inline directive inside a function or a mention in a comment/string: the enumerator cannot
      // list inline actions, so refuse them until the matrix learns about them.
      if (/^\s+["']use server["']/m.test(source))
        problems.push(`${path}: inline "use server" is not supported`);
    }
    if (fileLevel) {
      const { names, unsupported } = exportedNames(source);
      for (const u of unsupported) problems.push(`${path}: ${u} in a "use server" module`);
      for (const n of names) keys.push(`${path}#${n}`);
    }
    if (path.startsWith("src/app/") && /(^|\/)route\.tsx?$/.test(path)) {
      const { names, unsupported } = exportedNames(source);
      const methods = names.filter((n) => HTTP_METHODS.includes(n));
      for (const u of unsupported) problems.push(`${path}: ${u} in a route handler`);
      if (methods.length === 0) problems.push(`${path}: no HTTP method export recognised`);
      for (const n of methods) keys.push(`${path}#${n}`);
    }
  }
  return { keys: keys.sort(), problems };
}

describe("authorization matrix covers the whole source tree", () => {
  const { keys, problems } = discover();

  it("finds the entry points it is supposed to find", () => {
    // Guards the enumerator itself: a broken regex must not make the test vacuous.
    expect(keys.length).toBeGreaterThanOrEqual(50);
    expect(keys.filter((k) => k.includes("/route.ts#")).length).toBeGreaterThanOrEqual(12);
  });

  it("has no unsupported export forms", () => {
    expect(problems).toEqual([]);
  });

  it("lists every server action and route handler (100 % coverage)", () => {
    const missing = keys.filter((k) => !(k in MATRIX));
    expect(missing, `Add a row for each of these to MATRIX in authz-matrix.test.ts`).toEqual([]);
  });

  it("does not list entry points that no longer exist", () => {
    const stale = Object.keys(MATRIX).filter((k) => !keys.includes(k));
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Behaviour

function classify(value: unknown, error: unknown): Outcome {
  if (error instanceof AuthorizationError) {
    return error.code === "UNAUTHENTICATED" ? "unauthenticated" : "forbidden";
  }
  if (!error && value instanceof Response) {
    if (value.status === 401) return "unauthenticated";
    if (value.status === 403) return "forbidden";
  }
  return "allowed";
}

async function run(row: Row) {
  try {
    return classify(await row.call(), undefined);
  } catch (error) {
    return classify(undefined, error);
  }
}

describe("authorization matrix", { timeout: 60_000 }, () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
    process.env.CRON_SECRET = SECRET;
    state.userRow = null;
    state.dbCalls = [];
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const principals: Principal[] = ["anonymous", "driver", "admin"];
  for (const [key, row] of Object.entries(MATRIX)) {
    for (const principal of principals) {
      it(`${key} as ${principal} -> ${row.expect[principal]}`, async () => {
        state.principal = principal;
        expect(await run(row), `${key} (${row.note})`).toBe(row.expect[principal]);
      });
    }
  }

  it("re-checks the user in the database: a deactivated admin is unauthenticated everywhere", async () => {
    state.principal = "admin";
    state.userRow = {
      ...PEOPLE.admin,
      active: false,
      locale: "de",
      displayName: "X",
      localeChosen: true,
    };
    for (const [key, row] of Object.entries(MATRIX)) {
      if (row.expect.admin !== "allowed" || row.expect.anonymous !== "unauthenticated") continue;
      expect(await run(row), key).toBe("unauthenticated");
    }
  });

  it("a driver whose DB role is ADMIN (role changed since login) gets the admin answer", async () => {
    state.principal = "driver";
    state.userRow = {
      ...PEOPLE.driver,
      role: "ADMIN",
      locale: "de",
      displayName: "X",
      localeChosen: true,
    };
    expect(await run(MATRIX["src/server/settings-actions.ts#saveSettingsAction"]!)).toBe("allowed");
    expect(await run(MATRIX["src/app/api/driver/sync/route.ts#POST"]!)).toBe("forbidden");
  });

  it("the real Auth.js handlers answer the session endpoint per principal", async () => {
    const { GET } = await import("@/app/api/auth/[...nextauth]/route");
    const { NextRequest } = await import("next/server");
    const session = async (principal: Principal) => {
      const res = await GET(
        new NextRequest(`${ORIGIN}/api/auth/session`, { headers: await sessionCookie(principal) }),
      );
      expect(res.status).toBe(200);
      return res.json();
    };
    expect(await session("anonymous")).toBeNull();
    expect((await session("driver"))?.user?.role).toBe("DRIVER");
    expect((await session("admin"))?.user?.role).toBe("ADMIN");
  });

  it("Auth.js refuses a sign-out POST without its CSRF token (no session is touched)", async () => {
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(
      new NextRequest(`${ORIGIN}/api/auth/callback/admin`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
        body: "email=a%40example.com&password=x",
      }),
    );
    expect(res.status).toBeLessThan(500);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/authjs\.session-token=[^;]+\./);
  });

  it("cron endpoints accept exactly the bearer secret", async () => {
    state.principal = "anonymous";
    const handlers: Array<[string, (r: Request) => Promise<Response>]> = [
      ["retry-translations", (await import("@/app/api/cron/retry-translations/route")).GET],
      ["retention", (await import("@/app/api/cron/retention/route")).GET],
      ["audit-retention", (await import("@/app/api/cron/audit-retention/route")).GET],
      ["data-retention", (await import("@/app/api/cron/data-retention/route")).GET],
      ["orphan-cleanup", (await import("@/app/api/cron/orphan-cleanup/route")).GET],
      ["recurring-orders", (await import("@/app/api/cron/recurring-orders/route")).GET],
    ];
    handlers.push([
      "../monitoring/test-error",
      (await import("@/app/api/monitoring/test-error/route")).GET,
    ]);
    for (const [path, GET] of handlers) {
      const url = `${ORIGIN}/api/cron/${path}`;
      expect(
        (await GET(new Request(url, { headers: { authorization: "Bearer wrong" } }))).status,
      ).toBe(401);
      expect((await GET(new Request(url, { headers: { authorization: SECRET } }))).status).toBe(
        401,
      );
      delete process.env.CRON_SECRET;
      expect(
        (await GET(new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }))).status,
      ).toBe(401);
      process.env.CRON_SECRET = SECRET;
    }
  });

  it("state-changing route handlers refuse a cross-site browser request (CSRF)", async () => {
    const cases: Array<[Principal, string, () => Promise<Response>]> = [
      [
        "admin",
        "uploads",
        async () => (await import("@/app/api/uploads/route")).POST(evil("/api/uploads")),
      ],
      [
        "admin",
        "import parse",
        async () =>
          (await import("@/app/api/admin/customers/import/parse/route")).POST(
            evil("/api/admin/customers/import/parse"),
          ),
      ],
      [
        "driver",
        "sync",
        async () => (await import("@/app/api/driver/sync/route")).POST(evil("/api/driver/sync")),
      ],
      [
        "driver",
        "photos",
        async () =>
          (await import("@/app/api/driver/photos/route")).POST(evil("/api/driver/photos")),
      ],
    ];
    const evil = (path: string) =>
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      });
    for (const [principal, name, call] of cases) {
      state.principal = principal;
      const res = await call();
      expect(res.status, name).toBe(403);
      expect(await res.json(), name).toEqual({ error: "bad_origin" });
    }
  });
});
