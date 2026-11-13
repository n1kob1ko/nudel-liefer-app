import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BACKED_UP_TABLES,
  backupAgeHours,
  backupFileName,
  databaseIdentity,
  NOT_BACKED_UP_TABLES,
  parseBackupTime,
  parseToolMajor,
  pgEnvFromUrl,
  readBackupConfig,
  redactSecrets,
  selectExpiredBackups,
  tablesWithoutData,
} from "./backup";

const env = {
  BACKUP_DATABASE_URL:
    "postgresql://u:p%40ss@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require",
  BACKUP_S3_ENDPOINT: "https://abc.eu.r2.cloudflarestorage.com",
  BACKUP_S3_BUCKET: "nudel-backups",
  BACKUP_S3_ACCESS_KEY_ID: "AKID",
  BACKUP_S3_SECRET_ACCESS_KEY: "SECRET",
};

describe("readBackupConfig", () => {
  it("accepts a complete configuration and applies the defaults", () => {
    const parsed = readBackupConfig(env);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.prefix).toBe("db/");
    expect(parsed.config.retentionWeeks).toBe(8);
    expect(parsed.config.keepNewest).toBe(4);
    expect(parsed.config.s3?.region).toBe("auto");
    expect(parsed.config.s3?.pathStyle).toBe(true);
  });
  it("signs bucket sub-domain URLs when BACKUP_S3_URL_STYLE is virtual (Railway bucket)", () => {
    const parsed = readBackupConfig({ ...env, BACKUP_S3_URL_STYLE: "virtual" });
    expect(parsed.ok && parsed.config.s3?.pathStyle).toBe(false);
    const unknown = readBackupConfig({ ...env, BACKUP_S3_URL_STYLE: "vhost" });
    expect(unknown.ok ? [] : unknown.errors).toEqual([
      "BACKUP_S3_URL_STYLE must be path or virtual",
    ]);
  });
  it("names missing variables but never prints a value", () => {
    const parsed = readBackupConfig({
      BACKUP_DATABASE_URL: "postgresql://u:topsecret@h/db",
      BACKUP_S3_ENDPOINT: "https://abc.eu.r2.cloudflarestorage.com",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        "BACKUP_S3_BUCKET is not set",
        "BACKUP_S3_ACCESS_KEY_ID is not set",
        "BACKUP_S3_SECRET_ACCESS_KEY is not set",
      ]),
    );
    expect(JSON.stringify(parsed.errors)).not.toContain("topsecret");
  });
  it("accepts a folder on the server as the only destination", () => {
    const parsed = readBackupConfig({
      BACKUP_DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/nudel",
      BACKUP_LOCAL_DIR: "/var/backups/nudel/",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.localDir).toBe("/var/backups/nudel");
    expect(parsed.config.s3).toBeUndefined();
  });
  it("accepts a folder and a bucket together", () => {
    const parsed = readBackupConfig({ ...env, BACKUP_LOCAL_DIR: "/var/backups/nudel" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.localDir).toBe("/var/backups/nudel");
    expect(parsed.config.s3?.bucket).toBe("nudel-backups");
  });
  it("refuses a configuration without any destination, a half-configured bucket and a relative folder", () => {
    const errors = (input: Record<string, string>) => {
      const parsed = readBackupConfig(input);
      return parsed.ok ? [] : parsed.errors;
    };
    const db = { BACKUP_DATABASE_URL: "postgresql://u:p@h/db" };
    expect(errors(db).join()).toMatch(/BACKUP_LOCAL_DIR.*BACKUP_S3_/);
    expect(errors({ ...db, BACKUP_LOCAL_DIR: "/b", BACKUP_S3_BUCKET: "nudel-backups" })).toEqual([
      "BACKUP_S3_ACCESS_KEY_ID is not set",
      "BACKUP_S3_SECRET_ACCESS_KEY is not set",
    ]);
    expect(errors({ ...db, BACKUP_LOCAL_DIR: "backups" }).join()).toMatch(/absolute/);
  });
  it("falls back to the app's own connection when BACKUP_DATABASE_URL is not set", () => {
    const url = (input: Record<string, string>) => {
      const parsed = readBackupConfig({ BACKUP_LOCAL_DIR: "/b", ...input });
      return parsed.ok ? parsed.config.databaseUrl : parsed.errors.join();
    };
    expect(url({ DATABASE_URL: "postgresql://app@h/a" })).toBe("postgresql://app@h/a");
    expect(
      url({ DATABASE_URL: "postgresql://app@h/a", DATABASE_URL_UNPOOLED: "postgresql://app@h/b" }),
    ).toBe("postgresql://app@h/b");
    expect(
      url({ DATABASE_URL: "postgresql://app@h/a", BACKUP_DATABASE_URL: "postgresql://ro@h/c" }),
    ).toBe("postgresql://ro@h/c");
    expect(url({})).toMatch(/BACKUP_DATABASE_URL \(or DATABASE_URL\) is not set/);
  });
  it("rejects a pooled Neon URL, a wrong scheme and silly values", () => {
    const bad = (patch: Record<string, string>) => {
      const parsed = readBackupConfig({ ...env, ...patch });
      return parsed.ok ? [] : parsed.errors;
    };
    expect(
      bad({ BACKUP_DATABASE_URL: "postgresql://u:p@ep-x-pooler.eu.neon.tech/db" }).join(),
    ).toMatch(/pooled/);
    expect(bad({ BACKUP_DATABASE_URL: "mysql://u@h/db" }).join()).toMatch(/postgresql/);
    expect(bad({ BACKUP_RETENTION_WEEKS: "0" })).toHaveLength(1);
    expect(bad({ BACKUP_RETENTION_WEEKS: "abc" })).toHaveLength(1);
    expect(bad({ BACKUP_PREFIX: "../x/" })).toHaveLength(1);
    expect(bad({ BACKUP_S3_ENDPOINT: "ftp://x" })).toHaveLength(1);
  });
  it("normalises the prefix", () => {
    const get = (prefix: string) => {
      const parsed = readBackupConfig({ ...env, BACKUP_PREFIX: prefix });
      return parsed.ok ? parsed.config.prefix : null;
    };
    expect(get("/weekly")).toBe("weekly/");
    expect(get("weekly/")).toBe("weekly/");
    expect(get("")).toBe("");
  });
});

