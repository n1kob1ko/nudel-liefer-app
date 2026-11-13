// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDriverUpcomingTours } from "./driver-upcoming";
import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";

// 22:30 UTC on 1 July is already 2 July in Vienna: "today" is the factory's calendar day.
const NOW = new Date("2099-07-01T22:30:00Z");
const OPTIONS = { now: NOW, timezone: "Europe/Vienna", locale: "de" as const };
const text = (de: string) => ({
  de,
  meta: { source: "de", machine: {}, updatedAt: "2099-01-01T00:00:00Z" },
});

/**
 * NUD-205: a tour the office released for tomorrow (or a later day) was invisible to its driver
 * until that day. The home screen now lists the coming tours as a preview.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "the driver's coming tours (NUD-205)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let driverId: string;
    let otherDriverId: string;
    let tomorrowTourId: string;
    let laterTourId: string;

    beforeAll(async () => {
      t = await createTestDb();
      const hash = await hashSecret("123456");
      const user = (data: Record<string, unknown>) =>
        t.prisma.user.create({ data: { passwordHash: hash, ...data } as never }).then((u) => u.id);
      driverId = await user({ role: "DRIVER", username: "drv", displayName: "Driver" });
      otherDriverId = await user({ role: "DRIVER", username: "other", displayName: "Other" });

      const product = await t.prisma.product.create({
        data: { sku: "SPAG", unit: "KG", weightKgPerUnit: 1, name: text("Spaghetti") },
      });
      const customer = (number: string, name: string) =>
        t.prisma.customer.create({
          data: {
            customerNumber: number,
            name,
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
            lat: 48.2,
            lng: 16.3,
            pinConfirmed: true,
          },
        });
      const first = await customer("K1", "Trattoria 1");
      const second = await customer("K2", "Trattoria 2");

      const mkTour = (day: string, data: Record<string, unknown> = {}) =>
        t.prisma.tour.create({
          data: {
            date: new Date(`${day}T00:00:00Z`),
            driverId,
            status: "RELEASED",
            releaseRevision: 1,
            depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
            ...data,
          } as never,
        });
      const stop = (tourId: string, customerId: string, sequence: number, etaAt?: string) =>
        t.prisma.stop.create({
          data: {
            tourId,
            customerId,
            sequence,
            etaAt: etaAt ? new Date(etaAt) : null,
            items: [{ productId: product.id, quantity: sequence + 2 }],
          },
        });

      // Not listed: today's tour (it is the home screen itself) and yesterday's.
      const today = await mkTour("2099-07-02");
      await stop(today.id, first.id, 1);
      const yesterday = await mkTour("2099-07-01", { status: "COMPLETED" });
      await stop(yesterday.id, first.id, 1);
      // Not listed: a tour that is not released yet, and another driver's tour.
      const draft = await mkTour("2099-07-03", { status: "OPTIMIZED", releaseRevision: 0 });
      await stop(draft.id, first.id, 1);
      const foreign = await mkTour("2099-07-03", { driverId: otherDriverId });
      await stop(foreign.id, first.id, 1);

      const later = await mkTour("2099-07-06");
      laterTourId = later.id;
      await stop(later.id, second.id, 1, "2099-07-06T06:15:00Z");
      const tomorrow = await mkTour("2099-07-03");
      tomorrowTourId = tomorrow.id;
      await stop(tomorrow.id, second.id, 2, "2099-07-03T06:40:00Z");
      await stop(tomorrow.id, first.id, 1, "2099-07-03T06:10:00Z");
    });

    afterAll(async () => {
      await t?.teardown();
    });

    it("lists the released tours after today, nearest day first", async () => {
      const tours = await getDriverUpcomingTours(t.prisma, driverId, OPTIONS);
      expect(tours.map((tour) => tour.id)).toEqual([tomorrowTourId, laterTourId]);
      expect(tours.map((tour) => tour.date)).toEqual(["2099-07-03", "2099-07-06"]);
      expect(tours.map((tour) => tour.daysAhead)).toEqual([1, 4]);
    });

    it("carries the stops in driving order with name, address, time and quantities", async () => {
      const [tomorrow] = await getDriverUpcomingTours(t.prisma, driverId, OPTIONS);
      expect(tomorrow?.firstEtaAt).toBe("2099-07-03T06:10:00.000Z");
      expect(tomorrow?.stops.map((stop) => stop.customerName)).toEqual([
        "Trattoria 1",
        "Trattoria 2",
      ]);
      expect(tomorrow?.stops[0]).toMatchObject({
        sequence: 1,
        street: "Hauptstraße 1",
        postalCode: "1010",
        city: "Wien",
        etaAt: "2099-07-03T06:10:00.000Z",
        items: [{ name: "Spaghetti", unit: "KG", quantity: 3 }],
      });
    });

    it("shows nothing to another driver's account and nothing without a coming tour", async () => {
      const foreign = await getDriverUpcomingTours(t.prisma, otherDriverId, OPTIONS);
      expect(foreign).toHaveLength(1);
      expect(foreign[0]?.stops).toHaveLength(1);
      const late = await getDriverUpcomingTours(t.prisma, driverId, {
        ...OPTIONS,
        now: new Date("2099-07-10T10:00:00Z"),
      });
      expect(late).toEqual([]);
    });
  },
);
