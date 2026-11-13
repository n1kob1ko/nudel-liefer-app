// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createLocalizedText } from "../lib/localized-text";
import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

/**
 * NUD-198: `GET /api/admin/payments/export`, the download of a monthly bill. Office only, never
 * cached, always a file to save (never shown in the browser).
 */
const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("next/cache", () => ({ updateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { billExportResponse } = await import("./bill-export-api");

const NOW = new Date("2099-06-10T08:00:00Z");
const url = (query: string) =>
  new Request(`http://localhost:3000/api/admin/payments/export?${query}`);

describe.skipIf(!process.env.DATABASE_URL)("bill export API (NUD-198)", { timeout: 60_000 }, () => {
  let t: TestDb;
  let adminId: string;
  let driverId: string;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestDb();
    state.db = t.prisma;
    const hash = await hashSecret("123456");
    adminId = await t.prisma.user
      .create({
        data: {
          role: "ADMIN",
          email: "api@example.com",
          passwordHash: hash,
          displayName: "Office",
        },
      })
      .then((u) => u.id);
    driverId = await t.prisma.user
      .create({
        data: { role: "DRIVER", username: "exp-drv", passwordHash: hash, displayName: "Fahrer" },
      })
      .then((u) => u.id);
    customerId = await t.prisma.customer
      .create({
        data: {
          customerNumber: "A 7/1",
          name: "Čevapi Đorđe",
          street: "Hauptstraße 1",
          postalCode: "1010",
          city: "Wien",
        },
      })
      .then((c) => c.id);
    const productId = await t.prisma.product
      .create({
        data: {
          sku: "API-1",
          unit: "KG",
          weightKgPerUnit: 1,
          sortOrder: 1,
          name: createLocalizedText({ de: "Teigblätter" }, "de"),
        },
      })
      .then((p) => p.id);
    const day = new Date("2099-05-04T00:00:00Z");
    await t.prisma.order.create({
      data: {
        customerId,
        deliveryDate: day,
        windowFrom: day,
        windowTo: day,
        status: "CONFIRMED",
        source: "MANUAL",
        paymentTerm: "MONTHLY",
        amountCents: 4250,
        createdById: adminId,
        items: { create: [{ productId, quantity: 5 }] },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await t.teardown();
  });

  it("answers 401 without a session and 403 for a driver, and tells nothing", async () => {
    state.session = null;
    const anonymous = await billExportResponse(url(`month=2099-05&customer=${customerId}`), NOW);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });

    state.session = { user: { id: driverId } };
    const driver = await billExportResponse(url(`month=2099-05&customer=${customerId}`), NOW);
    expect(driver.status).toBe(403);
    expect(await driver.json()).toEqual({ error: "forbidden" });
    expect(driver.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sends the CSV as a file to save, never cached", async () => {
    state.session = { user: { id: adminId } };
    const response = await billExportResponse(
      url(`month=2099-05&customer=${customerId}&format=csv&locale=de`),
      NOW,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="monatsrechnung-A-7-1-2099-05.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(body.startsWith("﻿")).toBe(true);
    expect(body).toContain(
      "2099-05;A 7/1;Čevapi Đorđe;04.05.2099;Bestellung;5 kg Teigblätter;42,50;Offen;",
    );
  });

  it("sends the PDF as a file to save", async () => {
    state.session = { user: { id: adminId } };
    const response = await billExportResponse(
      url(`month=2099-05&customer=${customerId}&format=pdf&locale=en`),
      NOW,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="monatsrechnung-A-7-1-2099-05.pdf"',
    );
    const pdf = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()));
    expect(pdf.getTitle()).toBe("Monthly bill A 7/1 2099-05");
  });

  it("answers 400 for a request it cannot read and 404 for an unknown customer", async () => {
    state.session = { user: { id: adminId } };
    const bad = await billExportResponse(url("month=May"), NOW);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid" });

    const unknown = await billExportResponse(url("month=2099-05&customer=nope"), NOW);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });
    expect(unknown.headers.get("cache-control")).toBe("private, no-store");
  });
});