describe("backup names and retention", () => {
  const now = new Date("2026-10-18T02:23:00Z");
  it("names are UTC, sortable and parse back", () => {
    const name = backupFileName(now);
    expect(name).toBe("nudel-20261018T022300Z.dump");
    expect(parseBackupTime(`db/${name}`, "db/")?.toISOString()).toBe(now.toISOString());
    expect(parseBackupTime("db/other.dump", "db/")).toBeNull();
    expect(parseBackupTime("x/nudel-20261018T022300Z.dump", "db/")).toBeNull();
    expect(parseBackupTime("db/nudel-20261318T022300Z.dump", "db/")).toBeNull();
    expect(parseBackupTime("db/sub/nudel-20261018T022300Z.dump", "db/")).toBeNull();
  });

  const weekly = (weeksAgo: number) =>
    `db/${backupFileName(new Date(now.getTime() - weeksAgo * 7 * 24 * 3600 * 1000))}`;

  it("prunes backups older than eight weeks and keeps the rest", () => {
    const keys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20].map(weekly);
    const expired = selectExpiredBackups(keys, {
      prefix: "db/",
      now,
      retentionWeeks: 8,
      keepNewest: 4,
    });
    expect(expired.sort()).toEqual([weekly(9), weekly(10), weekly(20)].sort());
    // Exactly eight weeks old is not older than eight weeks.
    expect(expired).not.toContain(weekly(8));
  });

  it("never prunes the newest backups even when the whole schedule stalled for a year", () => {
    const keys = [60, 61, 62, 63, 64, 65].map(weekly);
    const expired = selectExpiredBackups(keys, {
      prefix: "db/",
      now,
      retentionWeeks: 8,
      keepNewest: 4,
    });
    expect([...expired].sort()).toEqual([weekly(64), weekly(65)].sort());
    expect(keys.filter((k) => !expired.includes(k))).toHaveLength(4);
  });

  it("leaves unknown objects alone and never deletes future-dated names", () => {
    const keys = [
      weekly(30),
      "db/notes.txt",
      "db/nudel-latest.dump",
      "other/nudel-20200101T000000Z.dump",
      `db/${backupFileName(new Date(now.getTime() + 3 * 24 * 3600 * 1000))}`,
      ...[0, 1, 2, 3].map(weekly),
    ];
    const expired = selectExpiredBackups(keys, {
      prefix: "db/",
      now,
      retentionWeeks: 8,
      keepNewest: 4,
    });
    expect(expired).toEqual([weekly(30)]);
  });
});

