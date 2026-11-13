import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";

import {
  backupAgeHours,
  type BackupConfig,
  backupFileName,
  databaseIdentity,
  parseBackupTime,
  parseToolMajor,
  pgEnvFromUrl,
  redactSecrets,
  selectExpiredBackups,
} from "../lib/backup";
import type { BackupStore } from "./store";

type RunResult = { code: number; stdout: string; stderr: string };

/** Runs a command with an explicit environment; output is captured, never inherited. */
export function run(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs = 15 * 60 * 1000,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(command, args, {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...env,
      } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${command} is not installed (apt install postgresql-client)`)
          : error,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (c) => hash.update(c))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** A dump below this size cannot contain this schema; it means something went wrong silently. */
export const MIN_DUMP_BYTES = 4 * 1024;
/** Table data entries the dump must contain (from `pg_restore --list`). */
export const REQUIRED_DATA_ENTRIES = ["_prisma_migrations", "User", "Settings"] as const;

export function tocDataTables(list: string): string[] {
  return [...list.matchAll(/^\d+; \d+ \d+ TABLE DATA public (\S+) /gm)].map((m) => m[1]!);
}

/** One place the dump is copied to; `name` is what the log and the error messages call it. */
export type BackupDestination = { name: string; store: BackupStore };

export type BackupSummary = {
  key: string;
  bytes: number;
  sha256: string;
  dataTables: number;
  /** Per destination: the backups pruned by this run and how many it holds now. */
  destinations: Array<{ name: string; pruned: string[]; remaining: number }>;
};

/**
 * Dump -> verify the dump file -> copy to every destination -> verify each copy -> prune old
 * backups. Every destination is tried even when another one fails (a full disk must not cost the
 * off-site copy, an unreachable bucket not the local one); the run then fails with all problems.
 * A destination is pruned only after its new backup is stored and its size matches, so a failing
 * run can never reduce the number of good backups.
 */
export async function runBackup(
  config: BackupConfig,
  deps: { destinations: BackupDestination[]; now?: Date; log?: (line: string) => void },
): Promise<BackupSummary> {
  if (deps.destinations.length === 0) throw new Error("no backup destination configured");
  const log = deps.log ?? (() => {});
  const now = deps.now ?? new Date();
  const secrets = [
    config.databaseUrl,
    new URL(config.databaseUrl).password,
    config.s3?.secretAccessKey,
  ];
  const dir = mkdtempSync(path.join(tmpdir(), "nudel-backup-"));
  const fileName = backupFileName(now);
  const file = path.join(dir, fileName);
  const key = `${config.prefix}${fileName}`;
  try {
    const pgEnv = pgEnvFromUrl(config.databaseUrl);

    // 1. The client must not be older than the server (pg_dump refuses, but say it plainly).
    const version = await run("pg_dump", ["--version"], {});
    if (version.code !== 0) throw new Error("pg_dump --version failed");
    const clientMajor = parseToolMajor(version.stdout.trim());
    const server = new Client({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 20_000,
    });
    await server.connect();
    let serverMajor: number;
    try {
      serverMajor = Math.floor(
        Number((await server.query("SHOW server_version_num")).rows[0].server_version_num) / 10000,
      );
    } finally {
      await server.end();
    }
    if (clientMajor !== null && clientMajor < serverMajor) {
      throw new Error(
        `pg_dump ${clientMajor} is older than the server (${serverMajor}): install postgresql-client-${serverMajor}`,
      );
    }
    log(`server PostgreSQL ${serverMajor}, pg_dump ${clientMajor}`);

    // 2. Dump. LoginAttempt rows (IP addresses) are not kept longer than 24 h anywhere, backups
    //    included. No owner / privileges: a restore must work with any role.
    const dump = await run(
      "pg_dump",
      [
        "--format=custom",
        "--compress=6",
        "--no-owner",
        "--no-privileges",
        '--exclude-table-data="LoginAttempt"',
        `--file=${file}`,
      ],
      pgEnv,
    );
    if (dump.code !== 0) {
      throw new Error(
        `pg_dump failed (exit ${dump.code}): ${redactSecrets(dump.stderr, secrets).trim()}`,
      );
    }

    // 3. The file must be a readable archive with the tables we cannot live without.
    const bytes = statSync(file).size;
    if (bytes < MIN_DUMP_BYTES) throw new Error(`dump is suspiciously small (${bytes} bytes)`);
    const toc = await run("pg_restore", ["--list", file], {});
    if (toc.code !== 0)
      throw new Error(`pg_restore --list failed: ${redactSecrets(toc.stderr, secrets).trim()}`);
    const tables = tocDataTables(toc.stdout);
    for (const required of REQUIRED_DATA_ENTRIES) {
      if (!tables.includes(required))
        throw new Error(`dump has no data entry for table ${required}`);
    }
    if (tables.includes("LoginAttempt"))
      throw new Error("dump contains LoginAttempt data (must be excluded)");
    const sha256 = await sha256File(file);
    log(`dump ok: ${bytes} bytes, ${tables.length} tables with data`);

    // 4. Copy to every destination and check what arrived; 5. prune there (only names this
    //    script makes; the newest backups are always kept).
    const done: BackupSummary["destinations"] = [];
    const failures: string[] = [];
    for (const { name, store } of deps.destinations) {
      try {
        await store.put(key, file, bytes, sha256);
        const stored = await store.head(key);
        if (!stored || stored.bytes !== bytes) {
          throw new Error(
            `upload check failed: expected ${bytes} bytes, found ${stored?.bytes ?? "nothing"}`,
          );
        }
        log(`${name}: stored ${key}`);

        const backups = (await store.list(config.prefix))
          .map((o) => o.key)
          .filter((k) => parseBackupTime(k, config.prefix) !== null);
        const expired = selectExpiredBackups(backups, {
          prefix: config.prefix,
          now,
          retentionWeeks: config.retentionWeeks,
          keepNewest: config.keepNewest,
        });
        for (const old of expired) {
          await store.delete(old);
          log(`${name}: pruned ${old}`);
        }
        done.push({ name, pruned: expired, remaining: backups.length - expired.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${name}: ${redactSecrets(message, secrets)}`);
        log(`${name}: FAILED`);
      }
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
    return { key, bytes, sha256, dataTables: tables.length, destinations: done };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export type VerifySummary = {
  key: string | null;
  /** Whole hours since the backup was taken (from its name); null for a file with another name. */
  ageHours: number | null;
  tables: number;
  migrations: number;
  admins: number;
  rowCounts: Record<string, number>;
};

