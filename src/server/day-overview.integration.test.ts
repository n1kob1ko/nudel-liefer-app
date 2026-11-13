// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

const state: { session: { user?: { id: string } } | null; db: TestDb["prisma"] | null } = {
  session: null,
  db: null,
};
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("./auth/auth", () => ({ auth: async () => state.session }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: () => state.db,
}));

const { dayOverviewQuery, getDayOverview } = await import("./day-overview");
const { todayInTimezone } = await import("./driver-today");

const TZ = "Europe/Vienna";

describe.skipIf(!process.env.DATABASE_URL)(
  "office overview with several drivers",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let driverId: string;
    const now = new Date();
    const today = todayInTimezone(now, TZ);
    const day = new Date(`${today}T00:00:00Z`);
    const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

    beforeAll(async () => {
      t = await createTestDb();
      state.db = t.prisma;
      const hash = await hashSecret("123456");
      adminId = (
        await t.prisma.user.create({
          data: { role: "ADMIN", email: "a@example.com", displayName: "A", passwordHash: hash },
        })
      ).id;
      const driver = (username: string, displayName: string) =>
        t.prisma.user.create({
          data: { role: "DRIVER", username, displayName, passwordHash: hash, localeChosen: true },
        });
      const hans = await driver("hans", "Hans");
      const li = await driver("li", "Li");
      driverId = hans.id;
      const van = await t.prisma.vehicle.create({ data: { name: "Sprinter", capacityKg: 900 } });

      let n = 0;
      const customer = async () => {
        n += 1;
        return t.prisma.customer.create({
          data: {
            customerNumber: `K${n}`,
            name: `Trattoria ${n}`,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: 48.2,
            lng: 16.3 + n / 100,
            pinConfirmed: true,
          },
        });
      };
      const tour = async (data: Record<string, unknown>, stops: Array<Record<string, unknown>>) => {
        const created = await t.prisma.tour.create({
          data: {
            date: day,
            releaseRevision: 1,
            depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
            ...data,
          } as never,
        });
        for (const [index, stop] of stops.entries()) {
          await t.prisma.stop.create({
            data: {
              tourId: created.id,
              customerId: (await customer()).id,
              sequence: index + 1,
              items: [],
              ...stop,
            } as never,
          });
        }
        return created;
      };

      // Hans is out: one delivered, one problem, one open.
      await tour(
        {
          driverId: hans.id,
          vehicleId: van.id,
          status: "IN_PROGRESS",
          departedAt: minutes(-60),
          createdAt: minutes(-180),
        },
        [
          { status: "DELIVERED", completedAt: minutes(-40), etaAt: minutes(-45) },
          {
            status: "PROBLEM",
            problemReason: "CLOSED",
            completedAt: minutes(-20),
            etaAt: minutes(-25),
          },
          { etaAt: minutes(15) },
        ],
      );
      // Li is released and still at the depot.
      await tour({ driverId: li.id, status: "RELEASED", createdAt: minutes(-170) }, [
        { etaAt: minutes(30) },
        { etaAt: minutes(50) },
      ]);
      // A tour of another day must not leak in.
      await t.prisma.tour.create({
        data: {
          date: new Date("2099-01-05T00:00:00Z"),
          status: "RELEASED",
          depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
        },
      });
    });

    afterAll(async () => {
      await t?.teardown();
    });

    it("is empty on a day without tours", async () => {
      const empty = await getDayOverview(t.prisma, {
        now: new Date("2099-03-01T10:00:00Z"),
        timezone: TZ,
        serviceMinutesPerStop: 10,
      });
      expect(empty.date).toBe("2099-03-01");
      expect(empty.rows).toEqual([]);
      expect(empty.totals.tours).toBe(0);
    });

    it("shows both drivers of today at once", async () => {
      const view = await getDayOverview(t.prisma, {
        now,
        timezone: TZ,
        serviceMinutesPerStop: 10,
      });
      expect(view.date).toBe(today);
      expect(view.rows.map((row) => [row.driverName, row.phase, row.number])).toEqual([
        ["Hans", "onRoad", 1],
        ["Li", "waiting", 2],
      ]);
      const [hans, li] = view.rows;
      expect(hans).toMatchObject({
        vehicleName: "Sprinter",
        progress: { total: 3, delivered: 1, problems: 1, pending: 1 },
        nextStop: { name: "Trattoria 3" },
        // The problem stop was ticked off last: that is where Hans was seen last.
        lastStop: { name: "Trattoria 2", status: "PROBLEM", lat: 48.2 },
      });
      expect(hans!.finishAt).toEqual(minutes(25));
      expect(li).toMatchObject({
        vehicleName: null,
        lastStop: null,
        nextStop: { name: "Trattoria 4" },
      });
      expect(view.totals).toMatchObject({ tours: 2, onRoad: 1, total: 5, done: 2, problems: 1 });
      expect(view.problems).toMatchObject([
        { driverName: "Hans", name: "Trattoria 2", reason: "CLOSED" },
      ]);
    });

    it("is for the office only", async () => {
      state.session = null;
      await expect(dayOverviewQuery(now)).rejects.toThrow();
      state.session = { user: { id: driverId } };
      await expect(dayOverviewQuery(now)).rejects.toThrow();
      state.session = { user: { id: adminId } };
      await expect(dayOverviewQuery(now)).resolves.toMatchObject({ date: today });
    });
  },
);
