// @vitest-environment node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type BackupConfig, backupFileName } from "../lib/backup";
import { countRows, run, runBackup, runRestoreVerify, tocDataTables } from "./core";
import { type BackupObject, type BackupStore, createLocalBackupStore } from "./store";

/**
 * Real pg_dump / pg_restore against real databases (NUD-094). Needs DATABASE_URL (a server where
 * the user may create databases) and pg_dump + pg_restore on PATH; skipped otherwise.
 */
const haveTools = ["pg_dump", "pg_restore"].every(
  (tool) => spawnSync(tool, ["--version"]).status === 0,
);
const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

function urlFor(base: string, database: string) {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** In-memory stand-in for the bucket. */
class MemoryStore implements BackupStore {
  readonly objects = new Map<string, { data: Buffer; lastModified: Date; sha256: string }>();
  failPut = false;
  async put(key: string, file: string, _bytes: number, sha256: string) {
    if (this.failPut) throw new Error("bucket unreachable");
    this.objects.set(key, { data: readFileSync(file), lastModified: new Date(), sha256 });
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { bytes: o.data.length } : null;
  }
  async list(prefix: string): Promise<BackupObject[]> {
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, o]) => ({ key, bytes: o.data.length, lastModified: o.lastModified }));
  }
  async get(key: string, destination: string) {
    const fs = await import("node:fs");
    fs.writeFileSync(destination, this.objects.get(key)!.data);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe.skipIf(!process.env.DATABASE_URL || !haveTools)(
  "backup and test restore (pg_dump, pg_restore)",
  { timeout: 120_000 },
  () => {
    const base = process.env.DATABASE_URL!;
    const suffix = randomBytes(4).toString("hex");
    const source = `bk_src_${suffix}`;
    const scratch = `bk_dst_${suffix}`;
    const scratch2 = `bk_dst2_${suffix}`;
    const scratch3 = `bk_dst3_${suffix}`;
    const scratch4 = `bk_dst4_${suffix}`;
    let admin: Client;
    let config: BackupConfig;

    beforeAll(async () => {
      admin = new Client({ connectionString: base });
      await admin.connect();
      for (const name of [source, scratch, scratch2, scratch3, scratch4])
        await admin.query(`CREATE DATABASE "${name}"`);
      const db = new Client({ connectionString: urlFor(base, source) });
      await db.connect();
      for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()) {
        await db.query(readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8"));
      }
      // The same tables the app uses, with the Prisma bookkeeping table as `prisma migrate` leaves it.
      await db.query(
        `CREATE TABLE IF NOT EXISTS _prisma_migrations (id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz, migration_name varchar(255) not null, logs text, rolled_back_at timestamptz, started_at timestamptz not null default now(), applied_steps_count int not null default 0)`,
      );
      await db.query(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name) VALUES ('1','x',now(),'init')`,
      );
      await db.query(
        `INSERT INTO "User" (id, role, email, "passwordHash", locale, "localeChosen", "displayName", active, "updatedAt") VALUES ('u1','ADMIN','a@example.com','hash','de',true,'Ümläut 司机',true,now())`,
      );
      await db.query(
        `INSERT INTO "Settings" (id, "depotName", "depotAddress", "depotLat", "depotLng") VALUES (1,'Depot','Adresse 1',48.2,16.3)`,
      );
      await db.query(
        `INSERT INTO "Customer" (id, "customerNumber", name, street, "postalCode", city, "updatedAt") VALUES ('c1','K-1','Trattoria','Straße 1','1010','Wien',now())`,
      );
      await db.query(`INSERT INTO "LoginAttempt" (id, key) VALUES ('l1','ip:203.0.113.9')`);
      // Master data that a backup keeps ...
      await db.query(
        `INSERT INTO "StandingTour" (id, name, "updatedAt") VALUES ('st1','Innenstadt',now())`,
      );
      await db.query(
        `INSERT INTO "StandingTourCustomer" ("standingTourId", "customerId") VALUES ('st1','c1')`,
      );
      // ... and what it must never hold (NUD-200): orders, payments, the change history.
      await db.query(
        `INSERT INTO "Order" (id, "customerId", "deliveryDate", "createdById", "updatedAt", "windowFrom", "windowTo") VALUES ('o1','c1','2026-10-17','u1',now(),'2026-10-17','2026-10-17')`,
      );
      await db.query(
        `INSERT INTO "MonthlyPayment" (id, "customerId", "periodStart", "amountCents", "orderCount", "paidById") VALUES ('m1','c1','2026-09-01',4250,1,'u1')`,
      );
      await db.query(
        `INSERT INTO "AuditLog" (id, "actorId", entity, "entityId", action, diff) VALUES ('a1','u1','Order','o1','order.create','{"amountCents":4250}')`,
      );
      await db.end();
      config = {
        databaseUrl: urlFor(base, source),
        localDir: "/unused-in-tests",
        prefix: "db/",
        retentionWeeks: 8,
        keepNewest: 4,
      };
    }, 120_000);

    afterAll(async () => {
      for (const name of [source, scratch, scratch2, scratch3, scratch4]) {
        await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
      }
      await admin?.end();
    });

    it("dumps, uploads, verifies the upload and prunes; the dump restores into an empty database with identical data", async () => {
      const store = new MemoryStore();
      const now = new Date("2026-10-18T02:23:00Z");
      // Old backups: two beyond eight weeks (prunable), four recent ones (kept).
      for (const weeks of [30, 20, 5, 4, 3, 2]) {
        const t = new Date(now.getTime() - weeks * 7 * 24 * 3600 * 1000);
        store.objects.set(`db/${backupFileName(t)}`, {
          data: Buffer.from("old"),
          lastModified: t,
          sha256: "x",
        });
      }
      store.objects.set("db/README.txt", {
        data: Buffer.from("hi"),
        lastModified: now,
        sha256: "x",
      });
      const lines: string[] = [];
      const summary = await runBackup(config, {
        destinations: [{ name: "bucket", store }],
        now,
        log: (l) => lines.push(l),
      });

      expect(summary.key).toBe(`db/${backupFileName(now)}`);
      expect(summary.destinations).toEqual([
        { name: "bucket", pruned: expect.any(Array), remaining: 5 },
      ]);
      expect(summary.destinations[0]!.pruned).toHaveLength(2);
      expect(store.objects.has("db/README.txt")).toBe(true);
      expect(store.objects.has(summary.key)).toBe(true);
      expect(lines.join("\n")).not.toMatch(/postgres(ql)?:\/\//);
      expect(summary.dataTables).toBeGreaterThanOrEqual(6);
      expect(summary.withoutData).toEqual(
        expect.arrayContaining([
          "Order",
          "OrderItem",
          "Tour",
          "Stop",
          "MonthlyPayment",
          "AuditLog",
        ]),
      );

      // The dump is a real archive with data for the core tables and without login attempts.
      const dumpFile = path.join(process.cwd(), `.tmp-backup-${suffix}.dump`);
      const fs = await import("node:fs");
      fs.writeFileSync(dumpFile, store.objects.get(summary.key)!.data);
      try {
        const toc = await run("pg_restore", ["--list", dumpFile], {});
        const tables = tocDataTables(toc.stdout);
        expect(tables).toEqual(
          expect.arrayContaining([
            "User",
            "Settings",
            "Customer",
            "StandingTour",
            "StandingTourCustomer",
            "_prisma_migrations",
          ]),
        );
        for (const left of ["LoginAttempt", "Order", "MonthlyPayment", "AuditLog"])
          expect(tables).not.toContain(left);
      } finally {
        fs.rmSync(dumpFile, { force: true });
      }

      // Test restore into a new database: master data as in the source, everything else empty.
      const verify = await runRestoreVerify({
        targetUrl: urlFor(base, scratch),
        store,
        prefix: "db/",
        protectedUrls: [config.databaseUrl],
      });
      expect(verify.key).toBe(summary.key);
      expect(verify.admins).toBe(1);
      const src = new Client({ connectionString: urlFor(base, source) });
      await src.connect();
      const original = await countRows(src);
      await src.end();
      expect(original).toMatchObject({ Order: 1, MonthlyPayment: 1, AuditLog: 1, LoginAttempt: 1 });
      expect({ ...verify.rowCounts }).toEqual({
        ...original,
        LoginAttempt: 0,
        Order: 0,
        MonthlyPayment: 0,
        AuditLog: 0,
      });
      expect(verify.rowCounts).toMatchObject({ Customer: 1, StandingTour: 1, User: 1 });
      const dst = new Client({ connectionString: urlFor(base, scratch) });
      await dst.connect();
      const user = await dst.query(`SELECT "displayName" FROM "User" WHERE id='u1'`);
      expect(user.rows[0].displayName).toBe("Ümläut 司机");
      await dst.end();
    });

    it("refuses to restore into a non-empty database or into a protected one", async () => {
      const store = new MemoryStore();
      await runBackup(config, {
        destinations: [{ name: "bucket", store }],
        now: new Date("2026-10-19T02:00:00Z"),
      });
      await expect(
        runRestoreVerify({ targetUrl: urlFor(base, source), store, prefix: "db/" }),
      ).rejects.toThrow(/not empty/);
      await expect(
        runRestoreVerify({
          targetUrl: urlFor(base, scratch2),
          store,
          prefix: "db/",
          protectedUrls: [urlFor(base, scratch2)],
        }),
      ).rejects.toThrow(/protected/);
    });

    it("a failed upload prunes nothing and leaves no temporary files behind", async () => {
      const store = new MemoryStore();
      const now = new Date("2026-10-18T02:23:00Z");
      const old = new Date(now.getTime() - 40 * 7 * 24 * 3600 * 1000);
      for (let i = 0; i < 6; i++) {
        const t = new Date(old.getTime() - i * 7 * 24 * 3600 * 1000);
        store.objects.set(`db/${backupFileName(t)}`, {
          data: Buffer.from("old"),
          lastModified: t,
          sha256: "x",
        });
      }
      store.failPut = true;
      await expect(
        runBackup(config, { destinations: [{ name: "bucket", store }], now }),
      ).rejects.toThrow(/bucket: bucket unreachable/);
      expect(store.objects.size).toBe(6);
    });

    it("writes to the folder on the server and to the bucket; one failing destination does not cost the other its backup", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "nudel-local-"));
      try {
        const local = createLocalBackupStore(dir);
        const bucket = new MemoryStore();
        const now = new Date("2026-10-20T02:23:00Z");
        const both = [
          { name: "server folder", store: local },
          { name: "bucket", store: bucket },
        ];

        const summary = await runBackup(config, { destinations: both, now });
        expect(summary.destinations.map((d) => d.name)).toEqual(["server folder", "bucket"]);
        expect(statSync(path.join(dir, summary.key)).size).toBe(summary.bytes);
        expect(bucket.objects.get(summary.key)!.data.length).toBe(summary.bytes);

        // The bucket is down the next night: the run fails loudly, the folder still got its copy.
        bucket.failPut = true;
        const next = new Date("2026-10-21T02:23:00Z");
        await expect(runBackup(config, { destinations: both, now: next })).rejects.toThrow(
          /bucket: bucket unreachable/,
        );
        expect((await local.list("db/")).map((o) => o.key)).toContain(`db/${backupFileName(next)}`);
        expect(bucket.objects.size).toBe(1);

        // And the other way round: the folder is not writable, the bucket still gets the backup.
        bucket.failPut = false;
        // (A folder below a regular file can never be created, whoever runs the test.)
        writeFileSync(path.join(dir, "a-file"), "");
        const broken = createLocalBackupStore(path.join(dir, "a-file", "backups"));
        const third = new Date("2026-10-22T02:23:00Z");
        await expect(
          runBackup(config, {
            destinations: [
              { name: "server folder", store: broken },
              { name: "bucket", store: bucket },
            ],
            now: third,
          }),
        ).rejects.toThrow(/server folder: /);
        expect(bucket.objects.has(`db/${backupFileName(third)}`)).toBe(true);

        // The copy in the folder restores like the one in the bucket.
        const verify = await runRestoreVerify({
          targetUrl: urlFor(base, scratch3),
          store: local,
          prefix: "db/",
          protectedUrls: [config.databaseUrl],
        });
        expect(verify.key).toBe(`db/${backupFileName(next)}`);
        expect(verify.admins).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("the check refuses a newest backup that is older than the limit, before it restores anything", async () => {
      const store = new MemoryStore();
      const taken = new Date("2026-10-23T02:23:00Z");
      await runBackup(config, { destinations: [{ name: "bucket", store }], now: taken });
      const error = await runRestoreVerify({
        targetUrl: urlFor(base, scratch4),
        store,
        prefix: "db/",
        maxAgeHours: 48,
        now: new Date("2026-10-26T04:23:00Z"),
      }).then(
        () => null,
        (e: Error) => e,
      );
      expect(error?.message).toMatch(/74 hours old.*limit: 48/);

      // Fresh enough: restored and checked. (The failed check above must not have touched the target.)
      const ok = await runRestoreVerify({
        targetUrl: urlFor(base, scratch4),
        store,
        prefix: "db/",
        maxAgeHours: 48,
        now: new Date("2026-10-24T04:23:00Z"),
      });
      expect(ok.ageHours).toBe(26);
    });

    it("a run without any destination is an error, not a silent success", async () => {
      await expect(runBackup(config, { destinations: [] })).rejects.toThrow(/destination/);
    });

    it("never leaks the database password in an error", async () => {
      const bad = {
        ...config,
        databaseUrl: urlFor(base, source).replace(/\/\/[^@]*@/, "//postgres:wrong-pass-123@"),
      };
      const error = await runBackup(bad, {
        destinations: [{ name: "bucket", store: new MemoryStore() }],
      }).then(
        () => null,
        (e: Error) => e,
      );
      expect(error).not.toBeNull();
      expect(error!.message).not.toContain("wrong-pass-123");
    });
  },
);