/** Counts per table, from the live database. */
export async function countRows(client: Client): Promise<Record<string, number>> {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const out = await client.query(
      `SELECT count(*)::int AS n FROM "${table_name.replace(/"/g, '""')}"`,
    );
    counts[table_name] = out.rows[0].n;
  }
  return counts;
}

/**
 * Restores a backup into an EMPTY scratch database and checks that the data is really there:
 * migrations table complete, an active admin, the settings row, and row counts per table.
 * Refuses a non-empty target and the production database (compared with the given identities).
 * With `maxAgeHours` it also refuses a backup that is too old: that is how a backup job that has
 * silently stopped on the server is noticed.
 */
export async function runRestoreVerify(options: {
  targetUrl: string;
  /** Either a local dump file or a store + key (default: the newest backup under `prefix`). */
  file?: string;
  store?: BackupStore;
  prefix?: string;
  key?: string;
  /** Databases that must never be a restore target (the production URLs). */
  protectedUrls?: Array<string | undefined>;
  /** The backup must not be older than this (age from its name). */
  maxAgeHours?: number;
  now?: Date;
  log?: (line: string) => void;
}): Promise<VerifySummary> {
  const log = options.log ?? (() => {});
  const now = options.now ?? new Date();
  const targetIdentity = databaseIdentity(options.targetUrl);
  for (const url of options.protectedUrls ?? []) {
    if (url && databaseIdentity(url) === targetIdentity) {
      throw new Error("refusing to restore into a protected (production) database");
    }
  }
  const secrets = [options.targetUrl, new URL(options.targetUrl).password];
  const dir = mkdtempSync(path.join(tmpdir(), "nudel-restore-"));
  try {
    let file = options.file;
    let key: string | null = options.key ?? null;
    let ageHours: number | null = null;
    const checkAge = (name: string) => {
      ageHours = backupAgeHours(name, now);
      if (options.maxAgeHours === undefined) return;
      if (ageHours === null) {
        throw new Error(`cannot tell the age of "${path.basename(name)}" from its name`);
      }
      if (ageHours > options.maxAgeHours) {
        throw new Error(
          `the newest backup ${name} is ${ageHours} hours old (limit: ${options.maxAgeHours}): the backup job has stopped or cannot reach its destination`,
        );
      }
    };
    if (file) checkAge(file);
    if (!file) {
      if (!options.store) throw new Error("either a file or a store is required");
      if (!key) {
        const prefix = options.prefix ?? "";
        const candidates = (await options.store.list(prefix))
          .filter((o) => /nudel-\d{8}T\d{6}Z\.dump$/.test(o.key))
          .sort((a, b) => (a.key < b.key ? 1 : -1));
        if (candidates.length === 0) throw new Error(`no backup found under "${prefix}"`);
        key = candidates[0]!.key;
      }
      checkAge(key);
      file = path.join(dir, path.basename(key));
      await options.store.get(key, file);
      log(`downloaded ${key}`);
    }

    const target = new Client({
      connectionString: options.targetUrl,
      connectionTimeoutMillis: 20_000,
    });
    await target.connect();
    try {
      const existing = await target.query(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      if (existing.rows[0].n !== 0) {
        throw new Error(
          "the target database is not empty; restore only into a new, empty database",
        );
      }
      const targetEnv = pgEnvFromUrl(options.targetUrl);
      const restore = await run(
        "pg_restore",
        [
          "--no-owner",
          "--no-privileges",
          "--exit-on-error",
          "--single-transaction",
          `--dbname=${targetEnv.PGDATABASE}`,
          file,
        ],
        targetEnv,
      );
      if (restore.code !== 0) {
        throw new Error(
          `pg_restore failed (exit ${restore.code}): ${redactSecrets(restore.stderr, secrets).trim()}`,
        );
      }
      log("restore finished");

      const migrations = await target.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE finished_at IS NULL)::int AS unfinished FROM _prisma_migrations`,
      );
      if (migrations.rows[0].total < 1)
        throw new Error("restored database has no applied migrations");
      if (migrations.rows[0].unfinished > 0)
        throw new Error("restored database has unfinished migrations");
      const admins = await target.query(
        `SELECT count(*)::int AS n FROM "User" WHERE role = 'ADMIN' AND active`,
      );
      if (admins.rows[0].n < 1) throw new Error("restored database has no active admin");
      const settings = await target.query(`SELECT count(*)::int AS n FROM "Settings"`);
      if (settings.rows[0].n !== 1)
        throw new Error("restored database does not have exactly one Settings row");
      const login = await target.query(`SELECT count(*)::int AS n FROM "LoginAttempt"`);
      if (login.rows[0].n !== 0) throw new Error("restored database contains LoginAttempt rows");
      const rowCounts = await countRows(target);
      return {
        key,
        ageHours,
        tables: Object.keys(rowCounts).length,
        migrations: migrations.rows[0].total,
        admins: admins.rows[0].n,
        rowCounts,
      };
    } finally {
      await target.end();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
