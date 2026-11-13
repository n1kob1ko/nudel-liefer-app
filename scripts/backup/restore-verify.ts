/**
 * Test restore (NUD-094, NUD-200):
 * `pnpm backup:verify [--key <object key>] [--file <local dump>] [--max-age-hours <n>]`.
 * Restores a backup (default: the newest in the backup bucket, without a bucket the newest in
 * BACKUP_LOCAL_DIR; or a local file) into an EMPTY scratch database and checks the data. With
 * --max-age-hours it fails when that backup is older: the daily GitHub check uses this to notice
 * a backup job that has stopped on the server. Target: RESTORE_DATABASE_URL (never production: it
 * refuses BACKUP_DATABASE_URL, DATABASE_URL and a non-empty database). See docs/runbook.md.
 */
import { appendFileSync } from "node:fs";

import { readBackupConfig, redactSecrets } from "../lib/backup";
import { runRestoreVerify } from "./core";
import { createLocalBackupStore, createS3BackupStore } from "./store";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const targetUrl = process.env.RESTORE_DATABASE_URL?.trim();
  if (!targetUrl) {
    console.error("RESTORE_DATABASE_URL is not set (an empty scratch database)");
    process.exit(1);
  }
  const file = arg("--file");
  const maxAge = arg("--max-age-hours");
  if (maxAge !== undefined && (!/^\d+$/.test(maxAge) || Number(maxAge) < 1)) {
    console.error("--max-age-hours must be a whole number of hours (1 or more)");
    process.exit(1);
  }
  let store;
  let prefix: string | undefined;
  if (!file) {
    const parsed = readBackupConfig({
      BACKUP_DATABASE_URL: "postgresql://unused/unused",
      ...process.env,
    });
    if (!parsed.ok) {
      console.error(
        `backup configuration problem:\n${parsed.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
      process.exit(1);
    }
    const { s3, localDir } = parsed.config;
    store = s3 ? createS3BackupStore(s3) : createLocalBackupStore(localDir!);
    console.log(`[verify] source: ${s3 ? `bucket ${s3.bucket}` : `folder ${localDir}`}`);
    prefix = parsed.config.prefix;
  }
  const summary = await runRestoreVerify({
    targetUrl,
    file,
    store,
    prefix,
    key: arg("--key"),
    maxAgeHours: maxAge === undefined ? undefined : Number(maxAge),
    protectedUrls: [
      process.env.BACKUP_DATABASE_URL,
      process.env.DATABASE_URL,
      process.env.DATABASE_URL_UNPOOLED,
    ],
    log: (line) => console.log(`[verify] ${line}`),
  });
  const age = summary.ageHours === null ? "age unknown" : `${summary.ageHours} hours old`;
  console.log(
    `[verify] OK: ${summary.key ?? "local file"} (${age}) restored; ${summary.tables} tables, ${summary.migrations} migrations, ${summary.admins} active admin(s)`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Database backup check\n\n- newest backup: \`${summary.key ?? "local file"}\` (${age})\n- restored into an empty database: ${summary.tables} tables, ${summary.migrations} migrations, ${summary.admins} active admin(s)\n`,
    );
  }
  console.log(
    Object.entries(summary.rowCounts)
      .map(([table, n]) => `  ${table}: ${n}`)
      .join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[verify] FAILED: ${redactSecrets(message, [process.env.RESTORE_DATABASE_URL, process.env.BACKUP_S3_SECRET_ACCESS_KEY])}`,
  );
  process.exit(1);
});
