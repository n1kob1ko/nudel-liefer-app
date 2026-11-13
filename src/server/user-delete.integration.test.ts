// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashSecret } from "./auth/password";
import { createTestDb, type TestDb } from "./test-db";
import { deleteUser } from "./user-delete";

const TODAY = new Date("2099-07-02T00:00:00Z");
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * NUD-206: an account can be deleted for good. What it left behind stays: finished tours lose only
 * the driver, records that need a user go to the admin who deletes, and a driver with a released
 * tour from today on cannot be deleted before the tour has another driver.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "deleting an account for good (NUD-206)",
  { timeout: 60_000 },
  () => {
    let t: TestDb;
    let adminId: string;
    let customerId: string;
    let n = 0;

    const user = async (role: "ADMIN" | "DRIVER") => {
      n += 1;
      const row = await t.prisma.user.create({
        data: {
          role,
          displayName: `User ${n}`,
          passwordHash: await hashSecret("123456"),
          ...(role === "DRIVER" ? { username: `drv-${n}` } : { email: `a${n}@example.com` }),
        },
      });
      return row.id;
    };
    const tour = (driverId: string, date: string, status: string) =>
      t.prisma.tour.create({
        data: {
          date: day(date),
          driverId,
          status: status as never,
          depotSnapshot: { name: "Depot", address: "x", lat: 48.2, lng: 16.3 },
        },
      });

    beforeAll(async () => {
      t = await createTestDb();
      adminId = await user("ADMIN");
      customerId = (
        await t.prisma.customer.create({
          data: {
            customerNumber: "K1",
            name: "Trattoria",
            street: "Hauptstraße 1",
            postalCode: "1010",
            city: "Wien",
          },
        })
      ).id;
    });

    afterAll(async () => {
      await t?.teardown();
    });

    it("removes a driver nobody refers to and frees the username", async () => {
      const id = await user("DRIVER");
      const before = await t.prisma.user.findUniqueOrThrow({ where: { id } });
      expect(await deleteUser(t.prisma, adminId, id, TODAY)).toEqual({ ok: true });
      expect(await t.prisma.user.findUnique({ where: { id } })).toBeNull();
      const again = await t.prisma.user.create({
        data: {
          role: "DRIVER",
          displayName: "Again",
          username: before.username,
          passwordHash: before.passwordHash,
        },
      });
      expect(again.username).toBe(before.username);
      const audit = await t.prisma.auditLog.findMany({ where: { entityId: id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "user.delete", entity: "User", actorId: adminId });
      expect(audit[0]?.diff).toMatchObject({ role: "DRIVER" });
    });

    it("refuses the own account, an unknown id and nonsense", async () => {
      expect(await deleteUser(t.prisma, adminId, adminId, TODAY)).toEqual({
        ok: false,
        error: "self",
      });
      expect(await deleteUser(t.prisma, adminId, "nobody", TODAY)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await deleteUser(t.prisma, adminId, 7, TODAY)).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(await t.prisma.user.findUnique({ where: { id: adminId } })).not.toBeNull();
    });

    it("refuses a driver with a released tour today or later and changes nothing", async () => {
      const id = await user("DRIVER");
      const done = await tour(id, "2099-06-30", "COMPLETED");
      await tour(id, "2099-07-02", "RELEASED");
      await tour(id, "2099-07-04", "IN_PROGRESS");
      expect(await deleteUser(t.prisma, adminId, id, TODAY)).toEqual({
        ok: false,
        error: "open_tours",
        dates: ["2099-07-02", "2099-07-04"],
      });
      expect(await t.prisma.user.findUnique({ where: { id } })).not.toBeNull();
      // Nothing of the refused delete is kept: the finished tour still names the driver.
      expect((await t.prisma.tour.findUniqueOrThrow({ where: { id: done.id } })).driverId).toBe(id);
    });

    it("keeps finished, old and unreleased tours and takes only the driver off them", async () => {
      const id = await user("DRIVER");
      const done = await tour(id, "2099-07-02", "COMPLETED");
      const stale = await tour(id, "2099-06-20", "RELEASED");
      const plan = await tour(id, "2099-07-05", "OPTIMIZED");
      const stop = await t.prisma.stop.create({
        data: {
          tourId: done.id,
          customerId,
          sequence: 1,
          status: "DELIVERED",
          collectedCents: 1250,
          collectedAt: new Date("2099-07-02T08:00:00Z"),
          collectedById: id,
        },
      });
      await t.prisma.workSchedule.create({
        data: { driverId: id, weekday: 1, startMinutes: 360, endMinutes: 840 },
      });
      const standing = await t.prisma.standingTour.create({
        data: { name: "Nord", driverId: id } as never,
      });
      await t.prisma.customer.update({
        where: { id: customerId },
        data: { keyUpdatedById: id, abbreviationUpdatedById: id },
      });

      expect(await deleteUser(t.prisma, adminId, id, TODAY)).toEqual({ ok: true });

      for (const tourId of [done.id, stale.id, plan.id]) {
        const row = await t.prisma.tour.findUniqueOrThrow({ where: { id: tourId } });
        expect(row.driverId).toBeNull();
      }
      const kept = await t.prisma.stop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(kept).toMatchObject({
        status: "DELIVERED",
        collectedCents: 1250,
        collectedById: null,
      });
      expect(await t.prisma.workSchedule.count({ where: { driverId: id } })).toBe(0);
      expect(
        (await t.prisma.standingTour.findUniqueOrThrow({ where: { id: standing.id } })).driverId,
      ).toBeNull();
      const customer = await t.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
      expect(customer).toMatchObject({ keyUpdatedById: null, abbreviationUpdatedById: null });
    });

    it("hands photos, parking spots and orders over to the admin who deletes", async () => {
      const driverId = await user("DRIVER");
      const otherAdminId = await user("ADMIN");
      const photo = await t.prisma.photo.create({
        data: {
          customerId,
          kind: "STORE",
          storageKey: "customers/x.jpg",
          width: 10,
          height: 10,
          bytes: 100,
          uploadedById: driverId,
        } as never,
      });
      const spot = await t.prisma.parkingSpot.create({
        data: { customerId, lat: 48.2, lng: 16.3, createdById: driverId } as never,
      });
      const order = await t.prisma.order.create({
        data: {
          customerId,
          deliveryDate: day("2099-07-03"),
          windowFrom: day("2099-07-03"),
          windowTo: day("2099-07-03"),
          status: "CONFIRMED",
          createdById: otherAdminId,
        } as never,
      });

      expect(await deleteUser(t.prisma, adminId, driverId, TODAY)).toEqual({ ok: true });
      expect(await deleteUser(t.prisma, adminId, otherAdminId, TODAY)).toEqual({ ok: true });

      expect(
        (await t.prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })).uploadedById,
      ).toBe(adminId);
      expect(
        (await t.prisma.parkingSpot.findUniqueOrThrow({ where: { id: spot.id } })).createdById,
      ).toBe(adminId);
      expect(
        (await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).createdById,
      ).toBe(adminId);
    });
  },
);
