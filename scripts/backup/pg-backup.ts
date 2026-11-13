/**
 * Database backup (NUD-094, NUD-200): `pnpm backup:db`. Runs where the database is reachable: on
 * the production server, started every night by the systemd timer of deploy/backup/. Dumps the
 * MASTER DATA of the database with pg_dump (settings, users, customers, products, standing tours,
 * standing orders - never orders, tours, payments or the change history; scripts/lib/backup.ts),
 * checks the dump, stores it in a folder on the server (BACKUP_LOCAL_DIR) and, only if someone
 * configures one, in a bucket (BACKUP_S3_*), and prunes backups older than 8 weeks in each.
 * Never prints connection strings or keys. Exit code 1 on any problem. See docs/runbook.md.
 */
import { readBackupConfig, redactSecrets } from "../lib/backup";
import { type BackupDestination, runBackup } from "./core";
import { createLocalBackupStore, createS3BackupStore } from "./store";

async function main() {
  const parsed = readBackupConfig(process.env);
  if (!parsed.ok) {
    console.error(
      `backup configuration problem:\n${parsed.errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    process.exit(1);
  }
  const { config } = parsed;
  const destinations: BackupDestination[] = [];
  if (config.localDir) {
    destinations.push({
      name: `folder ${config.localDir}`,
      store: createLocalBackupStore(config.localDir),
    });
  }
  if (config.s3) {
    destinations.push({
      name: `bucket ${config.s3.bucket}`,
      store: createS3BackupStore(config.s3),
    });
  }
  const summary = await runBackup(config, {
    destinations,
    log: (line) => console.log(`[backup] ${line}`),
  });
  console.log(
    `[backup] done: ${summary.key} (${summary.bytes} bytes, sha256 ${summary.sha256}, ${summary.dataTables} tables with data)`,
  );
  for (const d of summary.destinations) {
    console.log(`[backup] ${d.name}: ${d.remaining} backups kept, ${d.pruned.length} pruned`);
  }
  if (!config.s3) {
    console.log(
      "[backup] note: stored on this machine only (no BACKUP_S3_* bucket is configured); the backups are lost together with the server.",
    );
  }
}

main().catch((error: unknown) => {
  const secrets = [
    process.env.BACKUP_DATABASE_URL,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.DATABASE_URL,
    process.env.BACKUP_S3_SECRET_ACCESS_KEY,
    process.env.BACKUP_S3_ACCESS_KEY_ID,
  ];
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backup] FAILED: ${redactSecrets(message, secrets)}`);
  process.exit(1);
});