describe("what a backup holds: master data only (NUD-200)", () => {
  const models = [
    ...readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8").matchAll(
      /^model (\w+) \{/gm,
    ),
  ].map((m) => m[1]!);

  it("keeps settings, people, customers, standing tours, products and standing orders", () => {
    expect(tablesWithoutData([...models, "_prisma_migrations"]).sort()).toEqual(
      [
        "AuditLog",
        "LoginAttempt",
        "MonthlyAdjustment",
        "MonthlyPayment",
        "Order",
        "OrderItem",
        "Screenshot",
        "Stop",
        "StopMutation",
        "StopOrder",
        "Tour",
      ].sort(),
    );
  });

  it("leaves out the data of a table nobody has classified yet", () => {
    expect(tablesWithoutData(["User", "Settings", "SomethingNew"])).toEqual(["SomethingNew"]);
  });

  it("every model of the Prisma schema is classified, exactly once", () => {
    // A new model must be put on one of the two lists on purpose: "is this kept in a backup?"
    const classified = [...BACKED_UP_TABLES, ...NOT_BACKED_UP_TABLES];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].filter((t) => t !== "_prisma_migrations").sort()).toEqual(
      [...models].sort(),
    );
  });

  it("no kept table points at a table that is left out", () => {
    // Otherwise the foreign key could not be created when a backup is restored.
    const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const broken: string[] = [];
    for (const block of schema.split(/^model /m).slice(1)) {
      const model = /^(\w+)/.exec(block)![1]!;
      if (!(BACKED_UP_TABLES as readonly string[]).includes(model)) continue;
      for (const m of block.matchAll(/^\s+\w+\s+(\w+)\??\s+@relation\([^)]*fields:/gm)) {
        if ((NOT_BACKED_UP_TABLES as readonly string[]).includes(m[1]!))
          broken.push(`${model} -> ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("backupAgeHours", () => {
  const now = new Date("2026-11-13T04:23:00Z");
  it("reads the age of a backup from its name, with or without a folder in front", () => {
    expect(backupAgeHours("db/nudel-20261113T022300Z.dump", now)).toBe(2);
    expect(backupAgeHours("nudel-20261111T042300Z.dump", now)).toBe(48);
    expect(backupAgeHours("/var/backups/nudel/db/nudel-20261112T162300Z.dump", now)).toBe(12);
  });
  it("is null for a name this script did not make", () => {
    expect(backupAgeHours("db/manual.dump", now)).toBeNull();
    expect(backupAgeHours("db/nudel-20261318T022300Z.dump", now)).toBeNull();
  });
});

describe("connection helpers", () => {
  it("maps a URL to PG* variables, decoding the password", () => {
    expect(
      pgEnvFromUrl(
        "postgresql://user:p%40ss%2Fw@host.example:6543/db?sslmode=require&channel_binding=require&options=endpoint%3Dep-1",
      ),
    ).toEqual({
      PGHOST: "host.example",
      PGPORT: "6543",
      PGUSER: "user",
      PGPASSWORD: "p@ss/w",
      PGDATABASE: "db",
      PGSSLMODE: "require",
      PGCHANNELBINDING: "require",
      PGOPTIONS: "endpoint=ep-1",
    });
  });
  it("compares databases by host, port and name only", () => {
    expect(databaseIdentity("postgresql://a:b@H.example/db?sslmode=require")).toBe(
      databaseIdentity("postgresql://c:d@h.example:5432/db"),
    );
    expect(databaseIdentity("postgresql://a@h/db1")).not.toBe(
      databaseIdentity("postgresql://a@h/db2"),
    );
  });
  it("redacts URLs and explicit secrets from tool output", () => {
    const out = redactSecrets(
      "could not connect to postgresql://u:hunter2@h/db: password authentication failed for hunter2",
      ["hunter2"],
    );
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[redacted]");
  });
  it("reads the major version of the client tools", () => {
    expect(parseToolMajor("pg_dump (PostgreSQL) 16.2")).toBe(16);
    expect(parseToolMajor("pg_dump (PostgreSQL) 17.1 (Ubuntu 17.1-1.pgdg24.04+1)")).toBe(17);
    expect(parseToolMajor("garbage")).toBeNull();
  });
});
